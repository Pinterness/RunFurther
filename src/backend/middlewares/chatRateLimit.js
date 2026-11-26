// Giới hạn tốc độ cho mọi route /api/chat (phản biện 26-11): trang /messages hỏi tin mới 5 giây một lần, nên một
// script gọi liên tục có thể làm Atlas M0 chậm cho cả site. Đếm theo token (header Authorization), không theo IP, để
// người dùng chung một mạng không chặn lẫn nhau; request không có token thì đếm theo IP.
// Đứng TRƯỚC verifyUserToken, nên request đã bị chặn không tốn lệnh đọc users nào.
// Bộ đếm nằm trong RAM của một tiến trình: Render Free chỉ có một tiến trình, ngủ dậy thì đếm lại từ đầu, chấp nhận được
// vì đây là chặn lạm dụng chứ không phải giới hạn nghiệp vụ (giới hạn gửi tin vẫn đếm trong MongoDB, chatLimits).
const crypto = require('node:crypto');
const errorCodes = require('../lib/errorCodes');

// Một tab đang mở chat dùng khoảng 18 request mỗi phút (tin mới 12, danh sách 4, đánh dấu đọc, huy hiệu), nên 120 đủ cho
// vài tab cùng lúc mà vẫn chặn được script.
const DEFAULTS = { max: 120, windowMs: 60000 };

function createChatRateLimit({ max = DEFAULTS.max, windowMs = DEFAULTS.windowMs } = {}) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  }, windowMs);
  timer.unref();
  // Băm token để Map không giữ token gốc trong RAM.
  const keyOf = req => {
    const auth = req.headers.authorization;
    return auth ? 'u:' + crypto.createHash('sha256').update(auth).digest('base64url') : 'ip:' + req.ip;
  };
  return function chatRateLimit(req, res, next) {
    const key = keyOf(req), now = Date.now();
    let item = buckets.get(key);
    if (!item || item.until <= now) { item = { count: 0, until: now + windowMs }; buckets.set(key, item); }
    if (++item.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((item.until - now) / 1000))));
      return res.status(429).json({ message: 'Bạn thao tác hơi nhanh. Bạn chờ một chút rồi thử lại nhé.', code: errorCodes.CHAT_TOO_MANY_REQUESTS });
    }
    return next();
  };
}

module.exports = createChatRateLimit;
