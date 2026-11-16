// Hàm nhỏ dùng chung cho các trang cộng đồng ở trình duyệt.

// Đường tới trang đăng nhập, đăng nhập xong thì quay lại đúng trang đang mở.
export const loginHref = path => '/login?next=' + encodeURIComponent(path);

// "2026-01" (memberSince của API) → "tháng 01/2026".
export function memberSinceLabel(yearMonth) {
  const [year, month] = String(yearMonth || '').split('-');
  return year && month ? `tháng ${month}/${year}` : '';
}
