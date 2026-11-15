// Hàng chờ câu bot chưa trả lời được (spec 4.6): lưu không kèm tài khoản, che dãy số, tự xóa sau 30 ngày.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers); mỗi test bắt đầu với hàng chờ rỗng.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-unanswered-test-secret';

const { app } = require('../../src/backend/server');
const UnansweredQuestion = require('../../src/backend/models/UnansweredQuestion');
const { maskDigits, recordUnanswered, UNANSWERED_OPEN_LIMIT, UNANSWERED_SAMPLE_LIMIT, UNANSWERED_TTL_SECONDS } = require('../../src/backend/services/unansweredService');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { previewAnswer } = require('../../src/backend/services/supportKnowledgeAdmin');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_unanswered' });
before(harness.start);
after(harness.stop);
beforeEach(() => UnansweredQuestion.deleteMany({}));

const FALLBACK = /chưa có thông tin đã xác thực/;
// Không có bài nào, nên mọi câu không phải tác vụ đều nhận câu FALLBACK; recordMiss mặc định là hàm ghi thật.
const ask = (message, deps = {}, extra = {}) => createSupportResponder({ findArticles: async () => [], generateReply: null, ...deps })({ message, ...extra });

test('hằng số khớp spec', () => {
  assert.deepEqual([UNANSWERED_OPEN_LIMIT, UNANSWERED_SAMPLE_LIMIT, UNANSWERED_TTL_SECONDS], [500, 300, 2592000]);
});

test('maskDigits che mọi dãy từ 3 chữ số trở lên', () => {
  assert.equal(maskDigits('sinh năm 1960, chuyển 500.000 hôm 12/10'), 'sinh năm #, chuyển #.# hôm 12/10');
});

test('câu FALLBACK được lưu đã che số, không kèm người hỏi, trang hay IP', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const result = await ask('mình chuyển tiền 500.000 rồi mà chưa thấy vé', {}, { userId, page: '/events/mountain-race' });
  assert.match(result.reply, FALLBACK); assert.equal(result.mode, 'guide');
  const row = await UnansweredQuestion.findOne().lean();
  assert.deepEqual([row.kind, row.sample, row.count, row.status, row.articleKeys], ['NO_ANSWER', 'mình chuyển tiền #.# rồi mà chưa thấy vé', 1, 'OPEN', []]);
  assert.ok(row.firstAskedAt instanceof Date && row.lastAskedAt instanceof Date);
  assert.deepEqual(Object.keys(row).filter(k => /user|ip|page/i.test(k)), []);
  assert.doesNotMatch(JSON.stringify(row), /507f|mountain-race|500/);
});

test('câu nhạy cảm, câu tự giới thiệu, câu sức khỏe và câu không còn chữ nào thì không bao giờ được lưu', async () => {
  const questions = ['email mình là a@b.com sao chưa có vé', 'Tôi là Trần Thị B, sinh năm 1960, chuyển tiền rồi', 'mình bị hen suyễn có chạy được không', '123456', '🙂🙂', 'vé?', '12/10 5'];
  for (const q of questions) {
    assert.match((await ask(q)).reply, FALLBACK, q);
    assert.equal(await recordUnanswered(q), 'skipped', q);
  }
  assert.equal(await UnansweredQuestion.countDocuments(), 0);
});

test('câu dài 2000 ký tự được lưu cắt còn 300 ký tự', async () => {
  const message = 'chưa thấy vé ' + 'a'.repeat(2000 - 'chưa thấy vé '.length);
  assert.equal(message.length, 2000);
  await ask(message);
  const row = await UnansweredQuestion.findOne().lean();
  assert.equal(row.sample.length, 300); assert.equal(row.sample, message.slice(0, 300));
});

test('ba câu giống nhau gửi cùng lúc chỉ tạo một dòng với count bằng 3', async () => {
  const results = await Promise.all([1, 2, 3].map(() => recordUnanswered('đổi cự ly sau khi mua vé được không')));
  assert.deepEqual(results.sort(), ['counted', 'counted', 'created']);
  const rows = await UnansweredQuestion.find().lean();
  assert.deepEqual(rows.map(row => row.count), [3]);
});

test('câu chỉ khác chữ hoa, dấu hay dãy số thì gộp vào cùng một dòng', async () => {
  assert.equal(await recordUnanswered('Đơn 1234 chưa có vé'), 'created');
  assert.equal(await recordUnanswered('don 98765 chua co ve'), 'counted');
  const rows = await UnansweredQuestion.find().lean();
  assert.deepEqual(rows.map(row => [row.sample, row.count]), [['Đơn # chưa có vé', 2]]);
});

test('ghi lỗi thì bot vẫn trả FALLBACK; đọc bài lỗi, câu có bài hay câu nhận nút thì không ghi', async () => {
  const logged = []; const consoleError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let failing;
  try { failing = await ask('đổi cự ly sau khi mua vé được không', { recordMiss: async () => { throw new Error('write failed'); } }); }
  finally { console.error = consoleError; }
  assert.match(failing.reply, FALLBACK); assert.equal(failing.mode, 'guide');
  assert.ok(logged.some(line => /write failed/.test(line)), 'lỗi ghi hàng chờ được ghi log cho người vận hành');

  const silenced = console.error; console.error = () => {};
  try { await ask('đổi cự ly sau khi mua vé được không', { findArticles: async () => { throw new Error('db down'); } }); }
  finally { console.error = silenced; }
  assert.equal(await UnansweredQuestion.countDocuments(), 0);

  const calls = [];
  const recordMiss = async question => { calls.push(question); return 'created'; };
  const withArticles = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, recordMiss });
  await withArticles({ message: 'giữ chỗ được bao lâu' });
  // Câu "của tôi" không rõ tác vụ nhận 3 nút thay cho FALLBACK, nên không vào hàng chờ (plan :808).
  const unclear = await withArticles({ message: 'của tôi đâu rồi', userId: '507f1f77bcf86cd799439011' });
  assert.ok(unclear.actions?.length > 0, 'câu không rõ tác vụ nhận nút');
  assert.deepEqual(calls, []);
  await withArticles({ message: 'đổi cự ly được không' });
  assert.deepEqual(calls, ['đổi cự ly được không']);
});

test('TTL index xóa dòng 2592000 giây sau lastAskedAt, và kind cùng normalized là duy nhất', async () => {
  const indexes = await UnansweredQuestion.collection.indexes();
  const ttl = indexes.find(index => index.key.lastAskedAt === 1);
  assert.equal(ttl.expireAfterSeconds, 2592000);
  const unique = indexes.find(index => index.key.kind === 1 && index.key.normalized === 1);
  assert.equal(unique.unique, true);
});

test('đủ 500 câu OPEN thì câu mới bị bỏ qua nhưng câu đã có vẫn được đếm', async () => {
  const now = new Date();
  const row = (normalized, status = 'OPEN') => ({ kind: 'NO_ANSWER', normalized, sample: normalized, count: 1, status, articleKeys: [], firstAskedAt: now, lastAskedAt: now });
  await UnansweredQuestion.insertMany([row('cau da co'), ...Array.from({ length: 499 }, (_, i) => row('cau so ' + i)), row('cau da xu ly', 'RESOLVED')]);
  assert.equal(await recordUnanswered('một câu hoàn toàn mới'), 'skipped');
  assert.equal(await recordUnanswered('Câu đã có'), 'counted');
  assert.equal((await UnansweredQuestion.findOne({ normalized: 'cau da co' }).lean()).count, 2);
  assert.equal(await UnansweredQuestion.countDocuments({ status: 'OPEN' }), 500);
  // Câu RESOLVED không tính vào giới hạn: bớt một câu OPEN thì câu mới lại được ghi.
  await UnansweredQuestion.deleteOne({ normalized: 'cau so 0' });
  assert.equal(await recordUnanswered('một câu hoàn toàn mới'), 'created');
});

test('câu RESOLVED bị hỏi lại thì mở lại thành OPEN; câu IGNORED thì giữ nguyên', async () => {
  await recordUnanswered('đổi cự ly được không'); await recordUnanswered('xin voucher giảm giá');
  await UnansweredQuestion.updateOne({ normalized: 'doi cu ly duoc khong' }, { status: 'RESOLVED' });
  await UnansweredQuestion.updateOne({ normalized: 'xin voucher giam gia' }, { status: 'IGNORED' });
  await ask('đổi cự ly được không'); await ask('xin voucher giảm giá');
  const rows = await UnansweredQuestion.find().sort({ normalized: 1 }).lean();
  assert.deepEqual(rows.map(row => [row.normalized, row.status, row.count]), [['doi cu ly duoc khong', 'OPEN', 2], ['xin voucher giam gia', 'IGNORED', 2]]);
});

test('báo "Chưa đúng" lưu thành dòng WRONG_ANSWER riêng, kèm key các bài và gộp key khi báo lại', async () => {
  assert.equal(await recordUnanswered('giữ chỗ được bao lâu', { kind: 'WRONG_ANSWER', articleKeys: ['hold'] }), 'created');
  assert.equal(await recordUnanswered('giữ chỗ được bao lâu', { kind: 'WRONG_ANSWER', articleKeys: ['hold', 'payment'] }), 'counted');
  assert.equal(await recordUnanswered('giữ chỗ được bao lâu'), 'created');
  const rows = await UnansweredQuestion.find().sort({ kind: 1 }).lean();
  assert.deepEqual(rows.map(row => [row.kind, row.count, [...row.articleKeys].sort()]), [['NO_ANSWER', 1, []], ['WRONG_ANSWER', 2, ['hold', 'payment']]]);
});

test('admin xem thử câu trả lời thì không ghi vào hàng chờ', async () => {
  const result = await previewAnswer({ question: 'đổi cự ly sau khi mua vé được không' });
  assert.match(result.reply, FALLBACK);
  assert.equal(await UnansweredQuestion.countDocuments(), 0);
});
