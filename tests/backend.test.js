const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'isolated-test-secret-not-for-production';
// The top-up rate limiter is keyed by IP and every request in this suite comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';
const { app } = require('../src/backend/server');
const User = require('../src/backend/models/User');
const Event = require('../src/backend/models/Event');
const Category = require('../src/backend/models/EventCategory');
const Booking = require('../src/backend/models/Booking');
const Wallet = require('../src/backend/models/Wallet');
const Points = require('../src/backend/models/RunPoints');
const Ledger = require('../src/backend/models/Ledger');
const Registration = require('../src/backend/models/Registration');
const EventAccount = require('../src/backend/models/EventAccount');
const Payment = require('../src/backend/models/PaymentRequest');
const Volunteer = require('../src/backend/models/VolunteerApplication');
const Listing = require('../src/backend/models/MarketplaceListing');
const RunnerProfile = require('../src/backend/models/RunnerProfile');
const Organization = require('../src/backend/models/Organization');
const Application = require('../src/backend/models/OrganizerApplication');
const PlatformSetting = require('../src/backend/models/PlatformSetting');
const { expireBookings } = require('../src/backend/services/bookingService');
let repl, server, base, seq = 0;
const nativeFetch = global.fetch;
before(async () => {
  global.fetch = (input, options) => String(input) === 'https://api.vietqr.io/v2/banks'
    ? Promise.resolve(Response.json({ code: '00', data: require('../src/backend/data/banks.json').banks.map(bank => ({ ...bank, transferSupported: 1 })) }))
    : nativeFetch(input, options);
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri('runfurther_test'));
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  // Wallet top-ups need a receiving account; tests/topup/create-topup.test.js covers the closed state.
  await PlatformSetting.create({ key: 'WALLET_TOPUP', bankAccountInfo: { bankBin: '970422', bankName: 'MBBank', accountNo: '0123456789', accountName: 'CONG TY RUNFURTHER' } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});
after(async () => {
  global.fetch = nativeFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
async function user(role = 'RUNNER', balance = 2000000) {
  const u = await User.create({ fullName: 'Test runner', email: 'user' + (++seq) + '@test.local', passwordHash: 'unused-test-hash', systemRole: role });
  await Wallet.create({ userId: u._id, balance, currency: 'VND' });
  await Points.create({ userId: u._id, balance: 0 });
  return { ...u.toObject(), token: jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET) };
}
async function fixture(quota = 10) {
  const u = await user(), owner = await user();
  const org = await Organization.create({ name: 'Fixture org', slug: 'fixture-org-' + (++seq), ownerId: owner._id });
  await Application.create({ userId: owner._id, organizationName: 'Fixture org', phone: '0900000000', description: 'Test', status: 'APPROVED' });
  const event = await Event.create({ slug: 'test-' + (++seq), name: 'Test race', createdBy: owner._id, organizerId: org._id, status: 'REGISTRATION_OPEN',
    dateInfo: { registrationStart: new Date(Date.now() - 86400000), registrationEnd: new Date(Date.now() + 86400000), raceDate: new Date(Date.now() + 2 * 86400000) },
    location: { city: 'Hue', venue: 'Park' }, bankAccountInfo: { bankBin: '970422', bankName: 'MBBank', accountNo: '123456789', accountName: 'TEST ORGANIZER' } });
  const category = await Category.create({ eventId: event._id, code: '21K', name: 'Half', distance: 21, price: 100000, quotaTotal: quota });
  await EventAccount.create({ eventId: event._id, userId: owner._id, employeeName: 'Owner', accountType: 'EVENT_ADMIN', loginCode: 'OWNER' + (++seq), createdBy: owner._id });
  return { u, owner, org, event, category };
}
async function api(path, method = 'GET', body, u, extra = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: 'Bearer ' + u.token } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, ...(await response.json()) };
}
function holdBody(f) { return { eventId: f.event._id, categoryId: f.category._id, runnerInfo: { fullName: 'Runner', email: 'runner@test.local', phone: '0900000000' } }; }
test('Signup persists runner details; profile edits are private and cannot elevate roles', async () => {
  const profile = { gender: 'Nữ', birthday: '1997-08-12', nationality: 'Việt Nam', club: 'Morning runners', shirtSize: 'XXL', emergencyContact: 'Người thân', emergencyPhone: '0900000001' };
  const created = await api('/auth/register', 'POST', { email: 'profile@test.local', password: 'long-test-password', fullName: 'Runner Profile', phone: '0900000000', profile, systemRole: 'SUPER_ADMIN' });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.user.systemRole, 'RUNNER');
  const owner = { token: created.token };
  const me = await api('/auth/me', 'GET', null, owner);
  assert.deepEqual(me.profile, profile);
  assert.equal(me.user.passwordHash, undefined);
  const changed = await api('/auth/me', 'PATCH', { fullName: 'Runner Updated', avatarTheme: 'ocean', email: 'hijacked@test.local', systemRole: 'SUPER_ADMIN', profile: { club: 'New club' } }, owner);
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal(changed.user.fullName, 'Runner Updated');
  assert.equal(changed.user.avatarTheme, 'ocean');
  assert.equal(changed.user.email, 'profile@test.local');
  assert.equal(changed.user.systemRole, 'RUNNER');
  assert.equal(changed.profile.club, 'New club');
  assert.equal(changed.profile.birthday, profile.birthday);
  assert.equal(changed.profile.emergencyPhone, profile.emergencyPhone);
  assert.equal((await api('/auth/me', 'PATCH', { fullName: 'Anonymous' })).status, 401);
  const other = await user();
  await api('/auth/me', 'PATCH', { userId: created.user.id, profile: { club: 'Other club' } }, other);
  assert.equal((await api('/auth/me', 'GET', null, owner)).profile.club, 'New club');
});
test('Invalid runner details roll back account creation and profile updates', async () => {
  for (const [suffix, profile] of [['date', { birthday: '2025-02-30' }], ['shirt', { shirtSize: 'INVALID' }], ['contact', { emergencyContact: 'Name only' }]]) {
    const email = suffix + '@invalid-profile.local';
    const response = await api('/auth/register', 'POST', { email, password: 'long-test-password', fullName: 'Invalid profile', profile });
    assert.equal(response.status, 400, JSON.stringify(response));
    assert.equal(await User.countDocuments({ email }), 0);
  }
  const owner = await user();
  const response = await api('/auth/me', 'PATCH', { fullName: 'Should roll back', profile: { birthday: '2999-01-01' } }, owner);
  assert.equal(response.status, 400);
  assert.equal((await User.findById(owner._id)).fullName, 'Test runner');
  assert.equal(await RunnerProfile.countDocuments({ userId: owner._id }), 0);
});
test('Legacy accounts can create a runner profile and use it to purchase a ticket', async () => {
  const f = await fixture();
  const original = await api('/auth/me', 'GET', null, f.u);
  assert.equal(original.profile.shirtSize, 'M');
  const saved = await api('/auth/me', 'PATCH', { phone: '0900011222', profile: { birthday: '1995-04-12', gender: 'Nam', shirtSize: 'XL', emergencyContact: 'Family', emergencyPhone: '0900011223' } }, f.u);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  const runnerInfo = { ...saved.profile, fullName: saved.user.fullName, email: saved.user.email, phone: saved.user.phone };
  const booking = await hold(f, { runnerInfo });
  const payment = await api('/bookings/' + booking._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u);
  assert.equal(payment.status, 200);
  const tickets = await api('/registrations/me', 'GET', null, f.u);
  assert.equal(tickets.registrations.length, 1);
  assert.equal(tickets.registrations[0].runnerProfile.birthday, '1995-04-12');
  assert.equal(tickets.registrations[0].runnerProfile.emergencyPhone, '0900011223');
  assert.equal(tickets.registrations[0].logistics.shirtSize, 'XL');
  assert.ok(tickets.registrations[0].qrToken);
});
async function hold(f, extra = {}) {
  const r = await api('/bookings/hold', 'POST', { ...holdBody(f), ...extra }, f.u);
  assert.equal(r.status, 201, JSON.stringify(r)); return r.booking;
}
async function paid(f) {
  const b = await hold(f);
  const r = await api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u);
  assert.equal(r.status, 200, JSON.stringify(r)); return r;
}

test('Staff APIs reject anonymous, wrong-role and cross-event access', async () => {
  const f = await fixture();
  const prefix = '/staff/events/' + f.event._id;
  assert.equal((await api(prefix + '/search?q=test')).status, 401);
  assert.equal((await api(prefix + '/checkin', 'POST', { bibNumber: 'X' })).status, 401);
  assert.equal((await api(prefix + '/volunteers', 'GET', null, f.u)).status, 403);
  await EventAccount.create({ eventId: f.event._id, employeeName: 'Kit', accountType: 'RACE_KIT', loginCode: '123456', createdBy: f.u._id });
  assert.equal((await api(prefix + '/checkin', 'POST', { bibNumber: 'X' }, null, { 'x-login-code': '123456' })).status, 403);
  const other = await fixture();
  assert.equal((await api('/staff/events/' + other.event._id + '/search?q=test', 'GET', null, null, { 'x-login-code': '123456' })).status, 401);
});
test('Concurrent holds cannot oversell and invalid bookings roll quota back', async () => {
  const f = await fixture(1);
  const results = await Promise.all(Array.from({ length: 5 }, () => api('/bookings/hold', 'POST', holdBody(f), f.u)));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal((await Category.findById(f.category._id)).quotaHold, 1);
  const g = await fixture();
  assert.equal((await api('/bookings/hold', 'POST', { ...holdBody(g), runnerInfo: { ...holdBody(g).runnerInfo, shirtSize: 'INVALID' } }, g.u)).status, 400);
  assert.equal((await Category.findById(g.category._id)).quotaHold, 0);
  assert.equal((await api('/bookings/hold', 'POST', { ...holdBody(g), categoryId: f.category._id }, g.u)).status, 409);
});
test('Closed events reject holds', async () => {
  const f = await fixture();
  await Event.updateOne({ _id: f.event._id }, { status: 'REGISTRATION_CLOSED' });
  assert.equal((await api('/bookings/hold', 'POST', holdBody(f), f.u)).status, 409);
});
test('Expiry returns quota exactly once under concurrent workers', async () => {
  const f = await fixture(), b = await hold(f);
  await Booking.updateOne({ _id: b._id }, { expiresAt: new Date(Date.now() - 1000) });
  await Promise.all([expireBookings(), expireBookings(), expireBookings()]);
  assert.equal((await Category.findById(f.category._id)).quotaHold, 0);
  assert.equal((await Booking.findById(b._id)).status, 'EXPIRED');
});
test('Wallet confirmation is idempotent and cannot debit a supplied foreign wallet', async () => {
  const f = await fixture(), victim = await user(), b = await hold(f);
  const wallet = await Wallet.findOne({ userId: victim._id });
  const results = await Promise.all(Array.from({ length: 3 }, () => api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'WALLET', walletId: wallet._id }, f.u)));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(await Registration.countDocuments({ 'payment.bookingId': b._id }), 1);
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 1900000);
  assert.equal((await Wallet.findById(wallet._id)).balance, 2000000);
  assert.equal(await Ledger.countDocuments({ idempotencyKey: 'BOOKING-' + b._id }), 1);
});
test('Insufficient funds and points roll back the complete payment', async () => {
  const f = await fixture();
  await Points.updateOne({ userId: f.u._id }, { balance: 50 });
  const b = await hold(f, { usePoints: true });
  await Points.updateOne({ userId: f.u._id }, { balance: 0 });
  const r = await api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u);
  assert.equal(r.status, 409);
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 2000000);
  assert.equal((await Booking.findById(b._id)).status, 'HOLD');
  assert.equal(await Ledger.countDocuments({ idempotencyKey: 'BOOKING-' + b._id }), 0);
  await Wallet.updateOne({ userId: f.u._id }, { balance: 0 });
  assert.equal((await api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u)).status, 409);
});
test('VietQR requires admin reconciliation; one bank reference cannot approve twice', async () => {
  const f = await fixture(), b = await hold(f), admin = await user('SUPER_ADMIN');
  const pending = await api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u);
  assert.equal(pending.status, 202);
  assert.equal(await Registration.countDocuments({ 'payment.bookingId': b._id }), 0);
  const path = '/admin/events/' + f.event._id + '/payments/' + pending.paymentRequest._id + '/review';
  assert.equal((await api(path, 'POST', { status: 'APPROVED', bankReference: 'BANK-1' }, f.u)).status, 403);
  assert.equal((await api(path, 'POST', { status: 'APPROVED', bankReference: 'BANK-1' }, f.owner)).status, 200);
  assert.equal((await api(path, 'POST', { status: 'APPROVED', bankReference: 'BANK-1' }, f.owner)).status, 200);
  const top = await api('/wallet/topup', 'POST', { amount: 10000 }, f.u, { 'Idempotency-Key': 'test-topup-1' });
  assert.equal(top.status, 202);
  assert.equal((await api('/admin/payments/' + top.paymentRequest._id + '/review', 'POST', { status: 'APPROVED', bankReference: 'BANK-1', receivedAmount: 10000 }, admin)).status, 409);
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 2000000);
});
test('Top-ups credit only after approval and retries do not duplicate credit', async () => {
  const u = await user(), admin = await user('SUPER_ADMIN');
  const create = () => api('/wallet/topup', 'POST', { amount: 50000 }, u, { 'Idempotency-Key': 'topup-test-2' });
  const p = await create();
  assert.equal((await create()).paymentRequest._id, p.paymentRequest._id);
  assert.equal((await Wallet.findOne({ userId: u._id })).balance, 2000000);
  const review = () => api('/admin/payments/' + p.paymentRequest._id + '/review', 'POST', { status: 'APPROVED', bankReference: 'BANK-2', receivedAmount: 50000 }, admin);
  await Promise.all([review(), review()]);
  assert.equal((await Wallet.findOne({ userId: u._id })).balance, 2050000);
});
test('Marketplace sale pays seller, rotates QR, and has exactly one concurrent buyer', async () => {
  const f = await fixture(), p = await paid(f), a = await user(), b = await user();
  const listing = await api('/marketplace', 'POST', { listingType: 'BIB_TRANSFER', registrationId: p.registration._id, title: 'Transfer', price: 100000 }, f.u);
  assert.equal(listing.status, 201);
  const buy = u => api('/marketplace/' + listing.listing._id + '/buy', 'POST', { newRunnerProfile: { fullName: 'Buyer', email: u.email, phone: '0900000000' } }, u);
  const results = await Promise.all([buy(a), buy(b)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const reg = await Registration.findById(p.registration._id);
  assert.notEqual(reg.qrToken, p.registration.qrToken);
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 2000000);
  assert.equal(await Ledger.countDocuments({ referenceId: listing.listing._id }), 2);
  assert.equal((await api('/marketplace/' + listing.listing._id, 'DELETE', null, f.u)).status, 409);
});
test('Unfunded marketplace purchase leaves ownership, QR and listing unchanged', async () => {
  const f = await fixture(), p = await paid(f), buyer = await user('RUNNER', 0);
  const l = await api('/marketplace', 'POST', { listingType: 'BIB_TRANSFER', registrationId: p.registration._id, title: 'Transfer', price: 100000 }, f.u);
  const r = await api('/marketplace/' + l.listing._id + '/buy', 'POST', { newRunnerProfile: { fullName: 'Buyer', email: buyer.email, phone: '0900000000' } }, buyer);
  assert.equal(r.status, 409);
  const reg = await Registration.findById(p.registration._id);
  assert.equal(String(reg.userId), String(f.u._id)); assert.equal(reg.qrToken, p.registration.qrToken);
  assert.equal((await Listing.findById(l.listing._id)).status, 'ACTIVE');
});
test('Volunteer review prevents role escalation and duplicate staff accounts', async () => {
  const f = await fixture(), admin = f.owner;
  const a = await api('/staff/events/' + f.event._id + '/volunteers/apply', 'POST', { applicant: { fullName: 'Volunteer', email: 'v@test.local', phone: '0900000000' } }, f.u);
  assert.equal(a.status, 201);
  const path = '/staff/events/' + f.event._id + '/volunteers/' + a.application._id + '/review';
  assert.equal((await api(path, 'POST', { status: 'APPROVED', assignedRole: 'EVENT_ADMIN' }, admin)).status, 400);
  const results = await Promise.all([api(path, 'POST', { status: 'APPROVED', assignedRole: 'RACE_KIT' }, admin), api(path, 'POST', { status: 'APPROVED', assignedRole: 'RACE_KIT' }, admin)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(results[0].loginCode, results[1].loginCode);
  assert.equal(await EventAccount.countDocuments({ eventId: f.event._id, accountType: 'RACE_KIT' }), 1);
});
test('Banned users cannot reuse tokens, malformed IDs return 400', async () => {
  const u = await user();
  assert.equal((await api('/bookings/not-an-id', 'GET', null, u)).status, 400);
  await User.updateOne({ _id: u._id }, { status: 'BANNED' });
  assert.equal((await api('/wallet', 'GET', null, u)).status, 401);
});
test('Check-in and kit issuance preserve each other; cancelled tickets are rejected', async () => {
  const f = await fixture(), p = await paid(f), admin = f.owner;
  const path = '/staff/events/' + f.event._id;
  const results = await Promise.all([
    api(path + '/checkin', 'POST', { registrationId: p.registration._id }, admin),
    api(path + '/race-kit', 'POST', { registrationId: p.registration._id }, admin),
  ]);
  assert.ok(results.every(r => r.status === 200));
  const reg = await Registration.findById(p.registration._id);
  assert.equal(reg.logistics.hasCheckedIn, true); assert.equal(reg.logistics.raceKitIssued, true);
  await Registration.updateOne({ _id: reg._id }, { status: 'CANCELLED' });
  assert.equal((await api(path + '/checkin', 'POST', { registrationId: reg._id }, admin)).status, 404);
});
test('Achievements count verified results, not purchased tickets', async () => {
  const f = await fixture(), p = await paid(f);
  let r = await api('/registrations/achievements/me', 'GET', null, f.u);
  assert.equal(r.achievements.completedRaces, 0);
  const admin = f.owner;
  assert.equal((await api('/admin/events/' + f.event._id + '/registrations/' + p.registration._id + '/result', 'PUT', { chipTime: '01:30:00' }, admin)).status, 200);
  r = await api('/registrations/achievements/me', 'GET', null, f.u);
  assert.equal(r.achievements.completedRaces, 1);
  assert.equal(r.achievements.totalKm, 21);
});


 test('Admin event/category APIs enforce scope and quota invariants', async () => {
  const f = await fixture(), admin = f.owner;
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { name: 'Unauthorized' }, f.u)).status, 403);
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { name: 'Updated race' }, admin)).status, 200);
  await hold(f);
  assert.equal((await api('/admin/events/' + f.event._id + '/categories/' + f.category._id, 'PATCH', { quotaTotal: 0 }, admin)).status, 409);
  assert.equal((await Category.findById(f.category._id)).quotaTotal, 10);
  const created = await api('/admin/events', 'POST', { organizerId: f.org._id, slug: 'managed-' + (++seq), name: 'Managed race', dateInfo: f.event.dateInfo, location: f.event.location }, admin);
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.event.status, 'DRAFT');
  assert.equal((await api('/events/' + created.event.slug)).status, 404);
 });
 test('Public events expose real quotas and results without runner contacts', async () => {
  const f = await fixture(), p = await paid(f), admin = f.owner;
  const events = await api('/events?search=' + encodeURIComponent(f.event.name) + '&distance=21');
  assert.equal(events.status, 200);
  const event = events.events.find(e => e._id === String(f.event._id));
  assert.equal(event.price, 100000); assert.equal(event.quota, 1);
  await api('/admin/events/' + f.event._id + '/registrations/' + p.registration._id + '/result', 'PUT', { chipTime: '01:25:00' }, admin);
  const results = await api('/events/' + f.event.slug + '/results');
  assert.equal(results.results.length, 1); assert.equal(results.results[0].rank, 1);
  assert.equal(results.results[0].email, undefined); assert.equal(results.results[0].qrToken, undefined);
  assert.equal((await api('/events?search=%5B')).status, 200);
 });
 test('Expired and cancelled bookings cannot be approved or debit wallets', async () => {
  const f = await fixture(), b = await hold(f), admin = await user('SUPER_ADMIN');
  const pending = await api('/bookings/' + b._id + '/confirm', 'POST', {}, f.u);
  await Booking.updateOne({ _id: b._id }, { expiresAt: new Date(Date.now() - 1000) });
  const review = await api('/admin/events/' + f.event._id + '/payments/' + pending.paymentRequest._id + '/review', 'POST', { status: 'APPROVED', bankReference: 'LATE-BANK' }, f.owner);
  assert.equal(review.status, 409);
  assert.equal((await Payment.findById(pending.paymentRequest._id)).status, 'PENDING');
  assert.equal(await Registration.countDocuments({ 'payment.bookingId': b._id }), 0);
  assert.equal((await Category.findById(f.category._id)).quotaHold, 0);
 });
 test('Free races stay free and invalid payment/top-up requests are rejected', async () => {
  const f = await fixture(); await Category.updateOne({ _id: f.category._id }, { price: 0 });
  const p = await paid(f); assert.equal(p.booking.finalAmount, 0); assert.equal(p.pointsAwarded, 0);
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 2000000);
  assert.equal((await api('/wallet/topup', 'POST', { amount: '50000' }, f.u, { 'Idempotency-Key': 'bad-amount' })).status, 400);
  assert.equal((await api('/registrations/lookup?query[x]=1')).status, 400);
 });

test('BIB index upgrades coexist with legacy non-unique and earlier unique indexes', async () => {
  const connection = await mongoose.createConnection(repl.getUri('legacy_indexes_test'), { autoIndex: false }).asPromise();
  try {
    for (const unique of [false, true]) {
      const model = connection.model('LegacyRegistration' + unique, Registration.schema.clone());
      await model.createCollection();
      await model.collection.createIndex({ eventId: 1, bibNumber: 1 }, unique
        ? { unique: true, partialFilterExpression: { bibNumber: { $type: 'string' } } }
        : {});
      const eventId = new mongoose.Types.ObjectId();
      const original = { eventId, bibNumber: '21K-001', qrToken: 'original', payment: { bookingId: new mongoose.Types.ObjectId() } };
      await model.collection.insertOne(original);
      await model.createIndexes();
      await model.createIndexes();
      const indexes = await model.collection.indexes();
      assert.ok(indexes.some(index => index.name === 'eventId_1_bibNumber_1'));
      assert.ok(indexes.some(index => index.name === 'unique_bib_per_event' && index.unique));
      assert.equal(await model.collection.countDocuments(), 1);
      await assert.rejects(model.collection.insertOne({ eventId, bibNumber: '21K-001', qrToken: 'duplicate-bib', payment: { bookingId: new mongoose.Types.ObjectId() } }), error => error.code === 11000 && error.keyPattern.bibNumber === 1);
      await model.collection.insertOne({ eventId: new mongoose.Types.ObjectId(), bibNumber: '21K-001', qrToken: 'other-event', payment: { bookingId: new mongoose.Types.ObjectId() } });
      assert.equal(await model.collection.countDocuments(), 2);
    }
  } finally { await connection.close(); }
});

async function ownedEvent() {
  const owner = await user();
  await Application.create({ userId: owner._id, organizationName: 'Org', phone: '0900000000', description: 'Test', status: 'APPROVED' });
  const org = await Organization.create({ name: 'Test organizer', slug: 'org-' + (++seq), ownerId: owner._id });
  const dateInfo = { registrationStart: new Date(Date.now() - 86400000), registrationEnd: new Date(Date.now() + 86400000), raceDate: new Date(Date.now() + 2 * 86400000) };
  const result = await api('/admin/events', 'POST', { organizerId: org._id, slug: 'owned-' + (++seq), name: 'Owned event', dateInfo, location: { city: 'Hue', venue: 'Park' }, createdBy: new mongoose.Types.ObjectId() }, owner);
  assert.equal(result.status, 201, JSON.stringify(result));
  return { owner, event: result.event, org };
}

test('Organizer approval is required before creation and only Super Admin can review', async () => {
  const applicant = await user(), moderator = await user('SUPER_ADMIN');
  const orgBody = { name: 'Approval test', slug: 'approval-' + (++seq) };
  assert.equal((await api('/organizations', 'POST', orgBody, applicant)).status, 403);
  assert.equal((await api('/admin/events', 'POST', {}, applicant)).status, 403);
  const application = await api('/admin/organizer-access', 'POST', { organizationName: 'Approval test', phone: '0900000000', description: 'Running events', status: 'APPROVED' }, applicant);
  assert.equal(application.status, 201);
  assert.equal(application.application.status, 'PENDING');
  const path = '/admin/platform/applications/' + application.application._id + '/review';
  assert.equal((await api(path, 'POST', { status: 'APPROVED', reason: 'Self approval' }, applicant)).status, 403);
  assert.equal((await api(path, 'POST', { status: 'APPROVED', reason: ' ' }, moderator)).status, 400);
  assert.equal((await api('/organizations', 'POST', orgBody, applicant)).status, 403);
  const results = await Promise.all(['APPROVED', 'APPROVED'].map(status => api(path, 'POST', { status, reason: 'Verified organizer' }, moderator)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await api('/organizations', 'POST', orgBody, applicant)).status, 201);
  assert.equal((await Application.findById(application.application._id)).reviews.length, 1);
  assert.equal((await api('/organizations', 'POST', { ...orgBody, slug: orgBody.slug + '-super' }, moderator)).status, 403);
  assert.equal((await api('/admin/events', 'POST', {}, moderator)).status, 403);
});

test('Moderation preserves records, blocks commerce and operations, and records every reason', async () => {
  const f = await fixture(), ticket = await paid(f), held = await hold(f), moderator = await user('SUPER_ADMIN');
  const listing = await api('/marketplace', 'POST', { listingType: 'BIB_TRANSFER', registrationId: ticket.registration._id, title: 'Moderated transfer', price: 100000 }, f.u);
  const path = '/admin/platform/events/' + f.event._id;
  assert.equal((await api(path + '/moderation', 'POST', { action: 'SUSPENDED', reason: 'Test rule violation' }, f.owner)).status, 403);
  assert.equal((await api(path + '/moderation', 'POST', { action: 'SUSPENDED' }, moderator)).status, 400);
  for (const action of ['HIDDEN', 'SUSPENDED']) {
    assert.equal((await api(path + '/moderation', 'POST', { action, reason: 'Test rule violation' }, moderator)).status, 200);
    for (const suffix of ['', '/categories', '/results']) assert.equal((await api('/events/' + f.event.slug + suffix)).status, 404);
    assert.equal((await api('/events?search=' + f.event.slug)).events.length, 0);
    assert.equal((await api('/organizations/' + f.org.slug)).events.length, 0);
    assert.equal((await api('/marketplace?eventId=' + f.event._id)).listings.length, 0);
    assert.equal((await api('/bookings/hold', 'POST', holdBody(f), f.u)).status, 409);
    assert.equal((await api('/bookings/' + held._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u)).status, 409);
    assert.equal((await api('/bookings/' + held._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u)).status, 409);
    const blocked = await api('/bookings/' + held._id, 'GET', null, f.u);
    assert.equal(blocked.paymentBlocked, true);
    assert.equal(blocked.vietQrUrl, null);
    assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { moderation: { state: 'ACTIVE' }, status: 'REGISTRATION_OPEN' }, f.owner)).status, 409);
    assert.equal((await api('/staff/events/' + f.event._id + '/search?q=test', 'GET', null, f.owner)).status, 409);
    const buyer = await user();
    assert.equal((await api('/marketplace/' + listing.listing._id + '/buy', 'POST', { newRunnerProfile: { fullName: 'Buyer', email: buyer.email, phone: '0900000000' } }, buyer)).status, 409);
  }
  assert.equal((await api('/admin/events/' + f.event._id, 'GET', null, f.owner)).status, 200);
  assert.equal((await api('/admin/events/' + f.event._id, 'DELETE', null, moderator)).status, 404);
  assert.equal(await Registration.countDocuments({ _id: ticket.registration._id }), 1);
  assert.equal((await Booking.findById(held._id)).status, 'HOLD');
  assert.equal((await Wallet.findOne({ userId: f.u._id })).balance, 1900000);
  for (const suffix of ['', '/staff', '/registrations', '/payments']) assert.equal((await api('/admin/events/' + f.event._id + suffix, 'GET', null, moderator)).status, 403);
  assert.equal((await api('/staff/events/' + f.event._id + '/search?q=test', 'GET', null, moderator)).status, 403);
  const overview = await api('/admin/platform/events', 'GET', null, moderator);
  assert.equal(overview.events.find(e => e._id === String(f.event._id)).bankAccountInfo, undefined);
  assert.equal((await api(path + '/moderation', 'POST', { action: 'ACTIVE', reason: 'Violation resolved' }, moderator)).status, 200);
  assert.equal((await api(path + '/history', 'GET', null, moderator)).history.length, 3);
  assert.equal((await api('/events/' + f.event.slug)).status, 200);
  assert.equal((await api('/bookings/' + held._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u)).status, 200);
});

test('Ticket payments belong to the event owner; Super Admin only reviews wallet top-ups', async () => {
  const f = await fixture(), other = await fixture(), b = await hold(f), moderator = await user('SUPER_ADMIN');
  const pending = await api('/bookings/' + b._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u);
  const id = pending.paymentRequest._id, body = { status: 'APPROVED', bankReference: 'SCOPE-BANK' };
  assert.equal((await api('/admin/payments/' + id + '/review', 'POST', body, moderator)).status, 403);
  assert.equal((await api('/admin/events/' + other.event._id + '/payments/' + id + '/review', 'POST', body, other.owner)).status, 403);
  assert.equal((await api('/admin/events/' + f.event._id + '/payments/' + id + '/review', 'POST', body, moderator)).status, 403);
  const top = await api('/wallet/topup', 'POST', { amount: 10000 }, f.u, { 'Idempotency-Key': 'scope-topup' });
  assert.equal((await api('/admin/events/' + f.event._id + '/payments/' + top.paymentRequest._id + '/review', 'POST', body, f.owner)).status, 403);
  assert.ok((await api('/admin/payments', 'GET', null, moderator)).payments.every(p => p.kind === 'TOPUP'));
  assert.deepEqual((await api('/admin/events/' + f.event._id + '/payments', 'GET', null, f.owner)).payments.map(p => p._id), [id]);
  assert.equal((await api('/admin/events/' + f.event._id + '/payments/' + id + '/review', 'POST', body, f.owner)).status, 200);
});

test('Notifications use actual user records and read state cannot cross accounts', async () => {
  const f = await fixture(), other = await user(); await paid(f);
  const notifications = (await api('/notifications', 'GET', null, f.u)).notifications;
  assert.ok(notifications.some(n => n.key.startsWith('ticket:') && !n.read));
  assert.deepEqual((await api('/notifications', 'GET', null, other)).notifications, []);
  const keys = notifications.map(n => n.key);
  await api('/notifications/read', 'POST', { keys, userId: f.u._id }, other);
  assert.ok((await api('/notifications', 'GET', null, f.u)).notifications.every(n => !n.read));
  await api('/notifications/read', 'POST', { keys }, f.u);
  assert.ok((await api('/notifications', 'GET', null, f.u)).notifications.every(n => n.read));
  assert.equal((await api('/notifications')).status, 401);
});

test('Event image upload decodes real images, enforces ownership and serves safe WebP', async () => {
  const f = await fixture(), other = await fixture(), moderator = await user('SUPER_ADMIN');
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#447755' } }).png().toBuffer();
  const upload = (who, bytes = png, contentType = 'image/png', endpoint = '/admin/events/' + f.event._id + '/images?kind=banner') => fetch(base + endpoint, { method: 'POST', headers: { ...(who ? { Authorization: 'Bearer ' + who.token } : {}), 'Content-Type': contentType }, body: bytes });
  assert.equal((await upload(null)).status, 401);
  assert.equal((await upload(other.owner)).status, 403);
  assert.equal((await upload(moderator)).status, 403);
  assert.equal((await upload(f.owner, Buffer.from('<svg/>'))).status, 400);
  assert.equal((await upload(f.owner, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  const response = await upload(f.owner);
  assert.equal(response.status, 201);
  const image = await response.json();
  assert.match(image.url, /^\/api\/media\/images\/[a-f0-9]{24}$/);
  const result = await fetch(base.replace(/\/api$/, '') + image.url);
  assert.equal(result.headers.get('content-type'), 'image/webp');
  assert.equal(result.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal((await sharp(Buffer.from(await result.arrayBuffer())).metadata()).width, 64);
  assert.equal((await api('/admin/events/' + other.event._id, 'PATCH', { bannerUrl: image.url }, other.owner)).status, 403);
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { logoUrl: image.url }, f.owner)).status, 403);
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { bannerUrl: image.url }, f.owner)).status, 200);
  assert.equal((await api('/events/' + f.event.slug + '/categories')).event.bannerUrl, image.url);
  assert.equal((await api('/events/' + f.event.slug)).event.bannerUrl, image.url);
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { bannerUrl: 'javascript:alert(1)' }, f.owner)).status, 403);
  assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { bannerUrl: '' }, f.owner)).status, 200);
  assert.equal((await upload(f.owner, png, 'image/png', '/admin/images?kind=logo')).status, 201);
  assert.equal((await upload(f.u, png, 'image/png', '/admin/images?kind=logo')).status, 403);
});

test('Bank settings validate against the directory; checkout freezes destination and amount', async () => {
  const f = await fixture();
  const banks = await api('/banks');
  assert.ok(banks.banks.some(b => b.bin === '970422'));
  const bank = { bankBin: '970422', bankName: 'forged name', accountNo: '00123456789', accountName: 'TEST ORGANIZER' };
  for (const invalid of [{ ...bank, bankBin: '000000' }, { ...bank, accountNo: '../etc' }, { ...bank, accountName: '' }, { bankBin: '970422' }]) {
    assert.equal((await api('/admin/events/' + f.event._id, 'PATCH', { bankAccountInfo: invalid }, f.owner)).status, 400);
  }
  const saved = await api('/admin/events/' + f.event._id, 'PATCH', { bankAccountInfo: bank }, f.owner);
  assert.equal(saved.status, 200);
  assert.equal(saved.event.bankAccountInfo.bankName, 'MBBank');
  const holdResult = await api('/bookings/hold', 'POST', { ...holdBody(f), bankSnapshot: { ...bank, accountNo: 'EVIL' }, finalAmount: 1 }, f.u);
  assert.equal(holdResult.status, 201);
  const url = new URL(holdResult.vietQrUrl);
  assert.equal(url.pathname, '/image/970422-00123456789-compact2.png');
  assert.equal(url.searchParams.get('amount'), '100000');
  assert.equal(url.searchParams.get('addInfo'), holdResult.booking.orderCode);
  await api('/admin/events/' + f.event._id, 'PATCH', { bankAccountInfo: { ...bank, accountNo: '999999999' } }, f.owner);
  const restored = await api('/bookings/' + holdResult.booking._id, 'GET', null, f.u);
  assert.equal(restored.bankInfo.accountNo, '00123456789');
  assert.equal(restored.vietQrUrl, holdResult.vietQrUrl);
  const pending = await api('/bookings/' + holdResult.booking._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u);
  assert.equal(pending.status, 202);
  const reviewList = await api('/admin/events/' + f.event._id + '/payments', 'GET', null, f.owner);
  assert.equal(reviewList.payments[0].bookingId.orderCode, holdResult.booking.orderCode);
  assert.equal(reviewList.payments[0].bookingId.bankSnapshot.accountNo, '00123456789');
  assert.equal(await Registration.countDocuments({ 'payment.bookingId': holdResult.booking._id }), 0);
});

test('Missing or legacy unsnapshotted bank info cannot submit transfers; wallet and free entry still work', async () => {
  const f = await fixture();
  await Event.updateOne({ _id: f.event._id }, { $unset: { bankAccountInfo: '' } });
  const response = await api('/bookings/hold', 'POST', holdBody(f), f.u);
  assert.equal(response.vietQrUrl, null);
  assert.equal((await api('/bookings/' + response.booking._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u)).status, 409);
  assert.equal(await Payment.countDocuments({ bookingId: response.booking._id }), 0);
  assert.equal((await api('/bookings/' + response.booking._id + '/confirm', 'POST', { paymentMethod: 'WALLET' }, f.u)).status, 200);
  await Category.updateOne({ _id: f.category._id }, { price: 0 });
  const free = await hold(f);
  assert.equal((await api('/bookings/' + free._id + '/confirm', 'POST', { paymentMethod: 'VIETQR' }, f.u)).status, 200);
});
test('Event creator is assigned server-side; organizer lists only owned events', async () => {
  const a = await ownedEvent(), b = await ownedEvent();
  assert.equal(a.event.createdBy, String(a.owner._id));
  const mine = await api('/admin/events', 'GET', null, a.owner);
  assert.deepEqual(mine.events.map(e => e._id), [a.event._id]);
  const orgs = await api('/organizations/mine', 'GET', null, a.owner);
  assert.deepEqual(orgs.organizations.map(o => o._id), [String(a.org._id)]);
  const newcomer = await user();
  assert.deepEqual((await api('/admin/events', 'GET', null, newcomer)).events, []);
  assert.equal((await api('/admin/events', 'POST', { ...a.event, slug: 'stolen-' + (++seq), organizerId: b.org._id }, a.owner)).status, 403);
  assert.equal((await api('/admin/events', 'POST', a.event)).status, 401);
  assert.equal((await api('/admin/events/' + a.event._id, 'GET', null, a.owner)).status, 200);
  await api('/admin/events/' + a.event._id, 'PATCH', { createdBy: b.owner._id }, a.owner);
  assert.equal(String((await Event.findById(a.event._id)).createdBy), String(a.owner._id));
});
test('Forged EVENT_ADMIN assignment cannot grant ownership or cross-event access', async () => {
  const a = await ownedEvent(), b = await ownedEvent();
  await EventAccount.create({ eventId: b.event._id, userId: a.owner._id, employeeName: 'Forged admin', accountType: 'EVENT_ADMIN', loginCode: 'FORGEDADMIN', createdBy: a.owner._id });
  for (const suffix of ['', '/staff', '/registrations', '/access']) assert.equal((await api('/admin/events/' + b.event._id + suffix, 'GET', null, a.owner)).status, 403, suffix);
  assert.equal((await api('/admin/events/' + b.event._id, 'PATCH', { name: 'Hijack' }, a.owner)).status, 403);
  assert.equal((await api('/admin/events/' + b.event._id + '/categories', 'POST', { name: 'Bad' }, a.owner)).status, 403);
  assert.equal((await api('/staff/events/' + b.event._id + '/search?q=test', 'GET', null, a.owner)).status, 403);
  assert.equal((await api('/admin/events', 'GET', null, a.owner)).events.length, 1);
  const adminAccount = await EventAccount.findOne({ eventId: a.event._id, accountType: 'EVENT_ADMIN' });
  assert.equal((await api('/staff/events/' + a.event._id + '/login', 'POST', { loginCode: adminAccount.loginCode })).status, 403);
  assert.equal((await api('/staff/events/' + a.event._id + '/search?q=test', 'GET', null, null, { 'x-login-code': adminAccount.loginCode })).status, 403);
  await EventAccount.updateOne({ _id: adminAccount._id }, { status: 'INACTIVE' });
  assert.equal((await api('/admin/events/' + a.event._id, 'GET', null, a.owner)).status, 403);
  assert.equal((await api('/admin/events', 'GET', null, a.owner)).events.length, 0);
  const global = await user('SUPER_ADMIN');
  assert.equal((await api('/admin/events/' + a.event._id, 'GET', null, global)).status, 403);
});
test('Staff creation, revocation and code rotation remain scoped to one event', async () => {
  const a = await ownedEvent(), b = await ownedEvent(), worker = await user();
  const path = '/admin/events/' + a.event._id + '/staff';
  const created = await api(path, 'POST', { employeeName: 'Checkin worker', accountType: 'CHECKIN', email: worker.email, eventId: b.event._id, userId: b.owner._id }, a.owner);
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.account.eventId, a.event._id);
  assert.equal(created.account.userId, String(worker._id));
  assert.equal((await api(path, 'POST', { employeeName: 'Escalation', accountType: 'EVENT_ADMIN' }, a.owner)).status, 400);
  assert.equal((await api(path, 'POST', { employeeName: 'Other', accountType: 'CHECKIN' }, worker)).status, 403);
  const pinHeaders = { 'x-login-code': created.account.loginCode };
  assert.equal((await api('/staff/events/' + a.event._id + '/search?q=test', 'GET', null, null, pinHeaders)).status, 200);
  assert.equal((await api('/staff/events/' + a.event._id + '/race-kit', 'POST', { bibNumber: 'NO' }, worker)).status, 403);
  assert.equal((await api('/staff/events/' + b.event._id + '/search?q=test', 'GET', null, worker)).status, 403);
  assert.equal((await api('/staff/events/' + b.event._id + '/search?q=test', 'GET', null, null, pinHeaders)).status, 401);
  const accountPath = path + '/' + created.account._id;
  assert.equal((await api('/admin/events/' + b.event._id + '/staff/' + created.account._id, 'PATCH', { status: 'INACTIVE' }, b.owner)).status, 404);
  const rotated = await api(accountPath, 'PATCH', { rotateCode: true }, a.owner);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.account.loginCode, created.account.loginCode);
  assert.equal((await api('/staff/events/' + a.event._id + '/search?q=test', 'GET', null, null, pinHeaders)).status, 401);
  await api(accountPath, 'PATCH', { status: 'INACTIVE' }, a.owner);
  assert.equal((await api('/staff/events/' + a.event._id + '/search?q=test', 'GET', null, worker)).status, 403);
  await api(accountPath, 'PATCH', { status: 'ACTIVE' }, a.owner);
  await User.updateOne({ _id: worker._id }, { status: 'BANNED' });
  assert.equal((await api('/staff/events/' + a.event._id + '/login', 'POST', { loginCode: rotated.account.loginCode })).status, 401);
  const list = await api(path, 'GET', null, a.owner);
  assert.equal(list.accounts.find(a => a.accountType === 'EVENT_ADMIN').loginCode, undefined);
});
test('Legacy events without recorded creator deny organizer management; opening registration needs a category', async () => {
  const legacy = await fixture();
  await EventAccount.create({ eventId: legacy.event._id, userId: legacy.u._id, employeeName: 'Legacy admin', accountType: 'EVENT_ADMIN', loginCode: 'LEGACY', createdBy: legacy.u._id });
  assert.equal((await api('/admin/events/' + legacy.event._id, 'GET', null, legacy.u)).status, 403);
  const a = await ownedEvent();
  assert.equal((await api('/admin/events/' + a.event._id, 'PATCH', { status: 'REGISTRATION_OPEN' }, a.owner)).status, 409);
  const category = await api('/admin/events/' + a.event._id + '/categories', 'POST', { code: '5K', name: '5 km', distance: 5, price: 100000, quotaTotal: 10 }, a.owner);
  assert.equal(category.status, 201);
  assert.equal((await api('/admin/events/' + a.event._id, 'PATCH', { status: 'REGISTRATION_OPEN' }, a.owner)).status, 200);
});

test('Legacy ownership recovery is dry-run by default and never overwrites an established creator', async () => {
  const f = await fixture();
  await Event.collection.updateOne({ _id: f.event._id }, { $set: { createdBy: null } });
  await EventAccount.deleteMany({ eventId: f.event._id });
  const execFile = require('node:util').promisify(require('node:child_process').execFile);
  const script = require('node:path').resolve(__dirname, '../scripts/setLegacyEventCreator.js');
  const args = [script, '--event-id', String(f.event._id), '--creator-email', f.u.email];
  const options = { env: { ...process.env, MONGODB_URI: repl.getUri('runfurther_test') }, windowsHide: true };
  const preview = await execFile(process.execPath, args, options);
  assert.match(preview.stdout, /DRY_RUN/);
  assert.equal((await Event.findById(f.event._id)).createdBy, null);
  await execFile(process.execPath, [...args, '--apply'], options);
  assert.equal(String((await Event.findById(f.event._id)).createdBy), String(f.u._id));
  assert.equal((await api('/admin/events/' + f.event._id, 'GET', null, f.u)).status, 200);
  await assert.rejects(execFile(process.execPath, [...args, '--apply'], options));
  assert.equal(await EventAccount.countDocuments({ eventId: f.event._id, accountType: 'EVENT_ADMIN' }), 1);
});
