const crypto = require('crypto');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const EventCategory = require('../models/EventCategory');
const Registration = require('../models/Registration');
const RunPoints = require('../models/RunPoints');
const PaymentRequest = require('../models/PaymentRequest');
const transaction = require('../services/transaction');
const { expireBookings, completeBooking } = require('../services/bookingService');
const { assert } = require('../lib/errors');

async function createBookingHold(req, res, next) {
  try {
    const { eventId, categoryId, runnerInfo, addons = {}, paymentMethod = 'VIETQR', usePoints = false } = req.body;
    assert(eventId && categoryId && runnerInfo, 400, 'Event, category and runner information are required.');
    assert(['fullName', 'email', 'phone'].every(k => typeof runnerInfo[k] === 'string' && runnerInfo[k].trim()), 400, 'Name, email and phone are required.');
    assert(['VIETQR', 'WALLET'].includes(paymentMethod), 400, 'Unsupported payment method.');
    await expireBookings();
    const result = await transaction(async session => {
      const now = new Date();
      const event = await Event.findOne({ _id: eventId, status: 'REGISTRATION_OPEN', 'dateInfo.registrationStart': { $lte: now }, 'dateInfo.registrationEnd': { $gt: now } }).session(session);
      assert(event, 409, 'Registration is not open for this event.');
      const category = await EventCategory.findOneAndUpdate({
        _id: categoryId, eventId,
        $expr: { $lt: [{ $add: ['$quotaSold', '$quotaHold'] }, '$quotaTotal'] },
      }, { $inc: { quotaHold: 1 } }, { session, new: true });
      assert(category, 409, 'Category is unavailable or sold out.');
      if (category.rules?.minAge) {
        const birthday = new Date(runnerInfo.birthday);
        const race = new Date(event.dateInfo.raceDate);
        const age = race.getUTCFullYear() - birthday.getUTCFullYear() - (race.getUTCMonth() < birthday.getUTCMonth() || (race.getUTCMonth() === birthday.getUTCMonth() && race.getUTCDate() < birthday.getUTCDate()) ? 1 : 0);
        assert(Number.isFinite(birthday.getTime()) && age >= category.rules.minAge, 400, 'Runner does not meet the age requirement.');
      }
      const totalAmount = category.price + (addons.photoPackage === true ? 150000 : 0) + (addons.pastaParty === true ? 100000 : 0);
      assert(Number.isSafeInteger(totalAmount), 400, 'Invalid category price.');
      const points = usePoints === true ? await RunPoints.findOne({ userId: req.userId }).session(session) : null;
      const pointsDiscount = Math.min(Math.floor(totalAmount / 2000), Math.floor(points?.balance || 0)) * 1000;
      const [booking] = await Booking.create([{
        orderCode: 'RUN' + crypto.randomBytes(8).toString('hex').toUpperCase(),
        userId: req.userId, eventId, categoryId, runnerInfo,
        addons: { photoPackage: addons.photoPackage === true, pastaParty: addons.pastaParty === true },
        price: category.price, totalAmount, pointsDiscount, finalAmount: totalAmount - pointsDiscount,
        paymentMethod, status: 'HOLD', expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }], { session });
      const bankInfo = event.bankAccountInfo;
      const vietQrUrl = bankInfo?.accountNo ? 'https://img.vietqr.io/image/' + encodeURIComponent(bankInfo.bankName) + '-' + encodeURIComponent(bankInfo.accountNo) + '-compact2.png?amount=' + booking.finalAmount + '&addInfo=' + booking.orderCode + '&accountName=' + encodeURIComponent(bankInfo.accountName) : null;
      return { booking, bankInfo, vietQrUrl, holdSecondsRemaining: 600 };
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
}

async function confirmBooking(req, res, next) {
  try {
    await expireBookings();
    const { paymentMethod = 'VIETQR' } = req.body;
    assert(['VIETQR', 'WALLET'].includes(paymentMethod), 400, 'Unsupported payment method.');
    const result = await transaction(async session => {
      const booking = await Booking.findOne({ _id: req.params.bookingId, userId: req.userId }).session(session);
      assert(booking, 404, 'Booking not found.');
      if (booking.status === 'PAID' || paymentMethod === 'WALLET' || booking.finalAmount === 0) {
        return completeBooking(booking._id, req.userId, 'WALLET', session);
      }
      assert(booking.status === 'HOLD' && booking.expiresAt > new Date(), 409, 'Booking has expired.');
      const paymentRequest = await PaymentRequest.findOneAndUpdate({ requestKey: 'BOOKING-' + booking._id }, {
        $setOnInsert: { userId: req.userId, bookingId: booking._id, kind: 'BOOKING', amount: booking.finalAmount, status: 'PENDING' },
      }, { session, upsert: true, new: true });
      assert(paymentRequest.status !== 'REJECTED', 409, 'Payment was rejected. Contact the organizer.');
      return { pending: true, booking, paymentRequest, message: 'Đã gửi yêu cầu đối soát. Vé chỉ được cấp sau khi xác nhận tiền đã nhận.' };
    });
    res.status(result.pending ? 202 : 200).json(result);
  } catch (error) { next(error); }
}
async function listMyBookings(req, res, next) {
  try {
    await expireBookings();
    const bookings = await Booking.find({ userId: req.userId }).populate('eventId', 'name slug dateInfo location').populate('categoryId', 'name code distance price').sort({ createdAt: -1 }).limit(100).lean();
    res.json({ bookings });
  } catch (error) { next(error); }
}
async function getBookingById(req, res, next) {
  try {
    await expireBookings();
    const booking = await Booking.findOne({ _id: req.params.bookingId, userId: req.userId }).populate('eventId', 'name slug dateInfo location bankAccountInfo').populate('categoryId', 'name code distance price').lean();
    assert(booking, 404, 'Booking not found.');
    const registration = booking.status === 'PAID' ? await Registration.findOne({ 'payment.bookingId': booking._id, userId: req.userId }).lean() : null;
    res.json({ booking, registration, holdSecondsRemaining: Math.max(0, Math.floor((new Date(booking.expiresAt) - Date.now()) / 1000)) });
  } catch (error) { next(error); }
}
module.exports = { createBookingHold, confirmBooking, listMyBookings, getBookingById };

