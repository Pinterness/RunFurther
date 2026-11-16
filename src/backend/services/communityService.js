// Luật của hồ sơ cộng đồng (spec D1, D2, 4.2, 4.3). Hai nguyên tắc không được phá:
//   1. Danh sách trắng: API công khai chỉ dựng từ đúng các trường ở presentProfile. Truy vấn cũng chỉ đọc đúng các trường
//      cần (USER_FIELDS, RUNNER_FIELDS), nên email, SĐT, CCCD, bệnh sử… không bao giờ được nạp vào bộ nhớ của route.
//   2. Mọi trường hợp không xem được (không có hồ sơ, chủ hồ sơ bị khóa, dưới 16 tuổi, handle sai mẫu) trả cùng một 404,
//      để người xem không đoán được tài khoản nào đang tồn tại.
const User = require('../models/User');
const RunnerProfile = require('../models/RunnerProfile');
const CommunityProfile = require('../models/CommunityProfile');
const { HANDLE_PATTERN, createProfileWithHandle } = require('./communityHandle');
const { isAtLeastAge, latestBirthday } = require('../lib/age');
const { calendarDate } = require('../../lib/runnerValidation.cjs');
const { PROFILE_CONSENT } = require('../../lib/communityConsent.cjs');
const { httpError, assert } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const MIN_AGE = 16;
const PAGE_SIZE = 20;
const BIO_MAX = 160;
const USER_FIELDS = { fullName: 1, avatarTheme: 1, createdAt: 1, status: 1 };
const RUNNER_FIELDS = { dob: 1, club: 1 };

const notFound = () => httpError(404, 'Không tìm thấy hồ sơ.', errorCodes.COMMUNITY_NOT_FOUND);
const ownerVisible = (user, runner, now) => user?.status === 'ACTIVE' && isAtLeastAge(runner?.dob, MIN_AGE, now);

async function loadOwner(userId) {
  const [user, runner] = await Promise.all([
    User.findById(userId).select(USER_FIELDS).lean(),
    RunnerProfile.findOne({ userId }).select(RUNNER_FIELDS).lean(),
  ]);
  return { user, runner };
}

/**
 * Người đang xem có được thấy hồ sơ này không: phải đăng nhập, chủ hồ sơ còn ACTIVE và đủ 16 tuổi theo ngày sinh hiện
 * tại. Từ P12 thêm điều kiện không có Block ở chiều nào.
 * @param {string} viewerId Người đang xem.
 * @param {{ userId: unknown }} profile Hồ sơ cộng đồng.
 * @param {{ now?: Date, owner?: { user: object, runner: object } }} [options] `owner` đã nạp sẵn thì không đọc lại DB.
 * @returns {Promise<boolean>} true khi xem được.
 */
async function canSeeProfile(viewerId, profile, { now = new Date(), owner } = {}) {
  if (!viewerId || !profile) return false;
  const { user, runner } = owner ?? await loadOwner(profile.userId);
  return ownerVisible(user, runner, now);
}

/**
 * Dựng hồ sơ công khai theo danh sách trắng ở spec 4.2. Khóa tùy chọn đang tắt thì vắng mặt, không phải null.
 * @returns {{ handle: string, displayName: string, avatarTheme: string, bio: string, memberSince: string, club?: string, canMessage: boolean }}
 */
function presentProfile({ profile, user, runner, canMessage }) {
  return {
    handle: profile.handle,
    displayName: user.fullName,
    avatarTheme: user.avatarTheme ?? 'forest',
    bio: profile.bio ?? '',
    memberSince: calendarDate(user.createdAt).slice(0, 7),
    ...(profile.showClub && runner?.club ? { club: runner.club } : {}),
    canMessage: Boolean(canMessage),
  };
}

// Chủ hồ sơ xem cài đặt của chính mình: thêm hai ô tùy chọn và lần đồng ý, vẫn không có _id hay userId.
function presentOwn(profile) {
  if (!profile) return null;
  const { handle, bio, showClub, showResults, consentVersion, consentAt } = profile;
  return { handle, bio, showClub, showResults, consentVersion, consentAt };
}

function readSettings(body) {
  const source = body && typeof body === 'object' ? body : {};
  const settings = {};
  if (source.bio !== undefined) {
    assert(typeof source.bio === 'string' && source.bio.trim().length <= BIO_MAX, 400, `Lời giới thiệu tối đa ${BIO_MAX} ký tự.`, errorCodes.COMMUNITY_INVALID);
    settings.bio = source.bio.trim();
  }
  for (const key of ['showClub', 'showResults']) {
    if (source[key] === undefined) continue;
    assert(typeof source[key] === 'boolean', 400, 'Lựa chọn hiện câu lạc bộ hay thành tích chỉ là bật hoặc tắt.', errorCodes.COMMUNITY_INVALID);
    settings[key] = source[key];
  }
  return settings;
}

const readDob = userId => RunnerProfile.findOne({ userId }).select({ dob: 1 }).lean().then(runner => runner?.dob);

async function getMine(userId, { now = new Date() } = {}) {
  const [profile, dob] = await Promise.all([CommunityProfile.findOne({ userId }).lean(), readDob(userId)]);
  return { profile: presentOwn(profile), eligible: isAtLeastAge(dob, MIN_AGE, now), consentText: PROFILE_CONSENT };
}

/**
 * Bật hoặc sửa hồ sơ của chính mình. Bật lần đầu cần đúng phiên bản đồng ý hiện hành; handle tự sinh từ họ tên.
 * @returns {Promise<{ profile: object, created: boolean }>}
 */
async function saveMine(userId, body, { now = new Date() } = {}) {
  const settings = readSettings(body);
  assert(isAtLeastAge(await readDob(userId), MIN_AGE, now), 403,
    'Bạn cần đủ 16 tuổi và có ngày sinh trong hồ sơ người chạy để bật hồ sơ cộng đồng.', errorCodes.COMMUNITY_AGE_REQUIRED);

  const current = await CommunityProfile.findOne({ userId }).lean();
  if (current && !Object.keys(settings).length) return { profile: presentOwn(current), created: false };
  if (current) {
    const updated = await CommunityProfile.findOneAndUpdate({ userId }, { $set: settings }, { new: true, runValidators: true }).lean();
    // Hồ sơ vừa bị xóa ở tab khác thì đi tiếp nhánh tạo mới, nhánh đó đòi đồng ý lại.
    if (updated) return { profile: presentOwn(updated), created: false };
  }

  assert(body?.consentVersion === PROFILE_CONSENT.version, 400,
    'Bạn cần đánh dấu đồng ý công khai hồ sơ trước khi bật.', errorCodes.COMMUNITY_CONSENT_REQUIRED);
  const user = await User.findById(userId).select({ fullName: 1 }).lean();
  const profile = await createProfileWithHandle(
    { userId, ...settings, consentAt: now, consentVersion: PROFILE_CONSENT.version },
    user.fullName,
  );
  return { profile: presentOwn(profile.toObject()), created: true };
}

// Tắt hồ sơ là xóa hẳn tài liệu (spec D2); không còn hồ sơ thì coi như đã xóa.
async function deleteMine(userId) {
  await CommunityProfile.deleteOne({ userId });
}

function readPage(raw) {
  if (raw === undefined) return 1;
  assert(typeof raw === 'string' && /^[1-9]\d{0,5}$/.test(raw), 400, 'Số trang không hợp lệ.', errorCodes.COMMUNITY_INVALID);
  return Number(raw);
}

/**
 * Danh sách /community: 20 hồ sơ xem được mới nhất mỗi trang. Điều kiện xem được (ACTIVE, đủ 16 tuổi) lọc ngay trong
 * truy vấn, nên trang nào cũng đủ 20 hồ sơ nếu còn.
 */
async function listProfiles(viewerId, { page: rawPage, now = new Date() } = {}) {
  const page = readPage(rawPage);
  const rows = await CommunityProfile.aggregate([
    { $sort: { createdAt: -1, _id: -1 } },
    { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'user', pipeline: [{ $project: USER_FIELDS }] } },
    { $lookup: { from: RunnerProfile.collection.name, localField: 'userId', foreignField: 'userId', as: 'runner', pipeline: [{ $project: RUNNER_FIELDS }] } },
    { $set: { user: { $first: '$user' }, runner: { $first: '$runner' } } },
    { $match: { 'user.status': 'ACTIVE', 'runner.dob': { $lte: latestBirthday(MIN_AGE, now) } } },
    { $skip: (page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE + 1 },
  ]);
  return {
    profiles: rows.slice(0, PAGE_SIZE).map(row => presentProfile({ profile: row, user: row.user, runner: row.runner, canMessage: false })),
    page,
    hasMore: rows.length > PAGE_SIZE,
  };
}

async function getProfile(viewerId, rawHandle, { now = new Date() } = {}) {
  const handle = String(rawHandle).toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) throw notFound();
  const profile = await CommunityProfile.findOne({ handle }).lean();
  if (!profile) throw notFound();
  const owner = await loadOwner(profile.userId);
  if (!(await canSeeProfile(viewerId, profile, { now, owner }))) throw notFound();
  // canMessage luôn false tới P13 (Task 13.3 tính thật).
  return presentProfile({ profile, ...owner, canMessage: false });
}

module.exports = { MIN_AGE, canSeeProfile, presentProfile, getMine, saveMine, deleteMine, listProfiles, getProfile };
