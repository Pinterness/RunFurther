// Luật mã bài tri thức: chữ thường không dấu, số và dấu gạch ngang, dài 2–60 ký tự, không bắt đầu bằng gạch ngang.
// Model SupportArticle, hàng chờ (unansweredService.js) và khung chat (SupportChat.jsx) dùng chung file này, nên ba
// phía luôn nhận cùng một kiểu mã bài.
const ARTICLE_KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

// true khi giá trị là chuỗi đúng dạng mã bài.
const isArticleKey = value => typeof value === 'string' && ARTICLE_KEY.test(value);

module.exports = { ARTICLE_KEY, isArticleKey };
