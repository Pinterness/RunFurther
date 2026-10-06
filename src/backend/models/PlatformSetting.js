const mongoose = require('mongoose');

const bankAccountFields = () => ({
  bankBin: { type: String, default: '', trim: true },
  bankName: { type: String, default: '', trim: true },
  accountNo: { type: String, default: '', trim: true },
  accountName: { type: String, default: '', trim: true },
});

// One document per key. WALLET_TOPUP holds the account that receives wallet top-ups; every change is
// kept in `history` (newest last, capped by the writer) so a redirected account can be traced.
const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ['WALLET_TOPUP'], required: true, unique: true },
    bankAccountInfo: bankAccountFields(),
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: [
      {
        _id: false,
        bankAccountInfo: bankAccountFields(),
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', platformSettingSchema);
