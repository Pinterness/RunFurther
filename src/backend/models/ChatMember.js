// Tư cách nhắn tin của một người (spec 4.1, T1). Đồng ý nhắn tin là một mục đích riêng nên tách khỏi hồ sơ cộng đồng:
// rút đồng ý chỉ xóa consentAt, còn tài liệu và khóa nhắn tin (lockedAt, đặt ở P15) vẫn nằm đó. Nhờ vậy xóa hồ sơ hay
// rút đồng ý không phải là cách thoát khóa.
const mongoose = require('mongoose');

const chatMemberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    consentAt: { type: Date, default: null },
    consentVersion: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockReportId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.ChatMember || mongoose.model('ChatMember', chatMemberSchema);
