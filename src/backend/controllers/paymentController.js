const PaymentRequest = require('../models/PaymentRequest');
const Booking = require('../models/Booking');
const transaction = require('../services/transaction');
const { completeBooking, expireBookings } = require('../services/bookingService');
const { approveTopup, isExpired, presentTopup } = require('../services/topupService');
const ERROR_CODES = require('../lib/errorCodes');
const { assert } = require('../lib/errors');

const PAYMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const REVIEW_STATUSES = ['APPROVED', 'REJECTED'];
const BANK_REFERENCE_LENGTH = { min: 3, max: 200 };
const LIST_LIMIT = 100;
const SEARCH_MAX_LENGTH = 40;

// Who is asking decides what the list contains: an event owner sees ticket payments of that event,
// the Super Admin sees every top-up, anyone else sees only their own requests.
function listScopeOf(req) {
  if (req.params.eventId) {
    return 'event';
  }
  const isPlatformAdmin =
    req.baseUrl === '/api/admin' && req.currentUser?.systemRole === 'SUPER_ADMIN';
  return isPlatformAdmin ? 'admin' : 'owner';
}

function parseListQuery({ status, q }) {
  assert(
    status === undefined || PAYMENT_STATUSES.includes(status),
    400,
    'Bộ lọc trạng thái không hợp lệ.',
    ERROR_CODES.INVALID_QUERY,
  );
  assert(
    q === undefined || typeof q === 'string',
    400,
    'Từ khóa tìm kiếm không hợp lệ.',
    ERROR_CODES.INVALID_QUERY,
  );
  // Bank statements print memos lowercased, spaced or hyphenated ("nap k7m2-q9xa"): match the bare code.
  const code = (q ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, SEARCH_MAX_LENGTH);
  return { status, code };
}

async function baseFilterFor(scope, req) {
  if (scope === 'event') {
    const bookingIds = await Booking.distinct('_id', { eventId: req.params.eventId });
    return { kind: 'BOOKING', bookingId: { $in: bookingIds } };
  }
  return scope === 'admin' ? { kind: 'TOPUP' } : { userId: req.userId };
}

function presentPayment(payment, scope, now) {
  if (payment.kind !== 'TOPUP') {
    return payment;
  }
  if (scope === 'admin') {
    return { ...payment, expired: isExpired(payment, now) };
  }
  return { ...payment, transfer: presentTopup(payment, now) };
}

async function listPayments(req, res, next) {
  try {
    const scope = listScopeOf(req);
    const { status, code } = parseListQuery(req.query);
    const filter = await baseFilterFor(scope, req);
    if (status) {
      filter.status = status;
    }
    if (scope === 'admin' && code) {
      filter.transferCode = { $regex: code };
    }
    let query = PaymentRequest.find(filter).populate(
      'bookingId',
      'orderCode bankSnapshot status expiresAt',
    );
    if (scope === 'admin') {
      query = query.populate('userId', 'fullName email');
    }
    const payments = await query.sort({ createdAt: -1 }).limit(LIST_LIMIT).lean();
    const now = new Date();
    res.json({ payments: payments.map((payment) => presentPayment(payment, scope, now)) });
  } catch (error) {
    next(error);
  }
}

function parseReview({ status, bankReference, reviewNote, receivedAmount }) {
  assert(REVIEW_STATUSES.includes(status), 400, 'Invalid review status.');
  const reference = typeof bankReference === 'string' ? bankReference.trim() : '';
  assert(
    status !== 'APPROVED' ||
      (reference.length >= BANK_REFERENCE_LENGTH.min &&
        bankReference.length <= BANK_REFERENCE_LENGTH.max),
    400,
    'A unique bank transaction reference is required.',
  );
  return { status, bankReference: reference, reviewNote: reviewNote || '', receivedAmount };
}

// Event owners review ticket payments of their own event; the Super Admin reviews only top-ups.
async function assertReviewScope(payment, { eventId, reviewerRole }, session) {
  if (eventId) {
    const inEvent =
      payment.kind === 'BOOKING' &&
      (await Booking.exists({ _id: payment.bookingId, eventId }).session(session));
    assert(inEvent, 403, 'Yêu cầu không thuộc giải bạn quản lý.');
    return;
  }
  assert(
    payment.kind === 'TOPUP' && reviewerRole === 'SUPER_ADMIN',
    403,
    'Super Admin chỉ được duyệt nạp ví, không duyệt tiền vé.',
  );
}

async function approveBookingPayment(payment, { bankReference }, session) {
  const booking = await Booking.findById(payment.bookingId).session(session);
  assert(
    booking && booking.status === 'HOLD' && booking.finalAmount === payment.amount,
    409,
    'Booking unavailable; reconcile or refund this transfer manually.',
  );
  return completeBooking(payment.bookingId, payment.userId, 'VIETQR', session, bankReference);
}

// One approver per payment kind (Strategy): a new kind adds an entry instead of another branch.
const APPROVERS = {
  BOOKING: approveBookingPayment,
  TOPUP: approveTopup,
};

async function applyReview({ paymentId, eventId, reviewer, review }, session) {
  const payment = await PaymentRequest.findById(paymentId).session(session);
  assert(payment, 404, 'Payment request not found.');
  await assertReviewScope(payment, { eventId, reviewerRole: reviewer.role }, session);
  if (payment.status !== 'PENDING') {
    assert(payment.status === review.status, 409, 'Payment was already reviewed.');
    return { payment };
  }
  let completion = {};
  if (review.status === 'APPROVED') {
    const approve = APPROVERS[payment.kind];
    completion = await approve(payment, { ...review, reviewerId: reviewer.id }, session);
    payment.bankReference = review.bankReference;
  }
  Object.assign(payment, {
    status: review.status,
    reviewedBy: reviewer.id,
    reviewedAt: new Date(),
    reviewNote: review.reviewNote,
  });
  await payment.save({ session });
  return { payment, ...completion };
}

async function reviewPayment(req, res, next) {
  try {
    const review = parseReview(req.body);
    await expireBookings();
    const reviewer = { id: req.userId, role: req.currentUser?.systemRole };
    const { paymentId, eventId } = req.params;
    const result = await transaction((session) =>
      applyReview({ paymentId, eventId, reviewer, review }, session),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { listPayments, reviewPayment };
