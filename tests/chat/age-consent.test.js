// Tuổi tối thiểu và văn bản đồng ý dùng chung cho cộng đồng và chat (spec T7, T8, mục 4.7).
// Không kết nối DB: chỉ kiểm hàm thuần và hằng số.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAtLeastAge } = require('../../src/backend/lib/age');
const { PROFILE_CONSENT, CHAT_CONSENT, CONSENT_HISTORY } = require('../../src/lib/communityConsent.cjs');

const now = new Date('2026-11-16T03:00:00Z'); // 10 giờ sáng 16-11 giờ Việt Nam

test('đủ 16 tuổi đúng ngày sinh nhật theo lịch Việt Nam', () => {
  assert.equal(isAtLeastAge(new Date('2010-11-16'), 16, now), true);
  assert.equal(isAtLeastAge(new Date('2010-11-17'), 16, now), false);
});

test('ngày sinh nhật tính theo ngày Việt Nam, không theo ngày UTC', () => {
  // 17:30 UTC ngày 15-11 đã là 0 giờ 30 ngày 16-11 ở Việt Nam, nên người sinh 16-11-2010 đã tròn 16.
  assert.equal(isAtLeastAge(new Date('2010-11-16'), 16, new Date('2026-11-15T17:30:00Z')), true);
  assert.equal(isAtLeastAge(new Date('2010-11-16'), 16, new Date('2026-11-15T16:30:00Z')), false);
});

test('ngày sinh rỗng, sai hay ở tương lai thì chưa đủ tuổi', () => {
  for (const dob of [null, undefined, new Date('x'), '2000-01-01', new Date('2030-01-01')]) {
    assert.equal(isAtLeastAge(dob, 16, now), false, String(dob));
  }
});

test('văn bản đồng ý có phiên bản và nêu đủ ý bắt buộc', () => {
  assert.equal(PROFILE_CONSENT.version, 'profile-v1');
  assert.equal(CHAT_CONSENT.version, 'chat-v1');
  assert.match(CHAT_CONSENT.text, /12 tháng/);
  assert.match(CHAT_CONSENT.text, /báo cáo/);
  assert.deepEqual(CONSENT_HISTORY.map(c => c.version), ['profile-v1', 'chat-v1']);
});

test('văn bản đồng ý hồ sơ nêu trường hiện ra, ai xem được, tắt là xóa, ai giữ dữ liệu và quyền của người dùng', () => {
  for (const idea of [/họ tên/i, /thành viên đã đăng nhập/, /xóa hẳn/, /nhóm RunFurther/, /xem, sửa/]) {
    assert.match(PROFILE_CONSENT.text, idea);
  }
  // Văn bản hứa không hiện những thứ nhạy cảm nhất.
  assert.match(PROFILE_CONSENT.text, /không bao giờ/i);
});

test('các phiên bản đồng ý không sửa được lúc chạy', () => {
  assert.ok(Object.isFrozen(PROFILE_CONSENT) && Object.isFrozen(CHAT_CONSENT) && Object.isFrozen(CONSENT_HISTORY));
});
