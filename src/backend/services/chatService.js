// Nghiệp vụ nhắn tin 1–1 (spec 4.3–4.5). Route REST bây giờ và socket ở P14 đều gọi vào đây; luật quyền nằm ở chatGate.
// Nguyên tắc không được phá: mọi truy vấn cuộc trò chuyện đều có điều kiện participants là người gọi (lấy từ token), và
// MongoDB là nguồn sự thật: tin chỉ được coi là đã gửi khi transaction ghi tin đã commit.
const User = require('../models/User');
const ChatMember = require('../models/ChatMember');
const RunnerProfile = require('../models/RunnerProfile');
const CommunityProfile = require('../models/CommunityProfile');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { pairKeyOf, LAST_TEXT_MAX } = require('../models/Conversation');
const { TEXT_MAX } = require('../models/Message');
const { CHAT_CONSENT } = require('../../lib/communityConsent.cjs');
const { isAtLeastAge } = require('../lib/age');
const { MIN_AGE, inviteTarget, pairOpen, assertSelfEligible, unavailable } = require('./chatGate');
const { assertInviteQuota, assertDailyMessageQuota } = require('./chatLimits');
const transaction = require('./transaction');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const isDuplicateOf = (error, field) => error?.code === 11000 && Boolean(error.keyPattern?.[field]);
const same = (x, y) => String(x) === String(y);

// Mọi trường hợp không đọc được một cuộc (id sai định dạng, không tồn tại, người gọi không tham gia) trả đúng lỗi này,
// body giống hệt, để người ngoài không phân biệt được "không có" với "có nhưng không phải của bạn" (spec T10).
const notFound = () => httpError(404, 'Không tìm thấy cuộc trò chuyện.', errorCodes.CHAT_NOT_FOUND);
const notActive = () => httpError(409, 'Cuộc trò chuyện chưa được chấp nhận hoặc không còn nhận tin.', errorCodes.CHAT_NOT_ACTIVE);
const conversationExists = conversationId => Object.assign(
  httpError(409, 'Hai bạn đã có cuộc trò chuyện.', errorCodes.CHAT_CONVERSATION_EXISTS), { conversationId: String(conversationId) });
const clientIdReused = () => httpError(409, 'Mã tin nhắn này đã được dùng cho một tin khác.', errorCodes.CHAT_CLIENT_ID_REUSED);

/**
 * Kiểm phần nội dung của một tin (spec D5): text 1–1.000 ký tự sau khi cắt khoảng trắng, clientMessageId là UUID.
 * @returns {{ text: string, clientMessageId: string }}
 */
function readMessageInput(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > TEXT_MAX) {
    throw httpError(400, `Tin nhắn phải có từ 1 đến ${TEXT_MAX} ký tự.`, errorCodes.CHAT_MESSAGE_INVALID);
  }
  const clientMessageId = body?.clientMessageId;
  if (typeof clientMessageId !== 'string' || !UUID.test(clientMessageId)) {
    throw httpError(400, 'Mã tin nhắn không hợp lệ.', errorCodes.CHAT_MESSAGE_INVALID);
  }
  return { text, clientMessageId };
}

// 120 ký tự đầu cho phần xem trước trong danh sách; không cắt đôi một emoji (cặp surrogate UTF-16).
function preview(text) {
  const cut = text.slice(0, LAST_TEXT_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * Id cuộc trò chuyện từ URL; sai định dạng thì cùng 404 như không tồn tại.
 * @returns {string}
 */
function readConversationId(raw) {
  if (typeof raw !== 'string' || !OBJECT_ID.test(raw)) throw notFound();
  return raw;
}

// Cuộc trò chuyện người gọi đang tham gia, hoặc 404.
async function findMine(userId, rawId) {
  const conversation = await Conversation.findOne({ _id: readConversationId(rawId), participants: userId }).lean();
  if (!conversation) throw notFound();
  return conversation;
}

const otherOf = (conversation, userId) => conversation.participants.find(id => !same(id, userId));

/**
 * Thông tin hiển thị của những người tham gia (spec 4.2): chỉ { displayName, avatarTheme, handle | null }. Handle tính
 * lúc đọc, không lưu trong cuộc trò chuyện, nên người xóa hồ sơ công khai thì handle thành null (T15).
 * @param {Array<unknown>} userIds
 * @returns {Promise<Map<string, { displayName: string, avatarTheme: string, handle: string | null }>>}
 */
async function loadPeople(userIds) {
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select({ fullName: 1, avatarTheme: 1 }).lean(),
    CommunityProfile.find({ userId: { $in: userIds } }).select({ userId: 1, handle: 1 }).lean(),
  ]);
  const handles = new Map(profiles.map(profile => [String(profile.userId), profile.handle]));
  return new Map(users.map(user => [String(user._id), {
    displayName: user.fullName,
    avatarTheme: user.avatarTheme ?? 'forest',
    handle: handles.get(String(user._id)) ?? null,
  }]));
}

const UNKNOWN_PERSON = { displayName: 'Người dùng RunFurther', avatarTheme: 'forest', handle: null };

/**
 * Cuộc trò chuyện như người gọi thấy (spec 4.3). Không có id người dùng nào: người gửi tin cuối chỉ còn cờ `mine`.
 */
function presentConversation(conversation, userId, people) {
  return {
    id: String(conversation._id),
    status: conversation.status,
    isRequester: same(conversation.requesterId, userId),
    other: people.get(String(otherOf(conversation, userId))) ?? UNKNOWN_PERSON,
    lastMessage: {
      seq: conversation.lastMessage.seq,
      mine: same(conversation.lastMessage.senderId, userId),
      text: conversation.lastMessage.text,
    },
    lastMessageAt: conversation.lastMessageAt,
    unread: conversation.unreadBy.some(id => same(id, userId)),
    ...(conversation.context?.listingId ? { context: { listingId: String(conversation.context.listingId) } } : {}),
  };
}

async function presentOne(conversation, userId) {
  return presentConversation(conversation, userId, await loadPeople([otherOf(conversation, userId)]));
}

/**
 * Một tin như người gọi thấy (spec 4.3): clientMessageId chỉ có ở tin của chính mình, để client thay bong bóng "Đang
 * gửi" bằng tin thật.
 */
function presentMessage(message, userId) {
  const mine = same(message.senderId, userId);
  return {
    seq: message.seq,
    mine,
    text: message.text,
    createdAt: message.createdAt,
    ...(mine ? { clientMessageId: message.clientMessageId } : {}),
  };
}

/**
 * Trạng thái nhắn tin của chính người gọi (GET /api/chat/me).
 * @returns {Promise<{ consent: boolean, consentText: object, locked: boolean, eligible: boolean, realtime: boolean }>}
 */
async function getMe(userId, { now = new Date() } = {}) {
  const [member, runner] = await Promise.all([
    ChatMember.findOne({ userId }).select({ consentAt: 1, lockedAt: 1 }).lean(),
    RunnerProfile.findOne({ userId }).select({ dob: 1 }).lean(),
  ]);
  return {
    consent: Boolean(member?.consentAt),
    consentText: CHAT_CONSENT,
    locked: Boolean(member?.lockedAt),
    eligible: isAtLeastAge(runner?.dob, MIN_AGE, now),
    realtime: false, // P14 thay bằng công tắc thật
  };
}

/**
 * Đồng ý nhắn tin (PUT /api/chat/me/consent). Lưu thời điểm và phiên bản văn bản đã đồng ý (spec T8).
 * @returns {Promise<object>} Như getMe.
 */
async function giveConsent(userId, body, { now = new Date() } = {}) {
  if (body?.consentVersion !== CHAT_CONSENT.version) {
    throw httpError(400, 'Bạn cần đánh dấu đồng ý nhắn tin trước khi bật.', errorCodes.CHAT_CONSENT_REQUIRED);
  }
  const runner = await RunnerProfile.findOne({ userId }).select({ dob: 1 }).lean();
  if (!isAtLeastAge(runner?.dob, MIN_AGE, now)) {
    throw httpError(403, 'Bạn cần đủ 16 tuổi và có ngày sinh trong hồ sơ người chạy để nhắn tin.', errorCodes.CHAT_AGE_REQUIRED);
  }
  const update = { $set: { consentAt: now, consentVersion: CHAT_CONSENT.version } };
  try {
    await ChatMember.updateOne({ userId }, update, { upsert: true });
  } catch (error) {
    // Hai request đồng ý cùng lúc: upsert sau gặp lỗi trùng userId, lúc đó tài liệu đã có nên chỉ cần cập nhật.
    if (!isDuplicateOf(error, 'userId')) throw error;
    await ChatMember.updateOne({ userId }, update);
  }
  return getMe(userId, { now });
}

/**
 * Rút đồng ý (DELETE /api/chat/me/consent). Chỉ xóa hai trường đồng ý; khóa nhắn tin (lockedAt) giữ nguyên (spec T1).
 * @returns {Promise<void>}
 */
async function withdrawConsent(userId) {
  await ChatMember.updateOne({ userId }, { $set: { consentAt: null, consentVersion: null } });
}

/**
 * Lời mời đã gửi trước đó với cùng clientMessageId (client gửi lại vì mất mạng hay bấm đúp). Đúng là lời mời tới cùng
 * người thì trả lại lời mời đó (200); mã đã dùng cho việc khác thì 409.
 * @returns {Promise<{ status: 200, conversation: object, message: object } | null>} null khi mã chưa được dùng.
 */
async function previousInvite(senderId, clientMessageId, targetId) {
  const message = await Message.findOne({ senderId, clientMessageId }).lean();
  if (!message) return null;
  const conversation = await Conversation.findOne({ _id: message.conversationId, participants: senderId }).lean();
  const sameInvite = conversation && message.seq === 1 && same(conversation.requesterId, senderId)
    && targetId && same(otherOf(conversation, senderId), targetId);
  if (!sameInvite) throw clientIdReused();
  return { status: 200, conversation: await presentOne(conversation, senderId), message: presentMessage(message, senderId) };
}

// userId của chủ handle, chỉ để nhận ra lần gửi lại (không kiểm quyền; quyền do inviteTarget kiểm).
async function handleOwner(handle) {
  if (typeof handle !== 'string') return null;
  const profile = await CommunityProfile.findOne({ handle: handle.trim().toLowerCase() }).select({ userId: 1 }).lean();
  return profile ? String(profile.userId) : null;
}

/**
 * Gửi lời mời nhắn tin kèm tin đầu (POST /api/chat/invites, spec 4.4 "Lời mời", T3, T4).
 * Thứ tự: kiểm nội dung → cổng của chính người gửi → nhận ra lần gửi lại → cổng người nhận (404 chung) → cặp đã có
 * cuộc (409 kèm conversationId) → giới hạn → một transaction tạo cuộc REQUEST và tin seq 1.
 * Lần gửi lại được nhận ra trước khi đếm giới hạn, để gửi lại lời mời thứ 5 không bị 429 oan.
 * @returns {Promise<{ status: 200 | 201, conversation: object, message: object }>}
 */
async function createInvite(senderId, body, { now = new Date() } = {}) {
  const { text, clientMessageId } = readMessageInput(body);
  await assertSelfEligible(senderId, { now });

  const retried = await previousInvite(senderId, clientMessageId, await handleOwner(body?.handle));
  if (retried) return retried;

  const targetId = await inviteTarget(senderId, { handle: body?.handle }, { now });
  if (!targetId) throw httpError(404, 'Không tìm thấy người nhận lời mời.', errorCodes.CHAT_TARGET_NOT_FOUND);

  const pairKey = pairKeyOf(senderId, targetId);
  const existing = await Conversation.findOne({ pairKey }).select({ _id: 1 }).lean();
  if (existing) throw conversationExists(existing._id);

  await assertInviteQuota(senderId, now);
  await assertDailyMessageQuota(senderId, now);

  try {
    const { conversation, message } = await transaction(async session => {
      const [createdConversation] = await Conversation.create([{
        participants: [senderId, targetId],
        pairKey,
        status: 'REQUEST',
        requesterId: senderId,
        lastSeq: 1,
        lastMessage: { seq: 1, senderId, text: preview(text) },
        lastMessageAt: now,
        unreadBy: [targetId],
        // createdAt theo `now` để giới hạn lời mời theo ngày đếm đúng cả khi test tiêm thời điểm.
        createdAt: now,
        updatedAt: now,
      }], { session, timestamps: false });
      const [createdMessage] = await Message.create([{
        conversationId: createdConversation._id, seq: 1, senderId, clientMessageId, text, createdAt: now,
      }], { session });
      return { conversation: createdConversation.toObject(), message: createdMessage.toObject() };
    });
    return { status: 201, conversation: await presentOne(conversation, senderId), message: presentMessage(message, senderId) };
  } catch (error) {
    // Hai request đua nhau và cùng qua các bước kiểm phía trên. Transaction thua đã bị hủy, nên đọc lại thứ bên thắng
    // đã ghi: cùng lời mời gửi hai lần → 200 lời mời đó; cùng mã cho người nhận khác → 409 CHAT_CLIENT_ID_REUSED;
    // hai người mời nhau → 409 CHAT_CONVERSATION_EXISTS kèm id cuộc của bên thắng.
    if (!isDuplicateOf(error, 'pairKey') && !isDuplicateOf(error, 'clientMessageId')) throw error;
    const again = await previousInvite(senderId, clientMessageId, targetId);
    if (again) return again;
    const winner = await Conversation.findOne({ pairKey }).select({ _id: 1 }).lean();
    if (winner) throw conversationExists(winner._id);
    throw error;
  }
}

/**
 * Chấp nhận lời mời (POST /conversations/:id/accept, spec 4.4 "Chấp nhận", T13, T14). Chỉ người nhận, khi cuộc đang
 * REQUEST hoặc DECLINED (người đã từ chối đổi ý). Chấp nhận lần hai trả lại cuộc ACTIVE (bấm đúp không thành lỗi).
 * @returns {Promise<object>} Cuộc trò chuyện như người gọi thấy.
 */
async function acceptConversation(userId, rawId, { now = new Date() } = {}) {
  const current = await findMine(userId, rawId);
  const isRecipient = !same(current.requesterId, userId);
  if (isRecipient && current.status === 'ACTIVE') return presentOne(current, userId);
  if (!isRecipient) throw notActive();

  await assertSelfEligible(userId, { now });
  if (!(await pairOpen(userId, otherOf(current, userId), { now }))) throw unavailable();

  const accepted = await Conversation.findOneAndUpdate(
    { _id: current._id, participants: userId, status: { $in: ['REQUEST', 'DECLINED'] }, requesterId: { $ne: userId } },
    { $set: { status: 'ACTIVE' } },
    { new: true },
  ).lean();
  if (accepted) return presentOne(accepted, userId);
  // Một request khác vừa chấp nhận trước: đọc lại trạng thái mới.
  const latest = await findMine(userId, rawId);
  if (latest.status === 'ACTIVE') return presentOne(latest, userId);
  throw notActive();
}

/**
 * Từ chối lời mời (POST /conversations/:id/decline). Chỉ người nhận, chỉ khi REQUEST; không cần cổng chat, vì ai cũng
 * phải từ chối được lời mời gửi tới mình. Từ chối thì bỏ người nhận khỏi unreadBy.
 * @returns {Promise<object>} Cuộc trò chuyện như người gọi thấy.
 */
async function declineConversation(userId, rawId) {
  const current = await findMine(userId, rawId);
  if (same(current.requesterId, userId)) throw notActive();
  const declined = await Conversation.findOneAndUpdate(
    { _id: current._id, participants: userId, status: 'REQUEST', requesterId: { $ne: userId } },
    { $set: { status: 'DECLINED' }, $pull: { unreadBy: userId } },
    { new: true },
  ).lean();
  if (declined) return presentOne(declined, userId);
  const latest = await findMine(userId, rawId);
  if (latest.status === 'DECLINED') return presentOne(latest, userId);
  throw notActive();
}

module.exports = {
  getMe, giveConsent, withdrawConsent, createInvite, acceptConversation, declineConversation,
  // dùng lại ở các task sau (gửi tin, lấy tin, chặn)
  readMessageInput, findMine, otherOf, loadPeople, presentConversation, presentMessage, notFound, notActive,
};
