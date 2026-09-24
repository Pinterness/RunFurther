const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema(
  {
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      required: true,
      index: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['CREDIT', 'DEBIT'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceBefore: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    source: { type: String, trim: true, maxlength: 100 },
    destination: { type: String, trim: true, maxlength: 100 },
    referenceType: { type: String, trim: true, maxlength: 100 },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

ledgerSchema.index({ idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.Ledger || mongoose.model('Ledger', ledgerSchema);
