// Một tin nhắn (spec 4.1). Hai bất biến được MongoDB tự giữ bằng index unique:
//   - { conversationId, seq }: trong một cuộc, mỗi số thứ tự chỉ có một tin, nên client lấy bù theo seq không bị trùng;
//   - { senderId, clientMessageId }: client tự sinh mã UUID cho mỗi tin, gửi lại (mất mạng, bấm đúp) cùng mã thì server
//     nhận ra đó là tin cũ thay vì tạo tin thứ hai.
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const TEXT_MAX = 1000;

const messageSchema = new mongoose.Schema({
  conversationId: { type: ObjectId, ref: 'Conversation', required: true },
  seq: { type: Number, required: true, min: 1 },
  senderId: { type: ObjectId, ref: 'User', required: true },
  clientMessageId: { type: String, required: true, maxlength: 64 },
  // trim chạy trước required, nên tin toàn khoảng trắng thành chuỗi rỗng và bị từ chối.
  text: { type: String, required: true, trim: true, maxlength: TEXT_MAX },
  // Không dùng timestamps vì service cần đặt createdAt theo `now` được tiêm vào (test ranh giới ngày giờ Việt Nam).
  createdAt: { type: Date, required: true, default: Date.now },
});

messageSchema.index({ conversationId: 1, seq: 1 }, { unique: true });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
// Đếm số tin một người đã gửi trong 60 giây và trong ngày (giới hạn 20 tin/phút, 500 tin/ngày).
messageSchema.index({ senderId: 1, createdAt: -1 });
// Mỗi tin tự xóa 12 tháng sau khi gửi (spec D7).
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: YEAR_SECONDS });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

module.exports = Message;
module.exports.TEXT_MAX = TEXT_MAX;
