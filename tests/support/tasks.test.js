// Private-data tasks of the support bot (spec 4.7, plan P07): routing, guests, unclear questions, actions,
// and each task's reads against an in-memory MongoDB replica set (tests/helpers).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-tasks-test-secret';

const mongoose = require('mongoose');
const { app } = require('../../src/backend/server');
const Event = require('../../src/backend/models/Event');
const EventCategory = require('../../src/backend/models/EventCategory');
const Registration = require('../../src/backend/models/Registration');
const Booking = require('../../src/backend/models/Booking');
const Wallet = require('../../src/backend/models/Wallet');
const PaymentRequest = require('../../src/backend/models/PaymentRequest');
const { seedArticles, normalizeSupportText } = require('../../src/backend/services/supportKnowledge');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { routeTask, toActions, createTaskRunner } = require('../../src/backend/services/supportTasks');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_tasks' });
before(harness.start);
after(harness.stop);

const USER = '507f1f77bcf86cd799439011';
const mustNotRun = () => { throw Error('Must not run'); };
// The responder swallows AI errors, so a throwing fake cannot prove the AI was never called: count calls instead.
const countingAi = () => { const ai = async () => { ai.calls++; return null; }; ai.calls = 0; return ai; };
const r = q => routeTask(normalizeSupportText(q));

test('routeTask maps personal phrases to tasks and flags unclear personal questions', () => {
  assert.deepEqual(r('Kiểm tra vé của tôi'), { key: 'tickets' }); assert.deepEqual(r('đơn của mình còn bao lâu'), { key: 'holds' });
  assert.deepEqual(r('ví của tôi còn bao nhiêu'), { key: 'wallet' }); assert.deepEqual(r('yêu cầu hỗ trợ của tôi'), { key: 'supportTickets' });
  assert.deepEqual(r('của tôi sao rồi'), { ambiguous: true }); assert.equal(r('nạp ví thế nào'), null);
});

test('an ownership word or "kiểm tra giúp" makes a question about holds, BIB or top-ups a task', () => {
  assert.deepEqual(r('đơn giữ chỗ của tôi hết hạn chưa'), { key: 'holds' });
  assert.deepEqual(r('kiểm tra giúp mình đơn giữ chỗ còn hạn không'), { key: 'holds' });
  assert.deepEqual(r('BIB của tôi là số mấy'), { key: 'tickets' });
  assert.deepEqual(r('lệnh nạp tiền của tôi duyệt chưa'), { key: 'wallet' });
});

test('words that only look like task words once accents are stripped stay out of tasks', () => {
  // "vì", "vị" and "ví" all normalize to "vi"; "cô đơn" and "đơn vị" contain "don".
  for (const q of ['kiểm tra vì sao chưa nhận được email xác nhận vé', 'kiểm tra vị trí xuất phát ở đâu', 'check vị trí gửi đồ',
    'mình cô đơn quá', 'tôi có đơn vị tổ chức chưa', 'em có đơn bị hủy thì có được hoàn tiền không', 'đơn vị của tôi tạo giải thế nào']) {
    assert.equal(r(q)?.key, undefined, q);
  }
});

test('guests get a login prompt with a /login action and no task runs', async () => {
  const ai = countingAi();
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: ai, runTask: mustNotRun });
  for (const userId of [null, 'not-an-object-id']) {
    const result = await answer({ message: 'Ví của tôi còn bao nhiêu?', userId });
    assert.match(result.reply, /cần đăng nhập/); assert.equal(result.mode, 'guide');
    assert.deepEqual(result.actions, [{ label: 'Đăng nhập', url: '/login' }]);
  }
  assert.equal(ai.calls, 0);
});

test('ambiguous personal questions return task buttons without reading data', async () => {
  const ai = countingAi();
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: ai, runTask: mustNotRun });
  const result = await answer({ message: 'Của tôi sao rồi?', userId: USER });
  assert.equal(result.mode, 'guide'); assert.equal(ai.calls, 0);
  assert.deepEqual(result.actions, [{ label: 'Vé của tôi', url: '/account' }, { label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Mở yêu cầu hỗ trợ', view: 'tickets' }]);
});

test('"của tôi" questions that match an article still get the article', async () => {
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, runTask: mustNotRun });
  for (const [q, key] of [['hồ sơ của tôi sửa ở đâu', 'profile'], ['avatar của tôi không hiện', 'profile'], ['quên mật khẩu tài khoản của mình', 'account']]) {
    const result = await answer({ message: q, userId: USER });
    assert.ok(result.reply.startsWith(seedArticles().find(a => a.key === key).answer), q); assert.equal(result.actions, undefined, q);
  }
});

test('a reader that returns no reply text is treated as a failed read', async () => {
  const runTask = createTaskRunner({ readers: { wallet: async () => ({ actions: [] }) } });
  await assert.rejects(runTask('wallet', USER, { now: new Date() }));
  await assert.rejects(runTask('results', USER, { now: new Date() }), /No reader/);
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, runTask });
  assert.match((await answer({ message: 'ví của tôi còn bao nhiêu', userId: USER })).reply, /chưa đọc được/);
});

test('toActions keeps at most 3 internal or ticket-view actions', () => {
  assert.deepEqual(toActions([{ label: 'A', url: '/account' }, { label: 'B', url: 'https://x.example' }, { label: 'C', view: 'tickets' },
    { label: 'D', view: 'admin' }, { label: 'E', url: '/events' }, { label: 'F', url: '/lookup' }]),
  [{ label: 'A', url: '/account' }, { label: 'C', view: 'tickets' }, { label: 'E', url: '/events' }]);
  assert.deepEqual(toActions([{ label: 'x'.repeat(41), url: '/account' }, { label: '', url: '/account' }, { url: '/account' }, null, { label: 'Ví', url: '/account/wallet', extra: 'drop' }]),
    [{ label: 'Ví', url: '/account/wallet' }]);
  assert.deepEqual(toActions('not a list'), []);
});

// ---- Task 7.2: upcoming tickets and BIB --------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
let eventSeq = 0;
async function makeEvent(daysFromNow, name) {
  eventSeq += 1;
  const raceDate = new Date(Date.now() + daysFromNow * DAY);
  const event = await Event.create({
    slug: `giai-thu-${eventSeq}`, name, status: 'REGISTRATION_OPEN', location: { city: 'Huế', venue: 'Kinh thành' },
    dateInfo: { raceDate, registrationStart: new Date(Date.now() - 60 * DAY), registrationEnd: new Date(raceDate.getTime() - DAY) },
  });
  const category = await EventCategory.create({ eventId: event._id, code: '21K', name: 'Half Marathon 21K', distance: 21, price: 500000, quotaTotal: 100 });
  return { event, category };
}
const makeTicket = (userId, { event, category }, bibNumber, qrToken, status = 'CONFIRMED') => Registration.create({
  userId, eventId: event._id, categoryId: category._id, bibNumber, qrToken, status,
  runnerProfile: { fullName: 'Người Chạy', email: 'runner@test.local', phone: '0900000000' },
  payment: { bookingId: new mongoose.Types.ObjectId(), paidAmount: 500000 },
});
const ask = (message, userId) => createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null })({ message, userId });

let ticketOwners;
async function ticketData() {
  if (ticketOwners) return ticketOwners;
  const [a, b, c, empty] = [await harness.createUser(), await harness.createUser(), await harness.createUser(), await harness.createUser()];
  const soon = await makeEvent(20, 'Huế Heritage Run'), later = await makeEvent(60, 'Đà Lạt Trail'), past = await makeEvent(-30, 'Giải Đã Chạy');
  await makeTicket(a.id, later, 'A-001', 'qr-secret-A1');
  await makeTicket(a.id, soon, 'A-002', 'qr-secret-A2', 'PENDING_TRANSFER');
  // Created after the upcoming ones, so they come first by createdAt: they must not crowd out A-001 and A-002.
  for (const n of [1, 2, 3]) await makeTicket(a.id, past, `A-P0${n}`, `qr-secret-AP${n}`);
  await makeTicket(b.id, soon, 'B-001', 'qr-secret-B1');
  for (const [n, slot] of [[1, later], [2, soon], [3, later], [4, soon]]) await makeTicket(c.id, slot, `C-00${n}`, `qr-secret-C${n}`);
  ticketOwners = { a, b, c, empty };
  return ticketOwners;
}

test('tickets lists up to 3 upcoming tickets of the asker with BIB and never qrToken', async () => {
  const { a, c } = await ticketData();
  const own = await ask('Kiểm tra vé của tôi', a.id);
  assert.match(own.reply, /vé sắp chạy/); assert.match(own.reply, /A-001/); assert.match(own.reply, /A-002/);
  assert.match(own.reply, /Huế Heritage Run/); assert.match(own.reply, /Half Marathon 21K/); assert.match(own.reply, /Đang chuyển nhượng/);
  assert.ok(own.reply.indexOf('A-002') < own.reply.indexOf('A-001'), 'the earliest race comes first');
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]); assert.equal(own.mode, 'guide');
  assert.doesNotMatch(JSON.stringify(own), /qr-secret|runner@test|0900000000/);
  const many = await ask('vé của mình', c.id);
  assert.equal((many.reply.match(/C-00\d/g) || []).length, 3, 'at most 3 tickets are listed');
});

test('tickets of past races never hide upcoming ones', async () => {
  const { a } = await ticketData();
  const own = await ask('vé của tôi', a.id);
  assert.match(own.reply, /A-001/); assert.match(own.reply, /A-002/); assert.doesNotMatch(own.reply, /A-P0/);
});

test("A typing B's BIB still sees only A's tickets", async () => {
  const { a } = await ticketData();
  const own = await ask('vé của tôi, BIB B-001', a.id);
  assert.match(own.reply, /A-001/); assert.doesNotMatch(JSON.stringify(own), /B-001|qr-secret/);
});

test('a user without tickets is told so', async () => {
  const { empty } = await ticketData();
  const own = await ask('vé của tôi', empty.id);
  assert.match(own.reply, /chưa có vé sắp chạy/); assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
});

// ---- Task 7.3: holds and minutes left -----------------------------------------------------------------
const MINUTE = 60 * 1000;
const makeHold = (userId, { event, category }, orderCode, msLeft, status = 'HOLD') => Booking.create({
  orderCode, userId, eventId: event._id, categoryId: category._id, status, expiresAt: new Date(Date.now() + msLeft),
  runnerInfo: { fullName: 'Người Giữ Chỗ', email: 'holder@test.local', phone: '0911111111' },
  price: 500000, totalAmount: 500000, finalAmount: 500000,
});

let holdOwners;
async function holdData() {
  if (holdOwners) return holdOwners;
  const [a, b, none] = [await harness.createUser(), await harness.createUser(), await harness.createUser()];
  const hue = await makeEvent(40, 'Giải Giữ Chỗ Huế'), vungTau = await makeEvent(50, 'Giải Của Người B');
  await makeHold(a.id, hue, 'RUN0A0A0A0A0A0A0A0A', 4.5 * MINUTE);
  // Still HOLD in the database because the sweeper has not run yet, but already past expiresAt.
  await makeHold(a.id, vungTau, 'RUN0A0A0A0A0A0A0A0B', -MINUTE);
  await makeHold(a.id, vungTau, 'RUN0A0A0A0A0A0A0A0C', 8 * MINUTE, 'PAID');
  await makeHold(b.id, vungTau, 'RUN0B0B0B0B0B0B0B0B', 9 * MINUTE);
  holdOwners = { a, b, none };
  return holdOwners;
}

test('holds tells the asker how many minutes are left, rounded up', async () => {
  const { a } = await holdData();
  const own = await ask('đơn giữ chỗ của tôi còn bao lâu', a.id);
  assert.match(own.reply, /Giải Giữ Chỗ Huế/); assert.match(own.reply, /Half Marathon 21K/); assert.match(own.reply, /còn 5 phút/);
  assert.deepEqual(own.actions, [{ label: 'Xem đơn đang giữ', url: '/account' }]); assert.equal(own.mode, 'guide');
  assert.doesNotMatch(JSON.stringify(own), /holder@test|0911111111|RUN0A/);
});

test('expired and paid holds are not shown', async () => {
  const { a } = await holdData();
  const own = await ask('đơn của tôi', a.id);
  assert.match(own.reply, /Giải Giữ Chỗ Huế/); assert.doesNotMatch(own.reply, /Giải Của Người B/);
  assert.equal((own.reply.match(/còn \d+ phút/g) || []).length, 1);
});

test("A typing B's order code still sees only A's holds", async () => {
  const { a } = await holdData();
  const own = await ask('kiểm tra đơn RUN0B0B0B0B0B0B0B0B của tôi', a.id);
  assert.match(own.reply, /Giải Giữ Chỗ Huế/); assert.doesNotMatch(JSON.stringify(own), /Giải Của Người B|RUN0B|9 phút/);
});

test('a user without holds is told so', async () => {
  const { none } = await holdData();
  const own = await ask('đơn của tôi', none.id);
  assert.match(own.reply, /không có đơn nào đang giữ chỗ/); assert.deepEqual(own.actions, [{ label: 'Xem đơn đang giữ', url: '/account' }]);
});

// ---- Task 7.4: wallet balance and pending top-ups -----------------------------------------------------
const HOUR = 60 * MINUTE;
const BANK = { bankBin: '970422', bankName: 'MB Bank', accountNo: '0123456789', accountName: 'NGUYEN VAN QUAN TRI' };
let requestSeq = 0;
const makeTopup = (userId, amount, transferCode, msLeft, status = 'PENDING') => PaymentRequest.create({
  userId, kind: 'TOPUP', amount, status, transferCode, bankSnapshot: BANK,
  requestKey: `support-topup-${++requestSeq}`, expiresAt: new Date(Date.now() + msLeft),
});

let walletOwners;
async function walletData() {
  if (walletOwners) return walletOwners;
  const [a, b, noWallet, locked] = [await harness.createUser({ balance: 150000 }), await harness.createUser({ balance: 777000 }),
    await harness.createUser(), await harness.createUser({ balance: 50000 })];
  await makeTopup(a.id, 200000, 'NAPAAAA2222', 20 * HOUR);
  await makeTopup(a.id, 100000, 'NAPAAAA3333', 2 * HOUR);
  // Expired requests stay PENDING forever (topupService only filters them out), so the query must check expiresAt.
  await makeTopup(a.id, 300000, 'NAPAAAA4444', -MINUTE);
  await makeTopup(a.id, 400000, 'NAPAAAA5555', 5 * HOUR, 'APPROVED');
  await makeTopup(b.id, 888000, 'NAPBBBB2222', 10 * HOUR);
  // A user only has a wallet after opening the wallet page once; the bot must not create one.
  await Wallet.deleteOne({ userId: noWallet.id });
  await Wallet.updateOne({ userId: locked.id }, { status: 'SUSPENDED' });
  walletOwners = { a, b, noWallet, locked };
  return walletOwners;
}

test('wallet shows the balance and live pending top-ups only', async () => {
  const { a } = await walletData();
  const own = await ask('số dư ví của tôi', a.id);
  assert.match(own.reply, /150\.000đ/); assert.match(own.reply, /2 lệnh nạp/);
  assert.match(own.reply, /200\.000đ/); assert.match(own.reply, /100\.000đ/);
  assert.doesNotMatch(own.reply, /300\.000đ|400\.000đ/);
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }]); assert.equal(own.mode, 'guide');
});

test("wallet never shows another user's balance or top-ups", async () => {
  const { a } = await walletData();
  const own = await ask('ví của tôi còn bao nhiêu', a.id);
  assert.match(own.reply, /150\.000đ/); assert.doesNotMatch(own.reply, /777\.000đ|888\.000đ/);
});

test('a user without a wallet is told so and the bot does not create one', async () => {
  const { noWallet } = await walletData();
  const own = await ask('ví của tôi', noWallet.id);
  assert.match(own.reply, /chưa có ví/); assert.equal(await Wallet.countDocuments({ userId: noWallet.id }), 0);
});

test('wallet answers never carry the transfer code or the bank snapshot', async () => {
  const { a } = await walletData();
  const own = JSON.stringify(await ask('lệnh nạp tiền của tôi duyệt chưa', a.id));
  assert.match(own, /200\.000đ/); assert.doesNotMatch(own, /NAP[A-Z0-9]{8}|0123456789|NGUYEN VAN|MB Bank|970422/);
});

test('a suspended wallet is reported as locked', async () => {
  const { locked } = await walletData();
  const own = await ask('ví của tôi', locked.id);
  assert.match(own.reply, /50\.000đ/); assert.match(own.reply, /tạm khóa/);
});
