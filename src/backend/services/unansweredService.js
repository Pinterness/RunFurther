// Hàng chờ câu chưa trả lời (spec 4.6): ghi câu vào hàng chờ, và cho Super Admin xem, đánh dấu đã xử lý hay bỏ qua.
// Hàm ghi không bao giờ nhận thông tin người hỏi: responder chỉ đưa vào câu hỏi.
const mongoose = require('mongoose');
const UnansweredQuestion = require('../models/UnansweredQuestion');
const { normalizeSupportText } = require('./supportKnowledge');
const { sensitiveQuestion } = require('./supportFilters');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

const UNANSWERED_OPEN_LIMIT = 500;
const UNANSWERED_SAMPLE_LIMIT = 300;
const UNANSWERED_TTL_SECONDS = 2592000;
const ARTICLE_KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

// Mọi dãy từ 3 chữ số trở lên (năm sinh, số tiền, mã đơn, số tài khoản…) đổi thành "#". Dãy 1–2 chữ số như ngày
// "12/10" hay cự ly "21km" vẫn giữ, vì chúng giúp admin hiểu câu hỏi mà không nhận ra được ai.
const maskDigits = text => text.replace(/\d{3,}/g, '#');

// Câu còn dưới 2 chữ sau khi che số và chuẩn hóa thì không đáng lưu: "123456", "🙂🙂", "vé?", "12/10 5".
// Một "chữ" phải có ít nhất một chữ cái, nên câu chỉ toàn số cũng bị bỏ.
const tooShort = normalized => normalized.split(' ').filter(word => /[a-z]/.test(word)).length < 2;

// Câu mẫu để admin đọc: bỏ ký tự điều khiển, gộp khoảng trắng, cắt còn 300 ký tự. Nếu nhát cắt rơi vào giữa một
// emoji (cặp surrogate của UTF-16) thì bỏ nửa còn sót lại.
const sampleOf = masked => masked.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  .slice(0, UNANSWERED_SAMPLE_LIMIT).replace(/[\uD800-\uDBFF]$/, '');

/**
 * Ghi một câu vào hàng chờ.
 * @param {string} question Câu người dùng gõ.
 * @param {{ kind?: 'NO_ANSWER' | 'WRONG_ANSWER', articleKeys?: string[] }} [options] Loại câu và key các bài đã dùng (khi báo "Chưa đúng").
 * @returns {Promise<'created' | 'counted' | 'skipped'>} Tạo dòng mới, cộng vào dòng có sẵn, hoặc bỏ qua.
 */
async function recordUnanswered(question, { kind = 'NO_ANSWER', articleKeys = [] } = {}) {
  if (typeof question !== 'string' || sensitiveQuestion(question)) return 'skipped';
  const masked = maskDigits(question);
  const normalized = normalizeSupportText(masked);
  if (tooShort(normalized)) return 'skipped';
  const keys = (Array.isArray(articleKeys) ? articleKeys : []).filter(key => typeof key === 'string' && ARTICLE_KEY.test(key)).slice(0, 3);
  const now = new Date();

  // Bước 1: câu đã có thì cộng 1 và cập nhật lần hỏi cuối, trong một lệnh duy nhất. Câu RESOLVED mà vẫn bị hỏi lại,
  // tức bài đã làm chưa giải quyết được, thì mở lại thành OPEN; câu IGNORED giữ nguyên (spec T12).
  const existing = await UnansweredQuestion.updateOne({ kind, normalized }, [{ $set: {
    count: { $add: ['$count', 1] },
    lastAskedAt: now,
    status: { $cond: [{ $eq: ['$status', 'RESOLVED'] }, 'OPEN', '$status'] },
    articleKeys: { $setUnion: [{ $ifNull: ['$articleKeys', []] }, { $literal: keys }] },
  } }]);
  if (existing.matchedCount) return 'counted';

  // Bước 2: câu mới. Hàng chờ đã đủ 500 câu OPEN thì bỏ qua. Đây là giới hạn mềm: nhiều câu mới tới cùng lúc có
  // thể làm vượt một chút.
  if (await UnansweredQuestion.countDocuments({ status: 'OPEN' }).maxTimeMS(1500) >= UNANSWERED_OPEN_LIMIT) return 'skipped';

  // Upsert dùng $inc cho cả lúc tạo lẫn lúc cộng. Truy vấn khớp đúng các trường của unique index, nên khi hai request
  // cùng chèn, MongoDB tự thử lại request thua thành một lần cộng: ba request đồng thời cho ra count = 3.
  const inserted = await UnansweredQuestion.updateOne({ kind, normalized }, {
    $inc: { count: 1 },
    $set: { lastAskedAt: now },
    $setOnInsert: { sample: sampleOf(masked), firstAskedAt: now, status: 'OPEN' },
    $addToSet: { articleKeys: { $each: keys } },
  }, { upsert: true });
  return inserted.upsertedCount ? 'created' : 'counted';
}

// Những trường admin thấy. Không trả `normalized` (chỉ dùng để gộp câu trùng) và `__v`.
const QUEUE_FIELDS = 'kind sample count status articleKeys firstAskedAt lastAskedAt';
const QUEUE_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED'];

/**
 * Danh sách hàng chờ cho Super Admin: câu hỏi nhiều lần đứng trước, cùng số lần thì câu hỏi gần đây đứng trước.
 * @param {{ status?: 'OPEN' | 'RESOLVED' | 'IGNORED' }} [options] Trạng thái cần xem, mặc định OPEN.
 * @returns {Promise<object[]>} Tối đa 100 dòng.
 */
async function listUnanswered({ status = 'OPEN' } = {}) {
  // `status` đến từ query string, nên có thể là object như { $ne: 'OPEN' }. Chỉ nhận đúng ba giá trị.
  if (!QUEUE_STATUSES.includes(status)) throw httpError(400, 'Trạng thái hàng chờ không hợp lệ.', errorCodes.UNANSWERED_INVALID);
  return UnansweredQuestion.find({ status }).select(QUEUE_FIELDS)
    .sort({ count: -1, lastAskedAt: -1, _id: 1 }).limit(100).maxTimeMS(1500).lean();
}

/**
 * Đánh dấu một câu là đã xử lý (RESOLVED) hoặc bỏ qua (IGNORED).
 * @param {string} id Mã câu trong hàng chờ.
 * @param {'RESOLVED' | 'IGNORED'} status Trạng thái mới.
 * @returns {Promise<object>} Câu sau khi đổi, cùng các trường như danh sách.
 */
async function setUnansweredStatus(id, status) {
  if (!['RESOLVED', 'IGNORED'].includes(status)) throw httpError(400, 'Trạng thái hàng chờ không hợp lệ.', errorCodes.UNANSWERED_INVALID);
  const question = mongoose.isObjectIdOrHexString(id)
    && await UnansweredQuestion.findByIdAndUpdate(id, { status }, { new: true }).select(QUEUE_FIELDS).lean();
  if (!question) throw httpError(404, 'Không tìm thấy câu hỏi trong hàng chờ.', errorCodes.UNANSWERED_NOT_FOUND);
  return question;
}

module.exports = { UNANSWERED_OPEN_LIMIT, UNANSWERED_SAMPLE_LIMIT, UNANSWERED_TTL_SECONDS, maskDigits, recordUnanswered, listUnanswered, setUnansweredStatus };
