// Cổng chat và đồng ý nhắn tin (spec D3, T1, T9, T13; plan Task 12.2): chỉ người ACTIVE, đủ 16 tuổi theo ngày sinh
// hiện tại, đã đồng ý nhắn tin và không bị khóa mới gửi được; người nhận lời mời còn phải có hồ sơ công khai và không có
// Block ở chiều nào. Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-chat-gate-test-secret';

const { app } = require('../../src/backend/server');
const User = require('../../src/backend/models/User');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const ChatMember = require('../../src/backend/models/ChatMember');
const Block = require('../../src/backend/models/Block');
const CommunityProfile = require('../../src/backend/models/CommunityProfile');
const { senderEligible, pairOpen, inviteTarget } = require('../../src/backend/services/chatGate');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createChatFixtures } = require('../helpers/chatFixtures');
const { yearsAgo } = require('../helpers/dates');

const harness = createBackendHarness({ app, dbName: 'runfurther_chat_gate' });
const { request } = harness;
const { member } = createChatFixtures(harness);
const setDob = (user, dob) => RunnerProfile.updateOne({ userId: user.id }, { $set: { dob: new Date(dob) } });

before(harness.start);
after(harness.stop);

test('GET /chat/me của người mới: chưa đồng ý, chưa khóa, có văn bản đồng ý chat-v1, realtime tắt', async () => {
  const adult = await member({ consent: false, profile: false });
  const { status, body } = await request('/chat/me', { as: adult });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['consent', 'consentText', 'eligible', 'locked', 'realtime']);
  assert.equal(body.consent, false);
  assert.equal(body.locked, false);
  assert.equal(body.eligible, true);
  assert.equal(body.realtime, false);
  assert.equal(body.consentText.version, 'chat-v1');
  assert.match(body.consentText.text, /12 tháng/);

  const child = await member({ dob: yearsAgo(15), consent: false, profile: false });
  assert.equal((await request('/chat/me', { as: child })).body.eligible, false);
});

test('khách chưa đăng nhập nhận 401', async () => {
  assert.equal((await request('/chat/me')).status, 401);
  assert.equal((await request('/chat/me/consent', { method: 'PUT', body: { consentVersion: 'chat-v1' } })).status, 401);
});

test('đồng ý chat cần đủ 16 tuổi và đúng phiên bản hiện hành', async () => {
  const child = await member({ dob: yearsAgo(15), consent: false, profile: false });
  const noDob = await member({ dob: null, consent: false, profile: false });
  for (const user of [child, noDob]) {
    const r = await request('/chat/me/consent', { method: 'PUT', as: user, body: { consentVersion: 'chat-v1' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'CHAT_AGE_REQUIRED');
  }

  const adult = await member({ consent: false, profile: false });
  for (const body of [{ consentVersion: 'chat-v0' }, { consentVersion: 'profile-v1' }, {}, undefined]) {
    const r = await request('/chat/me/consent', { method: 'PUT', as: adult, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'CHAT_CONSENT_REQUIRED');
  }
  assert.equal(await ChatMember.countDocuments({ userId: adult.id }), 0);

  const ok = await request('/chat/me/consent', { method: 'PUT', as: adult, body: { consentVersion: 'chat-v1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.consent, true);
  const saved = await ChatMember.findOne({ userId: adult.id }).lean();
  assert.equal(saved.consentVersion, 'chat-v1');
  assert.ok(saved.consentAt instanceof Date);
  // Đồng ý lần hai (hai tab) không tạo tài liệu thứ hai.
  await request('/chat/me/consent', { method: 'PUT', as: adult, body: { consentVersion: 'chat-v1' } });
  assert.equal(await ChatMember.countDocuments({ userId: adult.id }), 1);
});

test('rút đồng ý giữ nguyên khóa nhắn tin', async () => {
  const user = await member({ profile: false });
  await ChatMember.updateOne({ userId: user.id }, { $set: { lockedAt: new Date() } });
  const r = await request('/chat/me/consent', { method: 'DELETE', as: user });
  assert.equal(r.status, 204);
  const saved = await ChatMember.findOne({ userId: user.id }).lean();
  assert.ok(saved, 'tài liệu vẫn còn');
  assert.equal(saved.consentAt, null);
  assert.equal(saved.consentVersion, null);
  assert.ok(saved.lockedAt instanceof Date);
  const me = await request('/chat/me', { as: user });
  assert.equal(me.body.consent, false);
  assert.equal(me.body.locked, true);

  // Người chưa từng đồng ý rút đồng ý: vẫn 204, không tạo tài liệu.
  const fresh = await member({ consent: false, profile: false });
  assert.equal((await request('/chat/me/consent', { method: 'DELETE', as: fresh })).status, 204);
  assert.equal(await ChatMember.countDocuments({ userId: fresh.id }), 0);
});

test('senderEligible theo ngày sinh hiện tại, đồng ý, khóa và trạng thái tài khoản', async () => {
  const user = await member({ profile: false });
  assert.deepEqual(await senderEligible(user.id), { ok: true });

  await setDob(user, yearsAgo(15));
  assert.deepEqual(await senderEligible(user.id), { ok: false, reason: 'AGE' });
  await RunnerProfile.updateOne({ userId: user.id }, { $unset: { dob: 1 } });
  assert.deepEqual(await senderEligible(user.id), { ok: false, reason: 'AGE' });

  assert.deepEqual(await senderEligible((await member({ consent: false, profile: false })).id), { ok: false, reason: 'CONSENT' });
  assert.deepEqual(await senderEligible((await member({ locked: true, profile: false })).id), { ok: false, reason: 'LOCKED' });
  // Rút đồng ý không phải cách thoát khóa: người bị khóa luôn nhận lý do LOCKED.
  assert.deepEqual(await senderEligible((await member({ consent: false, locked: true, profile: false })).id), { ok: false, reason: 'LOCKED' });

  const banned = await member({ profile: false });
  await User.updateOne({ _id: banned.id }, { $set: { status: 'BANNED' } });
  assert.deepEqual(await senderEligible(banned.id), { ok: false, reason: 'INACTIVE' });
});

test('senderEligible tính tuổi theo now được truyền vào: đúng ngày sinh nhật 16 theo giờ Việt Nam thì đủ tuổi', async () => {
  const user = await member({ dob: '2010-11-16', profile: false });
  assert.deepEqual(await senderEligible(user.id, { now: new Date('2026-11-15T16:59:59Z') }), { ok: false, reason: 'AGE' });
  assert.deepEqual(await senderEligible(user.id, { now: new Date('2026-11-15T17:00:00Z') }), { ok: true });
});

test('pairOpen sai khi một bên rút đồng ý, bị khóa, dưới 16, không ACTIVE hay có Block ở bất kỳ chiều nào', async () => {
  const pair = async () => [await member({ profile: false }), await member({ profile: false })];
  let [a, b] = await pair();
  assert.equal(await pairOpen(a.id, b.id), true);
  assert.equal(await pairOpen(b.id, a.id), true);

  const breakers = [
    user => ChatMember.updateOne({ userId: user.id }, { $set: { consentAt: null, consentVersion: null } }),
    user => ChatMember.updateOne({ userId: user.id }, { $set: { lockedAt: new Date() } }),
    user => setDob(user, yearsAgo(15)),
    user => User.updateOne({ _id: user.id }, { $set: { status: 'BANNED' } }),
  ];
  for (const breakB of breakers) {
    [a, b] = await pair();
    await breakB(b);
    assert.equal(await pairOpen(a.id, b.id), false, breakB.toString());
    assert.equal(await pairOpen(b.id, a.id), false, breakB.toString());
  }

  for (const direction of ['a chặn b', 'b chặn a']) {
    [a, b] = await pair();
    const [blocker, blocked] = direction === 'a chặn b' ? [a, b] : [b, a];
    await Block.create({ blockerId: blocker.id, blockedId: blocked.id });
    assert.equal(await pairOpen(a.id, b.id), false, direction);
    assert.equal(await pairOpen(b.id, a.id), false, direction);
  }

  // Xóa hồ sơ công khai không làm đóng cuộc đang có (T13): pairOpen không xét CommunityProfile.
  [a, b] = await [await member(), await member()];
  await CommunityProfile.deleteOne({ userId: b.id });
  assert.equal(await pairOpen(a.id, b.id), true);
});

test('inviteTarget trả id người nhận khi nhận được lời mời, null trong mọi trường hợp còn lại', async () => {
  const sender = await member();
  const target = await member();
  assert.equal(await inviteTarget(sender.id, { handle: target.handle }), target.id);
  assert.equal(await inviteTarget(sender.id, { handle: target.handle.toUpperCase() }), target.id);

  const cases = {
    'không có hồ sơ công khai': async () => { const u = await member(); await CommunityProfile.deleteOne({ userId: u.id }); return u.handle; },
    'chưa đồng ý chat': async () => (await member({ consent: false })).handle,
    'bị khóa nhắn tin': async () => (await member({ locked: true })).handle,
    'dưới 16 tuổi': async () => { const u = await member(); await setDob(u, yearsAgo(15)); return u.handle; },
    'tài khoản bị khóa': async () => { const u = await member(); await User.updateOne({ _id: u.id }, { $set: { status: 'BANNED' } }); return u.handle; },
    'người nhận đã chặn người gửi': async () => { const u = await member(); await Block.create({ blockerId: u.id, blockedId: sender.id }); return u.handle; },
    'người gửi đã chặn người nhận': async () => { const u = await member(); await Block.create({ blockerId: sender.id, blockedId: u.id }); return u.handle; },
    'tự mời chính mình': async () => sender.handle,
    'handle không tồn tại': async () => 'khong-co-ai-ten-nay',
    'handle sai mẫu': async () => '../admin',
    'handle không phải chuỗi': async () => ({ $ne: null }),
  };
  for (const [name, makeHandle] of Object.entries(cases)) {
    assert.equal(await inviteTarget(sender.id, { handle: await makeHandle() }), null, name);
  }
  assert.equal(await inviteTarget(sender.id, {}), null, 'thiếu handle');
});
