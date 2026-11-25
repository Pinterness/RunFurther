// Một lần chặn: blockerId chặn blockedId (spec 4.1). Chặn có tác dụng hai chiều (cả hai không nhắn được cho nhau), nên
// khi kiểm, service tìm bằng $or hai nhánh { blockerId: a, blockedId: b } và { blockerId: b, blockedId: a }; cả hai
// nhánh đều so bằng trên đủ hai trường của index unique bên dưới, nên không phải quét collection.
const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  blockerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blockedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, required: true, default: Date.now },
});

blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// Tìm "ai đã chặn tôi" (danh sách /community ẩn họ): blockedId đứng thứ hai trong index trên nên không dùng được nó.
blockSchema.index({ blockedId: 1 });

module.exports = mongoose.models.Block || mongoose.model('Block', blockSchema);
