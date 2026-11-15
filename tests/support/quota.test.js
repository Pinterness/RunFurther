// Đồng hồ hạn mức và chuông của Super Admin (spec 4.9, master plan §14.3): dung lượng Atlas so với 512 MB và lượt AI
// hôm nay so với AI_DAILY_LIMIT; từ 70% có mục mức vàng, từ 90% có mục mức đỏ. Đồng hồ nào lỗi thì bỏ đồng hồ đó.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'isolated-support-quota-test-secret';

const { app } = require('../../src/backend/server');
const AiUsage = require('../../src/backend/models/AiUsage');
const PaymentRequest = require('../../src/backend/models/PaymentRequest');
const { ATLAS_LIMIT_BYTES, createAtlasMeter, createAiMeter, quotaAlerts, clearQuotaCache } = require('../../src/backend/services/quotaService');
const { pacificDay } = require('../../src/backend/services/aiUsageService');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_quota' });
const { request } = harness;
const savedLimit = process.env.AI_DAILY_LIMIT;
let admin, runner;

before(async () => {
  await harness.start();
  admin = await harness.createUser({ role: 'SUPER_ADMIN' });
  runner = await harness.createUser();
});
after(async () => {
  if (savedLimit === undefined) delete process.env.AI_DAILY_LIMIT; else process.env.AI_DAILY_LIMIT = savedLimit;
  await harness.stop();
});
beforeEach(async () => { await AiUsage.deleteMany({}); clearQuotaCache(); delete process.env.AI_DAILY_LIMIT; });

const meter = (name, used, period = '2026-11') => ({ name, label: name, read: async () => ({ used, limit: 100, detail: `${used}/100` }), period: () => period });
const NOW = new Date('2026-11-05T03:00:00Z');

test('dưới 70% không có mục; 72% có mục mức 70; 91% có mục mức 90', async () => {
  const items = await quotaAlerts({ meters: [meter('atlas', 69), meter('ai', 72, '2026-11-05'), meter('x', 91)], now: NOW });
  assert.deepEqual(items.map(item => item.key), ['quota:ai:70:2026-11-05', 'quota:x:90:2026-11']);
  assert.deepEqual(items[0], { key: 'quota:ai:70:2026-11-05', title: 'ai đã dùng 72% (mức 70%)', detail: '72/100', href: '/admin', at: NOW });
  assert.equal(items[1].title, 'x đã dùng 91% (mức 90%)');
  // Đúng ngưỡng thì tính mức đó; 89,9% vẫn là mức 70 và không làm tròn lên thành 90%.
  const edges = await quotaAlerts({ meters: [meter('a', 70), meter('b', 90), meter('c', 89.9), meter('d', 150)], now: NOW });
  assert.deepEqual(edges.map(item => item.title), ['a đã dùng 70% (mức 70%)', 'b đã dùng 90% (mức 90%)', 'c đã dùng 89% (mức 70%)', 'd đã dùng 150% (mức 90%)']);
});

test('đồng hồ lỗi bị bỏ qua và các đồng hồ khác vẫn báo; giới hạn 0 thì bỏ qua đồng hồ', async () => {
  const broken = { name: 'atlas', label: 'atlas', read: async () => { throw new Error('stats failed'); }, period: () => '2026-11' };
  const off = { name: 'ai', label: 'ai', read: async () => ({ used: 5, limit: 0, detail: '' }), period: () => '2026-11-05' };
  const logged = []; const consoleError = console.error; console.error = (...args) => logged.push(args.join(' '));
  let items;
  try { items = await quotaAlerts({ meters: [broken, off, meter('x', 95)], now: NOW }); }
  finally { console.error = consoleError; }
  assert.deepEqual(items.map(item => item.key), ['quota:x:90:2026-11']);
  assert.ok(logged.some(line => /stats failed/.test(line)));
});

test('đồng hồ Atlas lấy dataSize + indexSize chia 512 MB, cache 10 phút, kỳ tính theo tháng giờ Việt Nam', async () => {
  assert.equal(ATLAS_LIMIT_BYTES, 536870912);
  let calls = 0, clock = 0;
  const atlas = createAtlasMeter({ stats: async () => { calls++; return { dataSize: 300 * 1048576, indexSize: 76.8 * 1048576, storageSize: 999e9 }; }, now: () => clock });
  const first = await atlas.read(NOW);
  assert.equal(first.used, 376.8 * 1048576); assert.equal(first.limit, ATLAS_LIMIT_BYTES);
  assert.match(first.detail, /376,8 MB \/ 512 MB/);
  clock = 599_999; await atlas.read(NOW);
  assert.equal(calls, 1);
  clock = 600_001; await atlas.read(NOW);
  assert.equal(calls, 2);
  // 31-10 lúc 17:30 UTC là 00:30 ngày 01-11 giờ Việt Nam.
  assert.equal(atlas.period(new Date('2026-10-31T17:30:00Z')), '2026-11');
  assert.equal(atlas.period(new Date('2026-10-31T16:59:00Z')), '2026-10');
  // Lỗi không được cache: lần sau đọc lại.
  const failing = createAtlasMeter({ stats: async () => { calls++; throw new Error('down'); }, now: () => 0 });
  calls = 0;
  await assert.rejects(failing.read(NOW)); await assert.rejects(failing.read(NOW));
  assert.equal(calls, 2);
});

test('đồng hồ AI so lượt hôm nay với AI_DAILY_LIMIT, kỳ là ngày Pacific; giới hạn 0 thì không đọc DB', async () => {
  let reads = 0;
  const ai = createAiMeter({ usage: async () => { reads++; return 8; }, env: { AI_DAILY_LIMIT: '10' } });
  assert.deepEqual(await ai.read(NOW), { used: 8, limit: 10, detail: '8 / 10 lượt hôm nay; lượt hồi lúc 0 giờ giờ Thái Bình Dương (14 hoặc 15 giờ chiều giờ Việt Nam)' });
  assert.equal(ai.period(NOW), '2026-11-04');
  const off = createAiMeter({ usage: async () => { reads++; return 8; }, env: {} });
  assert.equal((await off.read(NOW)).limit, 0);
  assert.equal(reads, 1);
});

test('SUPER_ADMIN thấy mục lượt AI trong chuông; RUNNER không bao giờ thấy mục hạn mức', async () => {
  process.env.AI_DAILY_LIMIT = '10';
  await AiUsage.create({ day: pacificDay(new Date()), count: 8, expiresAt: new Date(Date.now() + 864e5) });
  const adminBell = await request('/notifications', { as: admin });
  assert.equal(adminBell.status, 200);
  const item = adminBell.body.notifications.find(n => n.key.startsWith('quota:ai:'));
  assert.equal(item?.key, `quota:ai:70:${pacificDay(new Date())}`);
  assert.equal(item.title, 'Lượt AI hôm nay đã dùng 80% (mức 70%)'); assert.equal(item.href, '/admin'); assert.equal(item.read, false);
  // Đánh dấu đã đọc như mọi mục khác.
  assert.equal((await request('/notifications/read', { method: 'POST', as: admin, body: { keys: [item.key] } })).status, 200);
  assert.equal((await request('/notifications', { as: admin })).body.notifications.find(n => n.key === item.key).read, true);
  const runnerBell = await request('/notifications', { as: runner });
  assert.equal(runnerBell.status, 200);
  assert.ok(!runnerBell.body.notifications.some(n => n.key.startsWith('quota:')));
});

test('db.stats() lỗi thì chuông của Super Admin vẫn trả các mục khác', async () => {
  process.env.AI_DAILY_LIMIT = '10';
  await AiUsage.create({ day: pacificDay(new Date()), count: 9, expiresAt: new Date(Date.now() + 864e5) });
  await PaymentRequest.collection.insertOne({ userId: new mongoose.Types.ObjectId(runner.id), kind: 'TOPUP', status: 'PENDING', amount: 50000, transferCode: 'NAPK7M2Q9XA', createdAt: new Date(), updatedAt: new Date() });
  const db = mongoose.connection.db, stats = db.stats;
  db.stats = async () => { throw new Error('stats unavailable'); };
  const consoleError = console.error; console.error = () => {};
  let bell;
  try { bell = await request('/notifications', { as: admin }); }
  finally { db.stats = stats; console.error = consoleError; await PaymentRequest.deleteMany({}); }
  assert.equal(bell.status, 200);
  const keys = bell.body.notifications.map(n => n.key);
  assert.ok(keys.some(key => key.startsWith('topup-review:')), keys.join());
  assert.ok(keys.includes(`quota:ai:90:${pacificDay(new Date())}`), keys.join());
  assert.ok(!keys.some(key => key.startsWith('quota:atlas:')));
});
