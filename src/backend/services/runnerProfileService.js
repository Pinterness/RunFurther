const { assert } = require('../lib/errors');
const { birthdayError, needsBirthdayConfirmation } = require('../../lib/runnerValidation.cjs');
const { normalizeNationality } = require('../../lib/nationalities.cjs');
const genders = { Nam: 'MALE', 'Nữ': 'FEMALE', Khác: 'OTHER', 'Không chia sẻ': 'PREFER_NOT_TO_SAY' };
function runnerDetails(input, options) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Hồ sơ người chạy không hợp lệ.');
  const error = birthdayError(input.birthday, options);
  assert(!error, 400, error);
  assert(!needsBirthdayConfirmation(input.birthday, options?.now) || input.confirmedBirthday === input.birthday, 400, 'Bạn trên 50 tuổi. Vui lòng xác nhận ngày sinh này chính xác.');
  const details = {};
  if (input.birthday !== undefined) details.birthday = input.birthday || '';
  if (input.nationality !== undefined) {
    details.nationality = normalizeNationality(input.nationality);
    assert(details.nationality, 400, 'Vui lòng chọn quốc tịch trong danh sách.');
  }
  return details;
}
function profileData(input = {}, options) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 400, 'Hồ sơ người chạy không hợp lệ.');
  const data = {};
  if (input.gender !== undefined) {
    assert(genders[input.gender], 400, 'Giới tính không hợp lệ.');
    data.gender = genders[input.gender];
  }
  const details = runnerDetails(input, options);
  if (details.birthday !== undefined) data.dob = details.birthday ? new Date(details.birthday) : null;
  if (details.nationality !== undefined) data.nationality = details.nationality;
  for (const key of ['club']) if (input[key] !== undefined) {
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
module.exports = { profileData, serializeProfile, runnerDetails };
