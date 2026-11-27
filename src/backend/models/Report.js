// Một báo cáo vi phạm trong chat (spec 4.1, D10, P15). Lưu bản chụp đúng tin bị báo cáo, để Super Admin xử lý được
// kể cả khi tin gốc đã tự xóa sau 12 tháng; ngoài bản chụp này, không ai trong nhóm đọc tin nhắn (spec D7, chat-v1).
// Index unique { người báo cáo, cuộc, seq } làm cho cùng một người báo cáo cùng một tin nhiều lần (kể cả song song)
// chỉ có một dòng. Báo cáo tự xóa 12 tháng sau khi tạo (TTL theo expiresAt).
const mongoose = require('mongoose');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const REASONS = ['SPAM', 'HARASSMENT', 'SCAM', 'OTHER'];
const NOTE_MAX = 500;

const reportSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    message: {
      seq: { type: Number, required: true, min: 1 },
      text: { type: String, required: true },
      sentAt: { type: Date, required: true },
    },
    reason: { type: String, enum: REASONS, required: true },
    note: { type: String, default: '', maxlength: NOTE_MAX },
    status: { type: String, enum: ['OPEN', 'DISMISSED', 'LOCKED'], default: 'OPEN' },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + YEAR_MS) },
  },
  { timestamps: true },
);

reportSchema.index({ reporterId: 1, conversationId: 1, 'message.seq': 1 }, { unique: true });
// Hàng chờ của Super Admin: theo trạng thái, mới nhất trước.
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
module.exports.REASONS = REASONS;
module.exports.NOTE_MAX = NOTE_MAX;
