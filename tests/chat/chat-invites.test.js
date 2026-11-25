// Lời mời nhắn tin, chấp nhận và từ chối (spec D3, T3, T4, T9, T10, T14; plan Task 12.3). Lời mời là một transaction
// tạo cuộc REQUEST cùng tin seq 1; mỗi cặp người chỉ có một cuộc; người đã từ chối vẫn chấp nhận lại được.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-invites-test-secret';

const { app } = require('../../src/backend/server');
const ChatMember = require('../../src/backend/models/ChatMember');
const Conversation = require('../../src/backend/models/Conversation');
const Message = require('../../src/backend/models/Message');
const Block = require('../../src/backend/models/Block');
const CommunityProfile = require('../../src/backend/models/CommunityProfile');
const { pairKeyOf } = require('../../src/backend/models/Conversation');
const { createInvite } = require('../../src/backend/services/chatService');
const { vnDayStart } = require('../../src/backend/services/chatLimits');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');
const { yearsAgo } = require('../helpers/dates');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_invites' });
const { request } = harness;
const { member } = createChatFixtures(harness);

const invite = (from, to, extra = {}) => request('/chat/invites', {
  method: 'POST', as: from, body: { handle: to.handle, text: 'Chào bạn, cuối tuần chạy cùng nhé?', clientMessageId: crypto.randomUUID(), ...extra },
});
const accept = (user, id) => request(`/chat/conversations/${id}/accept`, { method: 'POST', as: user });
const decline = (user, id) => request(`/chat/conversations/${id}/decline`, { method: 'POST', as: user });
const allValues = value => JSON.stringify(value);

before(harness.start);
after(harness.stop);

test('lời mời tạo cuộc REQUEST kèm tin seq 1, đưa người nhận vào unreadBy, không lộ id người kia', async () => {
  const a = await member({ fullName: 'Người Mời' }), b = await member({ fullName: 'Người Nhận' });
  const r = await invite(a, b, { text: '  Chào bạn!  ' });
  assert.equal(r.status, 201);
  const { conversation, message } = r.body;
  assert.deepEqual(Object.keys(conversation).sort(), ['id', 'isRequester', 'lastMessage', 'lastMessageAt', 'other', 'status', 'unread']);
  assert.equal(conversation.status, 'REQUEST');
  assert.equal(conversation.isRequester, true);
  assert.equal(conversation.unread, false);
  assert.deepEqual(conversation.other, { displayName: 'Người Nhận', avatarTheme: 'forest', handle: b.handle });
  assert.deepEqual(conversation.lastMessage, { seq: 1, mine: true, text: 'Chào bạn!' });
  assert.deepEqual(Object.keys(message).sort(), ['clientMessageId', 'createdAt', 'mine', 'seq', 'text']);
  assert.equal(message.seq, 1);
  assert.equal(message.text, 'Chào bạn!');
  assert.ok(!allValues(r.body).includes(b.id), 'không lộ _id người nhận');
  assert.ok(!allValues(r.body).includes(a.id), 'không lộ _id của chính mình');

  const saved = await Conversation.findById(conversation.id).lean();
  assert.equal(saved.lastSeq, 1);
  assert.equal(saved.pairKey, pairKeyOf(a.id, b.id));
  assert.equal(String(saved.requesterId), a.id);
  assert.deepEqual(saved.unreadBy.map(String), [b.id]);
  assert.equal(await Message.countDocuments({ conversationId: conversation.id }), 1);
});

test('hai lời mời ngược chiều song song: đúng một cuộc, một 201, một 409 kèm conversationId', async () => {
  for (let round = 0; round < 5; round += 1) {
    const a = await member(), b = await member();
    const [x, y] = await Promise.all([invite(a, b), invite(b, a)]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409]);
    assert.equal(await Conversation.countDocuments({ pairKey: pairKeyOf(a.id, b.id) }), 1);
    const won = [x, y].find(r => r.status === 201), lost = [x, y].find(r => r.status === 409);
    assert.equal(lost.body.code, 'CHAT_CONVERSATION_EXISTS');
    assert.equal(lost.body.conversationId, won.body.conversation.id);
    assert.equal(await Message.countDocuments({ conversationId: won.body.conversation.id }), 1);
  }
});

test('gửi lại cùng clientMessageId (tuần tự và song song) trả cùng tin, không tạo thêm', async () => {
  const a = await member(), b = await member(), c = await member();
  const clientMessageId = crypto.randomUUID();
  const first = await invite(a, b, { clientMessageId });
  const again = await invite(a, b, { clientMessageId });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);

  const d = await member();
  const parallelId = crypto.randomUUID();
  const both = await Promise.all([invite(a, d, { clientMessageId: parallelId }), invite(a, d, { clientMessageId: parallelId })]);
  assert.deepEqual(both.map(r => r.status).sort(), [200, 201]);
  assert.equal(both[0].body.conversation.id, both[1].body.conversation.id);
  assert.equal(await Message.countDocuments({ senderId: a.id, clientMessageId: parallelId }), 1);

  // Cùng mã cho một người nhận khác là dùng lại mã, không phải gửi lại.
  const reused = await invite(a, c, { clientMessageId });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, 'CHAT_CLIENT_ID_REUSED');
  assert.equal(await Conversation.countDocuments({ pairKey: pairKeyOf(a.id, c.id) }), 0);
});

test('gửi lại lời mời sau khi người nhận đã xóa hồ sơ vẫn trả 200 lời mời cũ; mã viết hoa vẫn là cùng mã', async () => {
  const a = await member(), b = await member();
  const clientMessageId = crypto.randomUUID();
  const first = await invite(a, b, { clientMessageId });
  assert.equal(first.status, 201);
  const upper = await invite(a, b, { clientMessageId: clientMessageId.toUpperCase() });
  assert.equal(upper.status, 200, 'cùng UUID khác hoa thường là gửi lại');
  assert.equal(upper.body.conversation.id, first.body.conversation.id);

  await CommunityProfile.deleteOne({ userId: b.id });
  const again = await invite(a, b, { clientMessageId });
  assert.equal(again.status, 200);
  assert.equal(again.body.conversation.id, first.body.conversation.id);
  assert.equal(await Message.countDocuments({ senderId: a.id }), 1);
});

test('chấp nhận lần hai trên cuộc ACTIVE trả 200 cho cả người mời', async () => {
  const a = await member(), b = await member();
  const id = (await invite(a, b)).body.conversation.id;
  await accept(b, id);
  const r = await accept(a, id);
  assert.equal(r.status, 200);
  assert.equal(r.body.conversation.status, 'ACTIVE');
});

test('cùng một mã gửi song song cho hai người khác nhau: một lời mời, một 409 CHAT_CLIENT_ID_REUSED, không 500', async () => {
  for (let round = 0; round < 5; round += 1) {
    const a = await member(), b = await member(), c = await member();
    const clientMessageId = crypto.randomUUID();
    const results = await Promise.all([invite(a, b, { clientMessageId }), invite(a, c, { clientMessageId })]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(results.find(r => r.status === 409).body.code, 'CHAT_CLIENT_ID_REUSED');
    assert.equal(await Conversation.countDocuments({ requesterId: a.id }), 1, 'cuộc của bên thua đã bị hủy cùng transaction');
  }
});

test('không mời được người không có hồ sơ, chưa đồng ý, bị khóa, dưới 16, đã chặn mình hay không tồn tại: cùng một 404', async () => {
  const sender = await member();
  const noProfile = await member(); await CommunityProfile.deleteOne({ userId: noProfile.id });
  const noConsent = await member({ consent: false });
  const locked = await member({ locked: true });
  const child = await member(); await require('../../src/backend/models/RunnerProfile').updateOne({ userId: child.id }, { $set: { dob: new Date(yearsAgo(15)) } });
  const blocker = await member(); await Block.create({ blockerId: blocker.id, blockedId: sender.id });
  const results = await Promise.all([noProfile, noConsent, locked, child, blocker, { handle: 'khong-ai-ca' }, { handle: '../x' }, sender]
    .map(target => invite(sender, target)));
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(results[0].status, 404);
  assert.equal(results[0].body.code, 'CHAT_TARGET_NOT_FOUND');
  assert.doesNotMatch(allValues(results[0].body), /chặn|block/i);
  assert.equal(await Conversation.countDocuments({ requesterId: sender.id }), 0);
});

test('người gửi tự không đạt cổng thì nhận đúng lý do của mình', async () => {
  const target = await member();
  const r1 = await invite(await member({ consent: false }), target);
  assert.equal(r1.status, 403);
  assert.equal(r1.body.code, 'CHAT_CONSENT_REQUIRED');
  const r2 = await invite(await member({ dob: yearsAgo(15) }), target);
  assert.equal(r2.status, 403);
  assert.equal(r2.body.code, 'CHAT_AGE_REQUIRED');
  const r3 = await invite(await member({ locked: true }), target);
  assert.equal(r3.status, 403);
  assert.equal(r3.body.code, 'CHAT_LOCKED');
});

test('tin đầu 1.000 ký tự được; rỗng, toàn khoảng trắng, 1.001 ký tự hay clientMessageId sai thì 400', async () => {
  const a = await member();
  assert.equal((await invite(a, await member(), { text: 'a'.repeat(1000) })).status, 201);
  const b = await member();
  for (const extra of [{ text: '' }, { text: ' \n ' }, { text: 'a'.repeat(1001) }, { text: 42 }, { clientMessageId: 'abc' }, { clientMessageId: undefined }]) {
    const r = await invite(a, b, extra);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.body.code, 'CHAT_MESSAGE_INVALID');
  }
});

test('lời mời thứ 6 trong ngày bị 429, sang 0 giờ giờ Việt Nam thì mời lại được', async () => {
  const sender = await member();
  const targets = [];
  for (let i = 0; i < 7; i += 1) targets.push(await member());
  const midnight = vnDayStart(new Date()); // 0 giờ hôm nay theo giờ Việt Nam
  const justBefore = new Date(midnight.getTime() - 1000);
  const send = (target, now) => createInvite(sender.id, { handle: target.handle, text: 'chào', clientMessageId: crypto.randomUUID() }, { now });
  for (let i = 0; i < 5; i += 1) assert.equal((await send(targets[i], justBefore)).status, 201);
  await assert.rejects(send(targets[5], justBefore), { statusCode: 429, code: 'CHAT_INVITE_LIMIT' });
  assert.equal((await send(targets[5], midnight)).status, 201);
});

test('vnDayStart: 16:59:59Z vẫn là ngày cũ, 17:00:00Z là ngày mới theo giờ Việt Nam', () => {
  assert.equal(vnDayStart(new Date('2026-11-20T16:59:59Z')).toISOString(), '2026-11-19T17:00:00.000Z');
  assert.equal(vnDayStart(new Date('2026-11-20T17:00:00Z')).toISOString(), '2026-11-20T17:00:00.000Z');
});

test('quá 5 lời mời qua API thì 429 kèm Retry-After', async () => {
  const sender = await member();
  for (let i = 0; i < 5; i += 1) assert.equal((await invite(sender, await member())).status, 201);
  const target = await member();
  const response = await fetch(`${harnessBase()}/chat/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sender.token}` },
    body: JSON.stringify({ handle: target.handle, text: 'chào', clientMessageId: crypto.randomUUID() }),
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'CHAT_INVITE_LIMIT');
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 24 * 3600, String(retryAfter));
});

test('chỉ người nhận chấp nhận được; người mời gọi accept nhận 409; chấp nhận lần hai vẫn 200', async () => {
  const a = await member(), b = await member();
  const id = (await invite(a, b)).body.conversation.id;
  const byRequester = await accept(a, id);
  assert.equal(byRequester.status, 409);
  assert.equal(byRequester.body.code, 'CHAT_NOT_ACTIVE');
  const ok = await accept(b, id);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.conversation.status, 'ACTIVE');
  assert.equal(ok.body.conversation.isRequester, false);
  assert.ok(!allValues(ok.body).includes(a.id));
  assert.equal((await accept(b, id)).status, 200);
  assert.equal((await decline(b, id)).status, 409, 'cuộc ACTIVE không từ chối được');
});

test('người đã từ chối chấp nhận lại được; người mời không mời lại được', async () => {
  const a = await member(), b = await member();
  const id = (await invite(a, b)).body.conversation.id;
  const declined = await decline(b, id);
  assert.equal(declined.status, 200);
  assert.equal(declined.body.conversation.status, 'DECLINED');
  assert.deepEqual((await Conversation.findById(id).lean()).unreadBy, [], 'từ chối thì không còn chưa đọc');
  assert.equal((await decline(b, id)).status, 200, 'từ chối lần hai vẫn 200');
  assert.equal((await decline(a, id)).status, 409, 'người mời không từ chối được');

  const again = await invite(a, b);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'CHAT_CONVERSATION_EXISTS');
  assert.equal(again.body.conversationId, id);
  // Người đã từ chối bấm "Nhắn tin" cũng được trỏ về đúng cuộc đó (T14).
  const back = await invite(b, a);
  assert.equal(back.status, 409);
  assert.equal(back.body.conversationId, id);

  assert.equal((await accept(a, id)).status, 409, 'người mời không tự chấp nhận được');
  const accepted = await accept(b, id);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.conversation.status, 'ACTIVE');
});

test('chấp nhận dùng cổng hai phía: người nhận chưa đồng ý thì lý do của mình, người mời rút đồng ý thì 403 chung', async () => {
  const a = await member(), b = await member();
  const id = (await invite(a, b)).body.conversation.id;
  await ChatMember.updateOne({ userId: b.id }, { $set: { consentAt: null } });
  const self = await accept(b, id);
  assert.equal(self.status, 403);
  assert.equal(self.body.code, 'CHAT_CONSENT_REQUIRED');

  await ChatMember.updateOne({ userId: b.id }, { $set: { consentAt: new Date() } });
  await ChatMember.updateOne({ userId: a.id }, { $set: { consentAt: null } });
  const other = await accept(b, id);
  assert.equal(other.status, 403);
  assert.deepEqual(other.body, { message: 'Không gửi được tin.', code: 'CHAT_UNAVAILABLE' });
  assert.equal((await Conversation.findById(id).lean()).status, 'REQUEST');
  // Từ chối không cần cổng: ai cũng từ chối được lời mời gửi tới mình.
  assert.equal((await decline(b, id)).status, 200);
});

test('người thứ ba gọi accept hay decline nhận 404 giống hệt id không tồn tại và id sai định dạng', async () => {
  const a = await member(), b = await member(), stranger = await member();
  const id = (await invite(a, b)).body.conversation.id;
  const missing = '0123456789abcdef01234567';
  for (const call of [accept, decline]) {
    const shapes = await Promise.all([id, missing, 'khong-phai-id', '%24ne'].map(target => call(stranger, target)));
    for (const r of shapes) assert.deepEqual(r, shapes[0]);
    assert.equal(shapes[0].status, 404);
    assert.equal(shapes[0].body.code, 'CHAT_NOT_FOUND');
  }
  assert.equal((await Conversation.findById(id).lean()).status, 'REQUEST');
});

// Gốc URL của API trong harness (để đọc header Retry-After, harness.request chỉ trả status và body).
function harnessBase() {
  return harness.baseUrl();
}
