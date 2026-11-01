// The support bot reads PUBLISHED articles from MongoDB through a short in-memory cache.
// Runs against an in-memory MongoDB replica set (tests/helpers).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-store-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const { rankArticles, seedArticles } = require('../../src/backend/services/supportKnowledge');
const { createKnowledgeStore, loadPublishedArticles, clearKnowledgeCache } = require('../../src/backend/services/supportKnowledgeStore');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_store' });
before(harness.start);
after(harness.stop);

const PROBES = { // kết quả của findSupportKnowledge trước P04, chạy thật ngày 31-10-2026
  'giữ chỗ được bao lâu': ['hold'], 'mình chuyển tiền rồi mà chưa thấy vé': [], 'quên mật khẩu thì làm sao': ['account'],
  'tôi không đăng nhập được': ['account'], 'nạp tiền vào ví bao lâu được duyệt': ['wallet'], 'bán lại vé cho bạn được không': [],
  'cho mình hỏi số bib ở đâu': [], 'khi nào có kết quả chạy': ['results'], 'muốn mở giải chạy thì làm gì': [],
  'đổi size áo được không': ['profile'], 'hủy đăng ký có được hoàn tiền không': ['payment', 'registration'],
  'nhận áo và bib ở đâu': [], 'cho mình hỏi chút': [],
};

test('rankArticles over the seed articles reproduces the pre-P04 results', () => {
  for (const [question, keys] of Object.entries(PROBES)) assert.deepEqual(rankArticles(seedArticles(), question).map(a => a.key), keys, question);
});

test('terms written with capitals, punctuation or decomposed accents still match', () => {
  const articles = [{ key: 'x', priority: 0, terms: ['  ĐỔI SIZE ÁO! ', 'đổi size'.normalize('NFD')] }];
  assert.deepEqual(rankArticles(articles, 'Đổi size áo được không?').map(a => a.key), ['x']);
});

test('the store caches for 60 s and reloads after clear', async () => {
  let clock = 0, rows = [{ key: 'a' }];
  const store = createKnowledgeStore({ find: async () => rows, now: () => clock });
  await store.load(); rows = [{ key: 'a' }, { key: 'b' }];
  assert.equal((await store.load()).length, 1); clock = 60001; assert.equal((await store.load()).length, 2);
  rows = [{ key: 'c' }]; store.clear(); assert.deepEqual((await store.load()).map(a => a.key), ['c']);
});

test('a clear during an in-flight load keeps the stale result out of the cache', async () => {
  let release, calls = 0;
  const store = createKnowledgeStore({ find: () => (++calls === 1 ? new Promise(r => { release = r; }) : Promise.resolve([{ key: 'moi' }])) });
  const first = store.load(); store.clear(); release([{ key: 'cu' }]); await first;
  assert.deepEqual((await store.load()).map(a => a.key), ['moi']); assert.equal(calls, 2);
});

test('only PUBLISHED articles load, and equal scores keep the older article first on every load', async () => {
  const base = { title: 't', terms: ['cum chung'], answer: 'a', status: 'PUBLISHED' };
  await SupportArticle.create({ ...base, key: 'sau' });
  await SupportArticle.create({ ...base, key: 'truoc' });
  await SupportArticle.collection.updateOne({ key: 'truoc' }, { $set: { createdAt: new Date(Date.now() - 60000) } }); // bỏ qua timestamps của Mongoose
  await SupportArticle.create({ ...base, key: 'nhap', status: 'DRAFT' });
  for (let i = 0; i < 3; i++) {
    clearKnowledgeCache();
    assert.deepEqual(rankArticles(await loadPublishedArticles(), 'cum chung').map(a => a.key), ['truoc', 'sau']);
  }
  assert.ok((await loadPublishedArticles()).every(a => a.history === undefined), 'the cache never holds old versions');
});

test('a DRAFT article never answers in chat', async () => {
  await SupportArticle.create({ key: 'chi-nhap', title: 'Bài nháp', terms: ['cau chi co trong ban nhap'], answer: 'Nội dung bản nháp', status: 'DRAFT' });
  clearKnowledgeCache();
  const result = await createSupportResponder({ generateReply: null })({ message: 'Câu chỉ có trong bản nháp?' });
  assert.match(result.reply, /chưa có thông tin đã xác thực/); assert.doesNotMatch(result.reply, /bản nháp/);
});

test('articles shaped like database rows (key, no id) still route event questions to public events', async () => {
  const fromDb = seedArticles().map(({ id, ...article }) => article);
  const event = { name: 'Giải Huế mở rộng', url: '/events/giai-hue', city: 'Huế', date: '01/02/2027', registrationOpen: true, categories: [] };
  const answer = createSupportResponder({ findArticles: async () => fromDb, findEvents: async () => [event], generateReply: null });
  const result = await answer({ message: 'Có giải nào sắp diễn ra?' });
  assert.match(result.reply, /Giải Huế mở rộng/); assert.deepEqual(result.sources, [{ title: event.name, url: event.url }]);
});

test('a failing store gives the FALLBACK answer', async () => {
  const answer = createSupportResponder({ findArticles: async () => { throw new Error('db down'); }, generateReply: () => { throw Error('no AI'); } });
  const result = await answer({ message: 'giữ chỗ được bao lâu' });
  assert.equal(result.mode, 'guide'); assert.match(result.reply, /chưa có thông tin đã xác thực/);
});

test('a failed knowledge read is logged, so an outage does not look like an unanswered question', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  await createSupportResponder({ findArticles: async () => { throw new Error('db down'); }, generateReply: null })({ message: 'giữ chỗ được bao lâu' });
  assert.match(logged.mock.calls.map(call => call.arguments.join(' ')).join('\n'), /db down/);
});

test('a PUBLISHED row written around the model rules is skipped and logged, and other articles still answer', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const broken = ['hong-terms', 'link-ngoai'];
  t.after(() => SupportArticle.deleteMany({ key: { $in: [...broken, 'con-tot'] } }));
  await SupportArticle.collection.insertMany([ // như khi sửa tay trong Compass: không qua luật của model
    { key: 'hong-terms', title: 'Hỏng', terms: null, answer: 'Bài hỏng', status: 'PUBLISHED', createdAt: new Date() },
    { key: 'link-ngoai', title: 'Link ngoài', terms: ['cau co link ngoai'], answer: 'Xem trang ngoài', sources: [{ title: 'x', url: 'https://evil.example' }], status: 'PUBLISHED', createdAt: new Date() },
  ]);
  await SupportArticle.create({ key: 'con-tot', title: 'Còn tốt', terms: ['cau van tra loi duoc'], answer: 'Bài còn tốt', status: 'PUBLISHED' });
  clearKnowledgeCache();
  const keys = (await loadPublishedArticles()).map(article => article.key);
  assert.ok(keys.includes('con-tot')); assert.deepEqual(broken.filter(key => keys.includes(key)), []);
  assert.equal(logged.mock.callCount(), 2);
  const result = await createSupportResponder({ generateReply: null })({ message: 'Câu vẫn trả lời được không?' });
  assert.match(result.reply, /Bài còn tốt/);
});
