const PaymentRequest = require('../models/PaymentRequest');
const Booking = require('../models/Booking');
const transaction = require('../services/transaction');
const { completeBooking, expireBookings } = require('../services/bookingService');
const { changeBalance } = require('../services/walletService');
const { assert } = require('../lib/errors');

async function listPayments(req, res, next) {
  try {
    const filter = req.params.eventId ? { kind: 'BOOKING', bookingId: { $in: await Booking.distinct('_id', { eventId: req.params.eventId }) } } : req.baseUrl === '/api/admin' && req.currentUser?.systemRole === 'SUPER_ADMIN' ? { kind: 'TOPUP' } : { userId: req.userId };
    if (req.query.status) filter.status = req.query.status;
    res.json({ payments: await PaymentRequest.find(filter).populate('bookingId', 'orderCode bankSnapshot status expiresAt').sort({ createdAt: -1 }).limit(100).lean() });
  } catch (error) { next(error); }
}
async function reviewPayment(req, res, next) {
  try {
    const { status, bankReference, reviewNote } = req.body;
    assert(['APPROVED', 'REJECTED'].includes(status), 400, 'Invalid review status.');
    assert(status !== 'APPROVED' || (typeof bankReference === 'string' && bankReference.trim().length >= 3 && bankReference.length <= 200), 400, 'A unique bank transaction reference is required.');
    await expireBookings();
    const result = await transaction(async session => {
      const payment = await PaymentRequest.findById(req.params.paymentId).session(session);
      assert(payment, 404, 'Payment request not found.');
      if (req.params.eventId) {
        assert(payment.kind === 'BOOKING' && await Booking.exists({ _id: payment.bookingId, eventId: req.params.eventId }).session(session), 403, 'Yêu cầu không thuộc giải bạn quản lý.');
      } else assert(payment.kind === 'TOPUP' && req.currentUser?.systemRole === 'SUPER_ADMIN', 403, 'Super Admin chỉ được duyệt nạp ví, không duyệt tiền vé.');
      if (payment.status !== 'PENDING') {
        assert(payment.status === status, 409, 'Payment was already reviewed.');
        return { payment };
      }
      let completion;
      if (status === 'APPROVED') {
        if (payment.kind === 'BOOKING') {
          const booking = await Booking.findById(payment.bookingId).session(session);
          assert(booking && booking.status === 'HOLD' && booking.finalAmount === payment.amount, 409, 'Booking unavailable; reconcile or refund this transfer manually.');
          completion = await completeBooking(payment.bookingId, payment.userId, 'VIETQR', session, bankReference.trim());
        } else {
          await changeBalance({ userId: payment.userId, amount: payment.amount, type: 'CREDIT', referenceType: 'TOPUP', referenceId: payment._id, key: 'TOPUP-' + payment._id }, session);
        }
        payment.bankReference = bankReference.trim();
      }
      payment.status = status;
      payment.reviewedBy = req.userId;
      payment.reviewedAt = new Date();
      payment.reviewNote = reviewNote || '';
      await payment.save({ session });
      return { payment, ...completion };
    });
    res.json(result);
  } catch (error) { next(error); }
}
module.exports = { listPayments, reviewPayment };

