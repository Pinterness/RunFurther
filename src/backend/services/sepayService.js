const Receipt = require('../models/SepayReceipt');
const Payment = require('../models/PaymentRequest');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const transaction = require('./transaction');
const { approveTopup } = require('./topupService');
const { completeBooking } = require('./bookingService');
const { assert } = require('../lib/errors');
const { readSepayConnections } = require('../config/sepay');

function requireMatch(condition, reason) {
  assert(condition, 409, 'Giao dịch cần được đối soát.', reason);
}

function checkOrder(receipt, order, bank, amount) {
  requireMatch(bank?.bankBin === receipt.bankBin && bank?.accountNo === (receipt.subAccount || receipt.accountNumber), 'BANK_SNAPSHOT_MISMATCH');
  requireMatch(amount === receipt.amount, 'AMOUNT_MISMATCH');
  // Bank timestamps have second precision; allow the creation second, never an earlier order.
  requireMatch(receipt.paidAt >= new Date(Math.floor(new Date(order.createdAt).getTime() / 1000) * 1000), 'PAYMENT_BEFORE_ORDER');
  requireMatch(order.expiresAt && receipt.paidAt <= order.expiresAt, 'PAYMENT_AFTER_EXPIRY');
}

async function applyReceipt(receipt, session) {
  if (receipt.transferType !== 'in') return { status: 'IGNORED', reason: 'OUTGOING' };
  requireMatch(receipt.transferCode, 'MISSING_OR_AMBIGUOUS_CODE');
  requireMatch(receipt.transferCode.startsWith(receipt.kind === 'TOPUP' ? 'NAP' : 'RUN'), 'WRONG_PAYMENT_FLOW');
  let payment;
  if (receipt.kind === 'TOPUP') {
    payment = await Payment.findOne({ kind: 'TOPUP', transferCode: receipt.transferCode }).session(session);
    requireMatch(payment, 'ORDER_NOT_FOUND');
    checkOrder(receipt, payment, payment.bankSnapshot, payment.amount);
  } else {
    const booking = await Booking.findOne({ orderCode: receipt.transferCode, eventId: receipt.eventId }).session(session);
    requireMatch(booking, 'ORDER_NOT_FOUND');
    checkOrder(receipt, booking, booking.bankSnapshot, booking.finalAmount);
    requireMatch(['HOLD', 'EXPIRED'].includes(booking.status), 'BOOKING_ALREADY_PAID_OR_CANCELLED');
    payment = await Payment.findOneAndUpdate({ requestKey: 'BOOKING-' + booking._id }, {
      $setOnInsert: { kind: 'BOOKING', userId: booking.userId, bookingId: booking._id, amount: booking.finalAmount, status: 'PENDING' },
    }, { upsert: true, new: true, session });
  }
  requireMatch(payment.status === 'PENDING', 'PAYMENT_ALREADY_REVIEWED');
  requireMatch(await User.exists({ _id: payment.userId, status: 'ACTIVE' }).session(session), 'USER_INACTIVE');
  requireMatch(!await Payment.exists({ bankReference: receipt.referenceCode, _id: { $ne: payment._id } }).session(session), 'BANK_REFERENCE_USED');
  if (receipt.kind === 'TOPUP') {
    const wallet = await Wallet.findOne({ userId: payment.userId }).session(session);
    requireMatch(!wallet || wallet.status === 'ACTIVE', 'WALLET_INACTIVE');
    // A verified provider is the reviewer, not the payer or an impersonated Super Admin.
    await approveTopup(payment, { reviewerId: null, receivedAmount: receipt.amount }, session);
  } else {
    await completeBooking(payment.bookingId, payment.userId, 'VIETQR', session, receipt.referenceCode, receipt.paidAt);
  }
  payment.status = 'APPROVED';
  payment.bankReference = receipt.referenceCode;
  payment.receivedAmount = receipt.amount;
  payment.confirmationSource = 'SEPAY';
  payment.sepayReceiptId = receipt._id;
  payment.reviewedAt = new Date();
  payment.reviewNote = 'SePay đã đối chiếu tài khoản nhận, mã thanh toán và số tiền.';
  await payment.save({ session });
  return { status: 'APPLIED', reason: 'MATCHED', paymentId: payment._id };
}

async function processReceipt(receiptId) {
  try {
    return await transaction(async session => {
      // Updating first serializes retries. All money, ticket, receipt and ledger writes commit together.
      const receipt = await Receipt.findOneAndUpdate({ _id: receiptId, status: 'RECEIVED' }, { $inc: { attempts: 1 } }, { new: true, session });
      if (!receipt) return Receipt.findById(receiptId).session(session);
      Object.assign(receipt, await applyReceipt(receipt, session), { processedAt: new Date() });
      await receipt.save({ session });
      return receipt;
    });
  } catch (error) {
    // Expected business failures roll back every financial write, then keep durable review evidence.
    if (![400, 403, 404, 409].includes(error.statusCode) && error.code !== 11000) throw error;
    const reason = error.code === 11000 ? 'BANK_REFERENCE_USED' :
      typeof error.code === 'string' ? error.code : 'ORDER_UNAVAILABLE';
    await Receipt.updateOne({ _id: receiptId, status: 'RECEIVED' }, {
      $set: { status: 'REVIEW', reason, processedAt: new Date() }, $inc: { attempts: 1 },
    });
    return Receipt.findById(receiptId);
  }
}

async function receiveTransaction(data) {
  let receipt;
  try { receipt = await Receipt.create(data); } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await Receipt.findOne({ connectionId: data.connectionId, providerId: data.providerId }).select('+fingerprint');
    assert(receipt && receipt.fingerprint === data.fingerprint, 409,
      'Transaction id was already received with different data.', 'SEPAY_TRANSACTION_CONFLICT');
  }
  return processReceipt(receipt._id);
}

async function resumePendingReceipts() {
  const connections = readSepayConnections().filter(item => item.enabled);
  if (!connections.length) return;
  const pending = await Receipt.find({ status: 'RECEIVED', connectionId: { $in: connections.map(item => item.id) } })
    .sort({ createdAt: 1 }).limit(25).lean();
  for (const receipt of pending) {
    const connection = connections.find(item => item.id === receipt.connectionId);
    if (connection.kind !== receipt.kind || connection.eventId !== (receipt.eventId ? String(receipt.eventId) : null) ||
      connection.bankBin !== receipt.bankBin || connection.accountNumber !== receipt.accountNumber || connection.subAccount !== receipt.subAccount) continue;
    await processReceipt(receipt._id);
  }
}

module.exports = { receiveTransaction, processReceipt, resumePendingReceipts };
