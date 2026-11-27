// Lớp realtime Socket.IO của chat (ADR realtime mục 3, spec 4.8, plan Task 14.2). Socket chỉ báo tín hiệu
// `chat:message { conversationId, seq }` vào phòng user:<id> sau khi tin đã lưu; tin vẫn gửi và lấy qua REST.
// Server thật của harness (cổng ngẫu nhiên) gắn attachRealtime; client là socket.io-client chỉ dùng websocket,
// không tự nối lại. Chạy trên MongoDB replica set trong bộ nhớ, không đụng database thật.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { io: connectClient } = require('socket.io-client');

process.env.JWT_SECRET = 'isolated-chat-socket-test-secret';

const { app } = require('../../src/backend/server');
const User = require('../../src/backend/models/User');
const { attachRealtime } = require('../../src/backend/realtime');
const { setRealtime } = require('../../src/backend/services/chatRealtimeSetting');
const chatNotifier = require('../../src/backend/services/chatNotifier');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');
const { yearsAgo } = require('../helpers/dates');

const ALLOWED_ORIGIN = 'https://run-further.vercel.app';
const harness = createBackendHarness({ app, dbName: 'runfurther_chat_socket' });
const { request, createUser } = harness;
const { member } = createChatFixtures(harness);
const uuid = () => crypto.randomUUID();
const send = (user, id, text) => request(`/chat/conversations/${id}/messages`, { method: 'POST', as: user, body: { text, clientMessageId: uuid() } });
const sockets = new Set();
let socketUrl, admin;

before(async () => {
  await harness.start();
  const realtime = attachRealtime(harness.server(), { env: { ...process.env, CLIENT_ORIGIN: ALLOWED_ORIGIN } });
  harness.addCleanup(realtime.close);
  socketUrl = harness.baseUrl().replace(/\/api$/, '');
  admin = await createUser({ role: 'SUPER_ADMIN', dob: '1980-01-01' });
});
after(harness.stop);
afterEach(() => { for (const socket of sockets) socket.close(); sockets.clear(); });

// Nối một socket. Thành công trả socket đã nối; bị từ chối thì promise bị từ chối với lỗi connect_error.
function connect(token, { origin, auth } = {}) {
  const socket = connectClient(socketUrl, {
    transports: ['websocket'], reconnection: false, forceNew: true,
    auth: auth ?? (token === undefined ? {} : { token }),
    ...(origin ? { extraHeaders: { origin } } : {}),
  });
  sockets.add(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('quá 5 giây chưa nối được')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

// Chờ một sự kiện, quá 5 giây thì lỗi.
function once(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`quá ${ms} ms chưa có ${event}`)), ms);
    socket.once(event, value => { clearTimeout(timer); resolve(value); });
  });
}

// Ghi lại mọi tín hiệu chat:message một socket nhận được.
function record(socket) {
  const got = [];
  socket.on('chat:message', payload => got.push(payload));
  return got;
}
const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

// a mời b, b chấp nhận: một cuộc ACTIVE có tin seq 1.
async function pair() {
  const a = await member(), b = await member();
  const invited = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  const id = invited.body.conversation.id;
  assert.equal((await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b })).status, 200);
  return { a, b, id };
}

test('người nhận được đúng hai khóa conversationId và seq; người thứ ba không nhận gì', async () => {
  const { a, b, id } = await pair();
  const other = await pair();
  const sockB = await connect(b.token), sockC = await connect(other.a.token);
  const gotC = record(sockC);
  const signal = once(sockB, 'chat:message');
  assert.equal((await send(a, id, 'xin chào')).status, 201);
  const payload = await signal;
  assert.deepEqual(Object.keys(payload).sort(), ['conversationId', 'seq']);
  assert.deepEqual(payload, { conversationId: id, seq: 2 });

  // C chỉ nhận đúng tín hiệu của cuộc mình.
  assert.equal((await send(other.b, other.id, 'tin của cuộc khác')).status, 201);
  await settle();
  assert.deepEqual(gotC, [{ conversationId: other.id, seq: 2 }]);
});

test('tín hiệu tới khi tin đã lưu: lấy afterSeq ngay là có tin; gửi lỗi thì không có tín hiệu', async () => {
  const { a, b, id } = await pair();
  const sockB = await connect(b.token);
  const got = record(sockB);
  const signal = once(sockB, 'chat:message');
  await send(a, id, 'đã lưu chưa');
  const { seq } = await signal;
  const fetched = await request(`/chat/conversations/${id}/messages?afterSeq=${seq - 1}`, { as: b });
  assert.deepEqual(fetched.body.messages.map(m => [m.seq, m.text]), [[seq, 'đã lưu chưa']]);

  assert.equal((await send(a, id, '   ')).status, 400);
  await settle();
  assert.equal(got.length, 1);
});

test('người gửi mở tab thứ hai cũng nhận tín hiệu', async () => {
  const { a, id } = await pair();
  const tab2 = await connect(a.token);
  const signal = once(tab2, 'chat:message');
  await send(a, id, 'gửi từ tab 1');
  assert.deepEqual(await signal, { conversationId: id, seq: 2 });
});

test('bắt tay bị từ chối: thiếu token, token rác, sai secret, hết hạn, user không ACTIVE, chưa đồng ý chat, dưới 16, bị khóa', async () => {
  const ok = await member();
  const banned = await member();
  await User.updateOne({ _id: banned.id }, { $set: { status: 'BANNED' } });
  const noConsent = await member({ consent: false });
  const child = await member({ dob: yearsAgo(15) });
  const locked = await member({ locked: true });
  const sign = (payload, secret = process.env.JWT_SECRET) => jwt.sign(payload, secret);
  const cases = [
    ['thiếu token', undefined, 'AUTH_REQUIRED'],
    ['token rác', 'không-phải-jwt', 'AUTH_INVALID'],
    ['sai secret', sign({ sub: ok.id }, 'secret-khác'), 'AUTH_INVALID'],
    ['hết hạn', sign({ sub: ok.id, exp: Math.floor(Date.now() / 1000) - 10 }), 'AUTH_INVALID'],
    ['sub không phải id', sign({ sub: 'abc' }), 'AUTH_INVALID'],
    ['user không ACTIVE', banned.token, 'CHAT_UNAVAILABLE'],
    ['chưa đồng ý chat', noConsent.token, 'CHAT_UNAVAILABLE'],
    ['dưới 16 tuổi', child.token, 'CHAT_UNAVAILABLE'],
    ['bị khóa nhắn tin', locked.token, 'CHAT_UNAVAILABLE'],
  ];
  for (const [name, token, code] of cases) {
    await assert.rejects(connect(token), error => { assert.equal(error.data?.code, code, name); return true; }, name);
  }
  await assert.rejects(connect(undefined, { auth: { token: 123 } }), error => error.data?.code === 'AUTH_REQUIRED');
  assert.ok((await connect(ok.token)).connected);
});

test('Origin lạ bị từ chối; Origin trong CLIENT_ORIGIN và không có Origin thì nối được', async () => {
  const user = await member();
  await assert.rejects(connect(user.token, { origin: 'https://evil.example' }));
  assert.ok((await connect(user.token, { origin: ALLOWED_ORIGIN })).connected);
  assert.ok((await connect(user.token)).connected);
});

test('JWT hết hạn khi đang nối thì bị ngắt', async () => {
  const user = await member();
  const token = jwt.sign({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 1 }, process.env.JWT_SECRET);
  const socket = await connect(token);
  assert.equal(await once(socket, 'disconnect', 3000), 'io server disconnect');
});

test('tắt công tắc thì socket đang nối bị ngắt và bắt tay mới bị từ chối; bật lại thì nối được', async () => {
  const user = await member();
  const socket = await connect(user.token);
  const dropped = once(socket, 'disconnect');
  await setRealtime(false, admin.id);
  try {
    assert.equal(await dropped, 'io server disconnect');
    await assert.rejects(connect(user.token));
  } finally {
    await setRealtime(true, admin.id);
  }
  assert.ok((await connect(user.token)).connected);
});

test('chatNotifier.disconnectUser ngắt mọi socket của người đó, không đụng người khác', async () => {
  const user = await member(), other = await member();
  const tab1 = await connect(user.token), tab2 = await connect(user.token), keep = await connect(other.token);
  const gone = [once(tab1, 'disconnect'), once(tab2, 'disconnect')];
  chatNotifier.disconnectUser(user.id);
  assert.deepEqual(await Promise.all(gone), ['io server disconnect', 'io server disconnect']);
  await settle();
  assert.ok(keep.connected);
});

test('rút đồng ý nhắn tin thì socket của người đó bị ngắt', async () => {
  const user = await member();
  const socket = await connect(user.token);
  const dropped = once(socket, 'disconnect');
  assert.equal((await request('/chat/me/consent', { method: 'DELETE', as: user })).status, 204);
  assert.equal(await dropped, 'io server disconnect');
});

test('B ngắt, A gửi 3 tin, B nối lại rồi lấy afterSeq: đủ 3 tin, không trùng', async () => {
  const { a, b, id } = await pair();
  const first = await connect(b.token);
  const before = await request(`/chat/conversations/${id}/messages`, { as: b });
  const lastSeen = Math.max(...before.body.messages.map(m => m.seq));
  first.close();
  for (const text of ['một', 'hai', 'ba']) assert.equal((await send(a, id, text)).status, 201);
  const again = await connect(b.token);
  assert.ok(again.connected);
  const missed = await request(`/chat/conversations/${id}/messages?afterSeq=${lastSeen}`, { as: b });
  assert.deepEqual(missed.body.messages.map(m => m.text), ['một', 'hai', 'ba']);
  assert.equal(new Set(missed.body.messages.map(m => m.seq)).size, 3);
});
