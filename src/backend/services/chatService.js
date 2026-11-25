// Nghiệp vụ nhắn tin 1–1 (spec 4.3–4.5). Route REST bây giờ và socket ở P14 đều gọi vào đây; luật quyền nằm ở chatGate.
// Nguyên tắc không được phá: mọi truy vấn cuộc trò chuyện đều có điều kiện participants là người gọi (lấy từ token), và
// MongoDB là nguồn sự thật: tin chỉ được coi là đã gửi khi transaction ghi tin đã commit.
const ChatMember = require('../models/ChatMember');
const RunnerProfile = require('../models/RunnerProfile');
const { CHAT_CONSENT } = require('../../lib/communityConsent.cjs');
const { isAtLeastAge } = require('../lib/age');
const { MIN_AGE } = require('./chatGate');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const isDuplicate = error => error?.code === 11000;

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
    if (!isDuplicate(error)) throw error;
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

module.exports = { getMe, giveConsent, withdrawConsent };
