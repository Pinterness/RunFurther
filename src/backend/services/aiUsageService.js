// Đếm và giới hạn lượt gọi AI (spec 4.8 bước 6-7). Có hai lớp:
// - lượt của cả app trong ngày, lưu trong DB (`AiUsage`), không bao giờ vượt AI_DAILY_LIMIT;
// - lượt của từng tài khoản (30 câu mỗi ngày), đếm trong bộ nhớ và mất khi server khởi động lại.
const AiUsage = require('../models/AiUsage');

const AI_USAGE_RETENTION_DAYS = 35;
const ACCOUNT_DAILY_AI_ANSWERS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const pacificFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

// Ngày "YYYY-MM-DD" theo giờ Los Angeles, tự theo giờ mùa hè. Lượt ngày của Gemini hồi đúng lúc ngày này đổi,
// tức 14 giờ (mùa đông) hoặc 15 giờ (mùa hè) chiều giờ Việt Nam.
function pacificDay(now = new Date()) {
  return pacificFormat.format(now);
}

// Đọc AI_DAILY_LIMIT lúc gọi, để đổi biến trên Render là có hiệu lực sau khi khởi động lại. Chỉ nhận số nguyên
// không âm viết bằng chữ số; thiếu hay sai thì coi như 0, tức là không gọi AI.
function readDailyLimit(env = process.env) {
  const text = typeof env.AI_DAILY_LIMIT === 'string' ? env.AI_DAILY_LIMIT.trim() : '';
  if (!/^\d+$/.test(text)) return 0;
  const limit = Number(text);
  return Number.isSafeInteger(limit) ? limit : 0;
}

// Giữ một lượt trong ngày, trước khi gọi AI: lần gọi lỗi cũng bị tính, nhờ vậy không bao giờ vượt mức.
// Lệnh tìm-và-tăng chỉ khớp khi count còn dưới giới hạn. Khi đã đủ lượt, MongoDB định chèn dòng mới trùng `day`
// và báo lỗi E11000, tức là hết lượt. Nhưng lỗi này cũng xảy ra khi nhiều câu đầu ngày cùng định chèn dòng đầu
// tiên, nên gặp E11000 thì thử lại đúng một lần, không chèn: khớp được là còn lượt.
async function reserveAiCall({ limit, now = new Date() } = {}) {
  // Giới hạn 0 phải trả false trước khi chạy truy vấn: upsert với count < 0 vào ngày chưa có dòng vẫn chèn count = 1.
  if (!Number.isSafeInteger(limit) || limit <= 0) return false;
  const filter = { day: pacificDay(now), count: { $lt: limit } };
  try {
    await AiUsage.findOneAndUpdate(filter, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + AI_USAGE_RETENTION_DAYS * DAY_MS) } }, { upsert: true });
    return true;
  } catch (error) {
    if (error?.code !== 11000) { console.error('AI usage reserve failed:', error.message); return false; }
  }
  try {
    return Boolean(await AiUsage.findOneAndUpdate(filter, { $inc: { count: 1 } }));
  } catch (error) { console.error('AI usage reserve failed:', error.message); return false; }
}

// Số lượt đã giữ trong ngày Pacific hiện tại, cho đồng hồ hạn mức và trang admin.
async function todayUsage(now = new Date()) {
  const row = await AiUsage.findOne({ day: pacificDay(now) }).select('count').lean();
  return row?.count || 0;
}

// Giới hạn mỗi tài khoản `perDay` câu AI trong một ngày Pacific. Đếm trong bộ nhớ theo userId, không lưu DB
// (spec 4.12). Sang ngày mới thì xóa hết số đếm của ngày cũ, để Map không phình mãi.
function createAccountAllowance({ perDay = ACCOUNT_DAILY_AI_ANSWERS } = {}) {
  let currentDay = null;
  const used = new Map();
  const rollTo = now => {
    const day = pacificDay(now);
    if (day !== currentDay) { used.clear(); currentDay = day; }
  };
  // Các hàm dùng biến trong closure, không dùng `this`, nên tách hàm ra khỏi object vẫn chạy đúng.
  const canUse = (userId, now = new Date()) => { rollTo(now); return (used.get(String(userId)) || 0) < perDay; };
  const consume = (userId, now = new Date()) => { rollTo(now); const key = String(userId); used.set(key, (used.get(key) || 0) + 1); };
  return {
    canUse,
    consume,
    // Kiểm và trừ trong cùng một bước đồng bộ, không có await ở giữa, nên nhiều câu của cùng tài khoản tới cùng lúc
    // không cùng lọt qua bước kiểm (P09). Trả true khi đã trừ được một lượt.
    tryConsume(userId, now = new Date()) {
      if (!canUse(userId, now)) return false;
      consume(userId, now);
      return true;
    },
    // Trả lại một lượt đã trừ, khi cổng không giữ được lượt ngày. Chỉ trả trong cùng ngày Pacific: lượt của ngày cũ
    // đã bị xóa khi sang ngày mới, và refund không được làm xóa số đếm của ngày đang chạy.
    refund(userId, now = new Date()) {
      if (pacificDay(now) !== currentDay) return;
      const key = String(userId), count = used.get(key) || 0;
      if (count <= 1) used.delete(key); else used.set(key, count - 1);
    },
    size() { return used.size; },
  };
}

module.exports = { AI_USAGE_RETENTION_DAYS, ACCOUNT_DAILY_AI_ANSWERS, pacificDay, readDailyLimit, reserveAiCall, todayUsage, createAccountAllowance };
