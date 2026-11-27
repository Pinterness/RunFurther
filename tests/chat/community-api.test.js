// API hồ sơ cộng đồng (spec 4.2, 4.3, mục 5 phần P11): chỉ trả khóa trong danh sách trắng, mọi trường hợp không xem
// được trả cùng một 404, chưa đủ 16 tuổi hay chưa đồng ý thì không bật được.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-community-api-test-secret';

const { app } = require('../../src/backend/server');
const User = require('../../src/backend/models/User');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const CommunityProfile = require('../../src/backend/models/CommunityProfile');
const { createProfileWithHandle } = require('../../src/backend/services/communityHandle');
const { visibleProfilesPipeline } = require('../../src/backend/services/communityService');
const { latestBirthday } = require('../../src/backend/lib/age');
const mongoose = require('mongoose');
const { createBackendHarness } = require('../helpers/backendHarness');
const { yearsAgo } = require('../helpers/dates');

const harness = createBackendHarness({ app, dbName: 'runfurther_community' });
const { request, createUser } = harness;

const ALLOWED = new Set(['handle', 'displayName', 'avatarTheme', 'bio', 'memberSince', 'club', 'results', 'canMessage', 'completedRaces', 'totalKm', 'bestTimes', '5K', '10K', '21K', '42K']);
const MARK = 'leakmark';
function keysDeep(v, out = new Set()) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysDeep(x, out); } return out; }
const CONSENT = { consentVersion: 'profile-v1' };

// Người đủ tuổi đã có hồ sơ; trả người dùng và handle được cấp. Hồ sơ tạo thẳng qua service vì route ghi giới hạn 30
// lệnh mỗi phút mỗi IP; đường PUT /me được kiểm riêng ở các test bên dưới.
async function withProfile(settings = {}, userOptions = {}) {
  const user = await createUser({ dob: '1995-03-10', ...userOptions });
  const profile = await createProfileWithHandle({ userId: user.id, consentAt: new Date(), consentVersion: 'profile-v1', ...settings }, user.fullName);
  return { user, handle: profile.handle };
}
const profileOf = handle => request('/community/profiles/' + handle, { as: viewer });
const setDob = (user, dob) => RunnerProfile.updateOne({ userId: user.id }, { $set: { dob: new Date(dob) } });
let viewer;

before(async () => {
  await harness.start();
  viewer = await createUser({ dob: '1990-01-01' });
});
after(harness.stop);

test('hồ sơ công khai chỉ có khóa trong danh sách trắng, không lộ trường cấm', async () => {
  // 18 giờ UTC ngày 31-12-2025 đã là 1 giờ sáng 01-01-2026 ở Việt Nam, nên tháng tham gia là 2026-01.
  const { user: owner, handle } = await withProfile({ showClub: true, bio: 'Chạy sáng ven sông' }, { fullName: 'Chủ Hồ Sơ', createdAt: new Date('2025-12-31T18:00:00Z') });
  await User.updateOne({ _id: owner.id }, { $set: { phone: MARK, email: `${MARK}@test.local` } });
  await RunnerProfile.updateOne({ userId: owner.id }, { $set: {
    club: 'CLB Sông Hàn', identityCard: MARK, medicalHistory: MARK, bloodType: 'O+', nationality: MARK, gender: 'MALE',
    defaultShirtSize: 'XL', emergencyContact: { name: MARK, phone: MARK, relation: MARK },
  } });
  const { status, body } = await profileOf(handle);
  assert.equal(status, 200);
  assert.deepEqual(body, { handle, displayName: 'Chủ Hồ Sơ', avatarTheme: 'forest', bio: 'Chạy sáng ven sông', memberSince: '2026-01', club: 'CLB Sông Hàn', canMessage: false });

  const list = await request('/community/profiles', { as: viewer });
  const item = list.body.profiles.find(p => p.handle === handle);
  assert.deepEqual(item, body);
  for (const shown of [body, ...list.body.profiles]) {
    assert.ok([...keysDeep(shown)].every(k => ALLOWED.has(k)), [...keysDeep(shown)].join());
    const json = JSON.stringify(shown).toLowerCase();
    assert.ok(!json.includes(MARK), json);
    assert.ok(!json.includes(owner.id), json);
    assert.ok(!json.includes('1995'), json);
  }
});

test('handle trên đường dẫn không phân biệt hoa thường', async () => {
  const { handle } = await withProfile({}, { fullName: 'Hoa Thường' });
  assert.deepEqual(await profileOf(handle.toUpperCase()), await profileOf(handle));
});

test('khóa tùy chọn đang tắt thì vắng mặt, không phải null', async () => {
  const hidden = await withProfile({ showClub: false, showResults: true });
  await RunnerProfile.updateOne({ userId: hidden.user.id }, { $set: { club: 'CLB Ẩn' } });
  const empty = await withProfile({ showClub: true });
  for (const { handle } of [hidden, empty]) {
    const { body } = await profileOf(handle);
    assert.ok(!('club' in body), JSON.stringify(body));
    assert.ok(!('results' in body), JSON.stringify(body));
  }
});

test('không có hồ sơ, chủ dưới 16 tuổi, thiếu ngày sinh, bị khóa, handle lạ: cùng một 404', async () => {
  const deleted = await withProfile();
  await request('/community/me', { method: 'DELETE', as: deleted.user });
  const underage = await withProfile();
  await setDob(underage.user, yearsAgo(10));
  const noDob = await withProfile();
  await RunnerProfile.updateOne({ userId: noDob.user.id }, { $unset: { dob: 1 } });
  const banned = await withProfile();
  await User.updateOne({ _id: banned.user.id }, { $set: { status: 'BANNED' } });

  const shapes = await Promise.all([deleted.handle, underage.handle, noDob.handle, banned.handle, 'khong-ton-tai', 'a%24b', 'x'.repeat(40)].map(profileOf));
  for (const r of shapes) assert.deepEqual(r, shapes[0]);
  assert.equal(shapes[0].status, 404);
  assert.equal(shapes[0].body.code, 'COMMUNITY_NOT_FOUND');
});

test('chưa đủ 16 tuổi hay thiếu ngày sinh thì không bật được', async () => {
  for (const options of [{ dob: yearsAgo(10) }, {}]) {
    const user = await createUser(options);
    const res = await request('/community/me', { method: 'PUT', as: user, body: CONSENT });
    assert.equal(res.status, 403, JSON.stringify(options));
    assert.equal(res.body.code, 'COMMUNITY_AGE_REQUIRED');
    assert.equal(await CommunityProfile.countDocuments({ userId: user.id }), 0);
    const me = await request('/community/me', { as: user });
    assert.deepEqual([me.body.eligible, me.body.profile], [false, null]);
  }
});

test('thiếu hoặc sai consentVersion thì 400', async () => {
  const user = await createUser({ dob: '1995-01-01' });
  for (const body of [{}, { consentVersion: 'profile-v0' }, { consentVersion: 'chat-v1' }, { consentVersion: 1 }]) {
    const res = await request('/community/me', { method: 'PUT', as: user, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'COMMUNITY_CONSENT_REQUIRED');
  }
  assert.equal(await CommunityProfile.countDocuments({ userId: user.id }), 0);
});

test('lời giới thiệu quá 160 ký tự hay ô tùy chọn không phải true/false thì 400', async () => {
  const user = await createUser({ dob: '1995-01-01' });
  for (const body of [{ bio: 'a'.repeat(161) }, { bio: 5 }, { showClub: 'yes' }, { showResults: 1 }]) {
    const res = await request('/community/me', { method: 'PUT', as: user, body: { ...CONSENT, ...body } });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'COMMUNITY_INVALID');
  }
  const ok = await request('/community/me', { method: 'PUT', as: user, body: { ...CONSENT, bio: '  ' + 'a'.repeat(160) + '  ' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.profile.bio.length, 160);
});

test('GET /me cho chủ hồ sơ thấy cài đặt của mình và văn bản đồng ý hiện hành', async () => {
  const user = await createUser({ dob: '1995-01-01', fullName: 'Ngô Thị F' });
  const before = await request('/community/me', { as: user });
  assert.equal(before.status, 200);
  assert.equal(before.body.profile, null);
  assert.equal(before.body.eligible, true);
  assert.equal(before.body.consentText.version, 'profile-v1');
  assert.match(before.body.consentText.text, /xóa hẳn/);

  await request('/community/me', { method: 'PUT', as: user, body: { ...CONSENT, bio: 'Xin chào', showClub: true } });
  const { body } = await request('/community/me', { as: user });
  assert.deepEqual(Object.keys(body.profile).sort(), ['bio', 'consentAt', 'consentVersion', 'handle', 'showClub', 'showResults']);
  assert.deepEqual([body.profile.handle, body.profile.bio, body.profile.showClub, body.profile.showResults], ['ngo-thi-f', 'Xin chào', true, false]);
});

test('sửa hồ sơ đã bật không cần gửi lại đồng ý và không đổi handle', async () => {
  const { user, handle } = await withProfile({ bio: 'cũ' });
  const res = await request('/community/me', { method: 'PUT', as: user, body: { bio: 'mới', showClub: true } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.profile.handle, res.body.profile.bio, res.body.profile.showClub], [handle, 'mới', true]);
});

test('đổi họ tên sau khi bật: displayName đổi, handle giữ nguyên', async () => {
  const { user, handle } = await withProfile({}, { fullName: 'Tên Cũ' });
  await User.updateOne({ _id: user.id }, { $set: { fullName: 'Tên Mới' } });
  const { body } = await profileOf(handle);
  assert.deepEqual([body.handle, body.displayName], [handle, 'Tên Mới']);
});

test('xóa hồ sơ thì GET trả 404 và tài liệu không còn', async () => {
  const { user, handle } = await withProfile();
  const res = await request('/community/me', { method: 'DELETE', as: user });
  assert.deepEqual(res, { status: 204, body: null });
  assert.equal(await CommunityProfile.countDocuments({ userId: user.id }), 0);
  assert.equal((await profileOf(handle)).status, 404);
  assert.equal((await request('/community/me', { as: user })).body.profile, null);
  // Xóa khi không còn hồ sơ vẫn 204.
  assert.equal((await request('/community/me', { method: 'DELETE', as: user })).status, 204);
});

test('danh sách chỉ có hồ sơ xem được, mới nhất trước, 20 mỗi trang, bỏ tài khoản BANNED', async () => {
  const made = [];
  for (let i = 0; i < 23; i++) made.push(await withProfile({}, { fullName: `Danh Sách ${i}` }));
  await User.updateOne({ _id: made[21].user.id }, { $set: { status: 'BANNED' } });
  await setDob(made[20].user, yearsAgo(10));
  const visible = made.filter((_, i) => i !== 21 && i !== 20).map(m => m.handle).reverse();

  const page1 = await request('/community/profiles', { as: viewer });
  assert.equal(page1.status, 200);
  assert.deepEqual(page1.body.profiles.map(p => p.handle), visible.slice(0, 20));
  assert.equal(page1.body.hasMore, true);
  const page2 = await request('/community/profiles?page=2', { as: viewer });
  assert.deepEqual(page2.body.profiles.map(p => p.handle).slice(0, 1), [visible[20]]);
  assert.ok(page2.body.profiles.every(p => !visible.slice(0, 20).includes(p.handle)), 'trang 2 không lặp trang 1');
  // Trang quá sâu (sau 1.000 hồ sơ) bị từ chối để mỗi request có chi phí giới hạn.
  for (const bad of ['0', '-1', 'abc', '1.5', '51', '999999']) {
    const res = await request('/community/profiles?page=' + bad, { as: viewer });
    assert.deepEqual([res.status, res.body.code], [400, 'COMMUNITY_INVALID'], bad);
  }
});

test('truy vấn danh sách dùng index, không quét cả collection', async () => {
  const plan = JSON.stringify(await CommunityProfile.aggregate(visibleProfilesPipeline(new Date())).explain());
  assert.ok(plan.includes('IXSCAN'), plan.slice(0, 400));
  assert.ok(!plan.includes('COLLSCAN'), plan.slice(0, 400));
});

test('bấm "Bật hồ sơ" hai lần cùng lúc: cả hai thành công, chỉ có một hồ sơ', async () => {
  const user = await createUser({ dob: '1995-01-01' });
  const results = await Promise.all([1, 2].map(() => request('/community/me', { method: 'PUT', as: user, body: CONSENT })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201], JSON.stringify(results.map(r => r.body)));
  assert.equal(results[0].body.profile.handle, results[1].body.profile.handle);
  assert.equal(await CommunityProfile.countDocuments({ userId: user.id }), 1);
});

test('ngày sinh cũ có kèm giờ: trang hồ sơ và danh sách cùng một kết luận', async () => {
  // Người tròn 16 tuổi hôm nay, nhưng dob lưu lúc 12 giờ trưa UTC thay vì nửa đêm (dữ liệu cũ).
  const { user, handle } = await withProfile();
  await RunnerProfile.updateOne({ userId: user.id }, { $set: { dob: new Date(latestBirthday(16).getTime() + 12 * 3600 * 1000) } });
  assert.equal((await profileOf(handle)).status, 200);
  const list = await request('/community/profiles', { as: viewer });
  assert.ok(list.body.profiles.some(p => p.handle === handle), 'có trong danh sách');
});

test('tài khoản cũ thiếu createdAt hay createdAt null vẫn có tháng tham gia đúng, lấy từ _id', async () => {
  const joined = new Date('2025-01-15T03:00:00Z');
  const handles = [];
  for (const createdAt of [undefined, null]) {
    const _id = mongoose.Types.ObjectId.createFromTime(joined.getTime() / 1000 + handles.length);
    await User.collection.insertOne({ _id, email: `cu-${handles.length}@test.local`, fullName: 'Tài Khoản Cũ', passwordHash: 'x', status: 'ACTIVE', ...(createdAt === undefined ? {} : { createdAt }) });
    await RunnerProfile.create({ userId: _id, dob: new Date('1990-01-01') });
    handles.push((await createProfileWithHandle({ userId: _id, consentAt: new Date(), consentVersion: 'profile-v1' }, 'Tài Khoản Cũ')).handle);
  }
  for (const handle of handles) assert.equal((await profileOf(handle)).body.memberSince, '2025-01', handle);
});

test('khách chưa đăng nhập nhận 401', async () => {
  for (const [method, path] of [['GET', '/community/me'], ['PUT', '/community/me'], ['DELETE', '/community/me'], ['GET', '/community/profiles'], ['GET', '/community/profiles/khong-ton-tai']]) {
    assert.equal((await request(path, { method, body: method === 'PUT' ? CONSENT : undefined })).status, 401, `${method} ${path}`);
  }
});
