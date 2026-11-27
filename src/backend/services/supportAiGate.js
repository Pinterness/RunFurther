// Cổng AI (spec 4.8, T15): quyết định một câu hỏi chung có được gửi cho Gemini hay không. Bảy điều kiện, kiểm theo
// thứ tự "việc rẻ trước, giữ lượt sau cùng":
//   1. provider      server có SUPPORT_AI_PROVIDER=gemini, khóa và model;
//   2. sensitive     câu không chứa email, số điện thoại, mã riêng, tên tự giới thiệu hay thông tin sức khỏe;
//   3. guest         người hỏi đã đăng nhập (userId lấy từ token);
//   4. switch        Super Admin đang bật công tắc AI;
//   5. age           hồ sơ cho thấy đủ 18 tuổi (điều khoản Gemini cấm người dưới 18 tuổi);
//   6. account-limit tài khoản chưa quá 30 câu AI trong ngày Pacific;
//   7. daily-limit   giữ được một lượt trong AI_DAILY_LIMIT của cả app.
// Bước 1-3 không đọc DB nên chạy trước. Mọi lỗi đọc đều tính là không đạt, nên lỗi chỉ làm bot trả lời bằng guide.
const mongoose = require('mongoose');
const RunnerProfile = require('../models/RunnerProfile');
const { readAiConfig } = require('./supportAiConfig');
const { sensitiveQuestion } = require('./supportFilters');
const { isAiSwitchOn } = require('./aiSettingService');
const { readDailyLimit, reserveAiCall, createAccountAllowance } = require('./aiUsageService');
const { isAtLeastAge } = require('../lib/age');

const ADULT_AGE = 18;

// Chỉ đọc đúng trường dob của người hỏi; dob dùng để kiểm tuổi rồi bỏ, không bao giờ được gửi đi.
async function defaultFindDob(userId) {
  const profile = await RunnerProfile.findOne({ userId }).select('dob').maxTimeMS(1500).lean();
  return profile?.dob ?? null;
}

// dob trống, sai, ở tương lai hay không phải Date đều coi như chưa đủ tuổi. Tuổi tính theo lịch Việt Nam.
const isAdult = (dob, now) => isAtLeastAge(dob, ADULT_AGE, now);

const attempt = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

function createAiGate({
  env = process.env,
  isSwitchOn = isAiSwitchOn,
  findDob = defaultFindDob,
  reserve = ({ now }) => reserveAiCall({ limit: readDailyLimit(env), now }),
  allowance = createAccountAllowance(),
  now = () => new Date(),
} = {}) {
  const deny = reason => ({ allowed: false, reason });
  // Tham số thứ nhất chỉ là dữ liệu của câu hỏi (userId, câu hỏi). `claimSlot` (tùy chọn) là hàm responder đưa vào để
  // giữ một trong 4 chỗ gọi AI của adapter; cổng gọi nó sau các bước đọc DB, ngay trước bước trừ lượt, nên câu đang
  // chờ đọc công tắc hay ngày sinh không chiếm chỗ của câu khác, và câu hết chỗ không bị trừ lượt nào (P09).
  return async function canUseAi({ userId, question }, { claimSlot = null } = {}) {
    if (!readAiConfig(env)) return deny('provider');
    if (sensitiveQuestion(question)) return deny('sensitive');
    if (!userId || !mongoose.isValidObjectId(userId)) return deny('guest');
    if (!(await attempt(isSwitchOn, false))) return deny('switch');
    const at = now();
    if (!isAdult(await attempt(() => findDob(userId), null), at)) return deny('age');
    if (claimSlot && !claimSlot()) return deny('busy');
    // Trừ lượt của tài khoản ngay lúc kiểm (không có await ở giữa), để nhiều câu tới cùng lúc không cùng lọt qua.
    // Không giữ được lượt ngày thì trả lại, nên lượt của tài khoản chỉ bị tính khi đã giữ được lượt ngày.
    if (!allowance.tryConsume(userId, at)) return deny('account-limit');
    if (!(await attempt(() => reserve({ now: at }), false))) { allowance.refund(userId, at); return deny('daily-limit'); }
    return { allowed: true, reason: null };
  };
}

module.exports = { ADULT_AGE, createAiGate, defaultFindDob };
