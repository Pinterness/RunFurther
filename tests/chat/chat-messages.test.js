// Gửi tin, lấy tin và lấy bù theo seq (spec 4.3, 4.4, D5, T10, T13; plan Task 12.4). Tin chỉ được coi là đã gửi khi
// transaction đã commit; seq trong một cuộc liền mạch, không trùng; tín hiệu chatNotifier chỉ phát sau commit.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-messages-test-secret';

const { app } = require('../../src/backend/server');
const mongoose = require('mongoose');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const ChatMember = require('../../src/backend/models/ChatMember');
const Conversation = require('../../src/backend/models/Conversation');
const Message = require('../../src/backend/models/Message');
const CommunityProfile = require('../../src/backend/models/CommunityProfile');
const chatNotifier = require('../../src/backend/services/chatNotifier');
const { sendMessage } = require('../../src/backend/services/chatService');
const { vnDayStart } = require('../../src/backend/services/chatLimits');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');
const { yearsAgo } = require('../helpers/dates');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_messages', monitorCommands: true });
const { request } = harness;
const { member } = createChatFixtures(harness);

const range = n => Array.from({ length: n }, (_, i) => i);
const uuid = () => crypto.randomUUID();
const send = (user, id, text, clientMessageId = uuid()) =>
  request(`/chat/conversations/${id}/messages`, { method: 'POST', as: user, body: { text, clientMessageId } });
const read = (user, id, query = '') => request(`/chat/conversations/${id}/messages${query}`, { as: user });
const list = (user, query = '') => request(`/chat/conversations${query}`, { as: user });

// Hai người đã có cuộc ACTIVE (lời mời seq 1 của a, b đã chấp nhận).
async function activePair(options = {}) {
  const a = await member(options.a), b = await member(options.b);
  const invited = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  assert.equal(invited.status, 201);
  const id = invited.body.conversation.id;
  assert.equal((await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b })).status, 200);
  return { a, b, id };
}
function keysDeep(v, out = new Set()) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysDeep(x, out); } return out; }

before(harness.start);
after(harness.stop);
afterEach(() => chatNotifier.reset());

test('gửi tin: 201 với seq mới, lastSeq và lastMessage của cuộc đổi theo, người nhận vào unreadBy', async () => {
  const { a, b, id } = await activePair();
  await Conversation.updateOne({ _id: id }, { $set: { unreadBy: [] } });
  const clientMessageId = uuid();
  const r = await send(b, id, '  Hẹn 5 giờ sáng nhé  ', clientMessageId);
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body.message).sort(), ['clientMessageId', 'createdAt', 'mine', 'seq', 'text']);
  assert.equal(r.body.message.seq, 2);
  assert.equal(r.body.message.mine, true);
  assert.equal(r.body.message.text, 'Hẹn 5 giờ sáng nhé');
  assert.equal(r.body.message.clientMessageId, clientMessageId);
  const saved = await Conversation.findById(id).lean();
  assert.equal(saved.lastSeq, 2);
  assert.deepEqual({ ...saved.lastMessage, senderId: String(saved.lastMessage.senderId) }, { seq: 2, senderId: b.id, text: 'Hẹn 5 giờ sáng nhé' });
  assert.deepEqual(saved.unreadBy.map(String), [a.id]);
});

test('nội dung tin bắt đầu bằng $ được lưu nguyên văn, không bị hiểu là tên trường', async () => {
  const { a, id } = await activePair();
  for (const text of ['$lastSeq', '$$ROOT', '{ "$gt": 1 }']) {
    const r = await send(a, id, text);
    assert.equal(r.status, 201, text);
    assert.equal(r.body.message.text, text);
    assert.equal((await Conversation.findById(id).lean()).lastMessage.text, text);
  }
});

test('lastMessage chỉ giữ 120 ký tự đầu, còn tin đủ 1.000 ký tự', async () => {
  const { a, id } = await activePair();
  const r = await send(a, id, 'x'.repeat(1000));
  assert.equal(r.status, 201);
  assert.equal((await Conversation.findById(id).lean()).lastMessage.text.length, 120);
  assert.equal((await Message.findOne({ conversationId: id, seq: 2 }).lean()).text.length, 1000);
  for (const text of ['', '   ', 'x'.repeat(1001)]) assert.equal((await send(a, id, text)).body.code, 'CHAT_MESSAGE_INVALID');
});

test('20 tin song song: seq đúng 2..21, không 500, notify gọi 20 lần sau commit', async () => {
  const { a, b, id } = await activePair();
  const seen = [];
  chatNotifier.register({ notify: (ids, payload) => seen.push({ ids, payload }), disconnectUser() {} });
  const results = await Promise.all(range(20).map(i => send(i % 2 ? a : b, id, 'tin ' + i)));
  assert.deepEqual(results.map(r => r.status), range(20).map(() => 201));
  const seqs = (await Message.find({ conversationId: id }).sort('seq').lean()).map(m => m.seq);
  assert.deepEqual(seqs, range(21).map(i => i + 1));
  assert.equal((await Conversation.findById(id).lean()).lastSeq, 21);
  assert.deepEqual(seen.map(s => s.payload.seq).sort((x, y) => x - y), range(20).map(i => i + 2));
  for (const { ids, payload } of seen) {
    assert.deepEqual(Object.keys(payload).sort(), ['conversationId', 'seq']);
    assert.equal(payload.conversationId, id);
    assert.deepEqual([...ids].sort(), [a.id, b.id].sort());
  }
});

test('notify chỉ chạy sau commit: lệnh commitTransaction đã thành công trước khi notify được gọi', async () => {
  const { a, id } = await activePair();
  // Theo dõi lệnh driver gửi tới MongoDB (harness bật monitorCommands), rồi xếp chung một dòng thời gian với notify.
  const timeline = [];
  const client = mongoose.connection.getClient();
  const onCommit = event => { if (event.commandName === 'commitTransaction') timeline.push('commit'); };
  client.on('commandSucceeded', onCommit);
  chatNotifier.register({ notify: () => timeline.push('notify'), disconnectUser() {} });
  try {
    assert.equal((await send(a, id, 'xin chào')).status, 201);
  } finally {
    client.off('commandSucceeded', onCommit);
  }
  assert.deepEqual(timeline, ['commit', 'notify']);
});

test('transaction lỗi thì không có tin, lastSeq không đổi và không gọi notify', async () => {
  const { a, id } = await activePair();
  let calls = 0;
  chatNotifier.register({ notify: () => { calls += 1; }, disconnectUser() {} });
  const original = Message.create;
  Message.create = async () => { throw new Error('lỗi giả lập khi ghi tin'); };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await send(a, id, 'không tới nơi')).status, 500);
  } finally {
    Message.create = original;
    console.error = quiet;
  }
  const saved = await Conversation.findById(id).lean();
  assert.equal(saved.lastSeq, 1, 'lệnh tăng lastSeq bị hủy cùng transaction');
  assert.equal(saved.lastMessage.text, 'chào');
  assert.equal(await Message.countDocuments({ conversationId: id }), 1);
  assert.equal(calls, 0);
});

test('notify lỗi không làm hỏng việc gửi tin', async () => {
  const { a, id } = await activePair();
  chatNotifier.register({ notify: () => { throw new Error('socket hỏng'); }, disconnectUser() {} });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await send(a, id, 'vẫn tới')).status, 201);
    chatNotifier.register({ notify: () => Promise.reject(new Error('socket hỏng bất đồng bộ')), disconnectUser() {} });
    assert.equal((await send(a, id, 'vẫn tới lần nữa')).status, 201);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    console.error = quiet;
  }
});

test('lời mời phát tín hiệu cho người nhận sau commit', async () => {
  const a = await member(), b = await member();
  const seen = [];
  chatNotifier.register({ notify: (ids, payload) => seen.push({ ids, payload }), disconnectUser() {} });
  const r = await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } });
  assert.equal(r.status, 201);
  assert.deepEqual(seen, [{ ids: [b.id], payload: { conversationId: r.body.conversation.id, seq: 1 } }]);
});

test('gửi khi còn REQUEST bị 409 CHAT_NOT_ACTIVE, cả người mời lẫn người nhận; cuộc DECLINED cũng vậy', async () => {
  const a = await member(), b = await member();
  const id = (await request('/chat/invites', { method: 'POST', as: a, body: { handle: b.handle, text: 'chào', clientMessageId: uuid() } })).body.conversation.id;
  for (const user of [a, b]) {
    const r = await send(user, id, 'thêm một tin');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'CHAT_NOT_ACTIVE');
  }
  await request(`/chat/conversations/${id}/decline`, { method: 'POST', as: b });
  assert.equal((await send(a, id, 'vẫn không được')).status, 409);
  assert.equal(await Message.countDocuments({ conversationId: id }), 1);
});

test('gửi lại cùng clientMessageId trả cùng tin (tuần tự và song song); dùng lại ở cuộc khác bị 409', async () => {
  const { a, b, id } = await activePair();
  let calls = 0;
  chatNotifier.register({ notify: () => { calls += 1; }, disconnectUser() {} });
  const clientMessageId = uuid();
  const first = await send(a, id, 'một lần thôi', clientMessageId);
  const again = await send(a, id, 'một lần thôi', clientMessageId);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal((await Conversation.findById(id).lean()).lastSeq, 2);
  assert.equal(calls, 1, 'gửi lại không phát tín hiệu lần hai');

  const parallelId = uuid();
  const both = await Promise.all([send(b, id, 'song song', parallelId), send(b, id, 'song song', parallelId)]);
  assert.deepEqual(both.map(r => r.status).sort(), [200, 201]);
  assert.equal(both[0].body.message.seq, both[1].body.message.seq);
  assert.equal(await Message.countDocuments({ senderId: b.id, clientMessageId: parallelId }), 1);
  assert.equal((await Conversation.findById(id).lean()).lastSeq, 3);

  const other = await activePair();
  const otherConv = await request('/chat/invites', { method: 'POST', as: a, body: { handle: other.b.handle, text: 'chào', clientMessageId: uuid() } });
  await request(`/chat/conversations/${otherConv.body.conversation.id}/accept`, { method: 'POST', as: other.b });
  const reused = await send(a, otherConv.body.conversation.id, 'mã cũ', clientMessageId);
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, 'CHAT_CLIENT_ID_REUSED');
});

test('tin 21 trong một phút bị 429 kèm Retry-After; người khác cùng IP vẫn gửi được', async () => {
  const { a, b, id } = await activePair();
  // Tin mời (seq 1) của a đã tính vào cửa sổ 60 giây, nên a gửi thêm 19 tin là đủ 20.
  for (let i = 0; i < 19; i += 1) assert.equal((await send(a, id, 'tin ' + i)).status, 201, String(i));
  const response = await fetch(`${harness.baseUrl()}/chat/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ text: 'tin thứ 21', clientMessageId: uuid() }),
  });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'CHAT_RATE_LIMITED');
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60, String(retryAfter));
  assert.equal((await send(b, id, 'mình vẫn gửi được')).status, 201);
});

test('tin 501 trong ngày (giờ Việt Nam) bị 429 CHAT_DAILY_LIMIT; tin đầu của lời mời cũng được tính', async () => {
  const { a, id } = await activePair();
  const dayStart = vnDayStart(new Date());
  const earlier = new Date(dayStart.getTime() + 60 * 60 * 1000); // 1 giờ sáng hôm nay
  const now = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000); // trưa hôm nay
  // Tin mời của a mang giờ thật nên cũng thuộc hôm nay: 1 + 498 = 499 tin.
  const filler = new mongoose.Types.ObjectId();
  await Message.insertMany(range(498).map(i => ({ conversationId: filler, seq: i + 1, senderId: a.id, clientMessageId: uuid(), text: 'cũ', createdAt: earlier })));
  assert.equal((await sendMessage(a.id, id, { text: 'tin 500', clientMessageId: uuid() }, { now })).status, 201);
  await assert.rejects(sendMessage(a.id, id, { text: 'tin 501', clientMessageId: uuid() }, { now }), { statusCode: 429, code: 'CHAT_DAILY_LIMIT' });
  // Sang 0 giờ hôm sau thì gửi lại được.
  const tomorrow = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  assert.equal((await sendMessage(a.id, id, { text: 'ngày mới', clientMessageId: uuid() }, { now: tomorrow })).status, 201);
});

test('cổng hai phía: B rút đồng ý hay xuống 15 tuổi thì A nhận 403 CHAT_UNAVAILABLE; B xóa hồ sơ thì A vẫn gửi được', async () => {
  const expected = { message: 'Không gửi được tin.', code: 'CHAT_UNAVAILABLE' };
  const breakers = [
    b => ChatMember.updateOne({ userId: b.id }, { $set: { consentAt: null, consentVersion: null } }),
    b => RunnerProfile.updateOne({ userId: b.id }, { $set: { dob: new Date(yearsAgo(15)) } }),
    b => ChatMember.updateOne({ userId: b.id }, { $set: { lockedAt: new Date() } }),
  ];
  for (const breakB of breakers) {
    const { a, b, id } = await activePair();
    await breakB(b);
    const r = await send(a, id, 'còn đó không?');
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, expected);
    // Cả hai vẫn đọc được lịch sử.
    assert.equal((await read(a, id)).status, 200);
    assert.equal((await read(b, id)).status, 200);
  }
  const { a, b, id } = await activePair();
  await CommunityProfile.deleteOne({ userId: b.id });
  assert.equal((await send(a, id, 'vẫn nhắn được')).status, 201);
  const listed = await list(a);
  assert.equal(listed.body.conversations.find(c => c.id === id).other.handle, null, 'không còn hồ sơ thì handle là null');
});

test('người gửi tự không đạt cổng thì nhận đúng lý do của mình', async () => {
  const { a, id } = await activePair();
  await ChatMember.updateOne({ userId: a.id }, { $set: { consentAt: null } });
  const r = await send(a, id, 'xin chào');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'CHAT_CONSENT_REQUIRED');
});

test('afterSeq trả tin sau mốc, tăng dần, mine đúng; clientMessageId chỉ có ở tin của mình', async () => {
  const { a, b, id } = await activePair();
  await send(b, id, 'tin 2 của b');
  await send(a, id, 'tin 3 của a');
  const r = await read(b, id, '?afterSeq=1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.messages.map(m => [m.seq, m.mine, m.text]), [[2, true, 'tin 2 của b'], [3, false, 'tin 3 của a']]);
  assert.ok('clientMessageId' in r.body.messages[0]);
  assert.ok(!('clientMessageId' in r.body.messages[1]), 'không lộ clientMessageId của người kia');
  for (const message of r.body.messages) assert.deepEqual(Object.keys(message).filter(k => k !== 'clientMessageId').sort(), ['createdAt', 'mine', 'seq', 'text']);
  assert.deepEqual((await read(b, id, '?afterSeq=3')).body.messages, []);
});

test('tin mới chen vào giữa hai lần lấy trang: không trùng, không sót (cả lấy bù afterSeq lẫn cuộn lên beforeSeq)', async () => {
  const { a, b, id } = await activePair();
  for (let i = 2; i <= 10; i += 1) await send(i % 2 ? a : b, id, 'tin ' + i);

  // Lấy bù theo afterSeq, mỗi lần 3 tin, có tin mới tới giữa chừng.
  const seen = [];
  let cursor = 0;
  let page = await read(a, id, `?afterSeq=${cursor}&limit=3`);
  seen.push(...page.body.messages.map(m => m.seq));
  cursor = seen.at(-1);
  await send(b, id, 'tin 11 chen vào');
  await send(b, id, 'tin 12 chen vào');
  // Có trần số vòng: con trỏ hỏng (ví dụ trả lại chính tin ở mốc) thì test đỏ thay vì chạy mãi.
  for (let guard = 0; guard < 10; guard += 1) {
    page = await read(a, id, `?afterSeq=${cursor}&limit=3`);
    if (!page.body.messages.length) break;
    seen.push(...page.body.messages.map(m => m.seq));
    cursor = seen.at(-1);
  }
  assert.deepEqual(seen, range(12).map(i => i + 1));

  // Cuộn lên theo beforeSeq: trang mới nhất trước, tin mới tới không làm lệch các trang cũ.
  const latest = await read(a, id, '?limit=3');
  assert.deepEqual(latest.body.messages.map(m => m.seq), [10, 11, 12]);
  assert.equal(latest.body.hasMore, true);
  await send(a, id, 'tin 13 tới khi đang cuộn');
  const older = [];
  let oldest = latest.body.messages[0].seq;
  for (let guard = 0; guard < 10; guard += 1) {
    page = await read(a, id, `?beforeSeq=${oldest}&limit=3`);
    older.unshift(...page.body.messages.map(m => m.seq));
    if (!page.body.hasMore) break;
    oldest = page.body.messages[0].seq;
  }
  const newer = (await read(a, id, '?afterSeq=12')).body.messages.map(m => m.seq);
  assert.deepEqual([...older, ...latest.body.messages.map(m => m.seq), ...newer], range(13).map(i => i + 1));
});

test('tham số lấy tin sai thì 400; limit tối đa 50', async () => {
  const { a, id } = await activePair();
  for (const query of ['?afterSeq=-1', '?afterSeq=abc', '?beforeSeq=0', '?limit=0', '?limit=51', '?afterSeq=1&beforeSeq=5', '?afterSeq=1.5', '?afterSeq[$gt]=0']) {
    const r = await read(a, id, query);
    assert.equal(r.status, 400, query);
    assert.equal(r.body.code, 'INVALID_QUERY', query);
  }
  assert.equal((await read(a, id, '?limit=50')).status, 200);
});

test('người thứ ba đọc hay gửi nhận 404 giống hệt id không tồn tại và id sai định dạng', async () => {
  const { id } = await activePair();
  const stranger = await member();
  for (const call of [target => read(stranger, target), target => send(stranger, target, 'xâm nhập')]) {
    const shapes = await Promise.all([id, '0123456789abcdef01234567', 'khong-phai-id'].map(call));
    for (const r of shapes) assert.deepEqual(r, shapes[0]);
    assert.equal(shapes[0].status, 404);
    assert.equal(shapes[0].body.code, 'CHAT_NOT_FOUND');
  }
  assert.equal(await Message.countDocuments({ conversationId: id }), 1);
});

test('danh sách cuộc trò chuyện: chia hộp chats/invites, mới nhất trước, không lộ _id người khác', async () => {
  const me = await member({ fullName: 'Tôi' });
  const sentByMe = await member(), toMe = await member(), declinedByMe = await member(), active = await member();
  const inviteFrom = async (from, to) => (await request('/chat/invites', { method: 'POST', as: from, body: { handle: to.handle, text: 'chào', clientMessageId: uuid() } })).body.conversation.id;
  const idSent = await inviteFrom(me, sentByMe);
  const idToMe = await inviteFrom(toMe, me);
  const idDeclined = await inviteFrom(declinedByMe, me);
  await request(`/chat/conversations/${idDeclined}/decline`, { method: 'POST', as: me });
  const idActive = await inviteFrom(active, me);
  await request(`/chat/conversations/${idActive}/accept`, { method: 'POST', as: me });
  await send(active, idActive, 'tin mới nhất');

  const chats = await list(me, '?box=chats');
  assert.equal(chats.status, 200);
  assert.deepEqual(chats.body.conversations.map(c => c.id), [idActive, idSent]);
  const invites = await list(me, '?box=invites');
  assert.deepEqual(invites.body.conversations.map(c => c.id), [idToMe]);
  assert.deepEqual((await list(me)).body.conversations.map(c => c.id), [idActive, idSent], 'mặc định là chats');
  // Người mời bị từ chối vẫn thấy cuộc của mình ở chats (giao diện ghi "Chưa được chấp nhận").
  assert.deepEqual((await list(declinedByMe)).body.conversations.map(c => [c.id, c.status]), [[idDeclined, 'DECLINED']]);

  const allowed = new Set(['conversations', 'hasMore', 'id', 'status', 'isRequester', 'other', 'lastMessage', 'lastMessageAt', 'unread', 'displayName', 'avatarTheme', 'handle', 'seq', 'mine', 'text']);
  for (const body of [chats.body, invites.body]) {
    assert.ok([...keysDeep(body)].every(k => allowed.has(k)), [...keysDeep(body)].join());
    for (const other of [sentByMe, toMe, declinedByMe, active, me]) assert.ok(!JSON.stringify(body).includes(other.id));
  }
  assert.equal(chats.body.conversations[0].unread, true);
  assert.deepEqual(chats.body.conversations[0].lastMessage, { seq: 2, mine: false, text: 'tin mới nhất' });
});

test('danh sách phân trang 20 cuộc theo before; tham số sai thì 400', async () => {
  const me = await member();
  const ids = [];
  for (let i = 0; i < 22; i += 1) {
    const other = await member();
    const r = await request('/chat/invites', { method: 'POST', as: other, body: { handle: me.handle, text: 'chào ' + i, clientMessageId: uuid() } });
    ids.unshift(r.body.conversation.id);
    // Mỗi cuộc một mốc thời gian riêng, để thứ tự "mới nhất trước" xác định.
    await Conversation.updateOne({ _id: r.body.conversation.id }, { $set: { lastMessageAt: new Date(Date.UTC(2026, 10, 1, 0, i)) } });
  }
  const first = await list(me, '?box=invites');
  assert.equal(first.body.conversations.length, 20);
  assert.equal(first.body.hasMore, true);
  const before = first.body.conversations.at(-1).lastMessageAt;
  const second = await list(me, `?box=invites&before=${encodeURIComponent(before)}`);
  assert.equal(second.body.hasMore, false);
  assert.deepEqual([...first.body.conversations, ...second.body.conversations].map(c => c.id), ids);
  for (const query of ['?box=spam', '?before=hom-qua', '?box[$ne]=x']) {
    const r = await list(me, query);
    assert.equal(r.status, 400, query);
    assert.equal(r.body.code, 'INVALID_QUERY');
  }
});

test('truy vấn danh sách, lấy tin và đếm giới hạn dùng index (IXSCAN, không quét cả collection)', async () => {
  const { a, id } = await activePair();
  const me = new mongoose.Types.ObjectId(a.id);
  const plans = {
    'danh sách chats': await Conversation.find({ participants: me, $or: [{ status: 'ACTIVE' }, { requesterId: me }] }).sort({ lastMessageAt: -1 }).limit(21).explain('queryPlanner'),
    'danh sách invites': await Conversation.find({ participants: me, status: 'REQUEST', requesterId: { $ne: me } }).sort({ lastMessageAt: -1 }).limit(21).explain('queryPlanner'),
    'lấy tin afterSeq': await Message.find({ conversationId: id, seq: { $gt: 0 } }).sort({ seq: 1 }).limit(51).explain('queryPlanner'),
    'đếm tin theo phút': await Message.find({ senderId: me, createdAt: { $gte: new Date(Date.now() - 60000) } }).explain('queryPlanner'),
    'đếm lời mời theo ngày': await Conversation.find({ requesterId: me, createdAt: { $gte: vnDayStart(new Date()) } }).explain('queryPlanner'),
  };
  for (const [name, plan] of Object.entries(plans)) {
    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    assert.match(winning, /IXSCAN/, name);
    assert.doesNotMatch(winning, /COLLSCAN/, name);
    assert.doesNotMatch(winning, /"stage":"SORT"/, `${name}: sắp xếp bằng index, không sắp trong bộ nhớ`);
  }
});
