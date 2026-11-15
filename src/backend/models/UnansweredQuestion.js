const mongoose = require('mongoose');

// Một câu trong hàng chờ của admin: câu bot chưa trả lời được (NO_ANSWER), hoặc câu người dùng báo "Chưa đúng"
// (WRONG_ANSWER, kèm key các bài đã dùng). Không có trường nào về người hỏi: không userId, không IP, không trang
// đang mở. Các câu chỉ khác chữ hoa, dấu hay dãy số được gộp vào một dòng nhờ `normalized`, và `count` đếm số lần hỏi.
const unansweredQuestionSchema = new mongoose.Schema({
  kind: { type: String, enum: ['NO_ANSWER', 'WRONG_ANSWER'], required: true },
  // Câu đã che số rồi chuẩn hóa (chữ thường, bỏ dấu). Cùng với `kind`, đây là khóa để gộp câu trùng.
  normalized: { type: String, required: true },
  // Một câu gốc đã che số, tối đa 300 ký tự, để admin đọc.
  sample: { type: String, required: true, maxlength: 300 },
  count: { type: Number, min: 1 },
  articleKeys: { type: [String], default: undefined },
  status: { type: String, enum: ['OPEN', 'RESOLVED', 'IGNORED'], default: 'OPEN' },
  firstAskedAt: { type: Date, required: true },
  lastAskedAt: { type: Date, required: true },
});

// Unique index: hai request cùng lúc với cùng một câu chỉ tạo được một dòng.
unansweredQuestionSchema.index({ kind: 1, normalized: 1 }, { unique: true });
// TTL index: MongoDB tự xóa dòng 30 ngày sau lần hỏi cuối. Câu cứ có người hỏi lại thì không bị xóa.
unansweredQuestionSchema.index({ lastAskedAt: 1 }, { expireAfterSeconds: 2592000 });
// Phục vụ việc đếm câu OPEN và danh sách hàng chờ của admin.
unansweredQuestionSchema.index({ status: 1, count: -1, lastAskedAt: -1 });

module.exports = mongoose.models.UnansweredQuestion || mongoose.model('UnansweredQuestion', unansweredQuestionSchema);
