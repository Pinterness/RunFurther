// Luật của hồ sơ cộng đồng (spec D1, D2, 4.2, 4.3). Hai nguyên tắc không được phá:
//   1. Danh sách trắng: API công khai chỉ dựng từ đúng các trường ở presentProfile. Truy vấn cũng chỉ đọc đúng các trường
//      cần (USER_FIELDS, RUNNER_FIELDS), nên email, SĐT, CCCD, bệnh sử… không bao giờ được nạp vào bộ nhớ của route.
//      Ngoại lệ duy nhất là summarizeResults: nó đọc email và ngày sinh để lọc vé, rồi chỉ trả số tổng hợp.
//   2. Mọi trường hợp không xem được (không có hồ sơ, chủ hồ sơ bị khóa, dưới 16 tuổi, handle sai mẫu) trả cùng một 404,
//      để người xem không đoán được tài khoản nào đang tồn tại.
const User = require('../models/User');
const RunnerProfile = require('../models/RunnerProfile');
const CommunityProfile = require('../models/CommunityProfile');
const Registration = require('../models/Registration');
const Block = require('../models/Block');
const { blockedBetween, senderEligible, inviteTarget } = require('./chatGate');
require('../models/EventCategory'); // populate('categoryId') cần model này đã đăng ký
const { HANDLE_PATTERN, isReservedHandle, foldName, createProfileWithHandle } = require('./communityHandle');
const { isAtLeastAge, latestBirthday } = require('../lib/age');
const { calendarDate, ageOn } = require('../../lib/runnerValidation.cjs');
const { PROFILE_CONSENT } = require('../../lib/communityConsent.cjs');
const { httpError, assert } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const MIN_AGE = 16;
const PAGE_SIZE = 20;
const BIO_MAX = 160;
const QUERY_MAX = 60;
// Tìm theo tên lọc bằng JS (MongoDB không so được chữ đã bỏ dấu), nên chỉ quét chừng này hồ sơ mới nhất.
const SEARCH_SCAN = 1000;
// Danh sách cũng dừng ở 1.000 hồ sơ (50 trang), để mỗi request có chi phí giới hạn.
const MAX_PAGE = SEARCH_SCAN / PAGE_SIZE;
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_FIELDS = { fullName: 1, avatarTheme: 1, createdAt: 1, status: 1 };
const RUNNER_FIELDS = { dob: 1, club: 1 };
const RESULT_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'];
const CHIP_TIME = /^[0-9]+:[0-5][0-9]:[0-5][0-9]$/; // cùng mẫu với registrationController
// Cự ly chuẩn của từng nhóm thời gian tốt nhất. Ban tổ chức nhập 21, 21,1 hay 21,0975 cho bán marathon, nên cho lệch
// tối đa 0,2 km; 5,9 km hay 10,9 km không phải 5K hay 10K.
const BEST_TIME_DISTANCES = [['5K', 5], ['10K', 10], ['21K', 21.0975], ['42K', 42.195]];
const bestTimeKey = distance => BEST_TIME_DISTANCES.find(([, km]) => Math.abs(distance - km) <= 0.2)?.[0];

const notFound = () => httpError(404, 'Không tìm thấy hồ sơ.', errorCodes.COMMUNITY_NOT_FOUND);
const ownerVisible = (user, runner, now) => user?.status === 'ACTIVE' && isAtLeastAge(runner?.dob, MIN_AGE, now);
const seconds = time => time.split(':').reduce((total, part) => total * 60 + Number(part), 0);

async function loadOwner(userId) {
  const [user, runner] = await Promise.all([
    User.findById(userId).select(USER_FIELDS).lean(),
    RunnerProfile.findOne({ userId }).select(RUNNER_FIELDS).lean(),
  ]);
  return { user, runner };
}

/**
 * Thành tích tổng hợp của các tài khoản (spec D1, T6). Mỗi vé trong Registration là bản chụp người chạy lúc mua, có thể
 * là vé mua hộ bạn hay con, nên chỉ đếm vé có email trùng email tài khoản và người chạy đủ 16 tuổi. Email và ngày sinh
 * chỉ dùng để lọc ở đây; kết quả chỉ có số giải, tổng km và thời gian tốt nhất, không có tên giải, ngày hay BIB.
 * @param {Array<unknown>} userIds Các tài khoản cần tính.
 * @param {Date} now Thời điểm tính tuổi.
 * @returns {Promise<Map<string, { completedRaces: number, totalKm: number, bestTimes: object }>>} Chỉ có tài khoản có kết quả.
 */
async function summarizeResults(userIds, now) {
  if (!userIds.length) return new Map();
  const [owners, tickets] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select({ email: 1 }).lean(),
    Registration.find({ userId: { $in: userIds }, status: { $in: RESULT_STATUSES }, 'finishResult.chipTime': { $type: 'string' } })
      .select({ userId: 1, categoryId: 1, 'runnerProfile.email': 1, 'runnerProfile.birthday': 1, 'finishResult.chipTime': 1 })
      .populate('categoryId', 'distance')
      .lean(),
  ]);
  const emailOf = new Map(owners.map(owner => [String(owner._id), String(owner.email).toLowerCase()]));
  const totals = new Map();
  for (const ticket of tickets) {
    const id = String(ticket.userId), chipTime = ticket.finishResult.chipTime;
    if (String(ticket.runnerProfile?.email ?? '').toLowerCase() !== emailOf.get(id)) continue;
    if (!(ageOn(ticket.runnerProfile?.birthday, now) >= MIN_AGE)) continue;
    // Chip time 0:00:00 là dữ liệu hỏng, không phải thành tích.
    if (!CHIP_TIME.test(chipTime) || seconds(chipTime) === 0) continue;
    const distance = Number(ticket.categoryId?.distance) || 0;
    const sum = totals.get(id) ?? { completedRaces: 0, totalKm: 0, bestTimes: {} };
    sum.completedRaces += 1;
    sum.totalKm += distance;
    const key = bestTimeKey(distance);
    if (key && (!sum.bestTimes[key] || seconds(chipTime) < seconds(sum.bestTimes[key]))) sum.bestTimes[key] = chipTime;
    totals.set(id, sum);
  }
  for (const sum of totals.values()) sum.totalKm = Math.round(sum.totalKm * 10) / 10;
  return totals;
}

/**
 * Người đang xem có được thấy hồ sơ này không: phải đăng nhập, chủ hồ sơ còn ACTIVE và đủ 16 tuổi theo ngày sinh hiện
 * tại, và không có Block ở chiều nào giữa hai người (từ P12). Bị chặn thì nhận cùng 404 như hồ sơ không tồn tại, nên
 * người bị chặn không biết mình bị chặn.
 * @param {string} viewerId Người đang xem.
 * @param {{ userId: unknown }} profile Hồ sơ cộng đồng.
 * @param {{ now?: Date, owner?: { user: object, runner: object } }} [options] `owner` đã nạp sẵn thì không đọc lại DB.
 * @returns {Promise<boolean>} true khi xem được.
 */
async function canSeeProfile(viewerId, profile, { now = new Date(), owner } = {}) {
  if (!viewerId || !profile) return false;
  const [{ user, runner }, blocked] = await Promise.all([
    owner ?? loadOwner(profile.userId),
    blockedBetween(viewerId, profile.userId),
  ]);
  return ownerVisible(user, runner, now) && !blocked;
}

/**
 * Những người có Block với người xem ở bất kỳ chiều nào, để danh sách /community bỏ họ ra.
 * Nhánh blockerId dùng index { blockerId, blockedId }, nhánh blockedId dùng index { blockedId }.
 * @returns {Promise<Array<unknown>>} userId cần ẩn.
 */
async function blockedWith(viewerId) {
  const rows = await Block.find({ $or: [{ blockerId: viewerId }, { blockedId: viewerId }] }).select({ blockerId: 1, blockedId: 1 }).lean();
  return rows.map(row => (String(row.blockerId) === String(viewerId) ? row.blockedId : row.blockerId));
}

/**
 * Dựng hồ sơ công khai theo danh sách trắng ở spec 4.2. Khóa tùy chọn đang tắt hay không có dữ liệu thì vắng mặt,
 * không phải null.
 * @returns {{ handle: string, displayName: string, avatarTheme: string, bio: string, memberSince: string, club?: string, results?: object, canMessage: boolean }}
 */
function presentProfile({ profile, user, runner, results, canMessage }) {
  return {
    handle: profile.handle,
    displayName: user.fullName,
    avatarTheme: user.avatarTheme ?? 'forest',
    bio: profile.bio ?? '',
    // Tài khoản cũ có thể thiếu createdAt; _id của MongoDB chứa thời điểm tạo nên dùng thay.
    memberSince: calendarDate(user.createdAt || user._id.getTimestamp()).slice(0, 7),
    ...(profile.showClub && runner?.club ? { club: runner.club } : {}),
    ...(profile.showResults && results ? { results } : {}),
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
  if (source.handle !== undefined) {
    const handle = typeof source.handle === 'string' ? source.handle.trim().toLowerCase() : '';
    assert(HANDLE_PATTERN.test(handle) && !handle.includes('--'), 400,
      'Tên hồ sơ gồm 3–30 chữ thường không dấu, số và dấu gạch, không bắt đầu hay kết thúc bằng dấu gạch.', errorCodes.COMMUNITY_INVALID);
    settings.handle = handle; // tên cấm kiểm ở saveMine, chỉ khi handle thật sự đổi
  }
  return settings;
}

// Hai request bật hồ sơ chạy song song (bấm hai lần, hai tab) thì request sau gặp lỗi trùng userId; khi đó coi như
// hồ sơ đã bật và trả về hồ sơ đang có.
async function createOrReuse(userId, fields, fullName, now) {
  try {
    const profile = await createProfileWithHandle({ userId, ...fields, consentAt: now, consentVersion: PROFILE_CONSENT.version }, fullName);
    return { profile: presentOwn(profile.toObject()), created: true };
  } catch (error) {
    const existing = error?.code === errorCodes.COMMUNITY_INVALID && await CommunityProfile.findOne({ userId }).lean();
    if (existing) return { profile: presentOwn(existing), created: false };
    throw error;
  }
}

function assertHandleAllowed(settings, current) {
  if (settings.handle === undefined || settings.handle === current.handle) return;
  assert(!isReservedHandle(settings.handle), 400, 'Tên hồ sơ này dành cho hệ thống. Bạn chọn tên khác nhé.', errorCodes.COMMUNITY_INVALID);
}

const readDob = userId => RunnerProfile.findOne({ userId }).select({ dob: 1 }).lean().then(runner => runner?.dob);

async function getMine(userId, { now = new Date() } = {}) {
  const [profile, dob, results] = await Promise.all([
    CommunityProfile.findOne({ userId }).lean(), readDob(userId), summarizeResults([userId], now),
  ]);
  // results cho chủ hồ sơ xem trước số liệu sẽ hiện khi bật "Hiện thành tích"; null là chưa có kết quả nào.
  return { profile: presentOwn(profile), eligible: isAtLeastAge(dob, MIN_AGE, now), consentText: PROFILE_CONSENT, results: results.get(String(userId)) ?? null };
}

async function updateMine(userId, settings) {
  try {
    return await CommunityProfile.findOneAndUpdate({ userId }, { $set: settings }, { new: true, runValidators: true }).lean();
  } catch (error) {
    if (error?.code === 11000 && error.keyPattern?.handle) {
      throw httpError(409, 'Tên hồ sơ này đã có người dùng. Bạn chọn tên khác nhé.', errorCodes.COMMUNITY_HANDLE_TAKEN);
    }
    throw error;
  }
}

/**
 * Bật hoặc sửa hồ sơ của chính mình. Bật lần đầu cần đúng phiên bản đồng ý hiện hành, và handle luôn tự sinh từ họ tên;
 * đổi handle chỉ làm được sau khi đã bật.
 * @returns {Promise<{ profile: object, created: boolean }>}
 */
async function saveMine(userId, body, { now = new Date() } = {}) {
  const settings = readSettings(body);
  assert(isAtLeastAge(await readDob(userId), MIN_AGE, now), 403,
    'Bạn cần đủ 16 tuổi và có ngày sinh trong hồ sơ người chạy để bật hồ sơ cộng đồng.', errorCodes.COMMUNITY_AGE_REQUIRED);

  const current = await CommunityProfile.findOne({ userId }).lean();
  if (current && !Object.keys(settings).length) return { profile: presentOwn(current), created: false };
  if (current) {
    assertHandleAllowed(settings, current);
    const updated = await updateMine(userId, settings);
    // Hồ sơ vừa bị xóa ở tab khác thì đi tiếp nhánh tạo mới, nhánh đó đòi đồng ý lại.
    if (updated) return { profile: presentOwn(updated), created: false };
  }

  assert(body?.consentVersion === PROFILE_CONSENT.version, 400,
    'Bạn cần đánh dấu đồng ý công khai hồ sơ trước khi bật.', errorCodes.COMMUNITY_CONSENT_REQUIRED);
  const { handle: _requested, ...fields } = settings;
  const user = await User.findById(userId).select({ fullName: 1 }).lean();
  return createOrReuse(userId, fields, user.fullName, now);
}

// Tắt hồ sơ là xóa hẳn tài liệu (spec D2); không còn hồ sơ thì coi như đã xóa.
async function deleteMine(userId) {
  await CommunityProfile.deleteOne({ userId });
}

function readPage(raw) {
  if (raw === undefined) return 1;
  assert(typeof raw === 'string' && /^[1-9]\d{0,2}$/.test(raw) && Number(raw) <= MAX_PAGE, 400, 'Số trang không hợp lệ.', errorCodes.COMMUNITY_INVALID);
  return Number(raw);
}

function readQuery(raw) {
  if (raw === undefined) return [];
  assert(typeof raw === 'string' && raw.length <= QUERY_MAX, 400, `Từ khóa tìm kiếm tối đa ${QUERY_MAX} ký tự.`, errorCodes.COMMUNITY_INVALID);
  return foldName(raw).split(' ').filter(Boolean);
}

// Mỗi từ của từ khóa phải nằm trong họ tên hoặc handle đã bỏ dấu: "nguyen tim" khớp "Nguyễn Thị Tìm".
const matchesQuery = (row, words) => {
  const haystack = `${foldName(row.user.fullName)} ${foldName(row.handle)}`;
  return words.every(word => haystack.includes(word));
};

/**
 * Pipeline lấy hồ sơ xem được, mới nhất trước: sắp theo index { createdAt: -1, _id: -1 }, nối User và RunnerProfile
 * (chỉ các trường cần), rồi giữ chủ hồ sơ ACTIVE và đủ 16 tuổi. isAtLeastAge xét ngày UTC của dob, nên mọi dob trong
 * ngày mốc (kể cả dữ liệu cũ có kèm giờ) đều đạt: điều kiện là dob trước nửa đêm của ngày hôm sau.
 * @param {Date} now Thời điểm tính tuổi.
 * @returns {object[]} Các bước aggregate, chưa có $skip/$limit.
 */
function visibleProfilesPipeline(now) {
  return [
    { $sort: { createdAt: -1, _id: -1 } },
    { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'user', pipeline: [{ $project: USER_FIELDS }] } },
    { $lookup: { from: RunnerProfile.collection.name, localField: 'userId', foreignField: 'userId', as: 'runner', pipeline: [{ $project: RUNNER_FIELDS }] } },
    { $set: { user: { $first: '$user' }, runner: { $first: '$runner' } } },
    { $match: { 'user.status': 'ACTIVE', 'runner.dob': { $lt: new Date(latestBirthday(MIN_AGE, now).getTime() + DAY_MS) } } },
  ];
}

/**
 * Danh sách /community: 20 hồ sơ xem được mới nhất mỗi trang, lọc theo tên nếu có `q`. Điều kiện xem được (ACTIVE,
 * đủ 16 tuổi) lọc ngay trong truy vấn, nên trang nào cũng đủ 20 hồ sơ nếu còn.
 */
async function listProfiles(viewerId, { page: rawPage, q, now = new Date() } = {}) {
  const page = readPage(rawPage);
  const words = readQuery(q);
  const hidden = await blockedWith(viewerId);
  const visible = [...visibleProfilesPipeline(now), ...(hidden.length ? [{ $match: { userId: { $nin: hidden } } }] : [])];
  const start = (page - 1) * PAGE_SIZE;
  const rows = words.length
    ? (await CommunityProfile.aggregate([...visible, { $limit: SEARCH_SCAN }])).filter(row => matchesQuery(row, words)).slice(start, start + PAGE_SIZE + 1)
    : await CommunityProfile.aggregate([...visible, { $skip: start }, { $limit: PAGE_SIZE + 1 }]);
  const shown = rows.slice(0, PAGE_SIZE);
  const results = await summarizeResults(shown.filter(row => row.showResults).map(row => row.userId), now);
  return {
    profiles: shown.map(row => presentProfile({ profile: row, user: row.user, runner: row.runner, results: results.get(String(row.userId)), canMessage: false })),
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
  const [results, canMessage] = await Promise.all([
    profile.showResults ? summarizeResults([profile.userId], now).then(map => map.get(String(profile.userId))) : undefined,
    messageable(viewerId, handle, profile, now),
  ]);
  return presentProfile({ profile, ...owner, results, canMessage });
}

/**
 * Người xem có gửi được lời mời nhắn tin cho chủ hồ sơ này không (nút "Nhắn tin", P13.3). Dùng đúng phép kiểm của API
 * lời mời: cổng của chính người xem (senderEligible) và inviteTarget (chủ hồ sơ đủ điều kiện nhận, không có Block), nên
 * nút và API không bao giờ lệch nhau. Chỉ trả true/false, không nói lý do (spec T9). Danh sách /community luôn trả false
 * để không tốn thêm lệnh cho mỗi thẻ.
 * @returns {Promise<boolean>}
 */
async function messageable(viewerId, handle, profile, now) {
  if (String(profile.userId) === String(viewerId)) return false;
  const [self, target] = await Promise.all([senderEligible(viewerId, { now }), inviteTarget(viewerId, { handle }, { now })]);
  return self.ok && target !== null;
}

module.exports = { MIN_AGE, canSeeProfile, presentProfile, getMine, saveMine, deleteMine, listProfiles, getProfile, visibleProfilesPipeline };
