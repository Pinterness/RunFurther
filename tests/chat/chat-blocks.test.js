// Chặn (spec 4.3, T9, T13, canSeeProfile ở D1–D2; plan Task 12.5): chặn có tác dụng hai chiều, người bị chặn không
// biết mình bị chặn (lỗi không có chữ "chặn"), cả hai vẫn đọc được lịch sử, và hồ sơ của hai bên ẩn với nhau.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = 'isolated-chat-blocks-test-secret';

const { app } = require('../../src/backend/server');
const Conversation = require('../../src/backend/models/Conversation');
const Block = require('../../src/backend/models/Block');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_blocks' });
const { request } = harness;
const { member } = createChatFixtures(harness);

const uuid = () => crypto.randomUUID();
const invite = (from, to) => request('/chat/invites', { method: 'POST', as: from, body: { handle: to.handle, text: 'chào', clientMessageId: uuid() } });
const send = (user, id, text = 'xin chào') => request(`/chat/conversations/${id}/messages`, { method: 'POST', as: user, body: { text, clientMessageId: uuid() } });
const block = (user, id) => request(`/chat/conversations/${id}/block`, { method: 'POST', as: user });
const blocks = user => request('/chat/blocks', { as: user });
const unblock = (user, id) => request(`/chat/blocks/${id}`, { method: 'DELETE', as: user });
const profile = (viewer, handle) => request(`/community/profiles/${handle}`, { as: viewer });

async function activePair() {
  const a = await member({ fullName: 'Người A' }), b = await member({ fullName: 'Người B' });
  const id = (await invite(a, b)).body.conversation.id;
  assert.equal((await request(`/chat/conversations/${id}/accept`, { method: 'POST', as: b })).status, 200);
  return { a, b, id };
}

before(harness.start);
after(harness.stop);

test('chặn hai chiều: cả hai không gửi được, lỗi giống hệt lỗi cổng chung và không có chữ chặn', async () => {
  const { a, b, id } = await activePair();
  assert.equal((await block(a, id)).status, 204);
  for (const user of [b, a]) {
    const r = await send(user, id);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { message: 'Không gửi được tin.', code: 'CHAT_UNAVAILABLE' });
    assert.doesNotMatch(JSON.stringify(r.body), /chặn|block/i);
  }
});

test('chặn hai chiều: cả hai không mời được nhau, cùng 404 như handle không tồn tại', async () => {
  const a = await member(), b = await member();
  const id = (await invite(a, b)).body.conversation.id;
  // Người nhận chặn ngay từ hộp Lời mời, lúc cuộc còn REQUEST.
  assert.equal((await block(b, id)).status, 204);
  const missing = await request('/chat/invites', { method: 'POST', as: a, body: { handle: 'khong-ai-ca', text: 'chào', clientMessageId: uuid() } });
  for (const [from, to] of [[a, b], [b, a]]) {
    const r = await invite(from, to);
    assert.deepEqual(r, missing);
  }
  assert.equal(missing.body.code, 'CHAT_TARGET_NOT_FOUND');
});

test('bên chặn vẫn đọc được lịch sử và không còn trong unreadBy; bên bị chặn cũng vẫn đọc được', async () => {
  const { a, b, id } = await activePair();
  await send(a, id, 'tin trước khi bị chặn');
  assert.ok((await Conversation.findById(id).lean()).unreadBy.map(String).includes(b.id));
  assert.equal((await block(b, id)).status, 204);
  assert.ok(!(await Conversation.findById(id).lean()).unreadBy.map(String).includes(b.id));
  for (const user of [a, b]) {
    const r = await request(`/chat/conversations/${id}/messages`, { as: user });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.messages.map(m => m.text), ['chào', 'tin trước khi bị chặn']);
  }
});

test('chặn hai lần chỉ có một bản ghi; chặn lại từ phía kia là một bản ghi riêng', async () => {
  const { a, b, id } = await activePair();
  assert.equal((await block(a, id)).status, 204);
  assert.equal((await block(a, id)).status, 204);
  await Promise.all([block(a, id), block(a, id)]);
  assert.equal(await Block.countDocuments({ blockerId: a.id, blockedId: b.id }), 1);
  assert.equal((await block(b, id)).status, 204);
  assert.equal(await Block.countDocuments({ blockerId: b.id, blockedId: a.id }), 1);
});

test('hồ sơ của người đã chặn mình (và người mình chặn) trả 404 giống handle không tồn tại, và không có trong danh sách', async () => {
  const { a, b, id } = await activePair();
  const viewer = await member();
  assert.equal((await profile(a, b.handle)).status, 200);
  await block(b, id);
  const missing = await profile(a, 'khong-ai-ca');
  assert.deepEqual(await profile(a, b.handle), missing, 'người bị chặn không xem được hồ sơ người chặn');
  assert.deepEqual(await profile(b, a.handle), missing, 'người chặn cũng không thấy hồ sơ người bị chặn');
  assert.equal((await profile(viewer, b.handle)).status, 200, 'người khác vẫn xem được');

  const listedFor = async user => (await request('/community/profiles', { as: user })).body.profiles.map(p => p.handle);
  assert.ok(!(await listedFor(a)).includes(b.handle));
  assert.ok(!(await listedFor(b)).includes(a.handle));
  assert.ok((await listedFor(viewer)).includes(b.handle));
});

test('danh sách chặn chỉ có id của bản ghi chặn, tên và màu avatar; không lộ id người dùng', async () => {
  const { a, b, id } = await activePair();
  await block(a, id);
  const r = await blocks(a);
  assert.equal(r.status, 200);
  assert.equal(r.body.blocks.length, 1);
  const [item] = r.body.blocks;
  assert.deepEqual(Object.keys(item).sort(), ['avatarTheme', 'displayName', 'id']);
  assert.equal(item.displayName, 'Người B');
  assert.equal(item.id, String((await Block.findOne({ blockerId: a.id }).lean())._id));
  assert.ok(!JSON.stringify(r.body).includes(b.id));
  assert.deepEqual((await blocks(b)).body.blocks, [], 'người bị chặn không thấy mình bị chặn');
});

test('bỏ chặn thì gửi lại được; bỏ chặn của người khác, id lạ hay sai định dạng nhận cùng 404', async () => {
  const { a, b, id } = await activePair();
  const stranger = await member();
  await block(a, id);
  const blockId = (await blocks(a)).body.blocks[0].id;
  const shapes = await Promise.all([
    unblock(stranger, blockId), unblock(b, blockId), unblock(a, '0123456789abcdef01234567'), unblock(a, 'khong-phai-id'),
  ]);
  for (const r of shapes) assert.deepEqual(r, shapes[0]);
  assert.equal(shapes[0].status, 404);
  assert.equal(await Block.countDocuments({ _id: blockId }), 1, 'chưa ai bỏ được chặn của a');

  assert.equal((await unblock(a, blockId)).status, 204);
  assert.equal((await send(b, id, 'mình nói chuyện lại nhé')).status, 201);
  assert.deepEqual((await blocks(a)).body.blocks, []);
});

test('người thứ ba chặn qua cuộc của người khác nhận 404 giống id không tồn tại, không tạo bản ghi chặn', async () => {
  const { id } = await activePair();
  const stranger = await member();
  const shapes = await Promise.all([id, '0123456789abcdef01234567', 'khong-phai-id'].map(target => block(stranger, target)));
  for (const r of shapes) assert.deepEqual(r, shapes[0]);
  assert.equal(shapes[0].status, 404);
  assert.equal(shapes[0].body.code, 'CHAT_NOT_FOUND');
  assert.equal(await Block.countDocuments({ blockerId: stranger.id }), 0);
});

test('tìm Block theo người chặn và theo người bị chặn đều dùng index', async () => {
  const { a } = await activePair();
  for (const filter of [{ blockerId: a.id }, { blockedId: a.id }, { $or: [{ blockerId: a.id }, { blockedId: a.id }] }]) {
    const plan = JSON.stringify((await Block.find(filter).explain('queryPlanner')).queryPlanner.winningPlan);
    assert.match(plan, /IXSCAN/, JSON.stringify(filter));
    assert.doesNotMatch(plan, /COLLSCAN/, JSON.stringify(filter));
  }
});

test('người bị khóa hay đã rút đồng ý vẫn chặn được (T13)', async () => {
  const { a, id } = await activePair();
  await require('../../src/backend/models/ChatMember').updateOne({ userId: a.id }, { $set: { consentAt: null, lockedAt: new Date() } });
  assert.equal((await block(a, id)).status, 204);
});
