// Báo cáo vi phạm và khóa nhắn tin (spec D10, T12, T13, mục 4.3 phần P15; plan Task 15.1).
// Người tham gia báo cáo đúng một tin của người kia; server chụp lại nội dung tin đó. Super Admin chỉ thấy bản chụp và
// tên hai bên (không email, không id người dùng), rồi "Bỏ qua" hay "Khóa nhắn tin". Khóa chỉ đặt trên ChatMember,
// không đụng User.status, nên người bị khóa vẫn đặt vé và dùng ví.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-reports-test-secret';

const { app } = require('../../src/backend/server');
const Message = require('../../src/backend/models/Message');
const ChatMember = require('../../src/backend/models/ChatMember');
const User = require('../../src/backend/models/User');
const chatNotifier = require('../../src/backend/services/chatNotifier');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_reports' });
const { request, createUser } = harness;
const { member } = createChatFixtures(harness);
const uuid = () => crypto.randomUUID();
const send = (user, id, text) => request(`/chat/conversations/${id}/messages`, { method: 'POST', as: user, body: { text, clientMessageId: uuid() } });
const report = (user, id, body) => request(`/chat/conversations/${id}/reports`, { method: 'POST', as: user, body });
let admin;

// a mời, b chấp nhận rồi gửi tin quấy rối (seq 2).
async function harassed() {
  const a = await member(), b = await member();
  const invited = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  const id = invited.body.conversation.id;
  await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b });
  assert.equal((await send(b, id, 'tin quấy rối')).status, 201);
  return { a, b, id };
}

before(async () => {
  await harness.start();
  admin = await createUser({ role: 'SUPER_ADMIN', dob: '1980-01-01' });
});
after(harness.stop);
afterEach(() => chatNotifier.reset());

test('báo cáo trùng, kể cả song song, chỉ có một dòng; lần sau trả lại báo cáo cũ', async () => {
  const { a, id } = await harassed();
  const results = await Promise.all(Array.from({ length: 5 }, () => report(a, id, { seq: 2, reason: 'HARASSMENT' })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(new Set(results.map(r => r.body.report.id)).size, 1);
  const queue = await request('/chat/admin/reports', { as: admin });
  assert.equal(queue.body.reports.filter(r => r.message.text === 'tin quấy rối').length, 1);
});

test('người thứ ba báo cáo nhận 404 như mọi chỗ khác; báo cáo tin của chính mình hay dữ liệu sai nhận 400 CHAT_REPORT_INVALID', async () => {
  const { a, b, id } = await harassed();
  const stranger = await member();
  const outsider = await report(stranger, id, { seq: 2, reason: 'SPAM' });
  assert.equal(outsider.status, 404);
  assert.equal(outsider.body.code, 'CHAT_NOT_FOUND');
  for (const [who, body] of [[b, { seq: 2, reason: 'SPAM' }], [a, { seq: 1, reason: 'SPAM' }], [a, { seq: 99, reason: 'SPAM' }],
    [a, { seq: 2, reason: 'NOPE' }], [a, { seq: '2', reason: 'SPAM' }], [a, { seq: 2, reason: 'OTHER', note: 'x'.repeat(501) }], [a, { seq: 2, reason: 'OTHER', note: { $gt: '' } }]]) {
    const response = await report(who, id, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, 'CHAT_REPORT_INVALID', JSON.stringify(body));
  }
});

test('bản chụp giữ nguyên nội dung dù tin gốc đã bị xóa (TTL 12 tháng)', async () => {
  const { a, id } = await harassed();
  assert.equal((await report(a, id, { seq: 2, reason: 'SCAM', note: 'đòi chuyển khoản ngoài' })).status, 201);
  await Message.deleteMany({ conversationId: id });
  const item = (await request('/chat/admin/reports', { as: admin })).body.reports.find(r => r.note === 'đòi chuyển khoản ngoài');
  assert.equal(item.message.text, 'tin quấy rối');
  assert.equal(item.message.seq, 2);
  assert.equal(item.reason, 'SCAM');
});

test('RUNNER xem hay xử lý hàng chờ nhận 403; admin chỉ thấy khóa được phép, không email, không id người dùng', async () => {
  const { a, b, id } = await harassed();
  await report(a, id, { seq: 2, reason: 'HARASSMENT' });
  assert.equal((await request('/chat/admin/reports', { as: a })).status, 403);
  const queue = await request('/chat/admin/reports', { as: admin });
  assert.equal(queue.status, 200);
  const item = queue.body.reports.find(r => r.conversationId === undefined && r.reporter.displayName === a.fullName);
  assert.ok(item, JSON.stringify(queue.body.reports.slice(0, 2)));
  assert.equal((await request(`/chat/admin/reports/${item.id}/resolve`, { method: 'POST', as: a, body: { action: 'LOCK' } })).status, 403);
  const allowed = new Set(['reports', 'id', 'reason', 'note', 'status', 'createdAt', 'handledAt', 'message', 'seq', 'text', 'sentAt', 'reporter', 'reported', 'displayName', 'avatarTheme', 'locked']);
  const keys = new Set();
  (function walk(value) { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (!Array.isArray(value)) keys.add(key); walk(child); } })(queue.body);
  for (const key of keys) assert.ok(allowed.has(key), 'khóa không được phép: ' + key);
  const text = JSON.stringify(queue.body);
  for (const secret of [a.id, b.id, a.email, b.email].filter(Boolean)) assert.ok(!text.includes(secret), 'lộ ' + secret);
});

test('khóa: người bị khóa không gửi, không mời được (403 CHAT_LOCKED) nhưng vẫn xem ví; người kia nhận 403 CHAT_UNAVAILABLE; socket bị ngắt', async () => {
  const { a, b, id } = await harassed();
  const disconnected = [];
  chatNotifier.register({ notify() {}, disconnectUser: userId => disconnected.push(String(userId)) });
  const filed = await report(a, id, { seq: 2, reason: 'HARASSMENT' });
  const resolved = await request(`/chat/admin/reports/${filed.body.report.id}/resolve`, { method: 'POST', as: admin, body: { action: 'LOCK' } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.report.status, 'LOCKED');
  assert.deepEqual(disconnected, [b.id]);
  const lockedSend = await send(b, id, 'tin nữa');
  assert.equal(lockedSend.status, 403);
  assert.equal(lockedSend.body.code, 'CHAT_LOCKED');
  const third = await member();
  const invite = await request('/chat/invites', { method: 'POST', as: b, body: { handle: third.handle, text: 'chào', clientMessageId: uuid() } });
  assert.equal(invite.body.code, 'CHAT_LOCKED');
  const other = await send(a, id, 'tin của a');
  assert.equal(other.status, 403);
  assert.equal(other.body.code, 'CHAT_UNAVAILABLE');
  // Vẫn đọc lịch sử và vẫn dùng ví: khóa không đụng User.status.
  assert.equal((await request(`/chat/conversations/${id}/messages`, { as: b })).status, 200);
  assert.equal((await request('/wallet', { as: b })).status, 200);
  assert.equal((await User.findById(b.id).lean()).status, 'ACTIVE');
  // Xử lý lần hai (đổi ý) thì 409.
  const again = await request(`/chat/admin/reports/${filed.body.report.id}/resolve`, { method: 'POST', as: admin, body: { action: 'DISMISS' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'CHAT_REPORT_HANDLED');
});

test('rút đồng ý chat không bỏ được khóa; Super Admin bỏ khóa thì gửi lại được; "Bỏ qua" không khóa ai', async () => {
  const { a, b, id } = await harassed();
  const filed = await report(a, id, { seq: 2, reason: 'SPAM' });
  await request(`/chat/admin/reports/${filed.body.report.id}/resolve`, { method: 'POST', as: admin, body: { action: 'LOCK' } });
  await request('/chat/me/consent', { method: 'DELETE', as: b });
  await request('/chat/me/consent', { method: 'PUT', as: b, body: { consentVersion: 'chat-v1' } });
  assert.ok((await ChatMember.findOne({ userId: b.id }).lean()).lockedAt, 'rút rồi đồng ý lại vẫn còn khóa');
  assert.equal((await send(b, id, 'thử')).body.code, 'CHAT_LOCKED');
  const listed = (await request('/chat/admin/reports?status=LOCKED', { as: admin })).body.reports.find(r => r.id === filed.body.report.id);
  assert.equal(listed.reported.locked, true);
  assert.equal((await request(`/chat/admin/members/${filed.body.report.id}/unlock`, { method: 'POST', as: admin })).status, 204);
  assert.equal((await send(b, id, 'đã được bỏ khóa')).status, 201);
  assert.equal((await request(`/chat/admin/members/${filed.body.report.id}/unlock`, { method: 'POST', as: admin })).status, 409, 'bỏ khóa hai lần');

  const second = await harassed();
  const dismissed = await report(second.a, second.id, { seq: 2, reason: 'OTHER' });
  const done = await request(`/chat/admin/reports/${dismissed.body.report.id}/resolve`, { method: 'POST', as: admin, body: { action: 'DISMISS' } });
  assert.equal(done.body.report.status, 'DISMISSED');
  assert.equal((await send(second.b, second.id, 'vẫn gửi được')).status, 201);
});

test('người bị khóa hay đã rút đồng ý vẫn báo cáo được (T13)', async () => {
  const { a, id } = await harassed();
  await ChatMember.updateOne({ userId: a.id }, { $set: { consentAt: null, lockedAt: new Date() } });
  assert.equal((await report(a, id, { seq: 2, reason: 'HARASSMENT' })).status, 201);
});
