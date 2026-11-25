// Cuộc trò chuyện 1–1 (spec 4.1). Bất biến chính: mỗi cặp người có tối đa một cuộc. pairKey là hai id sắp tăng dần nối
// bằng dấu hai chấm, và có index unique, nên hai lời mời đua nhau (A mời B và B mời A cùng lúc) chỉ tạo được một cuộc;
// lệnh thứ hai gặp lỗi trùng khóa E11000 ngay trong MongoDB.
// lastSeq là số thứ tự của tin cuối: mỗi tin mới tăng nó lên 1 trong cùng transaction tạo tin (spec 4.4).
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const LAST_TEXT_MAX = 120;

/**
 * Khóa của một cặp người, không phụ thuộc ai đứng trước.
 * @param {unknown} a Id người thứ nhất (ObjectId hoặc chuỗi).
 * @param {unknown} b Id người thứ hai.
 * @returns {string} "idNhỏ:idLớn".
 */
function pairKeyOf(a, b) {
  return [String(a), String(b)].sort().join(':');
}

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: value => value.length === 2 && String(value[0]) !== String(value[1]),
        message: 'Cuộc trò chuyện phải có đúng hai người khác nhau.',
      },
    },
    pairKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['REQUEST', 'ACTIVE', 'DECLINED'], required: true },
    requesterId: { type: ObjectId, ref: 'User', required: true },
    context: { type: { listingId: { type: ObjectId } }, default: undefined },
    lastSeq: { type: Number, required: true, min: 1 },
    lastMessage: {
      seq: { type: Number, required: true },
      senderId: { type: ObjectId, required: true },
      text: { type: String, required: true, maxlength: LAST_TEXT_MAX },
    },
    lastMessageAt: { type: Date, required: true },
    unreadBy: { type: [{ type: ObjectId }], default: [] },
  },
  { timestamps: true },
);

// Lưu participants theo thứ tự tăng dần và kiểm pairKey khớp đúng hai người đó, để không có cuộc nào mang khóa của cặp
// khác (khóa sai thì index unique không còn chặn được cuộc thứ hai).
conversationSchema.pre('validate', function sortParticipants() {
  if (!Array.isArray(this.participants) || this.participants.length !== 2) return;
  const sorted = [...this.participants].sort((x, y) => (String(x) < String(y) ? -1 : 1)); // cùng thứ tự với pairKeyOf
  if (String(sorted[0]) !== String(this.participants[0])) this.participants = sorted;
  if (this.pairKey !== pairKeyOf(sorted[0], sorted[1])) this.invalidate('pairKey', 'pairKey không khớp hai người tham gia.');
});

// Danh sách cuộc trò chuyện của một người, mới nhất trước.
conversationSchema.index({ participants: 1, lastMessageAt: -1 });
// Đếm số cuộc có tin chưa đọc (P13).
conversationSchema.index({ unreadBy: 1 });
// Đếm số lời mời một người đã gửi trong ngày (giới hạn 5 lời mời/ngày).
conversationSchema.index({ requesterId: 1, createdAt: -1 });
// Cuộc không có tin mới trong 12 tháng thì MongoDB tự xóa (spec D7). Mỗi tin làm mới lastMessageAt nên cuộc đang dùng
// không bị xóa.
conversationSchema.index({ lastMessageAt: 1 }, { expireAfterSeconds: YEAR_SECONDS });

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
module.exports.pairKeyOf = pairKeyOf;
module.exports.LAST_TEXT_MAX = LAST_TEXT_MAX;
