const crypto = require('crypto');
const Booking = require('../models/Booking');
const EventCategory = require('../models/EventCategory');
const Registration = require('../models/Registration');
const RunPoints = require('../models/RunPoints');
const { processPayment } = require('./walletService');
const transaction = require('./transaction');
const { assert } = require('../lib/errors');

async function expireBookings() {
  const expired = await Booking.find({ status: 'HOLD', expiresAt: { $lte: new Date() } }).select('_id').limit(500).lean();
  for (const item of expired) {
    await transaction(async (session) => {
      const booking = await Booking.findOneAndUpdate({ _id: item._id, status: 'HOLD', expiresAt: { $lte: new Date() } }, { $set: { status: 'EXPIRED' } }, { session, new: true });
      if (!booking) return;
      const category = await EventCategory.findOneAndUpdate({ _id: booking.categoryId, quotaHold: { $gte: 1 } }, { $inc: { quotaHold: -1 } }, { session });
      assert(category, 409, 'Inconsistent held quota; reconciliation required.');
    });
  }
}
async function completeBooking(bookingId, userId, method, session, bankReference) {
  const booking = await Booking.findOne({ _id: bookingId, userId }).session(session);
  assert(booking, 404, 'Booking not found.');
  if (booking.status === 'PAID') {
    const registration = await Registration.findOne({ 'payment.bookingId': booking._id }).session(session);
    assert(registration, 409, 'Paid booking needs reconciliation.');
    return { booking, registration, bibNumber: registration.bibNumber, pointsAwarded: 0 };
  }
  assert(booking.status === 'HOLD' && booking.expiresAt > new Date(), 409, 'Booking is no longer available.');
  assert(method === 'WALLET' || (method === 'VIETQR' && bankReference), 400, 'Verified payment is required.');
  let transactionId = bankReference || booking.orderCode;
  if (method === 'WALLET' && booking.finalAmount > 0) {
    const result = await processPayment(userId, booking.finalAmount, 'REGISTRATION', booking._id, 'BOOKING-' + booking._id, session);
    transactionId = String(result.ledger._id);
  }
  const points = booking.pointsDiscount / 1000;
  if (points > 0) {
    assert(Number.isInteger(points), 409, 'Invalid points discount.');
    const updated = await RunPoints.findOneAndUpdate({ userId, balance: { $gte: points } }, {
      $inc: { balance: -points }, $push: { history: { type: 'REDEEMED', amount: points, reason: 'Booking ' + booking.orderCode, referenceType: 'BOOKING', referenceId: booking._id } },
    }, { session });
    assert(updated, 409, 'Insufficient RunPoints. Create a new booking.');
  }
  const pointsAwarded = Math.floor(booking.finalAmount / 50000);
  await RunPoints.findOneAndUpdate({ userId }, {
    $inc: { balance: pointsAwarded, lifetimeEarned: pointsAwarded },
    $push: { history: { type: 'EARNED', amount: pointsAwarded, reason: 'Booking ' + booking.orderCode, referenceType: 'BOOKING', referenceId: booking._id } },
  }, { session, upsert: true });
  const category = await EventCategory.findOneAndUpdate({ _id: booking.categoryId, eventId: booking.eventId, quotaHold: { $gte: 1 } }, { $inc: { quotaHold: -1, quotaSold: 1 } }, { session, new: true });
  assert(category, 409, 'Inconsistent category quota.');
  const bibNumber = category.code.slice(0, 12) + '-' + booking._id.toString().slice(-16).toUpperCase();
  const [registration] = await Registration.create([{
    userId, eventId: booking.eventId, categoryId: booking.categoryId, bibNumber,
    qrToken: 'RF-' + crypto.randomBytes(24).toString('hex'), status: 'CONFIRMED',
    runnerProfile: booking.runnerInfo.toObject(),
    payment: { bookingId: booking._id, transactionId, paymentMethod: method, paidAmount: booking.finalAmount },
    logistics: { shirtSize: booking.runnerInfo.shirtSize },
  }], { session });
  booking.status = 'PAID';
  booking.paymentMethod = method;
  await booking.save({ session });
  return { booking, registration, bibNumber, pointsAwarded };
}
module.exports = { expireBookings, completeBooking };

