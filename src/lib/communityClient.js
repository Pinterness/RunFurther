// Hàm nhỏ dùng chung cho các trang cộng đồng ở trình duyệt.

// Đường tới trang đăng nhập, đăng nhập xong thì quay lại đúng trang đang mở.
export const loginHref = path => '/login?next=' + encodeURIComponent(path);

// "2026-01" (memberSince của API) → "tháng 01/2026".
export function memberSinceLabel(yearMonth) {
  const [year, month] = String(yearMonth || '').split('-');
  return year && month ? `tháng ${month}/${year}` : '';
}

// Thứ tự hiện thời gian tốt nhất, cùng các khóa API trả trong results.bestTimes.
export const BEST_TIME_ORDER = ['5K', '10K', '21K', '42K'];

// [['21K', '1:50:10'], …] theo đúng thứ tự trên, bỏ cự ly chưa có kết quả.
export const bestTimeEntries = bestTimes => BEST_TIME_ORDER.filter(key => bestTimes?.[key]).map(key => [key, bestTimes[key]]);
