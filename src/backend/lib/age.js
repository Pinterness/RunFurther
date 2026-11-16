// Kiểm tuổi tối thiểu theo ngày sinh trong hồ sơ người chạy. Dùng chung cho cổng AI (18 tuổi) và cộng đồng, chat
// (16 tuổi). Luật "thiếu dữ liệu thì từ chối": dob trống, sai, không phải Date hay ở tương lai đều coi như chưa đủ.
const { ageOn } = require('../../lib/runnerValidation.cjs');

/**
 * Người có ngày sinh `dob` đã đủ `years` tuổi vào ngày `now` theo lịch Việt Nam chưa.
 * @param {Date | null | undefined} dob Ngày sinh lưu trong RunnerProfile (nửa đêm UTC của ngày sinh).
 * @param {number} years Số tuổi tối thiểu.
 * @param {Date} [now] Thời điểm tính.
 * @returns {boolean} true khi đủ tuổi.
 */
function isAtLeastAge(dob, years, now = new Date()) {
  if (!(dob instanceof Date) || !Number.isFinite(dob.getTime())) return false;
  // ageOn trả số âm cho ngày sinh ở tương lai, nên nhánh đó cũng ra false.
  return ageOn(dob.toISOString().slice(0, 10), now) >= years;
}

module.exports = { isAtLeastAge };
