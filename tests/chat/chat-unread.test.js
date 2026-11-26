// Đánh dấu đã đọc và số cuộc trò chuyện có tin chưa đọc (spec 4.5, D6; plan Task 13.1).
// Đọc: chỉ bỏ người đọc khỏi unreadBy khi lastSeq của cuộc đúng bằng upToSeq client gửi, để tin tới giữa chừng không bị
// đánh dấu đã đọc nhầm. Huy hiệu: một lệnh đếm trên index { unreadBy: 1 }, gồm cả lời mời đang chờ, trừ cuộc DECLINED.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-unread-test-secret';

const { app } = require('../../src/backend/server');
const mongoose = require('mongoose');
const ChatMember = require('../../src/backend/models/ChatMember');
const Conversation = require('../../src/backend/models/Conversation');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_unread', monitorCommands: true });
const { request } = harness;
const { member } = createChatFixtures(harness);

const uuid = () => crypto.randomUUID();
const send = (user, id, text) => request(`/chat/conversations/${id}/messages`, { method: 'POST', as: user, body: { text, clientMessageId: uuid() } });
const markRead = (user, id, upToSeq) => request(`/chat/conversations/${id}/read`, { method: 'POST', as: user, body: { upToSeq } });
const unread = async user => (await request('/chat/unread', { as: user })).body.count;

async function invite(a, b) {
  const invited = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  assert.equal(invited.status, 201);
  return invited.body.conversation.id;
}
async function activePair() {
  const a = await member(), b = await member();
  const id = await invite(a, b);
  assert.equal((await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b })).status, 200);
  return { a, b, id };
}

before(harness.start);
after(harness.stop);

test('đọc đúng tới lastSeq thì hết chưa đọc; upToSeq cũ hơn lastSeq (tin mới tới giữa chừng) thì vẫn chưa đọc', async () => {
  const { a, b, id } = await activePair();
  await send(a, id, 'tin 2');
  assert.equal(await unread(b), 1);
  // b đang xem tới seq 2 thì a gửi thêm tin 3: lệnh đọc tới 2 không được xóa dấu chưa đọc của tin 3.
  await send(a, id, 'tin 3');
  assert.equal((await markRead(b, id, 2)).status, 204);
  assert.equal(await unread(b), 1);
  assert.equal((await request('/chat/conversations', { as: b })).body.conversations.find(c => c.id === id).unread, true);
  assert.equal((await markRead(b, id, 3)).status, 204);
  assert.equal(await unread(b), 0);
  assert.equal((await request('/chat/conversations', { as: b })).body.conversations.find(c => c.id === id).unread, false);
  // upToSeq lớn hơn lastSeq: không có tin đó, không đổi gì, vẫn 204 để client không phải xử lý riêng.
  await send(a, id, 'tin 4');
  assert.equal((await markRead(b, id, 99)).status, 204);
  assert.equal(await unread(b), 1);
});

test('huy hiệu đếm cả lời mời đang chờ, không đếm cuộc DECLINED, không đếm cuộc của người khác', async () => {
  const me = await member();
  const inviters = [await member(), await member(), await member()];
  const [first, second, third] = await Promise.all(inviters.map(inviter => invite(inviter, me)));
  assert.equal(await unread(me), 3);
  assert.equal((await request(`/chat/conversations/${second}/decline`, { method: 'POST', as: me })).status, 200);
  assert.equal(await unread(me), 2);
  // Kể cả khi dữ liệu cũ còn sót người nhận trong unreadBy của cuộc DECLINED, huy hiệu cũng không đếm.
  await Conversation.updateOne({ _id: second }, { $addToSet: { unreadBy: new mongoose.Types.ObjectId(me.id) } });
  assert.equal(await unread(me), 2);
  // Người mời không có tin chưa đọc trong cuộc của chính họ.
  assert.equal(await unread(inviters[0]), 0);
  assert.equal((await markRead(me, first, 1)).status, 204);
  assert.equal((await markRead(me, third, 1)).status, 204);
  assert.equal(await unread(me), 0);
});

test('upToSeq không phải số nguyên dương thì 400 CHAT_READ_INVALID', async () => {
  const { b, id } = await activePair();
  // Tin mời (seq 1) vẫn chưa đọc sau khi chấp nhận: các lệnh sai bên dưới không được làm đổi số này.
  const before = await unread(b);
  assert.equal(before, 1);
  for (const bad of [0, -1, 1.5, '1', null, true, [1], { $gt: 0 }, 2 ** 53]) {
    const response = await markRead(b, id, bad);
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.equal(response.body.code, 'CHAT_READ_INVALID', JSON.stringify(bad));
  }
  const missing = await request(`/chat/conversations/${id}/read`, { method: 'POST', as: b, body: {} });
  assert.equal(missing.status, 400);
  assert.equal(await unread(b), before, 'không lệnh nào bị lọt qua làm đổi dữ liệu');
});

test('người ngoài cuộc, id không tồn tại và id sai định dạng nhận cùng một 404', async () => {
  const { id } = await activePair();
  const stranger = await member();
  const bodies = [];
  for (const target of [id, '0123456789abcdef01234567', 'khong-phai-id']) {
    const response = await markRead(stranger, target, 1);
    assert.equal(response.status, 404, target);
    bodies.push(JSON.stringify(response.body));
  }
  assert.equal(new Set(bodies).size, 1, bodies.join(' | '));
});

test('đánh dấu đã đọc không cần qua cổng chat: người đã rút đồng ý vẫn đọc được tin cũ (T13)', async () => {
  const { a, b, id } = await activePair();
  await send(a, id, 'tin 2');
  await ChatMember.updateOne({ userId: b.id }, { $set: { consentAt: null, consentVersion: null } });
  assert.equal((await markRead(b, id, 2)).status, 204);
  assert.equal(await unread(b), 0);
});

// Đếm lệnh MongoDB một thao tác gửi đi.
async function commandsOf(action) {
  const names = [];
  const client = mongoose.connection.getClient();
  const onStart = event => names.push(event.commandName === 'find' || event.commandName === 'aggregate' ? `${event.commandName}:${event.command[event.commandName]}` : event.commandName);
  client.on('commandStarted', onStart);
  try { await action(); } finally { client.off('commandStarted', onStart); }
  return names;
}

test('huy hiệu là một lệnh đếm đi trên index unreadBy; đọc trúng lastSeq là một lệnh cập nhật', async () => {
  const { a, b, id } = await activePair();
  await send(a, id, 'tin 2');
  // Xác thực token đọc users một lần, còn lại đúng một lệnh của thao tác.
  const counted = await commandsOf(() => unread(b));
  assert.deepEqual(counted.filter(name => name !== 'find:users'), ['aggregate:conversations'], counted.join(' '));
  const read = await commandsOf(() => markRead(b, id, 2));
  assert.deepEqual(read.filter(name => name !== 'find:users'), ['update'], read.join(' '));
  const me = new mongoose.Types.ObjectId(b.id);
  const plan = JSON.stringify((await Conversation.find({ unreadBy: me, status: { $ne: 'DECLINED' } }).explain('queryPlanner')).queryPlanner.winningPlan);
  assert.match(plan, /"indexName":"unreadBy_1"/);
  assert.doesNotMatch(plan, /COLLSCAN/);
});
