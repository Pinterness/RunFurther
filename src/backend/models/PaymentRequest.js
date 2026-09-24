const mongoose = require('mongoose');
const schema = new mongoose.Schema({
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
}, { timestamps: true });
schema.index({ bankReference: 1 }, { unique: true, partialFilterExpression: { bankReference: { $type: 'string' } } });
schema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.models.PaymentRequest || mongoose.model('PaymentRequest', schema);
