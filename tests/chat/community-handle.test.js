// Handle của hồ sơ cộng đồng (spec D1, 4.1): sinh từ họ tên, không trùng, không mạo danh tên của hệ thống.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-community-handle-test-secret';

const { app } = require('../../src/backend/server');
const CommunityProfile = require('../../src/backend/models/CommunityProfile');
const { slugifyName, isReservedHandle, HANDLE_PATTERN, createProfileWithHandle } = require('../../src/backend/services/communityHandle');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_community_handle' });
const { createUser } = harness;
const base = userId => ({ userId, consentAt: new Date(), consentVersion: 'profile-v1' });
const newProfile = async name => createProfileWithHandle(base((await createUser({ dob: '2000-01-01' })).id), name);

before(harness.start);
after(harness.stop);

test('handle sinh từ họ tên tiếng Việt', () => {
  assert.equal(slugifyName('Nguyễn Đức Anh'), 'nguyen-duc-anh');
  assert.equal(slugifyName('  Trần   Thị--B!! '), 'tran-thi-b');
  assert.equal(slugifyName('ĐẶNG THỊ ÁNH NGỌC'), 'dang-thi-anh-ngoc');
  assert.equal(slugifyName('🙂'), 'runner');
  assert.equal(slugifyName('---'), 'runner');
  assert.ok(slugifyName('a'.repeat(80)).length <= 30);
});

test('cắt 30 ký tự không để lại dấu gạch ở cuối', () => {
  assert.equal(slugifyName('a'.repeat(29) + ' b'), 'a'.repeat(29));
});

test('họ tên quá ngắn vẫn cho handle đủ 3 ký tự', () => {
  assert.equal(slugifyName('Lý'), 'ly-runner');
  assert.match(slugifyName('A'), HANDLE_PATTERN);
});

test('mọi handle sinh ra đều khớp mẫu và không có hai dấu gạch liền nhau', () => {
  for (const name of ['Nguyễn Đức Anh', '🙂', 'Lý', 'a'.repeat(80), 'x - - y', '9']) {
    const handle = slugifyName(name);
    assert.match(handle, HANDLE_PATTERN, name);
    assert.ok(!handle.includes('--'), name);
  }
});

test('mẫu handle: 3–30 ký tự, chữ thường, số và dấu gạch, không bắt đầu hay kết thúc bằng dấu gạch', () => {
  for (const ok of ['abc', 'le-van-c', 'a1b', 'x'.repeat(30)]) assert.match(ok, HANDLE_PATTERN, ok);
  for (const bad of ['ab', '-abc', 'abc-', 'ABC', 'le van', 'x'.repeat(31), 'lê-văn']) assert.doesNotMatch(bad, HANDLE_PATTERN, bad);
});

test('handle cấm: đứng một mình, kèm số ở trước hay sau, chữ hoa, hay chứa một từ của ban quản trị', () => {
  for (const h of ['admin', 'Admin', 'hotro-2', 'runfurther', 'messages', '2-admin', '01-hotro-3', 'admin-2-3', 'ADMIN-9-9',
    '1-2-admin', 'admin-nguyen', 'runfurther-official', 'hotro-runfurther', 'nguyen-ho-tro', 'ban-to-chuc-hue', 'staff-02']) {
    assert.equal(isReservedHandle(h), true, h);
  }
  // Họ Hồ, tên có chữ "api" hay các chữ rời nhau vẫn dùng được.
  for (const h of ['nguyen-van-a', '2-nguyen', 'ho-van-tro', 'ho-thi-tuyet', 'ban-thi-chuc', 'le-api-c']) assert.equal(isReservedHandle(h), false, h);
});

test('tên của hệ thống không bao giờ được cấp, kể cả kèm số: dùng runner thay thế', async () => {
  for (const name of ['Admin', '2 Admin', 'Hỗ Trợ', 'RunFurther Official']) {
    const p = await createProfileWithHandle(base((await createUser()).id), name);
    assert.equal(isReservedHandle(p.handle), false, `${name} → ${p.handle}`);
    assert.match(p.handle, /^runner(-\d+)?$/, name);
  }
});

test('một handle có hậu tố số khổng lồ không chặn được người cùng tên về sau', async () => {
  const squatter = await createUser();
  await CommunityProfile.create({ ...base(squatter.id), handle: 'le-van-q-9007199254740992' });
  const made = [];
  for (let i = 0; i < 3; i++) made.push((await newProfile('Lê Văn Q')).handle);
  assert.deepEqual(made, ['le-van-q', 'le-van-q-2', 'le-van-q-3']);
});

test('gốc còn trống thì dùng gốc, dù đã có handle của tên khác kết thúc bằng số', async () => {
  assert.equal((await newProfile('Lê Văn D 2')).handle, 'le-van-d-2');
  assert.equal((await newProfile('Lê Văn D')).handle, 'le-van-d');
});

test('hai người cùng tên tạo song song nhận hai handle khác nhau', async () => {
  const [a, b] = await Promise.all([1, 2].map(() => createUser({ dob: '2000-01-01' })));
  const made = await Promise.all([a, b].map(u => createProfileWithHandle(base(u.id), 'Lê Văn C')));
  assert.deepEqual(made.map(p => p.handle).sort(), ['le-van-c', 'le-van-c-2']);
});

test('họ tên không còn ký tự nào thì dùng runner, có số khi runner đã có người dùng', async () => {
  const handles = [(await newProfile('🙂')).handle, (await newProfile('---')).handle];
  assert.notEqual(handles[0], handles[1]);
  for (const handle of handles) assert.match(handle, /^runner(-\d+)?$/);
});

test('hậu tố số không làm handle dài quá 30 ký tự', async () => {
  const long = 'Nguyễn Thị Phương Thảo Hoàng Kim';
  const [first, second] = [await newProfile(long), await newProfile(long)];
  assert.equal(first.handle.length, 30);
  assert.ok(second.handle.length <= 30, second.handle);
  assert.match(second.handle, HANDLE_PATTERN);
  assert.ok(second.handle.endsWith('-2'), second.handle);
});

test('người thứ 60 cùng tên vẫn nhận được handle, cả với tên dài phải cắt bớt', async () => {
  for (const name of ['Trần Văn Nam', 'Hoàng Nguyễn Bảo Ngọc Trâm Anh Thư']) {
    const handles = [];
    for (let i = 0; i < 60; i++) handles.push((await createProfileWithHandle(base((await createUser()).id), name)).handle);
    assert.equal(new Set(handles).size, 60, name);
    assert.ok(handles.every(h => HANDLE_PATTERN.test(h) && !h.includes('--')), name);
    assert.ok(handles[59].endsWith('-60'), handles[59]);
  }
});

test('một tài khoản chỉ có một hồ sơ: tạo lần hai báo 409 COMMUNITY_INVALID', async () => {
  const user = await createUser({ dob: '2000-01-01' });
  await createProfileWithHandle(base(user.id), 'Phạm Văn D');
  await assert.rejects(createProfileWithHandle(base(user.id), 'Phạm Văn D'), { statusCode: 409, code: 'COMMUNITY_INVALID' });
  assert.equal(await CommunityProfile.countDocuments({ userId: user.id }), 1);
});

test('model lưu handle chữ thường, bio mặc định rỗng, hai ô tùy chọn mặc định tắt', async () => {
  const p = await newProfile('Võ Thị E');
  assert.deepEqual([p.handle, p.bio, p.showClub, p.showResults], ['vo-thi-e', '', false, false]);
  const indexes = await CommunityProfile.collection.indexes();
  assert.ok(indexes.some(i => i.key.handle === 1 && i.unique), 'unique handle');
  assert.ok(indexes.some(i => i.key.userId === 1 && i.unique), 'unique userId');
  assert.ok(indexes.some(i => i.key.createdAt === -1 && i.key._id === -1), 'createdAt -1, _id -1');
});
