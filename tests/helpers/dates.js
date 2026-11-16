// Ngày dùng trong test, tính từ hôm nay, để test không tự đỏ khi năm trôi qua
// (ví dụ ngày sinh cố định "2015-01-01" sẽ thành người đủ 16 tuổi vào năm 2031).

/**
 * Ngày cách hôm nay đúng `years` năm, dạng 'YYYY-MM-DD'.
 * @param {number} years Số năm lùi lại.
 * @returns {string} Ví dụ yearsAgo(10) vào 16-11-2026 là '2016-11-16'.
 */
function yearsAgo(years) {
  const day = new Date();
  day.setUTCFullYear(day.getUTCFullYear() - years);
  return day.toISOString().slice(0, 10);
}

module.exports = { yearsAgo };
