// Bộ lọc câu nhạy cảm (spec T7, T16): câu bị bắt thì không gửi cho AI và không vào hàng chờ,
// nhưng bot vẫn trả lời bằng bài soạn sẵn. File này không dùng database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sensitiveQuestion } = require('../../src/backend/services/supportFilters');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');

test('câu tự giới thiệu có chữ viết hoa theo sau là câu nhạy cảm', () => {
  for (const q of ['Tôi là Trần Thị B, chưa thấy vé', 'tôi là Nguyễn Văn A', 'Mình tên là Lan', 'em tên Hoa ạ', 'Mình là BTC giải', 'Tôi là Trần Thị B'.normalize('NFD')])
    assert.equal(sensitiveQuestion(q), true, q);
});

test('"tôi là" không có chữ viết hoa theo sau thì không nhạy cảm', () => {
  for (const q of ['tôi là người mới, mua vé sao', 'Tôi là runner mới', 'giữ chỗ được bao lâu']) assert.equal(sensitiveQuestion(q), false, q);
});

test('"xem là" không bị nhận nhầm thành "em là"', () => {
  // Đại từ phải đứng đầu câu hoặc sau một ký tự không phải chữ, nên chữ "em" nằm trong "xem" không tính.
  assert.equal(sensitiveQuestion('đơn của mình xem là Đã duyệt chưa'), false);
});

test('các luật cũ vẫn bắt được', () => {
  for (const q of ['email a@b.com', 'gọi 0912345678', 'quên mật khẩu']) assert.equal(sensitiveQuestion(q), true, q);
});

test('câu hỏi về sức khỏe là câu nhạy cảm', () => {
  for (const q of ['tôi bị hen suyễn có chạy được không', 'đang mang thai có đăng ký được không', 'bệnh tim có chạy 42km được không', 'mình bị chấn thương gối'])
    assert.equal(sensitiveQuestion(q), true, q);
});

test('chữ "thuộc" và câu hỏi thông thường không bị bắt', () => {
  for (const q of ['vé này thuộc giải nào', 'giữ chỗ được bao lâu', 'nạp ví do ai duyệt']) assert.equal(sensitiveQuestion(q), false, q);
});

test('responder dùng bộ lọc mới: câu có họ tên hay sức khỏe vẫn nhận bài soạn sẵn nhưng không tới AI', async () => {
  let calls = 0;
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), recordMiss: null, generateReply: async () => { calls++; return 'Không được dùng'; } });
  const named = await answer({ message: 'Tôi là Trần Thị B, chuyển khoản rồi sao chưa có vé' });
  assert.equal(named.mode, 'guide'); assert.match(named.reply, /EVENT_ADMIN/);
  const health = await answer({ message: 'mình bị hen suyễn thì mua vé giải chạy được không' });
  assert.equal(health.mode, 'guide'); assert.match(health.reply, /10 phút/);
  assert.equal(calls, 0);
  // Câu đối chứng không có tên hay sức khỏe vẫn được gửi cho AI.
  assert.equal((await answer({ message: 'chuyển khoản rồi sao chưa có vé' })).mode, 'ai'); assert.equal(calls, 1);
});
