// Dữ liệu dựng sẵn cho test chat (tests/chat/chat-*.test.js): người chạy đủ tuổi, đã đồng ý nhắn tin và có hồ sơ cộng
// đồng, tức người gửi và nhận được lời mời. Mỗi điều kiện tắt được riêng để test từng nhánh của cổng chat.
// Dữ liệu ghi thẳng vào DB (không qua API) để test không phụ thuộc giới hạn tốc độ của route.
const ChatMember = require('../../src/backend/models/ChatMember');
const { createProfileWithHandle } = require('../../src/backend/services/communityHandle');
const { yearsAgo } = require('./dates');

/**
 * @param {{ createUser: Function }} harness Harness của file test.
 * @returns {{ member: Function }} Hàm tạo người dùng chat.
 */
function createChatFixtures(harness) {
  /**
   * Tạo một người dùng cho test chat.
   * @param {{ dob?: string | null, consent?: boolean, profile?: boolean, locked?: boolean, fullName?: string }} [options]
   *   Mặc định: 30 tuổi, đã đồng ý chat, có hồ sơ cộng đồng, không bị khóa. `dob: null` là chưa khai ngày sinh.
   * @returns {Promise<{ id: string, token: string, fullName: string, handle: string | null }>} Người dùng.
   */
  async function member({ dob = yearsAgo(30), consent = true, profile = true, locked = false, fullName } = {}) {
    const user = await harness.createUser({ dob: dob ?? undefined, fullName });
    if (consent || locked) {
      await ChatMember.create({
        userId: user.id,
        ...(consent ? { consentAt: new Date(), consentVersion: 'chat-v1' } : {}),
        ...(locked ? { lockedAt: new Date() } : {}),
      });
    }
    let handle = null;
    if (profile) {
      const made = await createProfileWithHandle({ userId: user.id, consentAt: new Date(), consentVersion: 'profile-v1' }, user.fullName);
      handle = made.handle;
    }
    return { ...user, handle };
  }

  return { member };
}

module.exports = { createChatFixtures };
