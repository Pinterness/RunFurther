// Bộ đếm lượt AI (spec 4.8 bước 6-7): ngày tính theo giờ Los Angeles để khớp giờ hồi lượt của Gemini, giữ lượt
// bằng một lệnh nguyên tử nên không bao giờ vượt AI_DAILY_LIMIT, và mỗi tài khoản tối đa 30 câu AI mỗi ngày.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers); mỗi test bắt đầu với bảng đếm rỗng.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-ai-usage-test-secret';

const { app } = require('../../src/backend/server');
const AiUsage = require('../../src/backend/models/AiUsage');
const { pacificDay, readDailyLimit, reserveAiCall, todayUsage, createAccountAllowance, AI_USAGE_RETENTION_DAYS } = require('../../src/backend/services/aiUsageService');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_ai_usage' });
before(harness.start);
after(harness.stop);
beforeEach(() => AiUsage.deleteMany({}));

const NOW = new Date('2026-11-05T03:00:00Z'); // 19 giờ ngày 04-11 ở Los Angeles

test('pacificDay đổi ngày lúc 0 giờ ở Los Angeles, cả trước và sau lúc đổi giờ mùa hè', () => {
  // 01-11-2026 là ngày Mỹ đổi từ giờ mùa hè (UTC-7) về giờ chuẩn (UTC-8).
  assert.equal(pacificDay(new Date('2026-11-01T06:59:00Z')), '2026-10-31');
  assert.equal(pacificDay(new Date('2026-11-01T07:00:00Z')), '2026-11-01');
  assert.equal(pacificDay(new Date('2026-11-02T07:59:00Z')), '2026-11-01');
  assert.equal(pacificDay(new Date('2026-11-02T08:00:00Z')), '2026-11-02');
  // Giờ Việt Nam: 14 giờ chiều mùa đông là lúc sang ngày Pacific mới.
  assert.equal(pacificDay(new Date('2026-11-16T07:59:00Z')), '2026-11-15');
  assert.equal(pacificDay(new Date('2026-11-16T08:00:00Z')), '2026-11-16');
});

test('readDailyLimit coi giá trị thiếu hoặc sai là 0', () => {
  const cases = [{}, { AI_DAILY_LIMIT: '' }, { AI_DAILY_LIMIT: 'abc' }, { AI_DAILY_LIMIT: '-5' }, { AI_DAILY_LIMIT: '2.5' }, { AI_DAILY_LIMIT: '1e3' },
    { AI_DAILY_LIMIT: '99999999999999999999' }, { AI_DAILY_LIMIT: '200' }, { AI_DAILY_LIMIT: ' 40 ' }];
  assert.deepEqual(cases.map(env => readDailyLimit(env)), [0, 0, 0, 0, 0, 0, 0, 200, 40]);
});

test('reserveAiCall dừng đúng ở mức giới hạn, và giới hạn 0 không bao giờ giữ được lượt', async () => {
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await reserveAiCall({ limit: 2, now: NOW }));
  assert.deepEqual(results, [true, true, false]);
  assert.equal(await todayUsage(NOW), 2);
  // Giới hạn 0, âm hay không phải số nguyên: trả false mà không chạy truy vấn nào, nên không tạo dòng mới.
  await AiUsage.deleteMany({});
  for (const limit of [0, -1, 1.5, NaN, undefined, '3']) assert.equal(await reserveAiCall({ limit, now: NOW }), false, String(limit));
  assert.equal(await AiUsage.countDocuments(), 0);
});

test('sang ngày Pacific mới thì lượt đếm lại từ đầu', async () => {
  assert.equal(await reserveAiCall({ limit: 1, now: new Date('2026-11-16T07:59:00Z') }), true);
  assert.equal(await reserveAiCall({ limit: 1, now: new Date('2026-11-16T07:59:30Z') }), false);
  assert.equal(await reserveAiCall({ limit: 1, now: new Date('2026-11-16T08:00:00Z') }), true);
  assert.deepEqual((await AiUsage.find().sort({ day: 1 }).lean()).map(row => [row.day, row.count]), [['2026-11-15', 1], ['2026-11-16', 1]]);
});

test('còn đúng 1 lượt mà 5 câu tới cùng lúc thì đúng 1 câu giữ được lượt', async () => {
  await AiUsage.create({ day: pacificDay(NOW), count: 9, expiresAt: new Date(NOW.getTime() + 864e5) });
  const results = await Promise.all(Array.from({ length: 5 }, () => reserveAiCall({ limit: 10, now: NOW })));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await todayUsage(NOW), 10);
});

test('5 câu đầu ngày tới cùng lúc với giới hạn 10 thì cả 5 đều giữ được lượt', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => reserveAiCall({ limit: 10, now: NOW })));
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(await todayUsage(NOW), 5);
  assert.equal(await AiUsage.countDocuments(), 1);
});

test('dòng đếm tự xóa 35 ngày sau khi tạo', async () => {
  assert.equal(AI_USAGE_RETENTION_DAYS, 35);
  await reserveAiCall({ limit: 5, now: NOW });
  const row = await AiUsage.findOne({ day: pacificDay(NOW) }).lean();
  assert.equal(row.expiresAt.getTime() - NOW.getTime(), 35 * 864e5);
  // Lần giữ lượt sau không dời ngày xóa.
  await reserveAiCall({ limit: 5, now: new Date(NOW.getTime() + 3600e3) });
  assert.equal((await AiUsage.findOne({ day: pacificDay(NOW) }).lean()).expiresAt.getTime(), row.expiresAt.getTime());
  const ttl = (await AiUsage.collection.indexes()).find(index => index.key.expiresAt === 1);
  assert.equal(ttl?.expireAfterSeconds, 0);
});

test('todayUsage trả 0 khi hôm nay chưa có lượt nào', async () => {
  assert.equal(await todayUsage(NOW), 0);
});

test('mỗi tài khoản được 30 câu AI mỗi ngày Pacific, chỉ đếm khi đã dùng', () => {
  const allowance = createAccountAllowance();
  const later = new Date(NOW.getTime() + 60e3);
  // Hỏi xem còn lượt hay không thì không tốn lượt.
  for (let i = 0; i < 100; i++) assert.equal(allowance.canUse('a', NOW), true);
  for (let i = 0; i < 30; i++) { assert.equal(allowance.canUse('a', later), true, String(i)); allowance.consume('a', later); }
  assert.equal(allowance.canUse('a', later), false);
  // Tài khoản khác không bị ảnh hưởng.
  assert.equal(allowance.canUse('b', later), true);
  // Sang ngày Pacific mới thì có lại 30 câu.
  assert.equal(allowance.canUse('a', new Date('2026-11-05T08:00:00Z')), true);
  const small = createAccountAllowance({ perDay: 2 });
  small.consume('a', NOW); small.consume('a', NOW);
  assert.equal(small.canUse('a', NOW), false);
});

test('bộ đếm theo tài khoản bỏ các ngày cũ, không phình mãi', () => {
  const allowance = createAccountAllowance();
  for (let i = 0; i < 50; i++) allowance.consume('user-' + i, NOW);
  assert.equal(allowance.size(), 50);
  allowance.consume('user-0', new Date('2026-11-05T08:00:00Z'));
  assert.equal(allowance.size(), 1);
});
