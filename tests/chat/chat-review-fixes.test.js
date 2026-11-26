// Các sửa sau phản biện 26-11 (P13): giới hạn tốc độ đọc theo tài khoản, người mời không thấy DECLINED, đọc một cuộc
// theo id cho liên kết /messages?c=, cuộc thiếu unreadBy không làm hỏng gửi/đọc.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-review-fixes-secret';

const express = require('express');
const mongoose = require('mongoose');
const { app } = require('../../src/backend/server');
const Conversation = require('../../src/backend/models/Conversation');
const createChatRateLimit = require('../../src/backend/middlewares/chatRateLimit');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_review_fixes' });
const { request } = harness;
const { member } = createChatFixtures(harness);
const uuid = () => crypto.randomUUID();

async function invite(a, b) {
  const invited = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  assert.equal(invited.status, 201);
  return invited.body.conversation.id;
}

before(harness.start);
after(harness.stop);

test('người mời không bao giờ thấy DECLINED: bị từ chối hay bị chặn từ hộp Lời mời đều vẫn là REQUEST', async () => {
  for (const how of ['decline', 'block']) {
    const a = await member(), b = await member();
    const id = await invite(a, b);
    assert.ok([200, 204].includes((await request(`/chat/conversations/${id}/${how}`, { method: 'POST', as: b })).status), how);
    assert.equal((await Conversation.findById(id).lean()).status, 'DECLINED', 'dữ liệu thật vẫn là DECLINED');
    const listed = (await request('/chat/conversations', { as: a })).body.conversations.find(c => c.id === id);
    assert.equal(listed.status, 'REQUEST', how);
    assert.equal((await request(`/chat/conversations/${id}`, { as: a })).body.conversation.status, 'REQUEST', how);
    // Người nhận vẫn thấy đúng trạng thái của chính họ (lời mời họ đã từ chối).
    if (how === 'decline') assert.equal((await request(`/chat/conversations/${id}`, { as: b })).body.conversation.status, 'DECLINED');
  }
});

test('GET /chat/conversations/:id trả cuộc của mình; người ngoài, id không có và id sai định dạng cùng một 404', async () => {
  const a = await member(), b = await member(), stranger = await member();
  const id = await invite(a, b);
  const mine = await request(`/chat/conversations/${id}`, { as: b });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.conversation.id, id);
  assert.equal(mine.body.conversation.other.displayName, a.fullName);
  assert.equal(mine.body.conversation.unread, true);
  const bodies = [];
  for (const target of [id, '0123456789abcdef01234567', 'khong-phai-id']) {
    const response = await request(`/chat/conversations/${target}`, { as: stranger });
    assert.equal(response.status, 404, target);
    bodies.push(JSON.stringify(response.body));
  }
  assert.equal(new Set(bodies).size, 1);
});

test('cuộc thiếu trường unreadBy (dữ liệu cũ) vẫn gửi, đọc và liệt kê được, không lỗi 500', async () => {
  const a = await member(), b = await member();
  const id = await invite(a, b);
  assert.equal((await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b })).status, 200);
  // Gỡ trường bằng lệnh của driver, bỏ qua mặc định [] của schema, để giả lập dữ liệu cũ.
  await Conversation.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $unset: { unreadBy: '' } });
  assert.equal((await request('/chat/conversations', { as: a })).status, 200);
  const sent = await request(`/chat/conversations/${id}/messages`, { method: 'POST', as: a, body: { text: 'tin 2', clientMessageId: uuid() } });
  assert.equal(sent.status, 201);
  assert.deepEqual((await Conversation.findById(id).lean()).unreadBy.map(String), [b.id]);
  assert.equal((await request(`/chat/conversations/${id}/read`, { method: 'POST', as: b, body: { upToSeq: 2 } })).status, 204);
  assert.equal((await request('/chat/conversations', { as: b })).status, 200);
});

test('giới hạn tốc độ đếm theo tài khoản: quá mức thì 429 kèm Retry-After, tài khoản khác cùng IP không bị chặn', async () => {
  // App riêng với mức nhỏ, để không chạm giới hạn thật của các test khác.
  const small = express();
  small.use(createChatRateLimit({ max: 3, windowMs: 60000 }));
  small.get('/x', (_req, res) => res.json({ ok: true }));
  const server = small.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/x`;
  const call = token => fetch(base, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await call('tok-a')).status, 200);
    const limited = await call('tok-a');
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'CHAT_TOO_MANY_REQUESTS');
    const wait = Number(limited.headers.get('retry-after'));
    assert.ok(wait >= 1 && wait <= 60, String(wait));
    assert.equal((await call('tok-b')).status, 200, 'tài khoản khác cùng IP vẫn gọi được');
  } finally { server.close(); }
});

test('route /api/chat có giới hạn tốc độ đứng trước bước xác thực', async () => {
  const stack = require('../../src/backend/routes/chatRoutes').stack.map(layer => layer.name);
  const limiter = stack.indexOf('chatRateLimit'), auth = stack.indexOf('verifyUserToken');
  assert.ok(limiter >= 0, stack.join(','));
  assert.ok(limiter < auth, 'request bị chặn không tốn lệnh đọc user nào');
});
