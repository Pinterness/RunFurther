// Công tắc AI của trợ lý (spec 4.8, D6c, T5): lưu trong PlatformSetting key SUPPORT_AI, mặc định tắt, có lịch sử.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers). Rate limit ghi admin là 30 lần/phút theo IP: cả file
// dùng dưới mức đó.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-ai-setting-test-secret';

const { app } = require('../../src/backend/server');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const AiUsage = require('../../src/backend/models/AiUsage');
const { isAiSwitchOn, setAiEnabled, presentAiSetting, clearAiSettingCache } = require('../../src/backend/services/aiSettingService');
const { pacificDay } = require('../../src/backend/services/aiUsageService');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_ai_setting' });
const { request } = harness;
const ROUTE = '/support/admin/ai';
const AI_KEYS = ['SUPPORT_AI_PROVIDER', 'GEMINI_API_KEY', 'SUPPORT_AI_MODEL', 'AI_DAILY_LIMIT'];
const savedEnv = Object.fromEntries(AI_KEYS.map(key => [key, process.env[key]]));
let admin, runner;

before(async () => {
  await harness.start();
  admin = await harness.createUser({ role: 'SUPER_ADMIN' });
  runner = await harness.createUser();
});
after(async () => {
  for (const key of AI_KEYS) if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  await harness.stop();
});
beforeEach(async () => {
  for (const key of AI_KEYS) delete process.env[key];
  await PlatformSetting.deleteMany({ key: 'SUPPORT_AI' });
  clearAiSettingCache();
});

test('công tắc tắt khi chưa có cài đặt SUPPORT_AI', async () => {
  assert.equal(await isAiSwitchOn(), false);
  const response = await request(ROUTE, { as: admin });
  assert.equal(response.status, 200);
  assert.equal(response.body.setting.aiEnabled, false);
  assert.deepEqual(response.body.setting.history, []);
});

test('SUPER_ADMIN bật rồi tắt AI, có lịch sử; khách 401, RUNNER 403, giá trị không phải boolean bị 400', async () => {
  assert.equal((await request(ROUTE)).status, 401);
  for (const method of ['GET', 'PUT']) assert.equal((await request(ROUTE, { method, as: runner, body: method === 'PUT' ? { aiEnabled: true } : undefined })).status, 403, method);
  for (const body of [{}, { aiEnabled: 'true' }, { aiEnabled: 1 }, { aiEnabled: null }]) {
    const response = await request(ROUTE, { method: 'PUT', as: admin, body });
    assert.equal(response.status, 400, JSON.stringify(body)); assert.equal(response.body.code, 'AI_SETTING_INVALID');
  }
  assert.equal(await PlatformSetting.countDocuments({ key: 'SUPPORT_AI' }), 0);
  const on = await request(ROUTE, { method: 'PUT', as: admin, body: { aiEnabled: true } });
  assert.equal(on.status, 200); assert.equal(on.body.setting.aiEnabled, true);
  assert.equal(await isAiSwitchOn(), true);
  const off = await request(ROUTE, { method: 'PUT', as: admin, body: { aiEnabled: false } });
  assert.equal(off.body.setting.aiEnabled, false); assert.equal(await isAiSwitchOn(), false);
  // Lịch sử mới nhất đứng đầu, kèm người đổi.
  assert.deepEqual(off.body.setting.history.map(entry => entry.aiEnabled), [false, true]);
  assert.equal(off.body.setting.history[0].changedBy.email, admin.email);
  assert.ok(off.body.setting.history.every(entry => !Number.isNaN(Date.parse(entry.changedAt))));
});

test('lịch sử giữ 50 lần đổi gần nhất và chỉ trả về 10 lần', async () => {
  for (let i = 0; i < 55; i++) await setAiEnabled(i % 2 === 0, admin.id);
  const stored = await PlatformSetting.findOne({ key: 'SUPPORT_AI' }).lean();
  assert.equal(stored.history.length, 50);
  const setting = await presentAiSetting({ env: {} });
  assert.equal(setting.history.length, 10);
  assert.equal(setting.history[0].aiEnabled, true); // lần thứ 55 (i = 54) là bật
});

test('GET cho biết nhà cung cấp, model và đã có khóa hay chưa, không bao giờ trả khóa', async () => {
  Object.assign(process.env, { SUPPORT_AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'secret-key-value', SUPPORT_AI_MODEL: 'gemini-3.5-flash-lite', AI_DAILY_LIMIT: '10' });
  await AiUsage.create({ day: pacificDay(new Date()), count: 8, expiresAt: new Date(Date.now() + 864e5) });
  try {
    const response = await request(ROUTE, { as: admin });
    assert.doesNotMatch(JSON.stringify(response.body), /secret-key-value/);
    const { setting } = response.body;
    assert.deepEqual([setting.provider, setting.model, setting.configured], ['gemini', 'gemini-3.5-flash-lite', true]);
    assert.deepEqual(setting.today, { day: pacificDay(new Date()), used: 8, limit: 10 });
    assert.deepEqual(Object.keys(setting).sort(), ['aiEnabled', 'configured', 'history', 'model', 'provider', 'today']);
  } finally { await AiUsage.deleteMany({}); }
  // Máy chủ ở chế độ guide: chưa cấu hình, giới hạn 0.
  const guide = await presentAiSetting({ env: { SUPPORT_AI_PROVIDER: 'guide' } });
  assert.deepEqual([guide.provider, guide.model, guide.configured, guide.today.limit], ['guide', '', false, 0]);
  assert.equal((await presentAiSetting({ env: {} })).provider, 'guide');
});

test('đọc công tắc có cache 30 giây, và lưu công tắc thì xóa cache', async () => {
  assert.equal(await isAiSwitchOn(), false);
  // Ghi thẳng vào DB, không qua setAiEnabled: cache còn hạn nên vẫn đọc ra giá trị cũ.
  await PlatformSetting.create({ key: 'SUPPORT_AI', aiEnabled: true });
  assert.equal(await isAiSwitchOn(), false);
  assert.equal(await isAiSwitchOn({ now: Date.now() + 29_000 }), false);
  assert.equal(await isAiSwitchOn({ now: Date.now() + 31_000 }), true);
  await setAiEnabled(false, admin.id);
  assert.equal(await isAiSwitchOn(), false);
  await setAiEnabled(true, admin.id);
  assert.equal(await isAiSwitchOn(), true);
});

test('lần đọc chậm bắt đầu trước khi admin lưu không ghi đè giá trị cũ vào cache', async () => {
  const findOne = PlatformSetting.findOne;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // Lần đọc này thấy công tắc đang tắt, nhưng chỉ trả kết quả sau khi admin đã bật.
  PlatformSetting.findOne = (...args) => {
    const query = findOne.apply(PlatformSetting, args);
    return { select: () => ({ lean: async () => { const value = await query.select('aiEnabled').lean(); await gate; return value; } }) };
  };
  let slowRead;
  try { slowRead = isAiSwitchOn(); }
  finally { PlatformSetting.findOne = findOne; }
  await new Promise(resolve => setTimeout(resolve, 20));
  await setAiEnabled(true, admin.id);
  release();
  assert.equal(await slowRead, false);
  assert.equal(await isAiSwitchOn(), true);
});

test('đọc cài đặt lỗi thì coi như công tắc tắt', async () => {
  await setAiEnabled(true, admin.id);
  clearAiSettingCache();
  const findOne = PlatformSetting.findOne;
  PlatformSetting.findOne = () => { throw new Error('db down'); };
  const consoleError = console.error; console.error = () => {};
  try { assert.equal(await isAiSwitchOn(), false); }
  finally { PlatformSetting.findOne = findOne; console.error = consoleError; }
});

test('cài đặt SUPPORT_AI không đụng tới tài khoản nhận nạp ví', async () => {
  await PlatformSetting.create({ key: 'WALLET_TOPUP', bankAccountInfo: { bankBin: '970436', accountNo: '0123', accountName: 'A' } });
  try {
    await setAiEnabled(true, admin.id);
    const wallet = await PlatformSetting.findOne({ key: 'WALLET_TOPUP' }).lean();
    assert.equal(wallet.aiEnabled, undefined);
    assert.equal(wallet.bankAccountInfo.accountNo, '0123');
    const ai = await PlatformSetting.findOne({ key: 'SUPPORT_AI' }).lean();
    assert.equal(ai.bankAccountInfo, undefined);
  } finally { await PlatformSetting.deleteMany({ key: 'WALLET_TOPUP' }); }
});
