// Công tắc realtime của chat (ADR realtime mục 3.8). Super Admin bật tắt trong /admin/messages, không cần người giữ
// tài khoản Render hay deploy lại. Chưa có tài liệu CHAT_REALTIME nghĩa là bật. Biến môi trường CHAT_REALTIME=off là
// công tắc tổng để tắt khẩn cấp và thắng DB. Tắt realtime không làm hỏng chat: client tự quay về polling.
// Mẫu giống aiSettingService.js (cache 30 giây, lịch sử 50 dòng), khác ở mặc định và ở chỗ báo cho lớp socket biết.
const PlatformSetting = require('../models/PlatformSetting');
const { assert } = require('../lib/errors');
const ERROR_CODES = require('../lib/errorCodes');

const SETTING_KEY = 'CHAT_REALTIME';
const CACHE_MS = 30_000;
const HISTORY_LIMIT = 50;
const HISTORY_SHOWN = 10;

// `generation` tăng mỗi lần xóa cache: một lần đọc bắt đầu trước khi admin lưu sẽ không ghi đè giá trị cũ vào cache.
let cache = null;
let generation = 0;
const listeners = new Set();

const forcedOff = env => String(env.CHAT_REALTIME ?? '').trim().toLowerCase() === 'off';

/**
 * Realtime có đang bật không. Công tắc tổng trong env tắt thì luôn false; đọc DB lỗi thì coi như tắt và không cache.
 * @param {{ now?: number, env?: object }} [options]
 * @returns {Promise<boolean>}
 */
async function isRealtimeOn({ now = Date.now(), env = process.env } = {}) {
  if (forcedOff(env)) return false;
  if (cache && cache.expiresAt > now) return cache.value;
  const started = generation;
  try {
    const setting = await PlatformSetting.findOne({ key: SETTING_KEY }).select('realtimeEnabled').lean();
    const value = setting?.realtimeEnabled !== false;
    if (started === generation) cache = { value, expiresAt: now + CACHE_MS };
    return value;
  } catch (error) {
    console.error('Chat realtime setting read failed:', error.message);
    return false;
  }
}

/**
 * Đăng ký nghe mỗi lần Super Admin đổi công tắc (lớp socket dùng để ngắt mọi kết nối khi tắt).
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void} Hàm hủy đăng ký.
 */
function onRealtimeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ghi công tắc và một dòng lịch sử (giữ 50 dòng mới nhất), xóa cache rồi báo người nghe.
 * @param {boolean} enabled
 * @param {string} actorId Super Admin bấm công tắc.
 * @returns {Promise<{ enabled: boolean, history: object[] }>}
 */
async function setRealtime(enabled, actorId) {
  assert(typeof enabled === 'boolean', 400, 'realtimeEnabled phải là true hoặc false.', ERROR_CODES.CHAT_SETTING_INVALID);
  const setting = await PlatformSetting.findOneAndUpdate(
    { key: SETTING_KEY },
    {
      $set: { realtimeEnabled: enabled, updatedBy: actorId },
      $push: { history: { $each: [{ realtimeEnabled: enabled, changedBy: actorId, changedAt: new Date() }], $slice: -HISTORY_LIMIT } },
    },
    // setDefaultsOnInsert: false để tài liệu này không mang các trường mặc định của tài khoản nhận nạp ví.
    { upsert: true, new: true, setDefaultsOnInsert: false, lean: true },
  );
  cache = null;
  generation += 1;
  for (const listener of listeners) {
    try { listener(enabled); } catch (error) { console.error('Chat realtime listener failed:', error.message); }
  }
  return { enabled, history: setting.history };
}

/**
 * Dữ liệu cho công tắc trong /admin/messages. Người đổi chỉ hiện họ tên, không email.
 * @param {{ env?: object }} [options]
 */
async function presentRealtimeSetting({ env = process.env } = {}) {
  const setting = await PlatformSetting.findOne({ key: SETTING_KEY }).populate('history.changedBy', 'fullName').lean();
  return {
    realtimeEnabled: setting?.realtimeEnabled !== false,
    forcedOff: forcedOff(env),
    history: (setting?.history ?? []).slice(-HISTORY_SHOWN).reverse().map(entry => ({
      realtimeEnabled: entry.realtimeEnabled !== false,
      changedBy: entry.changedBy ? { fullName: entry.changedBy.fullName } : null,
      changedAt: entry.changedAt,
    })),
  };
}

module.exports = { isRealtimeOn, setRealtime, onRealtimeChange, presentRealtimeSetting };
