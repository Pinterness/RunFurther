// Dữ liệu chat (spec 4.1, plan Task 12.1): mỗi cặp người chỉ có một cuộc trò chuyện, seq không trùng trong một cuộc,
// một clientMessageId của một người gửi ứng với đúng một tin, và tin cũ tự xóa sau 12 tháng nhờ index TTL.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'isolated-chat-models-test-secret';

const { app } = require('../../src/backend/server');
const ChatMember = require('../../src/backend/models/ChatMember');
const Conversation = require('../../src/backend/models/Conversation');
const Message = require('../../src/backend/models/Message');
const Block = require('../../src/backend/models/Block');
const { pairKeyOf } = require('../../src/backend/models/Conversation');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_models' });
const YEAR_SECONDS = 31536000;
const id = () => new mongoose.Types.ObjectId();

// Một cuộc trò chuyện hợp lệ giữa a và b, a là người mời.
function conv(a, b, extra = {}) {
  const now = new Date();
  return {
    participants: [a, b], pairKey: pairKeyOf(a, b), status: 'REQUEST', requesterId: a,
    lastSeq: 1, lastMessage: { seq: 1, senderId: a, text: 'xin chào' }, lastMessageAt: now, unreadBy: [b], ...extra,
  };
}
const msg = (conversationId, senderId, extra = {}) => ({
  conversationId, senderId, seq: 1, clientMessageId: crypto.randomUUID(), text: 'xin chào', ...extra,
});
const hasIndex = (indexes, key, extra = {}) => indexes.some(index =>
  JSON.stringify(index.key) === JSON.stringify(key) && Object.entries(extra).every(([k, v]) => index[k] === v));

before(harness.start);
after(harness.stop);

test('pairKey không phụ thuộc thứ tự hai người, và participants được lưu theo thứ tự tăng dần', async () => {
  const [a, b] = [id(), id()].sort((x, y) => String(x).localeCompare(String(y)));
  assert.equal(pairKeyOf(b, a), pairKeyOf(a, b));
  assert.equal(pairKeyOf(String(a), String(b)), `${a}:${b}`);
  const saved = await Conversation.create(conv(b, a));
  assert.deepEqual(saved.participants.map(String), [String(a), String(b)]);
});

test('mỗi cặp người chỉ có một cuộc trò chuyện, dù ai mời ai', async () => {
  const a = id(), b = id();
  await Conversation.create(conv(a, b));
  await assert.rejects(Conversation.create(conv(b, a)), { code: 11000 });
});

test('cuộc trò chuyện phải có đúng hai người khác nhau và pairKey khớp hai người đó', async () => {
  const a = id(), b = id();
  await assert.rejects(Conversation.create(conv(a, a, { participants: [a, a], pairKey: pairKeyOf(a, a) })), { name: 'ValidationError' });
  await assert.rejects(Conversation.create(conv(a, b, { participants: [a, b, id()] })), { name: 'ValidationError' });
  await assert.rejects(Conversation.create(conv(a, b, { pairKey: pairKeyOf(a, id()) })), { name: 'ValidationError' });
  await assert.rejects(Conversation.create(conv(a, b, { status: 'PENDING' })), { name: 'ValidationError' });
});

test('seq không trùng trong một cuộc; clientMessageId không trùng theo người gửi', async () => {
  const a = id(), b = id(), c1 = id(), c2 = id();
  await Message.create(msg(c1, a, { seq: 1 }));
  await assert.rejects(Message.create(msg(c1, b, { seq: 1 })), { code: 11000 });
  await Message.create(msg(c2, a, { seq: 1 })); // seq 1 ở cuộc khác thì được

  const clientMessageId = crypto.randomUUID();
  await Message.create(msg(c1, a, { seq: 2, clientMessageId }));
  await assert.rejects(Message.create(msg(c2, a, { seq: 2, clientMessageId })), { code: 11000 });
  await Message.create(msg(c1, b, { seq: 3, clientMessageId })); // người gửi khác dùng cùng mã thì được
});

test('tin 1.000 ký tự được, 1.001 ký tự hay toàn khoảng trắng bị từ chối; text được cắt khoảng trắng hai đầu', async () => {
  const c = id(), a = id();
  const ok = await Message.create(msg(c, a, { seq: 1, text: 'a'.repeat(1000) }));
  assert.equal(ok.text.length, 1000);
  await assert.rejects(Message.create(msg(c, a, { seq: 2, text: 'a'.repeat(1001) })), { name: 'ValidationError' });
  await assert.rejects(Message.create(msg(c, a, { seq: 3, text: '   \n\t ' })), { name: 'ValidationError' });
  const trimmed = await Message.create(msg(c, a, { seq: 4, text: '  chạy sáng nhé  ' }));
  assert.equal(trimmed.text, 'chạy sáng nhé');
});

test('Block: một người chỉ chặn một người kia một lần', async () => {
  const a = id(), b = id();
  await Block.create({ blockerId: a, blockedId: b });
  await assert.rejects(Block.create({ blockerId: a, blockedId: b }), { code: 11000 });
  await Block.create({ blockerId: b, blockedId: a }); // chiều ngược lại là một lần chặn khác
});

test('ChatMember: mỗi người một tài liệu, mặc định chưa đồng ý và chưa bị khóa', async () => {
  const userId = id();
  const member = await ChatMember.create({ userId });
  assert.equal(member.consentAt, null);
  assert.equal(member.consentVersion, null);
  assert.equal(member.lockedAt, null);
  await assert.rejects(ChatMember.create({ userId }), { code: 11000 });
});

test('index và TTL 12 tháng có thật trong database', async () => {
  const [messages, conversations, blocks, members] = await Promise.all(
    [Message, Conversation, Block, ChatMember].map(model => model.collection.indexes()));
  assert.ok(hasIndex(messages, { createdAt: 1 }, { expireAfterSeconds: YEAR_SECONDS }), 'TTL của Message');
  assert.ok(hasIndex(messages, { conversationId: 1, seq: 1 }, { unique: true }));
  assert.ok(hasIndex(messages, { senderId: 1, clientMessageId: 1 }, { unique: true }));
  assert.ok(hasIndex(messages, { senderId: 1, createdAt: -1 }));
  assert.ok(hasIndex(conversations, { lastMessageAt: 1 }, { expireAfterSeconds: YEAR_SECONDS }), 'TTL của Conversation');
  assert.ok(hasIndex(conversations, { pairKey: 1 }, { unique: true }));
  assert.ok(hasIndex(conversations, { participants: 1, lastMessageAt: -1 }));
  assert.ok(hasIndex(conversations, { unreadBy: 1 }));
  assert.ok(hasIndex(conversations, { requesterId: 1, createdAt: -1 }));
  assert.ok(hasIndex(blocks, { blockerId: 1, blockedId: 1 }, { unique: true }));
  assert.ok(hasIndex(members, { userId: 1 }, { unique: true }));
});
