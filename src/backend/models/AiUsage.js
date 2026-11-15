const mongoose = require('mongoose');

// Số lần app đã gọi AI trong một ngày, tính theo giờ Los Angeles vì lượt ngày của gói Free Gemini hồi lúc 0 giờ giờ
// Thái Bình Dương. Mỗi ngày đúng một dòng (unique `day`), nên giữ lượt bằng một lệnh cập nhật nguyên tử là đủ để
// không bao giờ vượt AI_DAILY_LIMIT. Không có trường nào về người hỏi.
const aiUsageSchema = new mongoose.Schema({
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  // Không đặt default: lần giữ lượt đầu tiên của ngày tạo dòng bằng $inc, nên count bắt đầu từ 1.
  count: { type: Number, min: 0 },
  // Thời điểm MongoDB tự xóa dòng (35 ngày sau khi tạo), đủ để xem lại lượt dùng của tháng trước.
  expiresAt: { type: Date, required: true },
});

aiUsageSchema.index({ day: 1 }, { unique: true });
aiUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.AiUsage || mongoose.model('AiUsage', aiUsageSchema);
