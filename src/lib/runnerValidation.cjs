// Shared civil-date rules for the API and browser. Races use Vietnam's calendar date.
const MIN_BIRTHDAY = '1900-01-01';
const MIN_RUNNER_AGE = 7;
const AGE_CONFIRMATION_THRESHOLD = 50;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});

function calendarDate(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function yearsBefore(day, years) {
  const [year, month, date] = day.split('-').map(Number);
  const cutoffYear = year - Math.ceil(years);
  const cutoffDay = Math.min(date, new Date(Date.UTC(cutoffYear, month, 0)).getUTCDate());
  return `${String(cutoffYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(cutoffDay).padStart(2, '0')}`;
}

function ageOn(birthday, now = new Date()) {
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return NaN;
  const date = new Date(birthday + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) return NaN;
  const day = calendarDate(now);
  return Number(day.slice(0, 4)) - Number(birthday.slice(0, 4)) - (day.slice(5) < birthday.slice(5) ? 1 : 0);
}

function needsBirthdayConfirmation(birthday, now) {
  return ageOn(birthday, now) > AGE_CONFIRMATION_THRESHOLD;
}

function birthdayBounds({ now = new Date(), raceDate, minAge = 0 } = {}) {
  let max = yearsBefore(calendarDate(now), MIN_RUNNER_AGE);
  const raceDay = raceDate ? calendarDate(raceDate) : '';
  if (minAge > 0 && raceDay) {
    const cutoff = yearsBefore(raceDay, minAge);
    if (cutoff < max) max = cutoff;
  }
  return { min: MIN_BIRTHDAY, max };
}

function birthdayError(value, options = {}) {
  if (value === undefined || value === null || value === '') {
    return options.required || options.minAge > 0 ? 'Vui lòng nhập ngày sinh để kiểm tra độ tuổi.' : '';
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Ngày sinh phải có dạng YYYY-MM-DD.';
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Ngày sinh không tồn tại.';
  const today = calendarDate(options.now);
  if (value < MIN_BIRTHDAY || value > today) return 'Ngày sinh phải từ 01/01/1900 đến hôm nay.';
  if (ageOn(value, options.now) < MIN_RUNNER_AGE) return 'Người chạy phải đủ 7 tuổi tại thời điểm đăng ký.';
  if (value > birthdayBounds(options).max) return `Người chạy phải đủ ${options.minAge} tuổi vào ngày thi đấu.`;
  return '';
}

module.exports = { MIN_BIRTHDAY, MIN_RUNNER_AGE, AGE_CONFIRMATION_THRESHOLD, calendarDate, birthdayBounds, birthdayError, ageOn, needsBirthdayConfirmation };
