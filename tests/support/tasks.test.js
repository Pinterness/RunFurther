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
    assert.equal(result.reply, 'Bạn cần đăng nhập thì mình mới xem được số dư ví và lệnh nạp của bạn. Bạn bấm nút Đăng nhập bên dưới rồi hỏi lại mình nhé.');
    assert.equal(result.mode, 'guide');
    assert.deepEqual(result.actions, [{ label: 'Đăng nhập', url: '/login' }]);
  }
  assert.equal(ai.calls, 0);
});

test('ambiguous personal questions return task buttons without reading data', async () => {
  const ai = countingAi();
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: ai, runTask: mustNotRun });
  const result = await answer({ message: 'Của tôi sao rồi?', userId: USER });
  assert.equal(result.mode, 'guide'); assert.equal(ai.calls, 0);
  // The buttons open pages, so the reply does not promise that the bot will look (language review of 13-11, second round).
  assert.equal(result.reply, 'Bạn muốn xem vé và đơn giữ chỗ, ví hay yêu cầu hỗ trợ? Bạn bấm nút để mở trang, hoặc hỏi rõ hơn như "số dư ví của tôi" nhé.');
  assert.deepEqual(result.actions, [{ label: 'Vé của tôi', url: '/account' }, { label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }]);
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
  const failed = await answer({ message: 'ví của tôi còn bao nhiêu', userId: USER });
  assert.equal(failed.reply, 'Xin lỗi, mình chưa đọc được số dư ví và lệnh nạp của bạn lúc này. Bạn bấm "Ví của tôi" để xem trực tiếp, hoặc bấm "Gửi yêu cầu hỗ trợ" nếu vẫn lỗi nhé.');
  assert.deepEqual(failed.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' }]);
});

test('toActions keeps at most 3 internal or ticket-view actions', () => {
  assert.deepEqual(toActions([{ label: 'A', url: '/account' }, { label: 'B', url: 'https://x.example' }, { label: 'C', view: 'tickets' },
    { label: 'D', view: 'admin' }, { label: 'E', url: '/events' }, { label: 'F', url: '/lookup' }]),
  [{ label: 'A', url: '/account' }, { label: 'C', view: 'tickets' }, { label: 'E', url: '/events' }]);
  assert.deepEqual(toActions([{ label: 'x'.repeat(41), url: '/account' }, { label: '', url: '/account' }, { url: '/account' }, null, { label: 'Ví', url: '/account/wallet', extra: 'drop' }]),
    [{ label: 'Ví', url: '/account/wallet' }]);
  assert.deepEqual(toActions('not a list'), []);
});


// ---- Task 7.2–7.4 readers against real data ---------------------------------------------------------
// One fixed clock (10:00 on 13/11/2026 in Vietnam) so dates, times, "today" and minutes are asserted exactly.
const NOW = new Date('2026-11-13T03:00:00Z');
const MINUTE = 60 * 1000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const at = ms => new Date(NOW.getTime() + ms);
const SUPPORT = { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' };
// Every task question goes through the responder with a counting AI: no task may ever reach the provider.
const taskAi = countingAi();
const ask = async (message, userId) => {
  const result = await createSupportResponder({ findArticles: async () => seedArticles(), generateReply: taskAi, now: () => NOW })({ message, userId });
  assert.equal(taskAi.calls, 0, 'a task answer must never call the AI'); assert.equal(result.mode, 'guide');
  return result;
};

let eventSeq = 0;
async function makeEvent(raceDate, name, status = 'REGISTRATION_OPEN') {
  eventSeq += 1;
  const event = await Event.create({
    slug: `giai-thu-${eventSeq}`, name, status, location: { city: 'Huế', venue: 'Kinh thành' },
    dateInfo: { raceDate, registrationStart: at(-90 * DAY), registrationEnd: new Date(raceDate.getTime() - DAY) },
  });
  const category = await EventCategory.create({ eventId: event._id, code: '21K', name: 'Half Marathon 21K', distance: 21, price: 500000, quotaTotal: 100 });
  return { event, category };
}
const makeTicket = (userId, { event, category }, bibNumber, qrToken, status = 'CONFIRMED') => Registration.create({
  userId, eventId: event._id, categoryId: category._id, bibNumber, qrToken, status,
  runnerProfile: { fullName: 'Người Chạy', email: 'runner@test.local', phone: '0900000000' },
  payment: { bookingId: new mongoose.Types.ObjectId(), paidAmount: 500000 },
});
let orderSeq = 0;
const makeHold = (userId, { event, category }, expiresAt, status = 'HOLD') => Booking.create({
  orderCode: 'RUN' + String(++orderSeq).padStart(16, '0'), userId, eventId: event._id, categoryId: category._id, status, expiresAt,
  runnerInfo: { fullName: 'Người Giữ Chỗ', email: 'holder@test.local', phone: '0911111111' },
  price: 500000, totalAmount: 500000, finalAmount: 500000,
});
const BANK = { bankBin: '970422', bankName: 'MB Bank', accountNo: '0123456789', accountName: 'NGUYEN VAN QUAN TRI' };
const CODES = ['NAPAAAA2222', 'NAPAAAA3333', 'NAPAAAA4444', 'NAPAAAA5555', 'NAPAAAA6666', 'NAPAAAA7777', 'NAPAAAA8888', 'NAPAAAA9999'];
let requestSeq = 0;
const makeTopup = (userId, amount, createdAt, expiresAt, status = 'PENDING') => {
  requestSeq += 1;
  return PaymentRequest.create({
    userId, kind: 'TOPUP', amount, status, createdAt, requestKey: `support-topup-${requestSeq}`,
    // Requests made before transfer codes existed have no code, bank snapshot or expiry.
    ...(expiresAt ? { transferCode: CODES[requestSeq], bankSnapshot: BANK, expiresAt } : {}),
  });
};

const data = {};
before(async () => {
  const user = options => harness.createUser(options);
  // ---- tickets
  const today = await makeEvent(at(-5 * HOUR), 'Giải Sáng Nay'); // 05:00 today: still an upcoming race
  const lateYesterday = await makeEvent(at(-10.5 * HOUR), 'Giải Đêm Qua'); // 23:30 yesterday: already past
  const soon = await makeEvent(at(20 * DAY), 'Huế Heritage Run');
  const later = await makeEvent(at(60 * DAY), 'Đà Lạt Trail');
  const past = await makeEvent(at(-30 * DAY), 'Giải Đã Chạy');
  const cancelled = await makeEvent(at(30 * DAY), 'Giải Bị Hủy', 'CANCELLED');
  Object.assign(data, { a: await user(), b: await user(), c: await user(), d: await user(), e: await user(), empty: await user() });
  // Created in an order that differs from race order, so only sorting by race date lists them right.
  await makeTicket(data.a.id, soon, 'A-002', 'qr-secret-A2', 'PENDING_TRANSFER');
  await makeTicket(data.a.id, later, 'A-001', 'qr-secret-A1');
  await makeTicket(data.a.id, today, 'A-T01', 'qr-secret-AT', 'CHECKED_IN');
  await makeTicket(data.a.id, lateYesterday, 'A-Y01', 'qr-secret-AY');
  // Newer than the upcoming ones: they must not crowd them out.
  for (const n of [1, 2, 3]) await makeTicket(data.a.id, past, `A-P0${n}`, `qr-secret-AP${n}`);
  await makeTicket(data.a.id, soon, 'A-X01', 'qr-secret-AX1', 'CANCELLED');
  await makeTicket(data.a.id, soon, 'A-X02', 'qr-secret-AX2', 'TRANSFERRED');
  await makeTicket(data.b.id, soon, 'B-001', 'qr-secret-B1');
  for (const [n, slot] of [[1, soon], [2, later], [3, later], [4, later]]) await makeTicket(data.c.id, slot, `C-00${n}`, `qr-secret-C${n}`);
  await makeTicket(data.d.id, past, 'D-P01', 'qr-secret-D1');
  await makeTicket(data.d.id, lateYesterday, 'D-Y01', 'qr-secret-DY');
  await makeTicket(data.e.id, cancelled, null, 'qr-secret-E1');
  // ---- holds
  const events = {};
  for (const name of ['Hội An Night Run', 'Quy Nhơn Marathon', 'Sầm Sơn Run', 'Hạ Long Bay Run', 'Côn Đảo Run', 'Phú Quốc Run', 'Giải Của Người B']) {
    events[name] = await makeEvent(at(40 * DAY), name);
  }
  Object.assign(data, { holdA: await user(), holdB: await user(), holdF: await user(), noHold: await user() });
  await makeHold(data.holdA.id, events['Quy Nhơn Marathon'], at(8 * MINUTE));
  await makeHold(data.holdA.id, events['Hội An Night Run'], at(3 * MINUTE));
  await makeHold(data.holdA.id, events['Hạ Long Bay Run'], at(9.5 * MINUTE));
  await makeHold(data.holdA.id, events['Sầm Sơn Run'], at(4.5 * MINUTE));
  // Still HOLD in the database because the sweeper has not run yet, but already past expiresAt.
  await makeHold(data.holdA.id, events['Hội An Night Run'], at(-MINUTE));
  await makeHold(data.holdA.id, events['Quy Nhơn Marathon'], at(7 * MINUTE), 'PAID');
  await makeHold(data.holdB.id, events['Giải Của Người B'], at(9 * MINUTE));
  await makeHold(data.holdF.id, events['Côn Đảo Run'], at(2 * MINUTE));
  // The runner pressed "Tôi đã chuyển khoản": the booking stays HOLD and a BOOKING request waits for review.
  const reported = await makeHold(data.holdF.id, events['Phú Quốc Run'], at(6 * MINUTE));
  await PaymentRequest.create({ userId: data.holdF.id, bookingId: reported._id, kind: 'BOOKING', amount: 500000, requestKey: 'BOOKING-' + reported._id });
  // ---- wallet
  Object.assign(data, {
    walletA: await user({ balance: 150000 }), walletB: await user({ balance: 777000 }), noWallet: await user(),
    suspended: await user({ balance: 50000 }), closed: await user({ balance: 20000 }),
  });
  await makeTopup(data.walletA.id, 200000, at(-1 * HOUR), at(23 * HOUR));
  await makeTopup(data.walletA.id, 100000, at(-13 * HOUR), at(11 * HOUR));
  await makeTopup(data.walletA.id, 250000, at(-50 * HOUR), null); // made before codes and expiry existed: still waiting
  await makeTopup(data.walletA.id, 60000, at(-2 * HOUR), at(22 * HOUR));
  // Expired requests stay PENDING forever; the wallet page lists them as "Quá hạn".
  await makeTopup(data.walletA.id, 300000, at(-30 * HOUR), at(-6 * HOUR));
  await makeTopup(data.walletA.id, 400000, at(-5 * HOUR), at(19 * HOUR), 'APPROVED');
  await makeTopup(data.walletB.id, 888000, at(-1 * HOUR), at(23 * HOUR));
  // A wallet exists only once the account or wallet page was opened; the bot must not create one.
  await Wallet.deleteOne({ userId: data.noWallet.id });
  await Wallet.updateOne({ userId: data.suspended.id }, { status: 'SUSPENDED' });
  await Wallet.updateOne({ userId: data.closed.id }, { status: 'CLOSED' });
});

// ---- Task 7.2: upcoming tickets and BIB
test('tickets lists upcoming valid tickets by race date, today included, with the card wording', async () => {
  const own = await ask('Kiểm tra vé của tôi', data.a.id);
  assert.equal(own.reply, [
    'Bạn có 3 vé sắp chạy:',
    '- 13/11/2026 · Giải Sáng Nay (Half Marathon 21K) · BIB A-T01 · Đã check-in',
    '- 3/12/2026 · Huế Heritage Run (Half Marathon 21K) · BIB A-002 · Đang chuyển nhượng (đang rao bán)',
    '- 12/1/2027 · Đà Lạt Trail (Half Marathon 21K) · BIB A-001 · Vé đã xác nhận',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
  assert.doesNotMatch(JSON.stringify(own), /qr-secret|runner@test|0900000000/);
});

test('tickets shows the 3 earliest races and says how many there are', async () => {
  const many = await ask('vé của mình', data.c.id);
  const lines = many.reply.split('\n');
  assert.equal(lines[0], 'Bạn có 4 vé sắp chạy, đây là 3 vé chạy sớm nhất:');
  assert.equal(lines.filter(line => line.startsWith('- ')).length, 3); assert.match(many.reply, /C-001/);
  assert.equal(lines.at(-1), 'Vé còn lại bạn xem trong "Vé của tôi" nhé.');
});

test('a user with only past tickets is told there is no upcoming ticket', async () => {
  for (const who of [data.d, data.empty]) {
    const own = await ask('vé của tôi', who.id);
    assert.equal(own.reply, 'Bạn chưa có vé sắp chạy nào. Nếu bạn vừa chuyển khoản, vé chỉ được cấp sau khi xác nhận tiền đã nhận. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".');
    assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
  }
});

test('a ticket of a cancelled race says the race was cancelled', async () => {
  const own = await ask('vé của tôi', data.e.id);
  assert.equal(own.reply, 'Bạn có 1 vé sắp chạy:\n- 13/12/2026 · Giải Bị Hủy (Half Marathon 21K) · chưa có số BIB · Giải đã bị hủy');
});

test("A typing B's BIB still sees only A's tickets", async () => {
  const own = await ask('vé của tôi, BIB B-001', data.a.id);
  assert.match(own.reply, /A-001/); assert.doesNotMatch(JSON.stringify(own), /B-001|qr-secret/);
});

// ---- Task 7.3: holds
test('holds lists the 3 holds expiring first with the deadline and minutes rounded up', async () => {
  const own = await ask('đơn giữ chỗ của tôi còn bao lâu', data.holdA.id);
  assert.equal(own.reply, [
    'Bạn có 4 đơn đang giữ chỗ, đây là 3 đơn sắp hết giờ nhất:',
    '- Hội An Night Run (Half Marathon 21K): thanh toán trước 10:03 (còn khoảng 3 phút).',
    '- Sầm Sơn Run (Half Marathon 21K): thanh toán trước 10:04 (còn khoảng 5 phút).',
    '- Quy Nhơn Marathon (Half Marathon 21K): thanh toán trước 10:08 (còn khoảng 8 phút).',
    'Đơn còn lại bạn xem trong "Xem đơn chờ thanh toán" nhé.',
    'Quá giờ mà chưa thanh toán thì đơn hết hiệu lực và chỗ được trả lại.',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Xem đơn chờ thanh toán', url: '/account' }]);
  assert.doesNotMatch(JSON.stringify(own), /holder@test|0911111111|RUN0/);
});

test('a hold whose transfer was reported is not pushed for payment again', async () => {
  const own = await ask('đơn của tôi', data.holdF.id);
  assert.equal(own.reply, [
    'Bạn có 2 đơn đang giữ chỗ:',
    '- Côn Đảo Run (Half Marathon 21K): thanh toán trước 10:02 (còn khoảng 2 phút).',
    '- Phú Quốc Run (Half Marathon 21K): bạn đã báo chuyển khoản, đơn đang chờ đối soát nên bạn đừng chuyển thêm.',
    'Quá giờ mà chưa thanh toán thì đơn hết hiệu lực và chỗ được trả lại.',
  ].join('\n'));
});

test("A typing B's order code still sees only A's holds", async () => {
  const own = await ask('kiểm tra đơn RUN0B0B0B0B0B0B0B0B của tôi', data.holdA.id);
  assert.match(own.reply, /Hội An Night Run/); assert.doesNotMatch(JSON.stringify(own), /Giải Của Người B|RUN0B/);
});

test('a user without holds is told so and sent to the tickets', async () => {
  const own = await ask('đơn của tôi', data.noHold.id);
  assert.equal(own.reply, 'Bạn không có đơn nào đang giữ chỗ. Đơn quá giờ giữ chỗ mà chưa thanh toán đã hết hiệu lực, bạn cần đăng ký lại ở trang giải.');
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
});

// ---- Task 7.4: wallet
test('wallet shows the balance, the 3 newest waiting top-ups and the expired ones', async () => {
  const own = await ask('số dư ví của tôi', data.walletA.id);
  assert.equal(own.reply, [
    'Số dư ví của bạn là 150.000đ.',
    'Bạn có 4 lệnh nạp đang chờ đối soát, đây là 3 lệnh mới nhất:',
    '- 200.000đ, tạo lúc 09:00 ngày 13/11/2026.',
    '- 60.000đ, tạo lúc 08:00 ngày 13/11/2026.',
    '- 100.000đ, tạo lúc 21:00 ngày 12/11/2026.',
    'Lệnh còn lại bạn xem trong "Ví của tôi" nhé.',
    'Số dư chỉ tăng khi lệnh được duyệt.',
    'Bạn có 1 lệnh nạp đã quá hạn (300.000đ). Bạn đừng chuyển khoản theo lệnh đã quá hạn nữa. Nếu đã chuyển tiền, bạn bấm "Gửi yêu cầu hỗ trợ" để được đối soát.',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, SUPPORT]);
  assert.doesNotMatch(JSON.stringify(own), /NAP[A-Z0-9]{8}|0123456789|NGUYEN VAN|MB Bank|970422|777\.000đ|888\.000đ/);
});

test('a user without a wallet is told how to get one and the bot does not create it', async () => {
  const own = await ask('ví của tôi', data.noWallet.id);
  assert.equal(own.reply, 'Bạn chưa có ví. Bạn bấm "Ví của tôi" bên dưới là ví được tạo ngay.');
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }]);
  assert.equal(await Wallet.countDocuments({ userId: data.noWallet.id }), 0);
});

test('a wallet that is not active is reported as locked with a support button', async () => {
  for (const [who, balance] of [[data.suspended, '50.000đ'], [data.closed, '20.000đ']]) {
    const own = await ask('ví của tôi', who.id);
    assert.equal(own.reply, `Số dư ví của bạn là ${balance}.\nBạn không có lệnh nạp nào đang chờ đối soát.\nVí của bạn đang bị tạm khóa nên chưa thể nạp tiền. Bạn bấm "Gửi yêu cầu hỗ trợ" nếu cần mở lại nhé.`);
    assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, SUPPORT]);
  }
});

// ---- The HTTP route: whose data is read comes only from the token
test('the chat route reads only the token owner, whatever userId the request body carries', async () => {
  const own = await harness.request('/support/chat', { method: 'POST', as: data.walletA, body: { message: 'ví của tôi', userId: data.walletB.id } });
  assert.equal(own.status, 200); assert.match(own.body.reply, /150\.000đ/); assert.doesNotMatch(JSON.stringify(own.body), /777\.000đ|888\.000đ/);
  const guest = await harness.request('/support/chat', { method: 'POST', body: { message: 'ví của tôi', userId: data.walletB.id } });
  assert.equal(guest.status, 200); assert.match(guest.body.reply, /cần đăng nhập/); assert.doesNotMatch(JSON.stringify(guest.body), /777\.000đ|888\.000đ/);
});
