// Hồ sơ cộng đồng (spec D1, D2, 4.1): chỉ tồn tại khi người dùng tự bật và đã đồng ý. Tắt hồ sơ là xóa hẳn tài liệu,
// nên handle của hồ sơ đã xóa có thể được cấp lại cho người khác (T15). Không thêm trường nào vào User.
const mongoose = require('mongoose');

// 3–30 ký tự: chữ thường không dấu, số và dấu gạch; không bắt đầu hay kết thúc bằng dấu gạch.
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

const communityProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: HANDLE_PATTERN,
      validate: { validator: value => !value.includes('--'), message: 'Handle không được có hai dấu gạch liền nhau.' },
    },
    bio: { type: String, trim: true, maxlength: 160, default: '' },
    showClub: { type: Boolean, default: false },
    showResults: { type: Boolean, default: false },
    consentAt: { type: Date, required: true },
    consentVersion: { type: String, required: true },
  },
  { timestamps: true },
);

// Danh sách /community lấy hồ sơ mới nhất trước; _id phá hòa khi hai hồ sơ cùng mili giây. Index phải có đủ hai trường
// thì MongoDB mới sắp bằng index, không phải quét và sắp cả collection.
communityProfileSchema.index({ createdAt: -1, _id: -1 });

const CommunityProfile = mongoose.models.CommunityProfile || mongoose.model('CommunityProfile', communityProfileSchema);

module.exports = CommunityProfile;
module.exports.HANDLE_PATTERN = HANDLE_PATTERN;
