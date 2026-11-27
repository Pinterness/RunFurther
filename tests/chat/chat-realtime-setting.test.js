// Công tắc realtime của chat (ADR realtime mục 3.8, plan Task 14.1). Công tắc lưu trong PlatformSetting key
// CHAT_REALTIME; chưa có tài liệu nghĩa là bật; biến môi trường CHAT_REALTIME=off là công tắc tổng, thắng DB. Super Admin
// bật tắt qua /api/chat/admin/realtime; client biết trạng thái qua trường `realtime` của REST.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-chat-realtime-setting-test-secret';

const { app } = require('../../src/backend/server');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const realtimeSetting = require('../../src/backend/services/chatRealtimeSetting');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const { isRealtimeOn, setRealtime, onRealtimeChange } = realtimeSetting;
const harness = createBackendHarness({ app, dbName: 'runfurther_chat_realtime_setting' });
const { request, createUser } = harness;
const { member } = createChatFixtures(harness);
const put = (as, body) => request('/chat/admin/realtime', { method: 'PUT', as, body });
let admin;

before(async () => {
  await harness.start();
  admin = await createUser({ role: 'SUPER_ADMIN', dob: '1980-01-01' });
});
after(harness.stop);

test('chưa có tài liệu công tắc thì realtime bật', async () => {
  assert.equal(await PlatformSetting.exists({ key: 'CHAT_REALTIME' }), null);
  assert.equal(await isRealtimeOn({ env: {} }), true);
});

test('CHAT_REALTIME=off thắng DB đang bật', async () => {
  await setRealtime(true, admin.id);
  assert.equal(await isRealtimeOn({ env: { CHAT_REALTIME: 'off' } }), false);
  assert.equal(await isRealtimeOn({ env: {} }), true);
});

test('tắt trong admin có hiệu lực ngay ở lần đọc kế tiếp và báo cho người nghe', async () => {
  await setRealtime(true, admin.id);
  assert.equal(await isRealtimeOn({ env: {} }), true); // lần đọc này nằm trong cache 30 giây
  const heard = [];
  const stop = onRealtimeChange(enabled => heard.push(enabled));
  try {
    const result = await setRealtime(false, admin.id);
    assert.equal(result.enabled, false);
    assert.equal(await isRealtimeOn({ env: {} }), false);
    assert.deepEqual(heard, [false]);
  } finally {
    stop();
  }
  await setRealtime(true, admin.id);
  assert.deepEqual(heard, [false], 'đã hủy đăng ký thì không nghe nữa');
});

test('đọc DB lỗi thì coi như tắt và không lưu kết quả lỗi vào cache', async () => {
  await setRealtime(true, admin.id); // xóa cache
  const original = PlatformSetting.findOne;
  PlatformSetting.findOne = () => { throw new Error('mất kết nối giả'); };
  try {
    assert.equal(await isRealtimeOn({ env: {} }), false);
  } finally {
    PlatformSetting.findOne = original;
  }
  assert.equal(await isRealtimeOn({ env: {} }), true);
});

test('RUNNER gọi API công tắc nhận 403; body sai nhận 400 CHAT_SETTING_INVALID', async () => {
  const runner = await member();
  assert.equal((await request('/chat/admin/realtime', { as: runner })).status, 403);
  assert.equal((await put(runner, { realtimeEnabled: false })).status, 403);
  for (const body of [{}, { realtimeEnabled: 'false' }, { realtimeEnabled: 0 }]) {
    const bad = await put(admin, body);
    assert.equal(bad.status, 400, JSON.stringify(body));
    assert.equal(bad.body.code, 'CHAT_SETTING_INVALID');
  }
});

test('Super Admin tắt rồi bật: trả trạng thái, công tắc tổng và lịch sử mới nhất trước, không có email', async () => {
  const off = await put(admin, { realtimeEnabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.setting.realtimeEnabled, false);
  assert.equal(off.body.setting.forcedOff, false);
  const on = await put(admin, { realtimeEnabled: true });
  const { history } = on.body.setting;
  assert.equal(on.body.setting.realtimeEnabled, true);
  assert.deepEqual(history.slice(0, 2).map(entry => entry.realtimeEnabled), [true, false]);
  assert.deepEqual(Object.keys(history[0].changedBy), ['fullName']);
  assert.ok(history.length <= 10);
  const read = await request('/chat/admin/realtime', { as: admin });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.setting, on.body.setting);
});

test('GET /chat/me và danh sách cuộc trò chuyện trả realtime theo công tắc', async () => {
  const runner = await member();
  await put(admin, { realtimeEnabled: true });
  assert.equal((await request('/chat/me', { as: runner })).body.realtime, true);
  assert.equal((await request('/chat/conversations', { as: runner })).body.realtime, true);
  await put(admin, { realtimeEnabled: false });
  assert.equal((await request('/chat/me', { as: runner })).body.realtime, false);
  assert.equal((await request('/chat/conversations', { as: runner })).body.realtime, false);
  await put(admin, { realtimeEnabled: true });
});
