// Giới hạn nhắn tin (spec D5, T5): 20 tin/phút, 500 tin/ngày, 5 lời mời/ngày cho mỗi tài khoản. Đếm bằng countDocuments
// trên chính dữ liệu đã lưu (index { senderId, createdAt } của Message, { requesterId, createdAt } của Conversation),
// không đếm trong RAM: Render ngủ dậy thì bộ đếm trong RAM về 0, còn dữ liệu trong MongoDB thì không.
// Đánh đổi đã chấp nhận: hai request đua nhau đúng lúc chạm ngưỡng có thể cùng lọt, vượt vài tin.
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const VN_OFFSET_MS = 7 * 60 * MINUTE_MS; // giờ Việt Nam là UTC+7, không có giờ mùa hè
const PER_MINUTE = 20;
const PER_DAY = 500;
const INVITES_PER_DAY = 5;

/**
 * 0 giờ giờ Việt Nam của ngày chứa `now`, ví dụ 2026-11-20T16:59:59Z (23:59:59 ngày 20 ở Việt Nam) cho
 * 2026-11-19T17:00:00Z.
 * @param {Date} now
 * @returns {Date}
 */
function vnDayStart(now) {
  const local = now.getTime() + VN_OFFSET_MS;
  return new Date(local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - VN_OFFSET_MS);
}

// Số giây tới 0 giờ hôm sau theo giờ Việt Nam, dùng cho header Retry-After của giới hạn ngày.
const secondsToNextDay = now => Math.max(1, Math.ceil((vnDayStart(now).getTime() + DAY_MS - now.getTime()) / 1000));

function limited(message, code, retryAfter) {
  return Object.assign(httpError(429, message, code), { retryAfter });
}

/**
 * Ném 429 nếu người này đã gửi đủ 500 tin trong ngày (giờ Việt Nam). Tin đầu của lời mời cũng tính.
 * @returns {Promise<void>}
 */
async function assertDailyMessageQuota(senderId, now) {
  const today = await Message.countDocuments({ senderId, createdAt: { $gte: vnDayStart(now) } });
  if (today >= PER_DAY) {
    throw limited(`Bạn đã gửi ${PER_DAY} tin hôm nay. Bạn quay lại vào ngày mai nhé.`, errorCodes.CHAT_DAILY_LIMIT, secondsToNextDay(now));
  }
}

/**
 * Ném 429 nếu người này đã gửi 20 tin trong 60 giây vừa qua hoặc 500 tin trong ngày.
 * Retry-After của giới hạn phút là số giây tới khi tin cũ nhất trong cửa sổ 60 giây rơi ra ngoài.
 * @returns {Promise<void>}
 */
async function assertMessageQuota(senderId, now) {
  const since = new Date(now.getTime() - MINUTE_MS);
  const lastMinute = await Message.countDocuments({ senderId, createdAt: { $gte: since } });
  if (lastMinute >= PER_MINUTE) {
    const oldest = await Message.findOne({ senderId, createdAt: { $gte: since } }).sort({ createdAt: 1 }).select({ createdAt: 1 }).lean();
    const wait = oldest ? Math.ceil((oldest.createdAt.getTime() + MINUTE_MS - now.getTime()) / 1000) : 60;
    throw limited('Bạn gửi tin hơi nhanh. Bạn chờ một chút rồi gửi tiếp nhé.', errorCodes.CHAT_RATE_LIMITED, Math.max(1, wait));
  }
  await assertDailyMessageQuota(senderId, now);
}

/**
 * Ném 429 nếu người này đã gửi 5 lời mời trong ngày (giờ Việt Nam).
 * @returns {Promise<void>}
 */
async function assertInviteQuota(senderId, now) {
  const today = await Conversation.countDocuments({ requesterId: senderId, createdAt: { $gte: vnDayStart(now) } });
  if (today >= INVITES_PER_DAY) {
    throw limited(`Bạn đã gửi ${INVITES_PER_DAY} lời mời hôm nay. Bạn quay lại vào ngày mai nhé.`, errorCodes.CHAT_INVITE_LIMIT, secondsToNextDay(now));
  }
}

module.exports = { vnDayStart, assertMessageQuota, assertDailyMessageQuota, assertInviteQuota, PER_MINUTE, PER_DAY, INVITES_PER_DAY };
