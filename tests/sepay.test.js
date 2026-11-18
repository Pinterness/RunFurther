const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
process.env.JWT_SECRET = 'isolated-sepay-test-secret';
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';
process.env.SEPAY_CONNECTIONS = '[]';
const { app } = require('../src/backend/server');
const { createBackendHarness } = require('./helpers/backendHarness');
const { ACCOUNT, OTHER_ACCOUNT, createTopupHelpers } = require('./helpers/topupFixtures');
const Receipt = require('../src/backend/models/SepayReceipt');
const Payment = require('../src/backend/models/PaymentRequest');
const Booking = require('../src/backend/models/Booking');
const Event = require('../src/backend/models/Event');
const Category = require('../src/backend/models/EventCategory');
const EventAccount = require('../src/backend/models/EventAccount');
const Wallet = require('../src/backend/models/Wallet');
const Ledger = require('../src/backend/models/Ledger');
const Registration = require('../src/backend/models/Registration');
const Setting = require('../src/backend/models/PlatformSetting');
const { expireBookings } = require('../src/backend/services/bookingService');
const { readSepayConnections } = require('../src/backend/config/sepay');
const { verifySignature, parsePaidAt, paymentCode } = require('../src/backend/services/sepayPayload');
const harness = createBackendHarness({ app, dbName: 'runfurther_sepay_only_test' });
const { request, createUser } = harness;
const { configureAccount, openTopup, balanceOf } = createTopupHelpers(harness);
const SECRET = 'a'.repeat(64), EVENT_SECRET = 'b'.repeat(64);
const PLATFORM = { id: 'platform', kind: 'TOPUP', bankBin: ACCOUNT.bankBin, accountNumber: ACCOUNT.accountNo, secret: SECRET };
let admin, payer, sequence = 0;
before(harness.start);
after(harness.stop);
beforeEach(async () => {
  // All models are attached to the in-memory replica set started above, never the .env database.
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
  process.env.SEPAY_CONNECTIONS = JSON.stringify([PLATFORM]);
  admin = await createUser({ role: 'SUPER_ADMIN' }); payer = await createUser();
  await configureAccount(admin);
});
function bankTime(date = new Date()) { return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' '); }
function payload(code, overrides = {}) {
  const id = ++sequence;
  return { id, gateway: 'MBBank', accountNumber: ACCOUNT.accountNo, subAccount: '', transferType: 'in',
    transferAmount: 50000, transactionDate: bankTime(), referenceCode: 'FT-SEPAY-' + id,
    content: code + ' chuyen tien', code, ...overrides };
}
function signed(body, secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000))) {
  return { 'X-SePay-Timestamp': timestamp, 'X-SePay-Signature': 'sha256=' +
    crypto.createHmac('sha256', secret).update(timestamp + '.' + JSON.stringify(body)).digest('hex') };
}
function send(body, connection = 'platform', secret = SECRET, extraHeaders = {}) {
  return request('/payments/webhooks/sepay/' + connection, { method: 'POST', body, headers: { ...signed(body, secret), ...extraHeaders } });
}
async function topup(amount = 50000) {
  const r = await openTopup(payer, amount, 'sepay-test-' + (++sequence));
  assert.equal(r.status, 202, JSON.stringify(r.body)); return r.body.paymentRequest;
}
async function eventFixture({ account = ACCOUNT, quota = 2 } = {}) {
  const owner = await createUser();
  const event = await Event.create({ name: 'SePay race', slug: 'sepay-race-' + (++sequence), createdBy: owner.id,
    status: 'REGISTRATION_OPEN', dateInfo: { registrationStart: new Date(Date.now() - 86400000),
      registrationEnd: new Date(Date.now() + 86400000), raceDate: new Date(Date.now() + 172800000) },
    location: { city: 'Hue', venue: 'Park' }, bankAccountInfo: account });
  const category = await Category.create({ eventId: event._id, code: '5K', name: '5 km', distance: 5, price: 50000, quotaTotal: quota });
  await EventAccount.create({ eventId: event._id, userId: owner.id, employeeName: 'Owner', accountType: 'EVENT_ADMIN',
    loginCode: 'SEPAYOWNER' + (++sequence), createdBy: owner.id });
  const connection = { id: 'race-' + sequence, kind: 'BOOKING', eventId: String(event._id), bankBin: account.bankBin,
    accountNumber: account.accountNo, secret: EVENT_SECRET + sequence };
  const config = JSON.parse(process.env.SEPAY_CONNECTIONS); config.push(connection); process.env.SEPAY_CONNECTIONS = JSON.stringify(config);
  const r = await request('/bookings/hold', { method: 'POST', as: payer, body: { eventId: String(event._id), categoryId: String(category._id),
    runnerInfo: { fullName: 'Runner', email: 'runner@test.local', phone: '0900011223', birthday: '1995-04-12', nationality: 'Việt Nam' } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.automaticConfirmation, true);
  return { owner, event, category, connection, booking: r.body.booking };
}
function raceSend(f, changes = {}) {
  return send(payload(f.booking.orderCode, changes), f.connection.id, f.connection.secret);
}

test('configuration is disabled by default, validates scope and rejects reused secrets without leaking them', () => {
  assert.deepEqual(readSepayConnections({}), []);
  for (const value of ['{', '{}', JSON.stringify([{ ...PLATFORM, eventId: 'a'.repeat(24) }]),
    JSON.stringify([{ ...PLATFORM, kind: 'BOOKING' }]), JSON.stringify([PLATFORM, { ...PLATFORM, id: 'second' }]),
    JSON.stringify([{ ...PLATFORM, accountNumber: 123 }]), JSON.stringify([{ ...PLATFORM, secret: 'short' }])]) {
    assert.throws(() => readSepayConnections({ SEPAY_CONNECTIONS: value }), error => !error.message.includes(SECRET));
  }
});

test('HMAC uses raw bytes, rejects modified JSON, old timestamps and unsigned bodies', async () => {
  const body = payload('NAPK7M2Q9XA');
  const raw = Buffer.from('{ "message": "Thanh toán vé" }');
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'x-sepay-timestamp': ts, 'x-sepay-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(ts + '.').update(raw).digest('hex') };
  assert.doesNotThrow(() => verifySignature(raw, headers, SECRET));
  assert.throws(() => verifySignature(Buffer.from(JSON.stringify(JSON.parse(raw))), headers, SECRET));
  assert.equal((await request('/payments/webhooks/sepay/platform', { method: 'POST', body })).status, 401);
  assert.equal((await send(body, 'platform', 'wrong-secret')).status, 401);
  assert.equal((await send(body, 'platform', SECRET, signed(body, SECRET, String(Number(ts) - 301)))).status, 401);
  const altered = { ...body, transferAmount: 100000 };
  assert.equal((await send(altered, 'platform', SECRET, signed(body))).status, 401);
  assert.equal(await Receipt.countDocuments(), 0);
});

test('Vietnam dates and payment code parsing reject invalid, ambiguous or partial codes', () => {
  assert.equal(parsePaidAt('2026-11-18 12:30:00').toISOString(), '2026-11-18T05:30:00.000Z');
  assert.throws(() => parsePaidAt('2026-02-30 12:30:00'));
  assert.throws(() => parsePaidAt('2026-11-18T12:30:00Z'));
  assert.equal(paymentCode('napk7m2q9xa thanh toan', ''), 'NAPK7M2Q9XA');
  assert.equal(paymentCode('NAPK7M2Q9XA RUN1234567890ABCDEF', ''), '');
  assert.equal(paymentCode('NAPK7M2Q9XAEXTRA', ''), '');
});

test('probe acknowledges connection without database effects; unknown or disabled routes reject', async () => {
  assert.deepEqual((await send({ id: 0 })).body, { success: true, result: 'TEST_ONLY' });
  assert.equal(await Receipt.countDocuments(), 0);
  assert.equal((await send({ id: 0 }, 'missing')).status, 404);
  process.env.SEPAY_CONNECTIONS = JSON.stringify([{ ...PLATFORM, enabled: false }]);
  assert.equal((await send({ id: 0 })).status, 404);
});

test('invalid payloads and the wrong bank, account or VA never create receipts', async () => {
  for (const patch of [{ id: -1 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { transferAmount: '50000' },
    { transferAmount: 0 }, { transferAmount: 5.5 }, { transferType: 'refund' }, { referenceCode: '' },
    { transactionDate: 'invalid' }, { content: 'x'.repeat(2001) }, { gateway: 'Vietcombank' },
    { accountNumber: OTHER_ACCOUNT.accountNo }, { subAccount: 'NOT-CONFIGURED' }]) {
    const result = await send(payload('NAPK7M2Q9XA', patch));
    assert.ok([400, 403].includes(result.status), JSON.stringify(result));
  }
  assert.equal(await Receipt.countDocuments(), 0);
});

test('topup credits once automatically and stores no raw body, accumulated balance or secret', async () => {
  const payment = await topup();
  const body = payload(payment.transferCode, { accumulated: 999999999, description: 'PRIVATE SENDER' });
  assert.equal((await send(body)).body.result, 'APPLIED');
  assert.equal(await balanceOf(payer), 50000);
  const saved = await Payment.findById(payment._id);
  assert.equal(saved.status, 'APPROVED'); assert.equal(saved.confirmationSource, 'SEPAY');
  assert.equal(saved.receivedAmount, 50000); assert.equal(saved.reviewedBy, undefined);
  assert.equal((await send(body)).body.result, 'APPLIED');
  assert.equal(await Ledger.countDocuments({ referenceId: payment._id }), 1);
  const receipt = await Receipt.findOne().lean();
  assert.equal(receipt.status, 'APPLIED');
  for (const absent of ['rawBody', 'accumulated', 'description', 'secret', 'fingerprint']) assert.equal(receipt[absent], undefined);
});

test('parallel retries credit one ledger entry; conflicting transaction id returns 409', async () => {
  const payment = await topup(), body = payload(payment.transferCode);
  const responses = await Promise.all(Array.from({ length: 6 }, () => send(body)));
  assert.ok(responses.every(r => r.status === 200 && r.body.result === 'APPLIED'), JSON.stringify(responses));
  assert.equal(await balanceOf(payer), 50000); assert.equal(await Receipt.countDocuments(), 1);
  assert.equal(await Ledger.countDocuments(), 1);
  assert.equal((await send({ ...body, transferAmount: 60000 })).status, 409);
});

test('different provider ids cannot reuse a bank reference for another topup', async () => {
  const first = await topup(), second = await topup();
  const body = payload(first.transferCode);
  assert.equal((await send(body)).body.result, 'APPLIED');
  assert.equal((await send(payload(second.transferCode, { referenceCode: body.referenceCode }))).body.result, 'REVIEW');
  assert.equal(await balanceOf(payer), 50000);
  assert.equal((await Payment.findById(second._id)).status, 'PENDING');
});

test('wrong amount, outgoing, unknown and ambiguous transfers do not credit a wallet', async () => {
  const payment = await topup();
  for (const patch of [{ transferAmount: 49000 }, { transferAmount: 51000 }, { content: 'no matching code', code: null },
    { content: payment.transferCode + ' RUN1234567890ABCDEF' }]) {
    assert.equal((await send(payload(payment.transferCode, patch))).body.result, 'REVIEW');
  }
  assert.equal((await send(payload('NAPK7M2Q9XA'))).body.result, 'REVIEW');
  assert.equal((await send(payload(payment.transferCode, { transferType: 'out' }))).body.result, 'IGNORED');
  assert.equal(await balanceOf(payer), 0);
});

test('expired, predating and rejected topups remain for reconciliation', async () => {
  const payment = await topup();
  assert.equal((await send(payload(payment.transferCode, { transactionDate: bankTime(new Date(Date.now() - 60000)) }))).body.result, 'REVIEW');
  await Payment.updateOne({ _id: payment._id }, { $set: { expiresAt: new Date(Date.now() - 10000) } });
  assert.equal((await send(payload(payment.transferCode))).body.result, 'REVIEW');
  await Payment.updateOne({ _id: payment._id }, { $set: { expiresAt: new Date(Date.now() + 10000), status: 'REJECTED' } });
  assert.equal((await send(payload(payment.transferCode))).body.result, 'REVIEW');
  assert.equal(await balanceOf(payer), 0);
});

test('frozen wallet creates a review receipt; Super Admin retry rechecks and credits after unlock', async () => {
  const payment = await topup();
  await Wallet.updateOne({ userId: payer.id }, { $set: { status: 'FROZEN' } });
  const result = await send(payload(payment.transferCode));
  assert.equal(result.body.result, 'REVIEW');
  const receipt = await Receipt.findOne();
  assert.equal(receipt.reason, 'WALLET_INACTIVE');
  const route = '/admin/platform/sepay/receipts/' + receipt._id + '/retry';
  assert.equal((await request(route, { method: 'POST', as: payer })).status, 403);
  await Wallet.updateOne({ userId: payer.id }, { $set: { status: 'ACTIVE' } });
  assert.equal((await request(route, { method: 'POST', as: admin })).body.receipt.status, 'APPLIED');
  assert.equal(await balanceOf(payer), 50000);
  assert.equal((await request(route, { method: 'POST', as: admin })).body.receipt.status, 'APPLIED');
  assert.equal(await Ledger.countDocuments(), 1);
});

test('pending snapshot still reconciles after receiving-account settings are disabled or replaced', async () => {
  const payment = await topup();
  await configureAccount(admin, OTHER_ACCOUNT);
  await Setting.updateOne({ key: 'WALLET_TOPUP' }, { $set: { bankTransferEnabled: false } });
  assert.equal((await send(payload(payment.transferCode))).body.result, 'APPLIED');
  assert.equal(await balanceOf(payer), 50000);
});

test('ticket transfer creates a registration without clicking confirm and never credits a wallet', async () => {
  const f = await eventFixture();
  assert.equal(await Payment.countDocuments({ bookingId: f.booking._id }), 1);
  assert.equal((await raceSend(f)).body.result, 'APPLIED');
  assert.equal((await Booking.findById(f.booking._id)).status, 'PAID');
  assert.equal(await Registration.countDocuments({ 'payment.bookingId': f.booking._id }), 1);
  assert.equal(await balanceOf(payer), 0); assert.equal(await balanceOf(f.owner), 0);
  const category = await Category.findById(f.category._id);
  assert.equal(category.quotaHold, 0); assert.equal(category.quotaSold, 1);
});

test('wallet and event routes cannot pay each other; event A cannot pay event B', async () => {
  const f = await eventFixture(), other = await eventFixture(), payment = await topup();
  assert.equal((await send(payload(f.booking.orderCode))).body.result, 'REVIEW');
  assert.equal((await send(payload(payment.transferCode), f.connection.id, f.connection.secret)).body.result, 'REVIEW');
  assert.equal((await send(payload(other.booking.orderCode), f.connection.id, f.connection.secret)).body.result, 'REVIEW');
  assert.equal(await Registration.countDocuments(), 0); assert.equal(await Ledger.countDocuments(), 0);
  // A wrong-route receipt must not consume the transaction and prevent its correct delivery.
  const body = payload(other.booking.orderCode);
  assert.equal((await send(body, f.connection.id, f.connection.secret)).body.result, 'REVIEW');
  assert.equal((await send(body, other.connection.id, other.connection.secret)).body.result, 'APPLIED');
});

test('ticket already paid by wallet keeps incoming transfer for review without a second ticket', async () => {
  const f = await eventFixture();
  await Wallet.updateOne({ userId: payer.id }, { $set: { balance: 100000 } });
  const paid = await request('/bookings/' + f.booking._id + '/confirm', { method: 'POST', as: payer, body: { paymentMethod: 'WALLET' } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal((await raceSend(f)).body.result, 'REVIEW');
  assert.equal(await Registration.countDocuments(), 1); assert.equal(await balanceOf(payer), 50000);
  assert.equal((await Payment.findOne({ bookingId: f.booking._id })).status, 'REJECTED');
});

async function makeExpired(f, { full = false } = {}) {
  await Booking.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.booking._id) }, { $set: {
    createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000),
  } });
  await expireBookings();
  if (full) await Category.updateOne({ _id: f.category._id }, { $set: { quotaSold: f.category.quotaTotal } });
}
test('on-time money with delayed webhook reacquires a free slot after expiry exactly once', async () => {
  const f = await eventFixture({ quota: 1 }); await makeExpired(f);
  const body = payload(f.booking.orderCode, { transactionDate: bankTime(new Date(Date.now() - 90000)) });
  assert.equal((await send(body, f.connection.id, f.connection.secret)).body.result, 'APPLIED');
  assert.equal((await send(body, f.connection.id, f.connection.secret)).body.result, 'APPLIED');
  const cat = await Category.findById(f.category._id);
  assert.equal(cat.quotaHold, 0); assert.equal(cat.quotaSold, 1); assert.equal(await Registration.countDocuments(), 1);
});

test('late payment and a sold-out delayed payment never oversell', async () => {
  const f = await eventFixture({ quota: 1 }); await makeExpired(f, { full: true });
  assert.equal((await raceSend(f)).body.result, 'REVIEW');
  assert.equal((await raceSend(f, { transactionDate: bankTime(new Date(Date.now() - 90000)) })).body.result, 'REVIEW');
  assert.equal(await Registration.countDocuments(), 0);
  const cat = await Category.findById(f.category._id);
  assert.equal(cat.quotaHold, 0); assert.equal(cat.quotaSold, 1);
  assert.equal(await Receipt.countDocuments({ reason: 'NO_CAPACITY_FOR_DELAYED_PAYMENT' }), 1);
});

test('suspended events roll back ticket issuance; owner can retry once the event is restored', async () => {
  const f = await eventFixture();
  await Event.updateOne({ _id: f.event._id }, { $set: { 'moderation.state': 'SUSPENDED' } });
  assert.equal((await raceSend(f)).body.result, 'REVIEW');
  assert.equal(await Registration.countDocuments(), 0);
  const receipt = await Receipt.findOne();
  await Event.updateOne({ _id: f.event._id }, { $set: { 'moderation.state': 'ACTIVE' } });
  const r = await request(`/admin/events/${f.event._id}/payments/sepay/receipts/${receipt._id}/retry`, { method: 'POST', as: f.owner });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.receipt.status, 'APPLIED');
});

test('receipt queries and retry enforce Super Admin vs event owner boundaries and omit secrets', async () => {
  const f = await eventFixture(), other = await eventFixture(), payment = await topup();
  await send(payload(payment.transferCode, { transferAmount: 10000 }));
  await raceSend(f, { transferAmount: 10000 });
  const topups = '/admin/platform/sepay/receipts';
  const tickets = `/admin/events/${f.event._id}/payments/sepay/receipts`;
  assert.equal((await request(topups)).status, 401);
  assert.equal((await request(topups, { as: payer })).status, 403);
  assert.equal((await request(topups, { as: f.owner })).status, 403);
  assert.equal((await request(tickets, { as: admin })).status, 403);
  assert.equal((await request(tickets, { as: other.owner })).status, 403);
  const mine = await request(tickets, { as: f.owner });
  assert.equal(mine.body.receipts.length, 1); assert.equal(mine.body.receipts[0].kind, 'BOOKING');
  const platform = await request(topups, { as: admin });
  assert.equal(platform.body.receipts.length, 1); assert.equal(platform.body.receipts[0].kind, 'TOPUP');
  assert.equal(JSON.stringify(platform.body).includes(SECRET), false);
  assert.equal(platform.body.receipts[0].fingerprint, undefined);
  assert.equal((await request(tickets + '/' + platform.body.receipts[0]._id + '/retry', { method: 'POST', as: f.owner })).status, 404);
});

test('concurrent manual review and automatic topup processing never double-credit', async () => {
  const payment = await topup(), body = payload(payment.transferCode);
  const results = await Promise.all([
    send(body),
    request(`/admin/payments/${payment._id}/review`, { method: 'POST', as: admin,
      body: { status: 'APPROVED', bankReference: body.referenceCode, receivedAmount: 50000 } }),
  ]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(await balanceOf(payer), 50000); assert.equal(await Ledger.countDocuments(), 1);
});

test('a transient storage failure retains the receipt and background recovery commits once', async () => {
  const payment = await topup(), body = payload(payment.transferCode);
  const original = Ledger.create, originalLog = console.error;
  try {
    Ledger.create = async () => { throw new Error('simulated storage failure'); };
    console.error = () => {};
    assert.equal((await send(body)).status, 500);
  } finally { Ledger.create = original; console.error = originalLog; }
  assert.equal(await balanceOf(payer), 0);
  assert.equal((await Receipt.findOne()).status, 'RECEIVED');
  await require('../src/backend/services/sepayService').resumePendingReceipts();
  assert.equal((await Receipt.findOne()).status, 'APPLIED');
  assert.equal(await balanceOf(payer), 50000);
  assert.equal((await send(body)).body.result, 'APPLIED');
  assert.equal(await Ledger.countDocuments(), 1);
});

test('concurrent ticket webhooks create one ticket, one sale and one reward', async () => {
  const f = await eventFixture({ quota: 1 }), body = payload(f.booking.orderCode);
  const results = await Promise.all(Array.from({ length: 5 }, () => send(body, f.connection.id, f.connection.secret)));
  assert.ok(results.every(r => r.status === 200 && r.body.result === 'APPLIED'), JSON.stringify(results));
  const cat = await Category.findById(f.category._id);
  assert.equal(cat.quotaHold, 0); assert.equal(cat.quotaSold, 1);
  assert.equal(await Registration.countDocuments(), 1);
  const points = await require('../src/backend/models/RunPoints').findOne({ userId: payer.id });
  assert.equal(points.balance, 1); assert.equal(points.history.length, 1);
});

test('a cancelled event cannot receive new automatic registrations', async () => {
  const f = await eventFixture();
  await Event.updateOne({ _id: f.event._id }, { $set: { status: 'CANCELLED' } });
  assert.equal((await raceSend(f)).body.result, 'REVIEW');
  assert.equal(await Registration.countDocuments(), 0);
  assert.equal((await Receipt.findOne()).reason, 'EVENT_NOT_PAYABLE');
});

test('legacy holds created before enabling SePay can still be reconciled without a confirm click', async () => {
  const f = await eventFixture();
  await Payment.deleteMany({ bookingId: f.booking._id });
  assert.equal((await raceSend(f)).body.result, 'APPLIED');
  assert.equal(await Payment.countDocuments({ bookingId: f.booking._id, status: 'APPROVED' }), 1);
});

test('cross-connection deliveries cannot double-credit a single bank transaction', async () => {
  const payment = await topup(), body = payload(payment.transferCode);
  process.env.SEPAY_CONNECTIONS = JSON.stringify([PLATFORM, { ...PLATFORM, id: 'rotated', secret: EVENT_SECRET }]);
  const results = await Promise.all([send(body), send(body, 'rotated', EVENT_SECRET)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(await balanceOf(payer), 50000); assert.equal(await Ledger.countDocuments(), 1);
  assert.equal(await Receipt.countDocuments({ status: 'APPLIED' }), 1);
});

test('receipt list uses a bounded cursor and disallows retry after a connection is disabled', async () => {
  const { parsePayload } = require('../src/backend/services/sepayPayload');
  const connection = readSepayConnections()[0];
  await Receipt.insertMany(Array.from({ length: 52 }, () => ({ ...parsePayload(payload('NAPK7M2Q9XA'), connection), status: 'REVIEW', reason: 'ORDER_NOT_FOUND' })));
  const path = '/admin/platform/sepay/receipts';
  const first = await request(path + '?status=REVIEW', { as: admin });
  assert.equal(first.body.receipts.length, 50); assert.ok(first.body.nextCursor);
  const second = await request(path + '?before=' + first.body.nextCursor, { as: admin });
  assert.equal(second.body.receipts.length, 2); assert.equal(second.body.nextCursor, null);
  assert.equal((await request(path + '?before=bad', { as: admin })).status, 400);
  assert.equal((await request(path + '?status=bad', { as: admin })).status, 400);
  process.env.SEPAY_CONNECTIONS = '[]';
  assert.equal((await request(path + '/' + first.body.receipts[0]._id + '/retry', { method: 'POST', as: admin })).status, 409);
});

test('real HTTP handler verifies whitespace-preserving JSON, not a parsed and reserialized object', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const payment = await topup();
    const raw = JSON.stringify(payload(payment.transferCode), null, 2), timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/payments/webhooks/sepay/platform`, {
      method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-SePay-Timestamp': timestamp,
        'X-SePay-Signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(timestamp + '.' + raw).digest('hex') },
    });
    assert.equal(response.status, 200); assert.equal((await response.json()).result, 'APPLIED');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
