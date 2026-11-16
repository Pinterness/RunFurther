// Task 11.5 (spec D1, T6, T11): thành tích tổng hợp của chính chủ hồ sơ, sửa handle, tìm người chạy theo tên.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'isolated-community-results-test-secret';

const { app } = require('../../src/backend/server');
const User = require('../../src/backend/models/User');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const Event = require('../../src/backend/models/Event');
const EventCategory = require('../../src/backend/models/EventCategory');
const Registration = require('../../src/backend/models/Registration');
const { createProfileWithHandle } = require('../../src/backend/services/communityHandle');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_community_results' });
const { request, createUser } = harness;
const ALLOWED = new Set(['handle', 'displayName', 'avatarTheme', 'bio', 'memberSince', 'club', 'results', 'canMessage', 'completedRaces', 'totalKm', 'bestTimes', '5K', '10K', '21K', '42K']);
function keysDeep(v, out = new Set()) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysDeep(x, out); } return out; }

async function withProfile(settings = {}, userOptions = {}) {
  const user = await createUser({ dob: '1995-03-10', ...userOptions });
  const profile = await createProfileWithHandle({ userId: user.id, consentAt: new Date(), consentVersion: 'profile-v1', ...settings }, user.fullName);
  return { user, handle: profile.handle };
}
const profileOf = handle => request('/community/profiles/' + handle, { as: viewer });
let viewer, race, seq = 0;

before(async () => {
  await harness.start();
  viewer = await createUser({ dob: '1990-01-01' });
  const event = await Event.create({
    slug: 'giai-thanh-tich', name: 'Giải Bí Mật Ven Sông', status: 'COMPLETED', location: { city: 'Huế', venue: 'Kinh thành' },
    dateInfo: { raceDate: new Date('2026-10-01T00:00:00Z'), registrationStart: new Date('2026-08-01T00:00:00Z'), registrationEnd: new Date('2026-09-30T00:00:00Z') },
  });
  const category = (code, distance) => EventCategory.create({ eventId: event._id, code, name: code, distance, price: 1, quotaTotal: 100 });
  race = { event, k5: await category('5K', 5), k21: await category('21K', 21.1), k15: await category('15K', 15) };
});
after(harness.stop);

// Một vé đã chạy xong: mặc định của chính chủ (đúng email, ngày sinh người lớn) với chip time hợp lệ.
function ticket(user, category, { status = 'CONFIRMED', email = user.email, birthday = '1995-03-10', chipTime } = {}) {
  seq += 1;
  return Registration.create({
    userId: user.id, eventId: race.event._id, categoryId: category._id, bibNumber: `BIB-${seq}`, qrToken: `qr-results-${seq}`, status,
    runnerProfile: { fullName: 'Người Chạy', email, phone: '0900000000', birthday },
    payment: { bookingId: new mongoose.Types.ObjectId(), paidAmount: 1 },
    ...(chipTime === undefined ? {} : { finishResult: { chipTime } }),
  });
}

test('thành tích chỉ đếm vé đã xác nhận của chính chủ, đủ 16 tuổi, có chip time hợp lệ', async () => {
  const { user, handle } = await withProfile({ showResults: true });
  await ticket(user, race.k5, { chipTime: '0:25:30' });
  await ticket(user, race.k21, { status: 'CHECKED_IN', chipTime: '1:55:00' });
  await ticket(user, race.k21, { status: 'KIT_COLLECTED', email: user.email.toUpperCase(), chipTime: '1:50:10' });
  await ticket(user, race.k15, { chipTime: '1:20:00' });
  // Không được đếm: vé mua hộ người khác, vé của em 12 tuổi, vé đã hủy, chip time sai dạng, chưa có kết quả, thiếu ngày sinh.
  await ticket(user, race.k5, { email: 'ban-than@test.local', chipTime: '0:20:00' });
  await ticket(user, race.k5, { birthday: '2014-01-01', chipTime: '0:21:00' });
  await ticket(user, race.k5, { status: 'CANCELLED', chipTime: '0:22:00' });
  await ticket(user, race.k5, { chipTime: '25:30' });
  await ticket(user, race.k5);
  await ticket(user, race.k5, { birthday: '', chipTime: '0:23:00' });

  const { status, body } = await profileOf(handle);
  assert.equal(status, 200);
  assert.deepEqual(body.results, { completedRaces: 4, totalKm: 62.2, bestTimes: { '5K': '0:25:30', '21K': '1:50:10' } });
  assert.ok([...keysDeep(body)].every(k => ALLOWED.has(k)), [...keysDeep(body)].join());
  const json = JSON.stringify(body);
  for (const secret of ['Giải Bí Mật', 'BIB-', 'ban-than', '2014', '1995', 'qr-results']) assert.ok(!json.includes(secret), secret);

  // Phần tử của danh sách theo cùng danh sách trắng, nên cũng có thành tích.
  const list = await request('/community/profiles', { as: viewer });
  assert.deepEqual(list.body.profiles.find(p => p.handle === handle).results, body.results);
  // Chủ hồ sơ thấy trước số liệu của mình trong GET /me.
  assert.deepEqual((await request('/community/me', { as: user })).body.results, body.results);
});

test('tắt "Hiện thành tích" hoặc chưa có kết quả nào thì không có khóa results', async () => {
  const off = await withProfile({ showResults: false });
  await ticket(off.user, race.k5, { chipTime: '0:30:00' });
  const none = await withProfile({ showResults: true });
  await ticket(none.user, race.k5, { email: 'nguoi-khac@test.local', chipTime: '0:30:00' });
  for (const { handle } of [off, none]) assert.ok(!('results' in (await profileOf(handle)).body), handle);
  assert.equal((await request('/community/me', { as: none.user })).body.results, null);
});

test('chủ hồ sơ đổi được handle; handle cũ thành 404', async () => {
  const { user, handle } = await withProfile();
  const res = await request('/community/me', { method: 'PUT', as: user, body: { handle: '  Chay-Cung-Nam ' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.profile.handle, 'chay-cung-nam');
  assert.equal((await profileOf('chay-cung-nam')).status, 200);
  assert.equal((await profileOf(handle)).status, 404);
});

test('handle đã có người dùng thì 409 COMMUNITY_HANDLE_TAKEN; tên cấm hay sai mẫu thì 400', async () => {
  const taken = await withProfile();
  const { user, handle } = await withProfile();
  const clash = await request('/community/me', { method: 'PUT', as: user, body: { handle: taken.handle } });
  assert.deepEqual([clash.status, clash.body.code], [409, 'COMMUNITY_HANDLE_TAKEN']);
  for (const bad of ['admin', 'hotro-2', '2-admin', 'ab', 'a--b', '-abc', 'abc-', 'lê-văn', 'x'.repeat(31), 5]) {
    const res = await request('/community/me', { method: 'PUT', as: user, body: { handle: bad } });
    assert.deepEqual([res.status, res.body.code], [400, 'COMMUNITY_INVALID'], String(bad));
  }
  assert.equal((await request('/community/me', { as: user })).body.profile.handle, handle);
});

test('hai người cùng đổi sang một handle cùng lúc: một người được, người kia 409', async () => {
  const [a, b] = await Promise.all([withProfile(), withProfile()]);
  const results = await Promise.all([a, b].map(({ user }) => request('/community/me', { method: 'PUT', as: user, body: { handle: 'cung-mot-ten' } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test('tìm theo tên không phân biệt dấu và hoa thường, vẫn bỏ người không xem được', async () => {
  const a = await withProfile({}, { fullName: 'Nguyễn Văn Tìm' });
  const b = await withProfile({}, { fullName: 'NGUYỄN THỊ TÌM' });
  const hidden = await withProfile({}, { fullName: 'Nguyễn Ẩn Tìm' });
  await User.updateOne({ _id: hidden.user.id }, { $set: { status: 'BANNED' } });
  const young = await withProfile({}, { fullName: 'Nguyễn Nhỏ Tìm' });
  await RunnerProfile.updateOne({ userId: young.user.id }, { $set: { dob: new Date('2015-01-01') } });
  await withProfile({}, { fullName: 'Trần Khác' });

  const search = async q => (await request('/community/profiles?q=' + encodeURIComponent(q), { as: viewer })).body.profiles.map(p => p.handle).sort();
  assert.deepEqual(await search('nguyen tim'), [a.handle, b.handle].sort());
  assert.deepEqual(await search('Nguyễn   TÌM'), [a.handle, b.handle].sort());
  assert.deepEqual(await search('van tim'), [a.handle]);
  assert.deepEqual(await search('khong ai ten nay'), []);
  // Tìm được cả theo handle.
  assert.deepEqual(await search(a.handle), [a.handle]);
  const tooLong = await request('/community/profiles?q=' + 'a'.repeat(61), { as: viewer });
  assert.deepEqual([tooLong.status, tooLong.body.code], [400, 'COMMUNITY_INVALID']);
  // Chuỗi toàn khoảng trắng coi như không tìm.
  const all = await request('/community/profiles?q=%20%20', { as: viewer });
  assert.equal(all.status, 200);
  assert.ok(all.body.profiles.length > 2);
});
