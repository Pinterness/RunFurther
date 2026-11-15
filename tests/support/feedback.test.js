// Nút "Chưa đúng" dưới câu trả lời của trợ lý (spec 4.6, Task 6.5): khung chat gửi lại câu hỏi cùng key các bài đã
// dùng, server ghi một dòng WRONG_ANSWER vào hàng chờ. Khách cũng bấm được; route không đọc token vì hàng chờ không
// lưu người hỏi. Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers).
// Route giới hạn 6 lần mỗi phút theo IP, nên cả file chỉ gửi đúng 6 request trước test 429 đặt ở cuối.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-feedback-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const UnansweredQuestion = require('../../src/backend/models/UnansweredQuestion');
const { seedSupportKnowledge } = require('../../scripts/seedSupportKnowledge');
const { clearKnowledgeCache } = require('../../src/backend/services/supportKnowledgeStore');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { recordFeedback } = require('../../src/backend/services/unansweredService');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_feedback' });
let sent = 0;
const sendFeedback = (body, as) => { sent += 1; return harness.request('/support/feedback', { method: 'POST', body, as }); };

before(async () => {
  await harness.start();
  await seedSupportKnowledge({ apply: true });
  await SupportArticle.create({ key: 'bai-nhap', title: 'Bài nháp', terms: ['bài nháp'], answer: 'Chưa xuất bản.', status: 'DRAFT' });
  clearKnowledgeCache();
});
after(harness.stop);
beforeEach(() => UnansweredQuestion.deleteMany({}));

test('kết quả chat có articleKeys là key các bài đã dùng; mảng rỗng khi FALLBACK, tác vụ hay đọc giải lỗi', async () => {
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, recordMiss: null, findEvents: async () => { throw new Error('db down'); } });
  assert.deepEqual((await answer({ message: 'giữ chỗ được bao lâu' })).articleKeys, ['hold']);
  assert.deepEqual((await answer({ message: 'hủy đăng ký có được hoàn tiền không' })).articleKeys, ['payment', 'registration']);
  assert.deepEqual((await answer({ message: 'Dự đoán giá vàng ngày mai' })).articleKeys, []);
  assert.deepEqual((await answer({ message: 'Kiểm tra vé của tôi' })).articleKeys, []);
  // Đọc lịch giải lỗi thì câu trả lời là câu báo lỗi, không phải nội dung bài, nên không có nút "Chưa đúng".
  const events = await answer({ message: 'Có giải nào sắp diễn ra?' });
  assert.match(events.reply, /chưa tải được thông tin giải/); assert.deepEqual(events.articleKeys, []);
});

test('recordFeedback từ chối câu hỏi hay danh sách bài sai dạng, và key không thuộc bài đã xuất bản', async () => {
  const valid = { question: 'giữ chỗ được bao lâu', articleKeys: ['hold'] };
  const invalid = [
    { ...valid, question: '' }, { ...valid, question: '   ' }, { ...valid, question: 42 }, { ...valid, question: 'x'.repeat(2001) },
    { question: valid.question }, { ...valid, articleKeys: [] }, { ...valid, articleKeys: ['hold', 'payment', 'wallet'] },
    { ...valid, articleKeys: [123] }, { ...valid, articleKeys: ['Bad Key'] }, { ...valid, articleKeys: 'hold' },
  ];
  for (const body of invalid) {
    await assert.rejects(recordFeedback(body), error => error.statusCode === 400 && error.code === 'FEEDBACK_INVALID', JSON.stringify(body).slice(0, 80));
  }
  for (const key of ['khong-co-bai-nay', 'bai-nhap']) {
    await assert.rejects(recordFeedback({ ...valid, articleKeys: ['hold', key] }), error => error.statusCode === 400 && error.code === 'FEEDBACK_UNKNOWN_ARTICLE', key);
  }
  assert.equal(await UnansweredQuestion.countDocuments(), 0);
});

test('khách gửi "Chưa đúng" hợp lệ thì 200 { recorded: true } và có một dòng WRONG_ANSWER kèm articleKeys', async () => {
  const body = { question: 'mình giữ chỗ 500.000 được bao lâu', articleKeys: ['hold'] };
  const guest = await sendFeedback(body);
  assert.deepEqual([guest.status, guest.body], [200, { recorded: true }]);
  // Có token thì route cũng không đọc, và không lưu người hỏi.
  const runner = await harness.createUser();
  const signedIn = await sendFeedback(body, runner);
  assert.deepEqual([signedIn.status, signedIn.body], [200, { recorded: true }]);
  const rows = await UnansweredQuestion.find().lean();
  assert.deepEqual(rows.map(row => [row.kind, row.sample, row.count, row.articleKeys]), [['WRONG_ANSWER', 'mình giữ chỗ #.# được bao lâu', 2, ['hold']]]);
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(runner.id));
});

test('câu nhạy cảm thì { recorded: false } và không có dòng nào', async () => {
  const result = await sendFeedback({ question: 'Tôi là Trần Thị B, giữ chỗ được bao lâu', articleKeys: ['hold'] });
  assert.deepEqual([result.status, result.body], [200, { recorded: false }]);
  assert.equal(await UnansweredQuestion.countDocuments(), 0);
});

test('key lạ thì 400 FEEDBACK_UNKNOWN_ARTICLE', async () => {
  const result = await sendFeedback({ question: 'giữ chỗ được bao lâu', articleKeys: ['khong-co-bai-nay'] });
  assert.deepEqual([result.status, result.body.code], [400, 'FEEDBACK_UNKNOWN_ARTICLE']);
  assert.equal(await UnansweredQuestion.countDocuments(), 0);
});

// Đặt cuối file: sau test này route bị khóa tới hết phút.
test('lần gửi thứ 7 trong cùng một phút thì bị 429', async () => {
  while (sent < 6) assert.equal((await sendFeedback({ question: 'giữ chỗ được bao lâu', articleKeys: ['hold'] })).status, 200);
  assert.equal((await sendFeedback({ question: 'giữ chỗ được bao lâu', articleKeys: ['hold'] })).status, 429);
});
