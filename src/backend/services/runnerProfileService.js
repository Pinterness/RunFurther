const { assert } = require('../lib/errors');
const genders = { Nam: 'MALE', 'Nữ': 'FEMALE', Khác: 'OTHER', 'Không chia sẻ': 'PREFER_NOT_TO_SAY' };
function profileData(input = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Hồ sơ người chạy không hợp lệ.');
  const data = {};
  if (input.gender !== undefined) {
    assert(genders[input.gender], 400, 'Giới tính không hợp lệ.');
    data.gender = genders[input.gender];
  }
  if (input.birthday !== undefined) {
    if (!input.birthday) data.dob = null;
    else {
      assert(typeof input.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthday), 400, 'Ngày sinh phải có dạng YYYY-MM-DD.');
      const dob = new Date(input.birthday);
      assert(Number.isFinite(dob.getTime()) && dob.toISOString().slice(0, 10) === input.birthday && dob <= new Date() && dob.getUTCFullYear() >= 1900, 400, 'Ngày sinh không hợp lệ.');
      data.dob = dob;
    }
  }
  for (const key of ['nationality', 'club']) if (input[key] !== undefined) {
    assert(typeof input[key] === 'string', 400, 'Thông tin hồ sơ không hợp lệ.');
    data[key] = input[key].trim();
  }
  if (input.shirtSize !== undefined) data.defaultShirtSize = input.shirtSize === 'XXL' ? '2XL' : input.shirtSize;
  if (input.emergencyContact !== undefined || input.emergencyPhone !== undefined) {
    assert(typeof (input.emergencyContact ?? '') === 'string' && typeof (input.emergencyPhone ?? '') === 'string', 400, 'Liên hệ khẩn cấp không hợp lệ.');
    const name = (input.emergencyContact || '').trim(), phone = (input.emergencyPhone || '').trim();
    assert(Boolean(name) === Boolean(phone), 400, 'Vui lòng nhập cả tên và số điện thoại liên hệ khẩn cấp.');
    data.emergencyContact = name ? { name, phone, relation: 'Người thân' } : null;
  }
  return data;
}
function serializeProfile(profile) {
  return {
    gender: Object.keys(genders).find(key => genders[key] === profile?.gender) || 'Không chia sẻ',
    birthday: profile?.dob ? new Date(profile.dob).toISOString().slice(0, 10) : '',
    nationality: profile?.nationality || 'Việt Nam', club: profile?.club || '',
    shirtSize: profile?.defaultShirtSize === '2XL' ? 'XXL' : profile?.defaultShirtSize || 'M',
    emergencyContact: profile?.emergencyContact?.name || '', emergencyPhone: profile?.emergencyContact?.phone || '',
  };
}
module.exports = { profileData, serializeProfile };
