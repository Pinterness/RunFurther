// Cổng chat (spec D3, T9, T13): mọi luật "ai được nhắn cho ai" nằm ở đây, để route REST bây giờ và bắt tay socket ở
// P14 dùng chung một chỗ. Ba câu hỏi:
//   - senderEligible: chính người này có được nhắn tin không (ACTIVE, đủ 16 tuổi theo ngày sinh hiện tại, đã đồng ý
//     nhắn tin, không bị khóa). Kiểm lại ở mọi lệnh, vì ngày sinh và đồng ý đổi được bất cứ lúc nào.
//   - pairOpen: hai người trong một cuộc còn nhắn cho nhau được không (cả hai đạt senderEligible, không có Block chiều
//     nào). Hồ sơ công khai không cần ở đây: xóa hồ sơ không làm đóng cuộc đang có. Route gửi tin và chấp nhận dùng
//     checkPair: cùng phép kiểm nhưng trả luôn lỗi của chính người gọi, nên tư cách người gọi chỉ đọc một lần.
//   - inviteTarget: handle này có nhận lời mời của người gửi không (thêm điều kiện có hồ sơ công khai).
// Luật "thiếu dữ liệu thì từ chối": không có RunnerProfile, không có ngày sinh hay không có ChatMember đều là chưa đạt.
const User = require('../models/User');
const RunnerProfile = require('../models/RunnerProfile');
const ChatMember = require('../models/ChatMember');
const Block = require('../models/Block');
const CommunityProfile = require('../models/CommunityProfile');
const { HANDLE_PATTERN } = require('../models/CommunityProfile');
const { isAtLeastAge } = require('../lib/age');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

// Cùng tuổi tối thiểu với hồ sơ cộng đồng (communityService.MIN_AGE). Không require từ đó để tránh vòng phụ thuộc, vì
// communityService sẽ cần chatGate (kiểm Block khi xem hồ sơ, tính nút "Nhắn tin").
const MIN_AGE = 16;

/**
 * Người này có tự nhắn tin được không, và nếu không thì vì sao.
 * Thứ tự lý do có chủ ý: LOCKED đứng trước CONSENT, để người bị khóa rút đồng ý vẫn thấy mình đang bị khóa.
 * @param {string} userId Người cần kiểm.
 * @param {{ now?: Date }} [options] Thời điểm tính tuổi.
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'INACTIVE' | 'AGE' | 'LOCKED' | 'CONSENT' }>}
 */
async function senderEligible(userId, { now = new Date() } = {}) {
  const [user, runner, member] = await Promise.all([
    User.findById(userId).select({ status: 1 }).lean(),
    RunnerProfile.findOne({ userId }).select({ dob: 1 }).lean(),
    ChatMember.findOne({ userId }).select({ consentAt: 1, lockedAt: 1 }).lean(),
  ]);
  if (user?.status !== 'ACTIVE') return { ok: false, reason: 'INACTIVE' };
  if (!isAtLeastAge(runner?.dob, MIN_AGE, now)) return { ok: false, reason: 'AGE' };
  if (member?.lockedAt) return { ok: false, reason: 'LOCKED' };
  if (!member?.consentAt) return { ok: false, reason: 'CONSENT' };
  return { ok: true };
}

/**
 * Có Block ở bất kỳ chiều nào giữa hai người không. Hai nhánh của $or đều khớp đủ index { blockerId, blockedId }.
 * @returns {Promise<boolean>}
 */
async function blockedBetween(aId, bId) {
  return Boolean(await Block.exists({ $or: [{ blockerId: aId, blockedId: bId }, { blockerId: bId, blockedId: aId }] }));
}

/**
 * Đọc trong một lượt mọi thứ cổng hai phía cần: tư cách người gọi, tư cách người kia và Block. Trả cả lỗi của chính
 * người gọi, để route không phải đọc lại tư cách người gọi lần nữa như khi gọi assertSelfEligible rồi pairOpen.
 * @param {string} selfId Người gọi.
 * @param {string} otherId Người kia trong cuộc.
 * @returns {Promise<{ selfError: Error | null, open: boolean }>} open: hai người còn nhắn cho nhau được.
 */
async function checkPair(selfId, otherId, { now = new Date() } = {}) {
  const [self, other, blocked] = await Promise.all([
    senderEligible(selfId, { now }), senderEligible(otherId, { now }), blockedBetween(selfId, otherId),
  ]);
  return { selfError: selfError(self), open: self.ok && other.ok && !blocked };
}

/**
 * Hai người còn nhắn tin cho nhau được không (cổng hai phía, T13).
 * @returns {Promise<boolean>}
 */
async function pairOpen(aId, bId, { now = new Date() } = {}) {
  return (await checkPair(aId, bId, { now })).open;
}

/**
 * Người nhận của một lời mời theo handle (spec D3). Không nhận được vì bất kỳ lý do nào thì trả null, để route trả cùng
 * một 404 và người gửi không đoán được người kia chặn mình, chưa đồng ý hay không tồn tại.
 * @param {string} senderId Người gửi lời mời.
 * @param {{ handle?: unknown }} target Handle của người nhận.
 * @param {{ now?: Date }} [options]
 * @returns {Promise<string | null>} userId người nhận.
 */
async function inviteTarget(senderId, { handle } = {}, { now = new Date() } = {}) {
  if (typeof handle !== 'string') return null;
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(normalized)) return null;
  const profile = await CommunityProfile.findOne({ handle: normalized }).select({ userId: 1 }).lean();
  if (!profile || String(profile.userId) === String(senderId)) return null;
  const [eligible, blocked] = await Promise.all([senderEligible(profile.userId, { now }), blockedBetween(senderId, profile.userId)]);
  return eligible.ok && !blocked ? String(profile.userId) : null;
}

// Lỗi khi chính người gọi không đạt cổng: nói rõ lý do, vì đó là thông tin của chính họ.
const SELF_ERRORS = {
  AGE: [errorCodes.CHAT_AGE_REQUIRED, 'Bạn cần đủ 16 tuổi và có ngày sinh trong hồ sơ người chạy để nhắn tin.'],
  CONSENT: [errorCodes.CHAT_CONSENT_REQUIRED, 'Bạn cần bật "Cho phép nhắn tin" trong tab Cộng đồng trước khi nhắn tin.'],
  LOCKED: [errorCodes.CHAT_LOCKED, 'Quyền nhắn tin của bạn đang bị khóa.'],
};

/**
 * Lỗi 403 chung khi phía người kia không đạt cổng hoặc có Block (T9): không nói lý do, không có chữ "chặn".
 * @returns {Error}
 */
function unavailable() {
  return httpError(403, 'Không gửi được tin.', errorCodes.CHAT_UNAVAILABLE);
}

/**
 * Lỗi 403 ứng với kết quả senderEligible của chính người gọi, hoặc null khi đạt.
 * @param {{ ok: boolean, reason?: string }} result
 * @returns {Error | null}
 */
function selfError(result) {
  if (result.ok) return null;
  const known = SELF_ERRORS[result.reason];
  return known ? httpError(403, known[1], known[0]) : unavailable();
}

/**
 * Ném lỗi 403 nếu chính người gọi không được nhắn tin.
 * @returns {Promise<void>}
 */
async function assertSelfEligible(userId, { now = new Date() } = {}) {
  const error = selfError(await senderEligible(userId, { now }));
  if (error) throw error;
}

module.exports = { MIN_AGE, senderEligible, pairOpen, checkPair, inviteTarget, blockedBetween, assertSelfEligible, unavailable };
