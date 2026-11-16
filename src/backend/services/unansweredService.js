// Hàng chờ câu chưa trả lời (spec 4.6): ghi câu vào hàng chờ, và cho Super Admin xem, đánh dấu đã xử lý hay bỏ qua.
// Hàm ghi không bao giờ nhận thông tin người hỏi: responder chỉ đưa vào câu hỏi.
const mongoose = require('mongoose');
const UnansweredQuestion = require('../models/UnansweredQuestion');
const { normalizeSupportText, SUPPORT_MESSAGE_LIMIT } = require('./supportKnowledge');
const { loadPublishedArticles } = require('./supportKnowledgeStore');
const { sensitiveQuestion } = require('./supportFilters');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');
const { isArticleKey } = require('../../lib/supportArticleKey.cjs');

const UNANSWERED_OPEN_LIMIT = 500;
const UNANSWERED_SAMPLE_LIMIT = 300;
const UNANSWERED_TTL_SECONDS = 2592000;

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
  const keys = (Array.isArray(articleKeys) ? articleKeys : []).filter(isArticleKey).slice(0, 3);
  const now = new Date();

  // Phần cộng câu dùng chung cho bước 1 và bước 3, để luật trạng thái chỉ nằm ở một chỗ: câu RESOLVED mà vẫn bị hỏi
  // lại, tức bài đã làm chưa giải quyết được, thì mở lại thành OPEN; câu IGNORED giữ nguyên (spec T12); dòng mới là OPEN.
  const bump = {
    count: { $add: [{ $ifNull: ['$count', 0] }, 1] },
    lastAskedAt: now,
    status: { $cond: [{ $eq: ['$status', 'IGNORED'] }, 'IGNORED', 'OPEN'] },
    articleKeys: { $setUnion: [{ $ifNull: ['$articleKeys', []] }, { $literal: keys }] },
  };

  // Bước 1: câu đã có thì cộng 1 và cập nhật lần hỏi cuối, trong một lệnh duy nhất.
  const existing = await UnansweredQuestion.updateOne({ kind, normalized }, [{ $set: bump }]);
  if (existing.matchedCount) return 'counted';

  // Bước 2: câu mới. Loại câu này đã đủ 500 câu OPEN thì bỏ qua. Mỗi loại có giới hạn riêng: nút "Chưa đúng" cho
  // khách gửi, nên nếu dùng chung giới hạn, ai đó gửi đầy hàng chờ sẽ chặn luôn những câu bot thật sự chưa trả lời
  // được. Đây là giới hạn mềm: nhiều câu mới tới cùng lúc có thể làm vượt một chút.
  if (await UnansweredQuestion.countDocuments({ status: 'OPEN', kind }).maxTimeMS(1500) >= UNANSWERED_OPEN_LIMIT) return 'skipped';

  // Bước 3: upsert dạng pipeline với cùng phần cộng `bump`, thêm hai trường chỉ đặt khi tạo dòng mới. Nhờ vậy dòng vừa
  // xuất hiện giữa bước 1 và bước này (request khác vừa chèn, rồi admin có thể đã đánh dấu) cũng theo đúng luật trạng
  // thái. Truy vấn khớp đúng các trường của unique index, nên khi hai request cùng chèn, MongoDB tự thử lại request
  // thua thành một lần cộng: ba request đồng thời cho ra count = 3. Chuỗi đi qua $literal để câu bắt đầu bằng "$"
  // không bị hiểu là tên trường.
  const inserted = await UnansweredQuestion.updateOne({ kind, normalized }, [{ $set: {
    ...bump,
    sample: { $ifNull: ['$sample', { $literal: sampleOf(masked) }] },
    firstAskedAt: { $ifNull: ['$firstAskedAt', now] },
  } }], { upsert: true });
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
 * @param {{ from?: 'OPEN' }} [options] `from`: chỉ đổi khi câu đang ở trạng thái này; câu ở trạng thái khác coi như
 *   không tìm thấy (404). Tạo bài từ một câu dùng `from: 'OPEN'`, để không đổi câu admin khác vừa bấm "Bỏ qua".
 * @returns {Promise<object>} Câu sau khi đổi, cùng các trường như danh sách.
 */
async function setUnansweredStatus(id, status, { from } = {}) {
  if (!['RESOLVED', 'IGNORED'].includes(status)) throw httpError(400, 'Trạng thái hàng chờ không hợp lệ.', errorCodes.UNANSWERED_INVALID);
  // Điều kiện trạng thái nằm ngay trong lệnh cập nhật, nên hai admin thao tác cùng lúc cũng không ghi đè nhau.
  const question = mongoose.isObjectIdOrHexString(id)
    && await UnansweredQuestion.findOneAndUpdate({ _id: id, ...(from ? { status: from } : {}) }, { status }, { new: true }).select(QUEUE_FIELDS).lean();
  if (!question) throw httpError(404, 'Không tìm thấy câu hỏi trong hàng chờ.', errorCodes.UNANSWERED_NOT_FOUND);
  return question;
}

/**
 * Nút "Chưa đúng" (Task 6.5): khung chat gửi lại câu hỏi cùng key các bài đã dùng để trả lời. Server không lưu cuộc
 * trò chuyện, nên câu hỏi phải do khung chat gửi lại. Câu được ghi như câu chưa trả lời, với loại WRONG_ANSWER.
 * @param {{ question?: unknown, articleKeys?: unknown }} body Body của request.
 * @param {{ findArticles?: Function }} [deps] Nguồn bài đã xuất bản (mặc định đọc qua cache tri thức).
 * @returns {Promise<{ recorded: boolean }>} false khi câu bị bỏ qua (nhạy cảm, quá ngắn, hàng chờ đã đầy).
 */
async function recordFeedback({ question, articleKeys } = {}, { findArticles = loadPublishedArticles } = {}) {
  const invalid = message => httpError(400, message, errorCodes.FEEDBACK_INVALID);
  if (typeof question !== 'string' || !question.trim() || question.length > SUPPORT_MESSAGE_LIMIT) {
    throw invalid(`Câu hỏi phải có từ 1 đến ${SUPPORT_MESSAGE_LIMIT} ký tự.`);
  }
  // Một câu trả lời dùng tối đa 2 bài, nên báo "Chưa đúng" cũng chỉ nhắc tới 1–2 bài.
  if (!Array.isArray(articleKeys) || articleKeys.length < 1 || articleKeys.length > 2
    || !articleKeys.every(isArticleKey)) throw invalid('Danh sách bài được báo không hợp lệ.');
  // Chỉ nhận key của bài đang xuất bản: bot chỉ trả lời bằng những bài này, nên key khác là do request bị sửa tay.
  const published = new Set((await findArticles()).map(article => article.key));
  if (!articleKeys.every(key => published.has(key))) {
    throw httpError(400, 'Bài được báo không còn trên hệ thống. Hãy hỏi lại trợ lý.', errorCodes.FEEDBACK_UNKNOWN_ARTICLE);
  }
  const result = await recordUnanswered(question.trim(), { kind: 'WRONG_ANSWER', articleKeys: [...new Set(articleKeys)] });
  return { recorded: result !== 'skipped' };
}

module.exports = { UNANSWERED_OPEN_LIMIT, UNANSWERED_SAMPLE_LIMIT, UNANSWERED_TTL_SECONDS, maskDigits, recordUnanswered, listUnanswered, setUnansweredStatus, recordFeedback };
