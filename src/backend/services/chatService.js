// Nghiệp vụ nhắn tin 1–1 (spec 4.3–4.5). Route REST bây giờ và socket ở P14 đều gọi vào đây; luật quyền nằm ở chatGate.
// Nguyên tắc không được phá: mọi truy vấn cuộc trò chuyện đều có điều kiện participants là người gọi (lấy từ token), và
// MongoDB là nguồn sự thật: tin chỉ được coi là đã gửi khi transaction ghi tin đã commit.
const User = require('../models/User');
const ChatMember = require('../models/ChatMember');
const RunnerProfile = require('../models/RunnerProfile');
const CommunityProfile = require('../models/CommunityProfile');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Block = require('../models/Block');
const { pairKeyOf, LAST_TEXT_MAX } = require('../models/Conversation');
const { TEXT_MAX } = require('../models/Message');
const { CHAT_CONSENT } = require('../../lib/communityConsent.cjs');
const { isAtLeastAge } = require('../lib/age');
const { MIN_AGE, inviteTarget, checkPair, assertSelfEligible, unavailable } = require('./chatGate');
const { assertInviteQuota, assertDailyMessageQuota, messageQuotaError } = require('./chatLimits');
const chatNotifier = require('./chatNotifier');
const transaction = require('./transaction');
const mongoose = require('mongoose');
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
  const raw = body?.clientMessageId;
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw httpError(400, 'Mã tin nhắn không hợp lệ.', errorCodes.CHAT_MESSAGE_INVALID);
  }
  // UUID không phân biệt hoa thường; lưu chữ thường để lần gửi lại viết hoa vẫn được nhận ra là cùng một tin.
  return { text, clientMessageId: raw.toLowerCase() };
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
  const isRequester = same(conversation.requesterId, userId);
  return {
    id: String(conversation._id),
    // Người mời không được biết lời mời bị từ chối hay bị chặn từ hộp Lời mời (spec T9, phản biện 26-11): với họ,
    // DECLINED vẫn hiện là REQUEST ("Đang chờ chấp nhận"). Người nhận vẫn thấy đúng DECLINED.
    status: isRequester && conversation.status === 'DECLINED' ? 'REQUEST' : conversation.status,
    isRequester,
    other: people.get(String(otherOf(conversation, userId))) ?? UNKNOWN_PERSON,
    lastMessage: {
      seq: conversation.lastMessage.seq,
      mine: same(conversation.lastMessage.senderId, userId),
      text: conversation.lastMessage.text,
    },
    lastMessageAt: conversation.lastMessageAt,
    unread: (conversation.unreadBy ?? []).some(id => same(id, userId)),
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
  // targetId null nghĩa là handle không còn trỏ tới ai (người nhận vừa xóa hồ sơ): vẫn là lần gửi lại hợp lệ. Chỉ khi
  // handle trỏ tới một người khác thì mới là dùng lại mã.
  const sameInvite = conversation && message.seq === 1 && same(conversation.requesterId, senderId)
    && (!targetId || same(otherOf(conversation, senderId), targetId));
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
    // Sau commit, ngoài transaction, không chờ: báo người nhận có lời mời mới.
    chatNotifier.notify([targetId], { conversationId: conversation._id, seq: 1 });
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
  if (current.status === 'ACTIVE') return presentOne(current, userId); // bấm đúp hay giao diện cũ: không thành lỗi
  if (same(current.requesterId, userId)) throw notActive();

  const gate = await checkPair(userId, otherOf(current, userId), { now });
  if (gate.selfError) throw gate.selfError;
  if (!gate.open) throw unavailable();

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

/**
 * Tin đã gửi trước đó với cùng clientMessageId. Cùng cuộc → 200 tin đó (gửi lại); cuộc khác → 409.
 * @returns {Promise<{ status: 200, message: object } | null>} null khi mã chưa được dùng.
 */
async function previousMessage(senderId, conversationId, clientMessageId) {
  const message = await Message.findOne({ senderId, clientMessageId }).lean();
  if (!message) return null;
  if (!same(message.conversationId, conversationId)) throw clientIdReused();
  return { status: 200, message: presentMessage(message, senderId) };
}

/**
 * Gửi một tin vào cuộc ACTIVE (spec 4.4). Đây là hàm P14 gọi lại; socket không có đường ghi tin nào khác.
 *
 * Vì sao seq không trùng dù nhiều tin gửi cùng lúc: bước (a) tăng lastSeq của cuộc trò chuyện bằng một lệnh ghi
 * nguyên tử (atomic, MongoDB làm trọn trong một bước) và lấy về giá trị mới. Hai transaction cùng sửa một cuộc thì cái
 * sau phải chờ cái trước commit hoặc bị hủy rồi chạy lại, nên mỗi tin nhận một số khác nhau, liền mạch. Nếu bước (b)
 * ghi tin lỗi thì cả transaction bị hủy, lastSeq quay về như cũ, không để lại lỗ hổng.
 *
 * @param {string} userId Người gửi (từ token).
 * @param {string} rawId Id cuộc trò chuyện (từ URL).
 * @param {{ text: unknown, clientMessageId: unknown }} body
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ status: 200 | 201, message: object }>}
 */
async function sendMessage(userId, rawId, body, { now = new Date() } = {}) {
  const { text, clientMessageId } = readMessageInput(body);
  const conversation = await findMine(userId, rawId);
  const otherId = otherOf(conversation, userId);

  // Ba phần kiểm (gửi lại, cổng hai phía, giới hạn) chỉ đọc và không phụ thuộc nhau, nên đọc song song trong một lượt
  // chờ MongoDB thay vì bốn lượt nối tiếp như trước. Kết quả vẫn xét theo thứ tự cũ: gửi lại (mất mạng, bấm đúp) được nhận ra
  // trước mọi giới hạn, để tin đã lưu không bị báo lỗi oan; rồi cổng của chính người gửi, trạng thái cuộc, cổng hai
  // phía, giới hạn. Dùng allSettled chứ không dùng Promise.all: một lệnh đọc phụ lỗi (mất kết nối tạm thời) chỉ được
  // báo khi tới lượt nó, không được che kết quả gửi lại hay 409 đứng trước, đúng như khi các bước còn chạy nối tiếp.
  const settled = await Promise.allSettled([
    previousMessage(userId, conversation._id, clientMessageId),
    checkPair(userId, otherId, { now }),
    messageQuotaError(userId, now),
  ]);
  const take = index => {
    if (settled[index].status === 'rejected') throw settled[index].reason;
    return settled[index].value;
  };
  const retried = take(0);
  if (retried) return retried;
  const gate = take(1);
  if (gate.selfError) throw gate.selfError;
  if (conversation.status !== 'ACTIVE') throw notActive();
  if (!gate.open) throw unavailable();
  const quotaError = take(2);
  if (quotaError) throw quotaError;

  let saved;
  try {
    saved = await transaction(async session => {
      // (a) Tăng lastSeq và cập nhật phần xem trước trong một lệnh. Dùng update pipeline để lastMessage.seq lấy đúng
      // giá trị lastSeq mới. Trong pipeline, chuỗi bắt đầu bằng "$" là tên trường, nên nội dung tin phải bọc $literal.
      const nextSeq = { $add: ['$lastSeq', 1] };
      const updated = await Conversation.findOneAndUpdate(
        { _id: conversation._id, participants: userId, status: 'ACTIVE' },
        [{ $set: {
          lastSeq: nextSeq,
          lastMessage: { seq: nextSeq, senderId: new mongoose.Types.ObjectId(String(userId)), text: { $literal: preview(text) } },
          lastMessageAt: now,
          updatedAt: now,
          // Người kia có tin chưa đọc; người gửi thì đang xem cuộc này nên không còn tính là chưa đọc.
          unreadBy: { $setUnion: [
            // $ifNull: cuộc thiếu trường unreadBy (dữ liệu cũ) không làm pipeline ghi null rồi hỏng lệnh $pull khi đọc.
            { $setDifference: [{ $ifNull: ['$unreadBy', []] }, [new mongoose.Types.ObjectId(String(userId))]] },
            [new mongoose.Types.ObjectId(String(otherId))],
          ] },
        } }],
        { new: true, session, timestamps: false },
      ).lean();
      if (!updated) throw notActive(); // vừa bị chuyển trạng thái giữa lúc kiểm và lúc ghi
      // (b) Ghi tin với seq vừa cấp.
      const [message] = await Message.create([{
        conversationId: conversation._id, seq: updated.lastSeq, senderId: userId, clientMessageId, text, createdAt: now,
      }], { session });
      return message.toObject();
    });
  } catch (error) {
    // Hai lần gửi cùng mã chạy song song: transaction thua đã bị hủy (lastSeq không tăng), đọc tin của bên thắng.
    if (!isDuplicateOf(error, 'clientMessageId')) throw error;
    const again = await previousMessage(userId, conversation._id, clientMessageId);
    if (again) return again;
    throw error;
  }

  // Sau commit, ngoài transaction, không chờ. Phát cho cả người gửi để tab thứ hai của chính họ cũng cập nhật.
  chatNotifier.notify([otherId, userId], { conversationId: conversation._id, seq: saved.seq });
  return { status: 201, message: presentMessage(saved, userId) };
}

const MESSAGE_PAGE_MAX = 50;
const CONVERSATION_PAGE = 20;
const SEQ_PATTERN = /^(0|[1-9]\d{0,8})$/;

function invalidQuery(message) {
  return httpError(400, message, errorCodes.INVALID_QUERY);
}

// Số nguyên không âm từ query string; mảng hay object (ví dụ ?afterSeq[$gt]=0) đều bị từ chối.
function readSeq(raw, name, min) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !SEQ_PATTERN.test(raw) || Number(raw) < min) throw invalidQuery(`${name} không hợp lệ.`);
  return Number(raw);
}

/**
 * Lấy tin của một cuộc (GET /conversations/:id/messages). Người tham gia luôn đọc được, ở mọi trạng thái, kể cả khi
 * bị chặn hay đã rút đồng ý (T13).
 *
 * Phân trang bằng con trỏ seq thay vì "trang số N": afterSeq=X lấy các tin có seq > X (lấy bù tin mới), beforeSeq=X
 * lấy các tin có seq < X (cuộn lên xem tin cũ). Seq của một tin không bao giờ đổi, nên tin mới tới giữa hai lần lấy
 * không làm các trang trượt đi: không trùng, không sót. Với "trang số N" (skip), một tin mới đẩy mọi tin lùi một chỗ và
 * trang sau lặp lại tin cuối của trang trước.
 *
 * @param {{ afterSeq?: string, beforeSeq?: string, limit?: string }} query
 * @returns {Promise<{ messages: object[], hasMore: boolean }>} Tin theo seq tăng dần.
 */
async function listMessages(userId, rawId, query = {}) {
  const afterSeq = readSeq(query.afterSeq, 'afterSeq', 0);
  const beforeSeq = readSeq(query.beforeSeq, 'beforeSeq', 1);
  const limit = readSeq(query.limit, 'limit', 1) ?? MESSAGE_PAGE_MAX;
  if (limit > MESSAGE_PAGE_MAX) throw invalidQuery(`limit tối đa ${MESSAGE_PAGE_MAX}.`);
  if (afterSeq !== undefined && beforeSeq !== undefined) throw invalidQuery('Chỉ dùng một trong afterSeq hoặc beforeSeq.');

  const conversation = await findMine(userId, rawId);
  const present = rows => rows.map(message => presentMessage(message, userId));
  // Đọc dư một tin để biết còn trang nữa hay không (hasMore).
  if (afterSeq !== undefined) {
    const rows = await Message.find({ conversationId: conversation._id, seq: { $gt: afterSeq } }).sort({ seq: 1 }).limit(limit + 1).lean();
    return { messages: present(rows.slice(0, limit)), hasMore: rows.length > limit };
  }
  // Không có con trỏ thì lấy trang mới nhất; beforeSeq lấy trang ngay trước đó. Đọc từ mới về cũ rồi đảo lại.
  const seq = beforeSeq !== undefined ? { seq: { $lt: beforeSeq } } : {};
  const newestFirst = await Message.find({ conversationId: conversation._id, ...seq }).sort({ seq: -1 }).limit(limit + 1).lean();
  return { messages: present(newestFirst.slice(0, limit).reverse()), hasMore: newestFirst.length > limit };
}

/**
 * Con trỏ của danh sách cuộc trò chuyện: lastMessageAt và _id của cuộc cuối trang trước. Chỉ lastMessageAt thì chưa
 * đủ, vì hai cuộc có thể trùng đúng một mili giây và cuộc thứ hai bị bỏ sót ở ranh giới trang; _id phá hòa, nên cặp
 * (lastMessageAt, _id) là duy nhất. `before` đứng một mình (không beforeId) vẫn được nhận, theo spec 4.3.
 * @returns {object | null} Điều kiện "đứng sau con trỏ" khi sắp { lastMessageAt: -1, _id: -1 }.
 */
function readConversationCursor({ before: rawBefore, beforeId } = {}) {
  if (rawBefore === undefined) {
    if (beforeId !== undefined) throw invalidQuery('beforeId phải đi kèm before.');
    return null;
  }
  const before = typeof rawBefore === 'string' ? new Date(rawBefore) : null;
  if (!before || !Number.isFinite(before.getTime())) throw invalidQuery('before phải là thời điểm dạng ISO.');
  if (beforeId === undefined) return { lastMessageAt: { $lt: before } };
  if (typeof beforeId !== 'string' || !OBJECT_ID.test(beforeId)) throw invalidQuery('beforeId không hợp lệ.');
  const id = new mongoose.Types.ObjectId(beforeId);
  return { $or: [{ lastMessageAt: { $lt: before } }, { lastMessageAt: before, _id: { $lt: id } }] };
}

/**
 * Danh sách cuộc trò chuyện (GET /conversations?box=chats|invites&before=<ISO>&beforeId=<id>), 20 cuộc mới nhất trước.
 *   - invites: lời mời người khác gửi tới mình, đang chờ trả lời.
 *   - chats: cuộc đã ACTIVE, cộng lời mời mình đã gửi (REQUEST hay DECLINED, giao diện ghi "Chưa được chấp nhận").
 * Lời mời mình đã từ chối không nằm ở hộp nào; bấm "Nhắn tin" với người đó sẽ được trỏ về cuộc này (T14).
 * @returns {Promise<{ conversations: object[], hasMore: boolean }>}
 */
async function listConversations(userId, query = {}) {
  const box = query.box ?? 'chats';
  if (box !== 'chats' && box !== 'invites') throw invalidQuery('box chỉ là chats hoặc invites.');
  const cursor = readConversationCursor(query);
  const me = new mongoose.Types.ObjectId(String(userId));
  const boxFilter = box === 'invites'
    ? { status: 'REQUEST', requesterId: { $ne: me } }
    : { $or: [{ status: 'ACTIVE' }, { requesterId: me }] };
  const filter = { participants: me, ...(cursor ? { $and: [boxFilter, cursor] } : boxFilter) };
  const rows = await Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).limit(CONVERSATION_PAGE + 1).lean();
  const shown = rows.slice(0, CONVERSATION_PAGE);
  const people = await loadPeople(shown.map(row => otherOf(row, userId)));
  return { conversations: shown.map(row => presentConversation(row, userId, people)), hasMore: rows.length > CONVERSATION_PAGE };
}

/**
 * Chặn người kia trong một cuộc (POST /conversations/:id/block). Người nhận lời mời chặn được ngay từ hộp Lời mời.
 * Không cần cổng chat: người bị khóa hay đã rút đồng ý vẫn phải chặn được kẻ quấy rối (T13). Chặn lần hai không lỗi.
 * Người chặn được bỏ khỏi unreadBy, để cuộc này không còn hiện là chưa đọc.
 * Từ lúc này chatGate thấy Block: hai bên không gửi tin, không mời nhau và không xem hồ sơ của nhau được nữa.
 * @returns {Promise<void>}
 */
async function blockConversation(userId, rawId) {
  const conversation = await findMine(userId, rawId);
  try {
    await Block.create({ blockerId: userId, blockedId: otherOf(conversation, userId) });
  } catch (error) {
    if (!isDuplicateOf(error, 'blockerId')) throw error; // đã chặn từ trước
  }
  await Conversation.updateOne({ _id: conversation._id, participants: userId }, { $pull: { unreadBy: userId } });
  // Người nhận chặn ngay từ hộp Lời mời: coi như từ chối luôn, để lời mời rời hộp (nếu không, nó nằm đó mà bấm Chấp
  // nhận thì bị cổng chặn). Bỏ chặn rồi vẫn chấp nhận lại được như mọi lời mời đã từ chối (T14).
  await Conversation.updateOne(
    { _id: conversation._id, participants: userId, status: 'REQUEST', requesterId: { $ne: userId } },
    { $set: { status: 'DECLINED' } },
  );
}

const BLOCK_LIST_MAX = 200;

/**
 * Những người mình đã chặn (GET /blocks), mới nhất trước. `id` là id của bản ghi chặn (dùng để bỏ chặn), không phải id
 * người dùng (T2). Người bị chặn không thấy gì ở đây.
 * @returns {Promise<{ blocks: Array<{ id: string, displayName: string, avatarTheme: string }> }>}
 */
async function listBlocks(userId) {
  const rows = await Block.find({ blockerId: userId }).sort({ createdAt: -1 }).limit(BLOCK_LIST_MAX).lean();
  const people = await loadPeople(rows.map(row => row.blockedId));
  return {
    blocks: rows.map(row => {
      const { displayName, avatarTheme } = people.get(String(row.blockedId)) ?? UNKNOWN_PERSON;
      return { id: String(row._id), displayName, avatarTheme };
    }),
  };
}

/**
 * Bỏ chặn (DELETE /blocks/:id). Chỉ xóa được bản ghi chặn của chính mình; id sai định dạng, không tồn tại hay của người
 * khác đều nhận cùng một 404.
 * @returns {Promise<void>}
 */
async function unblock(userId, rawId) {
  const missing = () => httpError(404, 'Không tìm thấy người trong danh sách chặn.', errorCodes.CHAT_NOT_FOUND);
  if (typeof rawId !== 'string' || !OBJECT_ID.test(rawId)) throw missing();
  const { deletedCount } = await Block.deleteOne({ _id: rawId, blockerId: userId });
  if (!deletedCount) throw missing();
}

/**
 * Đánh dấu đã đọc (POST /conversations/:id/read, spec 4.5). Client gửi upToSeq là seq lớn nhất đang hiện trên màn hình.
 * Server chỉ bỏ người đọc khỏi unreadBy khi lastSeq của cuộc đúng bằng upToSeq: nếu có tin mới tới sau lúc client vẽ
 * màn hình thì lastSeq đã lớn hơn, lệnh không khớp, và cuộc vẫn còn chưa đọc. Không cần cổng chat, vì người tham gia
 * luôn đọc được cuộc của mình (T13).
 * Đường thường gặp tốn đúng một lệnh cập nhật; chỉ khi không khớp mới đọc thêm để phân biệt "chưa đọc hết" với "không
 * phải cuộc của bạn" (404 giống hệt các chỗ khác).
 * @param {string} userId Người đọc (từ token).
 * @param {string} rawId Id cuộc trò chuyện (từ URL).
 * @param {{ upToSeq: unknown }} body
 * @returns {Promise<void>}
 */
async function markRead(userId, rawId, body) {
  const id = readConversationId(rawId);
  const upToSeq = body?.upToSeq;
  if (!Number.isSafeInteger(upToSeq) || upToSeq < 1) {
    throw httpError(400, 'upToSeq phải là số nguyên dương.', errorCodes.CHAT_READ_INVALID);
  }
  const me = new mongoose.Types.ObjectId(String(userId));
  // timestamps: false vì đọc tin không phải là thay đổi của cuộc trò chuyện.
  const result = await Conversation.updateOne(
    { _id: id, participants: me, lastSeq: upToSeq },
    { $pull: { unreadBy: me } },
    { timestamps: false },
  );
  if (!result.matchedCount) await findMine(userId, id);
}

/**
 * Số cuộc trò chuyện có tin chưa đọc, cho huy hiệu "Tin nhắn" (GET /api/chat/unread, D6). Lời mời đang chờ đã có người
 * nhận trong unreadBy nên được đếm luôn; cuộc DECLINED không đếm. Một lệnh đếm trên index { unreadBy: 1 }.
 * @returns {Promise<{ count: number }>}
 */
/**
 * Một cuộc trò chuyện như người gọi thấy (GET /conversations/:id), để liên kết /messages?c=<id> mở được cả cuộc không
 * nằm ở trang đầu của hai hộp. Người ngoài cuộc nhận cùng một 404 như mọi chỗ khác.
 * @returns {Promise<object>}
 */
async function getConversation(userId, rawId) {
  return presentOne(await findMine(userId, rawId), userId);
}

async function unreadCount(userId) {
  const count = await Conversation.countDocuments({ unreadBy: userId, status: { $ne: 'DECLINED' } }).maxTimeMS(1500);
  return { count };
}

module.exports = {
  getMe, giveConsent, withdrawConsent, createInvite, acceptConversation, declineConversation,
  sendMessage, listMessages, listConversations, blockConversation, listBlocks, unblock, markRead, unreadCount, getConversation,
  // dùng lại ở các task sau (gửi tin, lấy tin, chặn)
  readMessageInput, findMine, otherOf, loadPeople, presentConversation, presentMessage, notFound, notActive,
};
