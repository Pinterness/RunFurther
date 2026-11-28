// Chống quá tải và khe đua của lớp realtime (soát chuyên gia sau PR #21, 28-11-2026).
// - Một kết nối WebSocket chỉ được bắt tay một lần: gửi dồn gói CONNECT không được biến thành hàng trăm lượt đọc DB
//   hay hàng nghìn socket.
// - Mỗi người tối đa 5 socket; gói tin tối đa 8 KB.
// - Khe đua: tắt công tắc hay rút đồng ý đúng lúc server đang kiểm quyền thì socket vẫn phải bị ngắt.
// - DB lỗi lúc bắt tay không được báo nhầm thành token sai.
// Không có test "bấm bật và tắt cùng lúc": chỉ cần một lần báo "tắt" là mọi socket bị ngắt, và lần báo đó luôn xảy ra.
// Gửi gói Engine.IO/Socket.IO thô bằng thư viện ws ("40{...}" là CONNECT, server trả "40" khi nhận, "44" khi từ chối).
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { io: connectClient } = require('socket.io-client');

process.env.JWT_SECRET = 'isolated-chat-socket-hardening-test-secret';

// Chèn độ trễ hay lỗi vào senderEligible trước khi realtime/index.js nạp nó. Độ trễ đặt SAU khi đã đọc quyền, giống
// lúc kết quả đọc DB còn đang trên đường về: đó là khe để một thay đổi khác chen vào.
const chatGate = require('../../src/backend/services/chatGate');
const realEligible = chatGate.senderEligible;
let eligibleDelay = 0, eligibleError = null, entered = null, eligibleCalls = 0;
chatGate.senderEligible = async (...args) => {
  eligibleCalls += 1;
  if (eligibleError) throw eligibleError;
  const result = await realEligible(...args);
  entered?.();
  if (eligibleDelay) await new Promise(resolve => setTimeout(resolve, eligibleDelay));
  return result;
};

const { app } = require('../../src/backend/server');
const { attachRealtime } = require('../../src/backend/realtime');
const { setRealtime } = require('../../src/backend/services/chatRealtimeSetting');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_socket_hardening' });
const { request, createUser } = harness;
const { member } = createChatFixtures(harness);
const opened = new Set();
let realtime, socketUrl, admin;

before(async () => {
  await harness.start();
  realtime = attachRealtime(harness.server());
  harness.addCleanup(realtime.close);
  socketUrl = harness.baseUrl().replace(/\/api$/, '');
  admin = await createUser({ role: 'SUPER_ADMIN', dob: '1980-01-01' });
});
after(harness.stop);
afterEach(() => {
  for (const item of opened) item.close();
  opened.clear();
  eligibleDelay = 0; eligibleError = null; entered = null;
});
const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
const roomSize = userId => realtime.io.of('/').adapter.rooms.get('user:' + userId)?.size ?? 0;

// WebSocket thô: chờ gói mở của Engine.IO rồi trả về để test tự gửi gói.
function raw() {
  const ws = new WebSocket(socketUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket');
  opened.add(ws);
  const got = [];
  let closed = false;
  ws.on('close', () => { closed = true; });
  return new Promise((resolve, reject) => {
    ws.on('message', data => {
      const text = data.toString();
      if (text === '2') return ws.send('3');
      got.push(text);
      if (text.startsWith('0')) resolve({ ws, got, isClosed: () => closed });
    });
    ws.on('error', reject);
  });
}

function connect(token) {
  const socket = connectClient(socketUrl, { transports: ['websocket'], reconnection: false, forceNew: true, auth: { token } });
  opened.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', error => { socket.close(); reject(error); });
  });
}

test('gửi dồn 20 gói CONNECT trên một kết nối bằng token chưa đủ điều kiện: chỉ kiểm quyền một lần rồi đóng kết nối', async () => {
  const user = await member({ consent: false });
  const conn = await raw();
  eligibleCalls = 0;
  for (let i = 0; i < 20; i++) conn.ws.send('40' + JSON.stringify({ token: user.token }));
  await settle(500);
  assert.equal(eligibleCalls, 1, 'chỉ một lượt đọc quyền cho cả 20 gói');
  assert.ok(conn.got.filter(text => text.startsWith('40')).length === 0, 'không gói nào được nhận: ' + conn.got.join(' | '));
  assert.ok(conn.isClosed(), 'kết nối phải bị đóng');
});

test('một gói CONNECT bị từ chối thì client nhận lý do rồi kết nối mới bị đóng', async () => {
  const user = await member({ consent: false });
  const conn = await raw();
  conn.ws.send('40' + JSON.stringify({ token: user.token }));
  await settle(500);
  assert.ok(conn.got.some(text => text.startsWith('44') && text.includes('CHAT_UNAVAILABLE')), conn.got.join(' | '));
  assert.ok(conn.isClosed());
});

test('gửi dồn 10 gói CONNECT bằng token hợp lệ: chỉ có một socket trong phòng', async () => {
  const user = await member();
  const conn = await raw();
  for (let i = 0; i < 10; i++) conn.ws.send('40' + JSON.stringify({ token: user.token }));
  await settle(500);
  assert.ok(roomSize(user.id) <= 1, 'phòng có ' + roomSize(user.id) + ' socket');
});

test('một người tối đa 5 socket: socket thứ sáu bị từ chối, 5 socket đầu vẫn nối', async () => {
  const user = await member();
  const first = [];
  for (let i = 0; i < 5; i++) first.push(await connect(user.token));
  await assert.rejects(connect(user.token), error => error.data?.code === 'TOO_MANY_CONNECTIONS');
  await settle();
  assert.ok(first.every(socket => socket.connected));
  assert.equal(roomSize(user.id), 5);
});

test('gói tin lớn hơn 8 KB bị đóng kết nối ngay, kể cả trước khi xác thực', async () => {
  const conn = await raw();
  conn.ws.send('40' + JSON.stringify({ token: 'x'.repeat(20 * 1024) }));
  await settle();
  assert.ok(conn.isClosed());
});

test('tắt công tắc đúng lúc server đang kiểm quyền thì socket vẫn bị ngắt', async () => {
  const user = await member();
  eligibleDelay = 300;
  const checking = new Promise(resolve => { entered = resolve; });
  const pending = connect(user.token).catch(error => error);
  await checking;
  await setRealtime(false, admin.id);
  try {
    const result = await pending;
    await settle(500);
    assert.ok(!(result.connected), 'socket không được còn nối sau khi công tắc đã tắt');
    assert.equal(roomSize(user.id), 0);
  } finally {
    await setRealtime(true, admin.id);
  }
});

test('rút đồng ý đúng lúc server đang kiểm quyền thì socket vẫn bị ngắt', async () => {
  const user = await member();
  eligibleDelay = 300;
  const checking = new Promise(resolve => { entered = resolve; });
  const pending = connect(user.token).catch(error => error);
  await checking;
  assert.equal((await request('/chat/me/consent', { method: 'DELETE', as: user })).status, 204);
  const result = await pending;
  await settle(500);
  assert.ok(!(result.connected), 'socket không được còn nối sau khi đã rút đồng ý');
  assert.equal(roomSize(user.id), 0);
});

test('DB lỗi lúc kiểm quyền thì báo máy chủ tạm lỗi, không báo nhầm là token sai', async () => {
  const user = await member();
  eligibleError = new Error('mất kết nối MongoDB giả');
  await assert.rejects(connect(user.token), error => { assert.equal(error.data?.code, 'REALTIME_UNAVAILABLE'); return true; });
});
