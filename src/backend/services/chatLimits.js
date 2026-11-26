// Giới hạn nhắn tin (spec D5, T5): 20 tin/phút, 500 tin/ngày, 5 lời mời/ngày cho mỗi tài khoản. Đếm trên chính
// dữ liệu đã lưu (index { senderId, createdAt } của Message, { requesterId, createdAt } của Conversation),
// không đếm trong RAM: Render ngủ dậy thì bộ đếm trong RAM về 0, còn dữ liệu trong MongoDB thì không.
// Đánh đổi đã chấp nhận: hai request đua nhau đúng lúc chạm ngưỡng có thể cùng lọt, vượt vài tin.
const mongoose = require('mongoose');
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
 * Pipeline đếm tin trong 60 giây vừa qua và trong ngày (giờ Việt Nam) của một người. Tách riêng để test explain đúng
 * câu lệnh này: nó phải được index { senderId, createdAt } phủ trọn, không đọc document nào.
 * @returns {object[]}
 */
function messageQuotaPipeline(senderId, now) {
  const since = new Date(now.getTime() - MINUTE_MS);
  const dayStart = vnDayStart(now);
  const inMinute = { $gte: ['$createdAt', since] };
  return [
    // aggregate không tự đổi kiểu như find, nên senderId phải là ObjectId.
    { $match: { senderId: new mongoose.Types.ObjectId(String(senderId)), createdAt: { $gte: since < dayStart ? since : dayStart } } },
    { $group: {
      _id: null,
      minute: { $sum: { $cond: [inMinute, 1, 0] } },
      day: { $sum: { $cond: [{ $gte: ['$createdAt', dayStart] }, 1, 0] } },
      oldestInMinute: { $min: { $cond: [inMinute, '$createdAt', null] } },
    } },
  ];
}

/**
 * Lỗi 429 nếu người này đã gửi 20 tin trong 60 giây vừa qua hoặc 500 tin trong ngày, không thì null. Trả lỗi thay vì
 * ném, để sendMessage chạy hàm này song song với các lần đọc khác mà vẫn xét lỗi theo đúng thứ tự.
 *
 * Một lệnh aggregate đếm cả hai cửa sổ: lọc từ mốc sớm hơn trong hai mốc (60 giây trước hoặc 0 giờ hôm nay), rồi đếm
 * riêng từng cửa sổ. Không được bỏ đếm phút khi số tin trong ngày dưới 20: lúc vừa qua 0 giờ, tin trong ngày là 0
 * nhưng tin của 60 giây trước vẫn tính. Chỉ dùng senderId và createdAt nên đi trọn trên index { senderId, createdAt }.
 * Retry-After của giới hạn phút là số giây tới khi tin cũ nhất trong cửa sổ 60 giây rơi ra ngoài.
 * @returns {Promise<Error | null>}
 */
async function messageQuotaError(senderId, now) {
  const [counts = { minute: 0, day: 0 }] = await Message.aggregate(messageQuotaPipeline(senderId, now));
  if (counts.minute >= PER_MINUTE) {
    const wait = Math.ceil((counts.oldestInMinute.getTime() + MINUTE_MS - now.getTime()) / 1000);
    return limited('Bạn gửi tin hơi nhanh. Bạn chờ một chút rồi gửi tiếp nhé.', errorCodes.CHAT_RATE_LIMITED, Math.max(1, wait));
  }
  if (counts.day >= PER_DAY) {
    return limited(`Bạn đã gửi ${PER_DAY} tin hôm nay. Bạn quay lại vào ngày mai nhé.`, errorCodes.CHAT_DAILY_LIMIT, secondsToNextDay(now));
  }
  return null;
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

module.exports = { vnDayStart, messageQuotaPipeline, messageQuotaError, assertDailyMessageQuota, assertInviteQuota, PER_MINUTE, PER_DAY, INVITES_PER_DAY };
