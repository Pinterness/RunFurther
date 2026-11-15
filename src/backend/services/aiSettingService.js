// Công tắc AI của trợ lý (spec 4.8, D6c). Biến môi trường SUPPORT_AI_PROVIDER là công tắc tổng do người giữ Render
// đặt; công tắc này cho Super Admin bật tắt AI ngay trên trang admin. Chưa có tài liệu SUPPORT_AI thì coi như tắt (T5),
// nên chỉ nhập khóa trên Render vẫn chưa đủ để AI chạy.
const PlatformSetting = require('../models/PlatformSetting');
const { readAiConfig } = require('./supportAiConfig');
const { pacificDay, readDailyLimit, todayUsage } = require('./aiUsageService');
const { assert } = require('../lib/errors');
const ERROR_CODES = require('../lib/errorCodes');

const SETTING_KEY = 'SUPPORT_AI';
const CACHE_MS = 30_000;
const HISTORY_LIMIT = 50;
const HISTORY_SHOWN = 10;

// `generation` tăng mỗi lần xóa cache. Một lần đọc bắt đầu trước khi admin lưu sẽ không được ghi đè kết quả cũ vào
// cache, nhờ vậy bấm "Tắt AI" là có hiệu lực ngay ở câu hỏi tiếp theo.
let cache = null;
let generation = 0;

function clearAiSettingCache() {
  cache = null;
  generation += 1;
}

async function isAiSwitchOn({ now = Date.now() } = {}) {
  if (cache && cache.expiresAt > now) return cache.value;
  const started = generation;
  try {
    const setting = await PlatformSetting.findOne({ key: SETTING_KEY }).select('aiEnabled').lean();
    const value = setting?.aiEnabled === true;
    if (started === generation) cache = { value, expiresAt: now + CACHE_MS };
    return value;
  } catch (error) {
    // Đọc lỗi thì coi như tắt và không lưu vào cache, để lần sau đọc lại.
    console.error('Support AI setting read failed:', error.message);
    return false;
  }
}

// Ghi công tắc và một dòng lịch sử (giữ 50 dòng mới nhất), rồi xóa cache. `setDefaultsOnInsert: false` để tài liệu
// SUPPORT_AI không mang các trường mặc định của tài khoản nhận nạp ví.
async function setAiEnabled(enabled, actorId) {
  assert(typeof enabled === 'boolean', 400, 'aiEnabled phải là true hoặc false.', ERROR_CODES.AI_SETTING_INVALID);
  const changedAt = new Date();
  await PlatformSetting.findOneAndUpdate(
    { key: SETTING_KEY },
    { $set: { aiEnabled: enabled, updatedBy: actorId }, $push: { history: { $each: [{ aiEnabled: enabled, changedBy: actorId, changedAt }], $slice: -HISTORY_LIMIT } } },
    { upsert: true, setDefaultsOnInsert: false },
  );
  clearAiSettingCache();
}

const toPerson = user => (user ? { fullName: user.fullName, email: user.email } : null);

// Dữ liệu cho mục "Trợ lý AI" trong trang admin. Chỉ cho biết đã có khóa hay chưa (`configured`), không bao giờ trả khóa.
async function presentAiSetting({ env = process.env, now = new Date() } = {}) {
  const [setting, used] = await Promise.all([
    PlatformSetting.findOne({ key: SETTING_KEY }).populate('history.changedBy', 'fullName email').lean(),
    todayUsage(now),
  ]);
  const provider = typeof env.SUPPORT_AI_PROVIDER === 'string' && env.SUPPORT_AI_PROVIDER.trim() ? env.SUPPORT_AI_PROVIDER.trim() : 'guide';
  return {
    aiEnabled: setting?.aiEnabled === true,
    provider,
    model: typeof env.SUPPORT_AI_MODEL === 'string' ? env.SUPPORT_AI_MODEL.trim() : '',
    configured: Boolean(readAiConfig(env)),
    today: { day: pacificDay(now), used, limit: readDailyLimit(env) },
    history: (setting?.history ?? []).slice(-HISTORY_SHOWN).reverse().map(entry => ({
      aiEnabled: entry.aiEnabled === true, changedBy: toPerson(entry.changedBy), changedAt: entry.changedAt,
    })),
  };
}

module.exports = { isAiSwitchOn, setAiEnabled, presentAiSetting, clearAiSettingCache };
