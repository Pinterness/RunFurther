const mongoose = require('mongoose');

const bankSnapshotSchema = new mongoose.Schema(
  { bankBin: String, bankName: String, accountNo: String, accountName: String },
  { _id: false },
);

const paymentRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    kind: { type: String, enum: ['BOOKING', 'TOPUP'], required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    requestKey: { type: String, required: true, unique: true },
    bankReference: { type: String, trim: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, maxlength: 1000 },
    // TOPUP only. The payer writes transferCode in the bank transfer memo; bankSnapshot freezes the
    // receiving account at creation so a later settings change never redirects an open request.
    transferCode: { type: String, trim: true, uppercase: true },
    bankSnapshot: { type: bankSnapshotSchema, default: null, immutable: true },
    expiresAt: Date,
    receivedAmount: { type: Number, min: 1 },
  },
  { timestamps: true },
);

const uniqueWhenSet = (field) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: 'string' } },
});

paymentRequestSchema.index({ bankReference: 1 }, uniqueWhenSet('bankReference'));
paymentRequestSchema.index({ transferCode: 1 }, uniqueWhenSet('transferCode'));
paymentRequestSchema.index({ userId: 1, createdAt: -1 });
paymentRequestSchema.index({ kind: 1, status: 1, createdAt: -1 });

module.exports =
  mongoose.models.PaymentRequest || mongoose.model('PaymentRequest', paymentRequestSchema);
