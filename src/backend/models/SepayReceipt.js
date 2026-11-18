const mongoose = require('mongoose');

// Retain only reconciliation evidence; never store the raw body, balances or sender bank details.
const schema = new mongoose.Schema({
  connectionId: { type: String, required: true },
  kind: { type: String, enum: ['TOPUP', 'BOOKING'], required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  providerId: { type: String, required: true },
  fingerprint: { type: String, required: true, select: false },
  bankBin: { type: String, required: true },
  accountNumber: { type: String, required: true },
  subAccount: { type: String, default: '' },
  referenceCode: { type: String, required: true },
  transferType: { type: String, enum: ['in', 'out'], required: true },
  amount: { type: Number, required: true },
  paidAt: { type: Date, required: true },
  transferCode: { type: String, default: '' },
  content: { type: String, maxlength: 2000 },
  status: { type: String, enum: ['RECEIVED', 'APPLIED', 'REVIEW', 'IGNORED'], default: 'RECEIVED' },
  reason: { type: String, default: '' },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentRequest' },
  attempts: { type: Number, default: 0 },
  processedAt: Date,
}, { timestamps: true });
schema.index({ connectionId: 1, providerId: 1 }, { unique: true });
schema.index({ bankBin: 1, accountNumber: 1, referenceCode: 1 }, {
  unique: true, partialFilterExpression: { status: 'APPLIED' },
});
schema.index({ kind: 1, eventId: 1, createdAt: -1 });
module.exports = mongoose.models.SepayReceipt || mongoose.model('SepayReceipt', schema);
