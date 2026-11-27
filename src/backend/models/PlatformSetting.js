const mongoose = require('mongoose');

const bankAccountFields = () => ({
  bankBin: { type: String, default: '', trim: true },
  bankName: { type: String, default: '', trim: true },
  accountNo: { type: String, default: '', trim: true },
  accountName: { type: String, default: '', trim: true },
});

// One document per key. WALLET_TOPUP holds the account that receives wallet top-ups; every change is
// kept in `history` (newest last, capped by the writer) so a redirected account can be traced.
// SUPPORT_AI giữ công tắc AI của trợ lý (`aiEnabled`); chưa có tài liệu thì coi như tắt (spec T5).
// CHAT_REALTIME giữ công tắc realtime của chat (`realtimeEnabled`); chưa có tài liệu thì coi như bật (ADR realtime 3.8).
const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ['WALLET_TOPUP', 'SUPPORT_AI', 'CHAT_REALTIME'], required: true, unique: true },
    bankAccountInfo: bankAccountFields(),
    bankTransferEnabled: { type: Boolean, default: true },
    aiEnabled: Boolean,
    realtimeEnabled: Boolean,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: [
      {
        _id: false,
        bankAccountInfo: bankAccountFields(),
        bankTransferEnabled: Boolean,
        aiEnabled: Boolean,
        realtimeEnabled: Boolean,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', platformSettingSchema);
