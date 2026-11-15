// Một quy tắc chung cho câu hỏi "link này có nằm trong RunFurther không?": chỉ nhận đường dẫn nội bộ cùng website
// như /account, không bao giờ nhận //host, dấu \ hay khoảng trắng. Hàm được dùng ở khung chat (trình duyệt),
// ở model SupportArticle (server) và ở toActions trong supportActions.cjs (lọc nút của trợ lý).
function internalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000- ]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://runfurther.invalid');
    const path = url.pathname + url.search + url.hash;
    // Đường dẫn có đoạn chấm như /.//evil.example bị chuẩn hóa thành //evil.example, và trình duyệt mở nó như một trang khác.
    return url.origin === 'https://runfurther.invalid' && !path.startsWith('//') ? path : null;
  } catch { return null; }
}

module.exports = { internalPath };
