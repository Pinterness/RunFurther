// Các tác vụ đọc dữ liệu riêng của người hỏi (spec mục 4.7, plan P07): định tuyến, khách chưa đăng nhập, câu chưa
// rõ ý, nút bấm, và phần đọc của từng tác vụ trên MongoDB chạy trong bộ nhớ (replica set: một cụm MongoDB nhỏ
// để dùng được transaction, dựng sẵn ở tests/helpers).
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
const SupportTicket = require('../../src/backend/models/SupportTicket');
const RunPoints = require('../../src/backend/models/RunPoints');
const { seedArticles, normalizeSupportText } = require('../../src/backend/services/supportKnowledge');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { routeTask, toActions, createTaskRunner } = require('../../src/backend/services/supportTasks');
const { actionLabel } = require('../../src/lib/supportActions.cjs');
const { createBackendHarness } = require('../helpers/backendHarness');

// Bật theo dõi lệnh MongoDB để test cuối file chứng minh được các tác vụ chỉ gửi lệnh đọc.
const harness = createBackendHarness({ app, dbName: 'runfurther_support_tasks', monitorCommands: true });
before(harness.start);
after(harness.stop);

const USER = '507f1f77bcf86cd799439011';
const mustNotRun = () => { throw Error('Must not run'); };
// Responder nuốt mọi lỗi của AI, nên AI giả ném lỗi không chứng minh được AI chưa bị gọi: phải đếm số lần gọi.
const countingAi = () => { const ai = async () => { ai.calls++; return null; }; ai.calls = 0; return ai; };
const r = q => routeTask(normalizeSupportText(q));

test('routeTask dẫn câu hỏi về dữ liệu riêng tới đúng tác vụ và đánh dấu câu "của tôi" chưa rõ ý', () => {
  assert.deepEqual(r('Kiểm tra vé của tôi'), { key: 'tickets' }); assert.deepEqual(r('đơn của mình còn bao lâu'), { key: 'holds' });
  assert.deepEqual(r('ví của tôi còn bao nhiêu'), { key: 'wallet' }); assert.deepEqual(r('yêu cầu hỗ trợ của tôi'), { key: 'supportTickets' });
  assert.deepEqual(r('của tôi sao rồi'), { ambiguous: true }); assert.equal(r('nạp ví thế nào'), null);
  // Mẫu tác vụ nào cũng nhận "của em", "của e", nên câu chưa rõ ý cũng phải nhận như vậy.
  assert.deepEqual(r('thông tin của em đâu rồi'), { ambiguous: true }); assert.deepEqual(r('của e sao rồi ad'), { ambiguous: true });
});

test('có chữ sở hữu hoặc "kiểm tra giúp" thì câu hỏi về đơn giữ chỗ, BIB hay lệnh nạp được nhận là tác vụ', () => {
  assert.deepEqual(r('đơn giữ chỗ của tôi hết hạn chưa'), { key: 'holds' });
  assert.deepEqual(r('kiểm tra giúp mình đơn giữ chỗ còn hạn không'), { key: 'holds' });
  assert.deepEqual(r('BIB của tôi là số mấy'), { key: 'tickets' });
  assert.deepEqual(r('lệnh nạp tiền của tôi duyệt chưa'), { key: 'wallet' });
  for (const q of ['kiểm tra vé', 'Kiểm tra vé giúp mình', 'kiểm tra vé đã mua', 'kiểm tra vé nhé', 'kiểm tra vé HM21K-0A1B2C', 'kiểm tra vé số 1024', 'kiểm tra vé BIB A-001'])assert.deepEqual(r(q), { key: 'tickets' }, q);
  for (const q of ['kiểm tra đơn', 'kiểm tra đơn hàng', 'kiểm tra đơn giúp em', 'kiểm tra đơn RUN12AB34', 'kiểm tra đơn mã RUN12AB34']) assert.deepEqual(r(q), { key: 'holds' }, q);
});

test('chữ chỉ giống từ khóa tác vụ sau khi bỏ dấu thì không bị nhận là tác vụ', () => {
  // "vì", "vị" và "ví" bỏ dấu đều thành "vi"; "cô đơn" và "đơn vị" có chứa "don".
  for (const q of ['kiểm tra vì sao chưa nhận được email xác nhận vé', 'kiểm tra vị trí xuất phát ở đâu', 'check vị trí gửi đồ',
    'mình cô đơn quá', 'tôi có đơn vị tổ chức chưa', 'em có đơn bị hủy thì có được hoàn tiền không', 'đơn vị của tôi tạo giải thế nào',
    // "kiểm tra về …" bỏ dấu thành "kiem tra ve …", "kiểm tra đơn vị" thành "kiem tra don vi".
    'kiểm tra về việc hoàn tiền thế nào', 'cho mình hỏi kiểm tra về lịch chạy ở đâu', 'kiểm tra đơn vị tổ chức giải']) {
    assert.equal(r(q)?.key, undefined, q);
  }
});

test('câu hỏi về kết quả chạy hay RunPoints của chính người hỏi được nhận là tác vụ, câu hỏi chung thì không', () => {
  for (const q of ['kết quả chạy của tôi thế nào', 'thành tích của mình ở giải Huế', 'kq của e sao rồi ad', 'chip time của tôi bao nhiêu',
    'thời gian về đích của mình là bao nhiêu', 'kiểm tra giúp mình kết quả giải Huế', 'kiểm tra giúp kết quả của BIB A-001',
    'kiểm tra giúp mình kết quả', 'kiểm tra giúp em kq nhé', 'kiểm tra giúp mình chip time giải Huế']) {
    assert.deepEqual(r(q), { key: 'results' }, q);
  }
  for (const q of ['RunPoints của tôi còn bao nhiêu', 'điểm thưởng của mình được bao nhiêu rồi', 'tôi có bao nhiêu điểm', 'xem điểm của tôi',
    'e còn mấy runpoint vậy ad', 'xu của tôi dùng được không', 'ví của tôi có bao nhiêu điểm']) {
    assert.deepEqual(r(q), { key: 'runpoints' }, q);
  }
  // Câu hỏi chung không nhắc tới dữ liệu của chính người hỏi thì vẫn đi tới bài tri thức (nửa luyện q21, q22).
  // "Điểm" đứng sau chữ khác là từ khác ("địa điểm", "quan điểm"); "kết quả xét duyệt" không phải kết quả chạy.
  for (const q of ['khi nào có kết quả chạy', 'bao h có kq giải v ad', 'RunPoints là gì', 'điểm thưởng dùng thế nào',
    'kết quả xét duyệt quyền tổ chức của tôi', 'địa điểm của tôi ở đâu', 'quan điểm của tôi là chạy chậm thôi', 'điểm xuất phát của tôi ở đâu',
    // "Kiểm tra giúp" cộng "kết quả" chỉ là tác vụ khi "kết quả" nói về giải chạy, không phải kết quả xét duyệt hay nạp tiền.
    'kiểm tra giúp mình kết quả xét duyệt hoàn tiền', 'kiểm tra giúp kết quả nạp tiền của tôi']) {
    assert.equal(r(q)?.key, undefined, q);
  }
});

test('khách chưa đăng nhập nhận lời mời đăng nhập kèm nút /login, không tác vụ nào chạy', async () => {
  const ai = countingAi();
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: ai, runTask: mustNotRun });
  for (const userId of [null, 'not-an-object-id']) {
    const result = await answer({ message: 'Ví của tôi còn bao nhiêu?', userId });
    assert.equal(result.reply, 'Bạn cần đăng nhập thì mình mới xem được số dư ví và lệnh nạp của bạn. Bạn bấm nút "Đăng nhập" bên dưới rồi hỏi lại mình nhé.');
    assert.equal(result.mode, 'guide');
    assert.deepEqual(result.actions, [{ label: 'Đăng nhập', url: '/login' }]);
  }
  assert.equal(ai.calls, 0);
});

test('câu "của tôi" chưa rõ ý nhận các nút tác vụ, bot không đọc dữ liệu', async () => {
  const ai = countingAi();
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: ai, runTask: mustNotRun });
  const result = await answer({ message: 'Của tôi sao rồi?', userId: USER });
  assert.equal(result.mode, 'guide'); assert.equal(ai.calls, 0);
  // Nút thứ ba mở tab trong khung chat chứ không mở trang, và "vé (kể cả đơn giữ chỗ)" là một lựa chọn (soát ngôn ngữ vòng 2).
  assert.equal(result.reply, 'Bạn muốn xem vé (kể cả đơn giữ chỗ), ví hay yêu cầu hỗ trợ? Bạn bấm một nút bên dưới, hoặc hỏi rõ hơn, ví dụ "số dư ví của tôi" nhé.');
  assert.deepEqual(result.actions, [{ label: 'Vé của tôi', url: '/account' }, { label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }]);
});

test('câu có "của tôi" mà khớp một bài tri thức thì vẫn nhận bài đó', async () => {
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, runTask: mustNotRun });
  for (const [q, key] of [['hồ sơ của tôi sửa ở đâu', 'profile'], ['avatar của tôi không hiện', 'profile'], ['quên mật khẩu tài khoản của mình', 'account']]) {
    const result = await answer({ message: q, userId: USER });
    assert.ok(result.reply.startsWith(seedArticles().find(a => a.key === key).answer), q); assert.equal(result.actions, undefined, q);
  }
});

test('reader trả câu rỗng bị coi là đọc lỗi', async () => {
  const runTask = createTaskRunner({ readers: { wallet: async () => ({ actions: [] }) } });
  await assert.rejects(runTask('wallet', USER, { now: new Date() }));
  await assert.rejects(runTask('results', USER, { now: new Date() }), /No reader/);
  const answer = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, runTask });
  const failed = await answer({ message: 'ví của tôi còn bao nhiêu', userId: USER });
  assert.equal(failed.reply, 'Xin lỗi, mình chưa xem được số dư ví và lệnh nạp của bạn lúc này. Bạn bấm "Ví của tôi" để xem trực tiếp, hoặc bấm "Gửi yêu cầu hỗ trợ" nếu vẫn lỗi nhé.');
  assert.deepEqual(failed.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Gửi yêu cầu hỗ trợ', view: 'new-ticket' }]);
  // Nút "Yêu cầu hỗ trợ của tôi" mở danh sách, còn "Gửi yêu cầu hỗ trợ" mở form gửi mới: hai nút mở hai chỗ khác nhau.
  const noTickets = createSupportResponder({ findArticles: async () => seedArticles(), generateReply: null, runTask: createTaskRunner({ readers: {} }) });
  const failedTickets = await noTickets({ message: 'yêu cầu hỗ trợ của tôi', userId: USER });
  assert.equal(failedTickets.reply, 'Xin lỗi, mình chưa xem được yêu cầu hỗ trợ của bạn lúc này. Bạn bấm "Yêu cầu hỗ trợ của tôi" để xem trực tiếp, hoặc bấm "Gửi yêu cầu hỗ trợ" nếu vẫn lỗi nhé.');
  assert.deepEqual(failedTickets.actions, [{ label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }, { label: 'Gửi yêu cầu hỗ trợ', view: 'new-ticket' }]);
});

test('toActions chỉ giữ tối đa 3 nút trỏ vào trang nội bộ, danh sách yêu cầu hoặc form gửi yêu cầu hỗ trợ', () => {
  assert.deepEqual(toActions([{ label: 'A', url: '/account' }, { label: 'B', url: 'https://x.example' }, { label: 'C', view: 'tickets' },
    { label: 'D', view: 'admin' }, { label: 'E', url: '/events' }, { label: 'F', url: '/lookup' }]),
  [{ label: 'A', url: '/account' }, { label: 'C', view: 'tickets' }, { label: 'E', url: '/events' }]);
  assert.deepEqual(toActions([{ label: 'G', view: 'new-ticket', url: '/admin' }, { label: 'H', view: 'detail' }]), [{ label: 'G', view: 'new-ticket' }]);
  assert.deepEqual(toActions([{ label: 'x'.repeat(41), url: '/account' }, { label: '', url: '/account' }, { url: '/account' }, null, { label: 'Ví', url: '/account/wallet', extra: 'drop' }]),
    [{ label: 'Ví', url: '/account/wallet' }]);
  assert.deepEqual(toActions('not a list'), []);
});

test('chủ đề giải: câu trả lời có tối đa 3 nút dẫn tới trang giải nội bộ, tên dài được cắt còn 40 ký tự', async () => {
  const event = (name, url) => ({ name, url, city: 'Huế', date: '01/02/2031', registrationOpen: true, categories: [] });
  const events = [
    event('Giải chạy bộ Marathon Quốc tế Di sản Cố đô Huế mở rộng 2031', '/events/marathon-hue-2031'),
    event('Giải ở trang ngoài', 'https://x.example/giai'),
    event('Đà Lạt Ultra Trail Vượt Đèo Prenn 2031 Đêm Sương', '/events/da-lat-ultra-trail'),
    event('Hà Nội 10K', '/events/ha-noi-10k'),
    event('Vũng Tàu Night Run', '/events/vung-tau-night-run'),
  ];
  // Cắt ở ký tự 39 rồi thêm "…" cho đủ 40; khoảng trắng ngay trước chỗ cắt bị bỏ. Nút giữ nguyên khi AI trả lời.
  const expected = [
    { label: 'Giải chạy bộ Marathon Quốc tế Di sản Cố…', url: '/events/marathon-hue-2031' },
    { label: 'Đà Lạt Ultra Trail Vượt Đèo Prenn 2031…', url: '/events/da-lat-ultra-trail' },
    { label: 'Hà Nội 10K', url: '/events/ha-noi-10k' },
  ];
  for (const [generateReply, mode] of [[null, 'guide'], [async () => 'Trợ lý AI trả lời về các giải.', 'ai']]) {
    const answer = createSupportResponder({ findArticles: async () => seedArticles(), findEvents: async () => events, generateReply, canUseAi: async () => ({ allowed: true, reason: null }), runTask: mustNotRun });
    const result = await answer({ message: 'Có giải nào sắp diễn ra?' });
    assert.equal(result.mode, mode);
    assert.deepEqual(result.actions, expected);
  }
  const noEvents = createSupportResponder({ findArticles: async () => seedArticles(), findEvents: async () => [], generateReply: null, runTask: mustNotRun });
  assert.equal((await noEvents({ message: 'Có giải nào sắp diễn ra?' })).actions, undefined);
});

test('actionLabel không để sót nửa emoji khi chỗ cắt rơi vào giữa emoji', () => {
  // Emoji 🏃 chiếm hai ký tự JavaScript ở vị trí 38 và 39; cắt ở 39 sẽ còn nửa đầu, nửa đó phải bị bỏ cùng khoảng trắng trước nó.
  assert.equal(actionLabel('Sài Gòn Night Run mùa lễ hội cuối năm 🏃 2031'), 'Sài Gòn Night Run mùa lễ hội cuối năm…');
  assert.equal(actionLabel('  Hà Nội 10K  '), 'Hà Nội 10K');
  assert.equal(actionLabel(undefined), '');
});


// ---- Task 7.2–7.4: các reader đọc từ database chạy trong bộ nhớ ------------------------------------------
// Một đồng hồ cố định: 10:00 ngày 10/1/2031 giờ Việt Nam. Mốc này cố ý nằm xa ngày chạy test, nên nếu code lỡ dùng
// giờ thật thay cho `now` thì "hôm nay", số phút còn lại và lệnh quá hạn sẽ lệch, và test bắt được ngay.
const NOW = new Date('2031-01-10T03:00:00Z');
const MINUTE = 60 * 1000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const at = ms => new Date(NOW.getTime() + ms);
const SUPPORT = { label: 'Gửi yêu cầu hỗ trợ', view: 'new-ticket' };
const HOLD_FOOTER = 'Đơn chưa thanh toán mà quá giờ thì hết hiệu lực và chỗ được trả lại.';
// Mọi câu tác vụ đi qua responder với một AI đếm số lần gọi: không tác vụ nào được phép tới AI.
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
// `extra` thêm trường riêng cho từng test, ví dụ finishResult của vé đã chạy xong.
const makeTicket = (userId, { event, category }, bibNumber, qrToken, status = 'CONFIRMED', extra = {}) => Registration.create({
  userId, eventId: event._id, categoryId: category._id, bibNumber, qrToken, status,
  runnerProfile: { fullName: 'Người Chạy', email: 'runner@test.local', phone: '0900000000' },
  payment: { bookingId: new mongoose.Types.ObjectId(), paidAmount: 500000 },
  ...extra,
});
let orderSeq = 0;
const makeHold = (userId, { event, category }, expiresAt, status = 'HOLD') => Booking.create({
  orderCode: 'RUN' + String(++orderSeq).padStart(16, '0'), userId, eventId: event._id, categoryId: category._id, status, expiresAt,
  runnerInfo: { fullName: 'Người Giữ Chỗ', email: 'holder@test.local', phone: '0911111111' },
  price: 500000, totalAmount: 500000, finalAmount: 500000,
});
// Lệnh BOOKING mà confirmBooking tạo khi người chạy bấm "Tôi đã chuyển khoản"; mỗi đơn có tối đa một lệnh.
const reportTransfer = (userId, booking, status = 'PENDING') => PaymentRequest.create({
  userId, bookingId: booking._id, kind: 'BOOKING', amount: 500000, status, requestKey: 'BOOKING-' + booking._id,
});
const BANK = { bankBin: '970422', bankName: 'MB Bank', accountNo: '0123456789', accountName: 'NGUYEN VAN QUAN TRI' };
// Mã nạp giả theo đúng bảng chữ của mã thật (topupService), mỗi lệnh một mã khác nhau.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
let requestSeq = 0;
const makeTopup = (userId, amount, createdAt, expiresAt, status = 'PENDING') => {
  requestSeq += 1;
  return PaymentRequest.create({
    userId, kind: 'TOPUP', amount, status, createdAt, requestKey: `support-topup-${requestSeq}`,
    // Lệnh nạp tạo trước khi có mã chuyển khoản thì không có mã, không có tài khoản nhận và không có hạn.
    ...(expiresAt ? { transferCode: 'NAP' + Array.from({ length: 8 }, (_, i) => CODE_ALPHABET[Math.floor(requestSeq / 32 ** i) % 32]).join(''), bankSnapshot: BANK, expiresAt } : {}),
  });
};

const data = {};
before(async () => {
  const user = options => harness.createUser(options);
  // ---- vé
  const today = await makeEvent(at(-5 * HOUR), 'Giải Sáng Nay'); // 05:00 hôm nay: vẫn tính là giải sắp chạy
  const lateYesterday = await makeEvent(at(-10.5 * HOUR), 'Giải Đêm Qua'); // 23:30 hôm qua: đã qua
  const soon = await makeEvent(at(20 * DAY), 'Huế Heritage Run');
  // Hết hạn đăng ký nhưng vẫn diễn ra: không được nhầm với giải bị hủy.
  const later = await makeEvent(at(60 * DAY), 'Đà Lạt Trail', 'REGISTRATION_CLOSED');
  const past = await makeEvent(at(-30 * DAY), 'Giải Đã Chạy');
  const cancelled = await makeEvent(at(30 * DAY), 'Giải Bị Hủy', 'CANCELLED');
  Object.assign(data, { a: await user(), b: await user(), c: await user(), d: await user(), e: await user(), empty: await user() });
  // Tạo theo thứ tự khác thứ tự ngày chạy, nên chỉ khi sắp theo ngày chạy thì danh sách mới đúng.
  await makeTicket(data.a.id, soon, 'A-002', 'qr-secret-A2', 'PENDING_TRANSFER');
  await makeTicket(data.a.id, later, 'A-001', 'qr-secret-A1');
  await makeTicket(data.a.id, today, 'A-T01', 'qr-secret-AT', 'CHECKED_IN');
  await makeTicket(data.a.id, lateYesterday, 'A-Y01', 'qr-secret-AY');
  // Tạo sau các vé sắp chạy: không được chiếm chỗ của chúng.
  for (const n of [1, 2, 3]) await makeTicket(data.a.id, past, `A-P0${n}`, `qr-secret-AP${n}`);
  await makeTicket(data.a.id, soon, 'A-X01', 'qr-secret-AX1', 'CANCELLED');
  await makeTicket(data.a.id, soon, 'A-X02', 'qr-secret-AX2', 'TRANSFERRED');
  await makeTicket(data.b.id, soon, 'B-001', 'qr-secret-B1');
  for (const [n, slot] of [[1, soon], [2, later], [3, later], [4, later]]) await makeTicket(data.c.id, slot, `C-00${n}`, `qr-secret-C${n}`);
  await makeTicket(data.d.id, past, 'D-P01', 'qr-secret-D1');
  await makeTicket(data.d.id, lateYesterday, 'D-Y01', 'qr-secret-DY');
  await makeTicket(data.e.id, cancelled, null, 'qr-secret-E1');
  // ---- đơn giữ chỗ
  const events = {};
  for (const name of ['Hội An Night Run', 'Quy Nhơn Marathon', 'Sầm Sơn Run', 'Hạ Long Bay Run', 'Côn Đảo Run', 'Phú Quốc Run', 'Lý Sơn Run', 'Giải Của Người B']) {
    events[name] = await makeEvent(at(40 * DAY), name);
  }
  Object.assign(data, { holdA: await user(), holdB: await user(), holdF: await user(), holdG: await user(), noHold: await user() });
  await makeHold(data.holdA.id, events['Quy Nhơn Marathon'], at(8 * MINUTE));
  await makeHold(data.holdA.id, events['Hội An Night Run'], at(3 * MINUTE));
  await makeHold(data.holdA.id, events['Hạ Long Bay Run'], at(9.5 * MINUTE));
  // 4,2 phút: làm tròn lên ra 5, làm tròn thường ra 4, nên test phân biệt được hai cách.
  await makeHold(data.holdA.id, events['Sầm Sơn Run'], at(4.2 * MINUTE));
  // Trong database vẫn là HOLD vì bộ quét chưa chạy, nhưng đã quá expiresAt.
  await makeHold(data.holdA.id, events['Hội An Night Run'], at(-MINUTE));
  await makeHold(data.holdA.id, events['Quy Nhơn Marathon'], at(7 * MINUTE), 'PAID');
  await reportTransfer(data.holdB.id, await makeHold(data.holdB.id, events['Giải Của Người B'], at(9 * MINUTE)));
  await reportTransfer(data.holdB.id, await makeHold(data.holdB.id, events['Giải Của Người B'], at(-20 * MINUTE), 'EXPIRED'));
  // F: một đơn chờ thanh toán, một đơn đã báo chuyển khoản, một đơn bị chủ giải từ chối khoản chuyển,
  // cộng hai đơn đã báo chuyển khoản rồi hết giờ (một đã bị bộ quét đổi sang EXPIRED, một chưa).
  await makeHold(data.holdF.id, events['Côn Đảo Run'], at(2 * MINUTE));
  await reportTransfer(data.holdF.id, await makeHold(data.holdF.id, events['Phú Quốc Run'], at(6 * MINUTE)));
  await reportTransfer(data.holdF.id, await makeHold(data.holdF.id, events['Lý Sơn Run'], at(5 * MINUTE)), 'REJECTED');
  await reportTransfer(data.holdF.id, await makeHold(data.holdF.id, events['Phú Quốc Run'], at(-30 * MINUTE), 'EXPIRED'));
  await reportTransfer(data.holdF.id, await makeHold(data.holdF.id, events['Côn Đảo Run'], at(-2 * MINUTE)));
  // Khoản chuyển bị từ chối của một đơn đã hết giờ là chuyện cũ: không nhắc lại.
  await reportTransfer(data.holdF.id, await makeHold(data.holdF.id, events['Lý Sơn Run'], at(-HOUR), 'EXPIRED'), 'REJECTED');
  // G: không còn đơn nào trong giờ giữ chỗ, chỉ có một đơn đã báo chuyển khoản rồi hết giờ.
  await reportTransfer(data.holdG.id, await makeHold(data.holdG.id, events['Phú Quốc Run'], at(-15 * MINUTE), 'EXPIRED'));
  // ---- ví
  Object.assign(data, {
    walletA: await user({ balance: 150000 }), walletB: await user({ balance: 777000 }), noWallet: await user(),
    suspended: await user({ balance: 50000 }), closed: await user({ balance: 20000 }),
    crowded: await user(), onlyExpired: await user({ balance: 30000 }), noWalletWaiting: await user(),
  });
  await makeTopup(data.walletA.id, 200000, at(-1 * HOUR), at(23 * HOUR));
  await makeTopup(data.walletA.id, 100000, at(-13 * HOUR), at(11 * HOUR));
  await makeTopup(data.walletA.id, 250000, at(-50 * HOUR), null); // tạo trước khi có mã và hạn: vẫn tính là đang chờ
  await makeTopup(data.walletA.id, 60000, at(-2 * HOUR), at(22 * HOUR));
  // Lệnh quá hạn vẫn giữ trạng thái PENDING tới khi admin duyệt hoặc từ chối; trang ví liệt kê chúng với nhãn "Quá hạn".
  await makeTopup(data.walletA.id, 300000, at(-30 * HOUR), at(-6 * HOUR));
  await makeTopup(data.walletA.id, 400000, at(-5 * HOUR), at(19 * HOUR), 'APPROVED');
  await makeTopup(data.walletB.id, 888000, at(-1 * HOUR), at(23 * HOUR));
  // Một lệnh cũ đang chờ, cộng 21 lệnh quá hạn mới hơn: lệnh đang chờ không được bị đẩy ra khỏi danh sách.
  await makeTopup(data.crowded.id, 90000, at(-30 * DAY), null);
  for (let n = 1; n <= 21; n += 1) await makeTopup(data.crowded.id, n * 10000, at(-n * HOUR), at(-n * HOUR + 30 * MINUTE));
  await makeTopup(data.onlyExpired.id, 120000, at(-3 * DAY), at(-2 * DAY));
  await makeTopup(data.noWalletWaiting.id, 70000, at(-1 * HOUR), at(23 * HOUR));
  // Những người này chưa từng mở trang có gọi GET /wallet và chưa được cộng tiền nên chưa có ví; bot không được tự tạo ví.
  await Wallet.deleteOne({ userId: data.noWallet.id });
  await Wallet.deleteOne({ userId: data.noWalletWaiting.id });
  await Wallet.updateOne({ userId: data.suspended.id }, { status: 'SUSPENDED' });
  await Wallet.updateOne({ userId: data.closed.id }, { status: 'CLOSED' });
});

// ---- Task 7.2: vé sắp chạy và BIB
test('vé: liệt kê vé còn hiệu lực theo ngày chạy, tính cả giải hôm nay, dùng chữ của thẻ vé', async () => {
  const own = await ask('Kiểm tra vé của tôi', data.a.id);
  assert.equal(own.reply, [
    'Bạn có 3 vé sắp chạy:',
    '- 10/1/2031 · Giải Sáng Nay (Half Marathon 21K) · BIB A-T01 · Đã check-in',
    '- 30/1/2031 · Huế Heritage Run (Half Marathon 21K) · BIB A-002 · Đang chuyển nhượng (đang rao bán)',
    '- 11/3/2031 · Đà Lạt Trail (Half Marathon 21K) · BIB A-001 · Vé đã xác nhận',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
  assert.doesNotMatch(JSON.stringify(own), /qr-secret|runner@test|0900000000/);
});

test('vé: hiện 3 vé có ngày chạy gần nhất và nói rõ tổng số vé', async () => {
  const many = await ask('vé của mình', data.c.id);
  const lines = many.reply.split('\n');
  assert.equal(lines[0], 'Bạn có 4 vé sắp chạy, đây là 3 vé có ngày chạy gần nhất:');
  assert.equal(lines.filter(line => line.startsWith('- ')).length, 3); assert.match(many.reply, /C-001/);
  assert.equal(lines.at(-1), 'Vé còn lại bạn bấm "Vé của tôi" để xem nhé.');
});

test('vé: người chỉ có vé của giải đã qua được báo là chưa có vé sắp chạy', async () => {
  for (const who of [data.d, data.empty]) {
    const own = await ask('vé của tôi', who.id);
    assert.equal(own.reply, 'Bạn chưa có vé sắp chạy nào. Nếu bạn vừa chuyển khoản, vé chỉ được cấp sau khi chủ giải xác nhận đã nhận tiền. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".');
    assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
  }
});

test('vé: vé của giải bị hủy ghi rõ giải đã bị hủy, vé chưa có BIB ghi "BIB đang cấp"', async () => {
  const own = await ask('vé của tôi', data.e.id);
  assert.equal(own.reply, 'Bạn có 1 vé sắp chạy:\n- 9/2/2031 · Giải Bị Hủy (Half Marathon 21K) · BIB đang cấp · Giải đã bị hủy');
});

test('vé: A gõ BIB của B vẫn chỉ thấy vé của A', async () => {
  const own = await ask('vé của tôi, BIB B-001', data.a.id);
  assert.match(own.reply, /A-001/); assert.doesNotMatch(JSON.stringify(own), /B-001|qr-secret/);
});

// ---- Task 7.3: đơn giữ chỗ
test('đơn giữ chỗ: hiện 3 đơn sắp hết giờ nhất, kèm giờ hết hạn và số phút làm tròn lên', async () => {
  const own = await ask('đơn giữ chỗ của tôi còn bao lâu', data.holdA.id);
  assert.equal(own.reply, [
    'Bạn có 4 đơn đang giữ chỗ, đây là 3 đơn sắp hết giờ nhất:',
    '- Hội An Night Run (Half Marathon 21K): thanh toán trước 10:03 (còn chưa tới 3 phút).',
    '- Sầm Sơn Run (Half Marathon 21K): thanh toán trước 10:04 (còn chưa tới 5 phút).',
    '- Quy Nhơn Marathon (Half Marathon 21K): thanh toán trước 10:08 (còn chưa tới 8 phút).',
    HOLD_FOOTER,
    'Đơn còn lại bạn bấm "Xem đơn chờ thanh toán" để xem nhé.',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Xem đơn chờ thanh toán', url: '/account' }]);
  assert.doesNotMatch(JSON.stringify(own), /holder@test|0911111111|RUN0/);
});

test('đơn giữ chỗ: đơn đã báo chuyển khoản hay bị từ chối không bị giục thanh toán, đơn báo rồi hết giờ được nhắc đừng trả lại', async () => {
  const own = await ask('đơn của tôi', data.holdF.id);
  assert.equal(own.reply, [
    'Bạn có 3 đơn đang giữ chỗ:',
    '- Côn Đảo Run (Half Marathon 21K): thanh toán trước 10:02 (còn chưa tới 2 phút).',
    '- Lý Sơn Run (Half Marathon 21K): chủ giải đã từ chối khoản chuyển của đơn này, bạn đừng chuyển lại. Bạn bấm "Gửi yêu cầu hỗ trợ" để được hướng dẫn.',
    '- Phú Quốc Run (Half Marathon 21K): bạn đã báo chuyển khoản, đơn đang chờ chủ giải đối soát, bạn không cần chuyển thêm.',
    HOLD_FOOTER,
    'Bạn có 2 đơn đã báo chuyển khoản nhưng đã hết giờ giữ chỗ. Bạn đừng đăng ký hay chuyển tiền lại; bạn bấm "Gửi yêu cầu hỗ trợ" để được đối soát.',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Xem đơn chờ thanh toán', url: '/account' }, SUPPORT]);
});

test('đơn giữ chỗ: không còn đơn trong giờ mà có đơn đã báo chuyển khoản thì không bị khuyên đăng ký lại', async () => {
  const own = await ask('đơn của tôi', data.holdG.id);
  assert.equal(own.reply, 'Bạn không có đơn nào còn trong giờ giữ chỗ.\nBạn có 1 đơn đã báo chuyển khoản nhưng đã hết giờ giữ chỗ. Bạn đừng đăng ký hay chuyển tiền lại; bạn bấm "Gửi yêu cầu hỗ trợ" để được đối soát.');
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }, SUPPORT]);
});

test('đơn giữ chỗ: A gõ mã đơn của B vẫn chỉ thấy đơn của A', async () => {
  const own = await ask('kiểm tra đơn RUN0B0B0B0B0B0B0B0B của tôi', data.holdA.id);
  assert.match(own.reply, /Hội An Night Run/); assert.doesNotMatch(JSON.stringify(own), /Giải Của Người B|RUN0B|đã báo chuyển khoản/);
});

test('đơn giữ chỗ: người không có đơn được báo và nhận nút về Vé của tôi', async () => {
  const own = await ask('đơn của tôi', data.noHold.id);
  assert.equal(own.reply, 'Bạn không có đơn nào đang giữ chỗ. Đơn chưa thanh toán mà quá giờ thì đã hết hiệu lực, muốn giữ chỗ lại thì bạn đăng ký ở trang giải.');
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
});

// ---- Task 7.4: ví
const EXPIRED_ADVICE = 'Chưa chuyển thì bạn tạo lệnh mới trong "Ví của tôi". Đã chuyển rồi thì bạn bấm "Gửi yêu cầu hỗ trợ" và ghi kèm mã nạp hiện trong "Ví của tôi".';

test('ví: hiện số dư, 3 lệnh nạp đang chờ mới nhất và các lệnh đã quá hạn', async () => {
  const own = await ask('số dư ví của tôi', data.walletA.id);
  assert.equal(own.reply, [
    'Số dư ví của bạn là 150.000đ.',
    'Bạn có 4 lệnh nạp đang chờ đối soát, đây là 3 lệnh mới nhất:',
    '- 200.000đ, tạo lúc 09:00 ngày 10/1/2031.',
    '- 60.000đ, tạo lúc 08:00 ngày 10/1/2031.',
    '- 100.000đ, tạo lúc 21:00 ngày 9/1/2031.',
    'Số dư chỉ tăng khi lệnh được duyệt.',
    'Lệnh còn lại bạn bấm "Ví của tôi" để xem nhé.',
    'Bạn có 1 lệnh nạp đã quá hạn (300.000đ), bạn đừng chuyển khoản theo lệnh này. ' + EXPIRED_ADVICE,
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, SUPPORT]);
  assert.doesNotMatch(JSON.stringify(own), /NAP[A-Z0-9]{8}|0123456789|NGUYEN VAN|MB Bank|970422|777\.000đ|888\.000đ/);
});

test('ví: nhiều lệnh quá hạn mới hơn không đẩy lệnh đang chờ ra khỏi danh sách và được đếm đủ', async () => {
  const own = await ask('ví của tôi', data.crowded.id);
  assert.equal(own.reply, [
    'Số dư ví của bạn là 0đ.',
    'Bạn có 1 lệnh nạp đang chờ đối soát:',
    '- 90.000đ, tạo lúc 10:00 ngày 11/12/2030.',
    'Số dư chỉ tăng khi lệnh được duyệt.',
    'Bạn có 21 lệnh nạp đã quá hạn (10.000đ, 20.000đ, 30.000đ, …), bạn đừng chuyển khoản theo các lệnh này. ' + EXPIRED_ADVICE,
  ].join('\n'));
});

test('ví: ví chỉ có lệnh quá hạn thì báo không có lệnh đang chờ và nhắc lệnh quá hạn', async () => {
  const own = await ask('ví của tôi', data.onlyExpired.id);
  assert.equal(own.reply, [
    'Số dư ví của bạn là 30.000đ.',
    'Bạn không có lệnh nạp nào đang chờ đối soát.',
    'Bạn có 1 lệnh nạp đã quá hạn (120.000đ), bạn đừng chuyển khoản theo lệnh này. ' + EXPIRED_ADVICE,
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, SUPPORT]);
});

test('ví: người chưa có ví được chỉ cách tạo, bot không tự tạo ví', async () => {
  const own = await ask('ví của tôi', data.noWallet.id);
  assert.equal(own.reply, 'Bạn chưa có ví. Bạn bấm "Ví của tôi" bên dưới là ví được tạo ngay.');
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }]);
  const waiting = await ask('ví của tôi', data.noWalletWaiting.id);
  assert.equal(waiting.reply, [
    'Bạn chưa có ví. Bạn bấm "Ví của tôi" bên dưới là ví được tạo ngay.',
    'Bạn có 1 lệnh nạp đang chờ đối soát:',
    '- 70.000đ, tạo lúc 09:00 ngày 10/1/2031.',
    'Số dư chỉ tăng khi lệnh được duyệt.',
  ].join('\n'));
  assert.equal(await Wallet.countDocuments({ userId: { $in: [data.noWallet.id, data.noWalletWaiting.id] } }), 0);
});

test('ví: ví không ACTIVE được báo là đang bị khóa, kèm nút gửi yêu cầu hỗ trợ', async () => {
  for (const [who, balance] of [[data.suspended, '50.000đ'], [data.closed, '20.000đ']]) {
    const own = await ask('ví của tôi', who.id);
    assert.equal(own.reply, `Số dư ví của bạn là ${balance}.\nBạn không có lệnh nạp nào đang chờ đối soát.\nVí của bạn đang bị khóa nên chưa thể nạp tiền. Bạn bấm "Gửi yêu cầu hỗ trợ" nếu cần mở lại nhé.`);
    assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }, SUPPORT]);
  }
});

// ---- Route HTTP: dữ liệu của ai bị đọc chỉ do token quyết định
test('route chat chỉ đọc dữ liệu của chủ token, dù body gửi kèm userId của người khác', async () => {
  const own = await harness.request('/support/chat', { method: 'POST', as: data.walletA, body: { message: 'ví của tôi', userId: data.walletB.id } });
  assert.equal(own.status, 200); assert.match(own.body.reply, /150\.000đ/); assert.doesNotMatch(JSON.stringify(own.body), /777\.000đ|888\.000đ/);
  const guest = await harness.request('/support/chat', { method: 'POST', body: { message: 'ví của tôi', userId: data.walletB.id } });
  assert.equal(guest.status, 200); assert.match(guest.body.reply, /cần đăng nhập/); assert.doesNotMatch(JSON.stringify(guest.body), /777\.000đ|888\.000đ/);
});

// ---- Task 7.5: yêu cầu hỗ trợ
// Đặt sẵn updatedAt cho từng yêu cầu: lưu với { timestamps: false } để Mongoose không ghi đè bằng giờ thật.
const makeSupportTicket = (userId, subject, status, updatedAt) => new SupportTicket({
  userId, subject, status, createdAt: at(-7 * DAY), updatedAt,
  messages: [{ role: 'customer', authorId: userId, content: 'Nội dung riêng của yêu cầu ' + subject }],
}).save({ timestamps: false });

before(async () => {
  Object.assign(data, { ticketA: await harness.createUser(), ticketB: await harness.createUser(), noTicket: await harness.createUser() });
  // Tạo theo thứ tự khác thứ tự cập nhật, nên chỉ khi sắp theo updatedAt thì danh sách mới đúng.
  await makeSupportTicket(data.ticketA.id, 'Hoàn tiền giải bị hủy', 'CLOSED', at(-2 * DAY));
  await makeSupportTicket(data.ticketA.id, 'Sai tên trên BIB', 'OPEN', at(-5 * DAY));
  // Tiêu đề do người dùng gõ có thể chứa xuống dòng: câu trả lời phải giữ mỗi yêu cầu trên một dòng.
  await makeSupportTicket(data.ticketA.id, 'Không nhận được\nemail xác nhận', 'ANSWERED', at(-1 * HOUR));
  await makeSupportTicket(data.ticketA.id, 'Đổi cự ly 21K sang 10K', 'OPEN', at(-3 * HOUR));
  await makeSupportTicket(data.ticketB.id, 'Yêu cầu của người B', 'OPEN', at(-1 * HOUR));
});

test('yêu cầu hỗ trợ: hiện 3 yêu cầu mới cập nhật nhất với nhãn trạng thái như khung chat', async () => {
  const own = await ask('yêu cầu hỗ trợ của tôi', data.ticketA.id);
  assert.equal(own.reply, [
    'Bạn có 4 yêu cầu hỗ trợ, đây là 3 yêu cầu mới cập nhật nhất:',
    '- "Không nhận được email xác nhận" · Đã phản hồi · cập nhật lúc 09:00 ngày 10/1/2031',
    '- "Đổi cự ly 21K sang 10K" · Chờ phản hồi · cập nhật lúc 07:00 ngày 10/1/2031',
    '- "Hoàn tiền giải bị hủy" · Đã đóng · cập nhật lúc 10:00 ngày 8/1/2031',
    'Yêu cầu còn lại bạn bấm "Yêu cầu hỗ trợ của tôi" để xem nhé.',
  ].join('\n'));
  assert.deepEqual(own.actions, [{ label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }]);
  // Bot chỉ đọc tiêu đề và trạng thái, không đọc nội dung tin nhắn trong yêu cầu.
  assert.doesNotMatch(JSON.stringify(own), /Nội dung riêng/);
});

test('yêu cầu hỗ trợ: A không thấy yêu cầu của B', async () => {
  const own = await ask('ticket hỗ trợ của mình', data.ticketA.id);
  assert.match(own.reply, /Đổi cự ly/); assert.doesNotMatch(JSON.stringify(own), /người B/);
});

test('yêu cầu hỗ trợ: người chưa gửi yêu cầu nào được mời gửi yêu cầu mới', async () => {
  const own = await ask('yêu cầu hỗ trợ của tôi', data.noTicket.id);
  assert.equal(own.reply, 'Bạn chưa gửi yêu cầu hỗ trợ nào. Nếu cần nhân viên giúp, bạn bấm "Gửi yêu cầu hỗ trợ" để gửi yêu cầu mới.');
  assert.deepEqual(own.actions, [SUPPORT]);
});

// ---- Task 7.7: kết quả chạy và RunPoints
before(async () => {
  const hue = await makeEvent(at(-60 * DAY), 'Huế Heritage Marathon', 'COMPLETED');
  const danang = await makeEvent(at(-20 * DAY), 'Đà Nẵng International River Run 2030', 'COMPLETED');
  const quyNhon = await makeEvent(at(-100 * DAY), 'Quy Nhơn Beach Run', 'COMPLETED');
  // Giải bị quản trị viên ẩn: trang kết quả của nó trả 404, nên bot vẫn báo thời gian nhưng không đưa nút.
  const hidden = await makeEvent(at(-10 * DAY), 'Giải Bị Ẩn', 'COMPLETED');
  await Event.updateOne({ _id: hidden.event._id }, { 'moderation.state': 'HIDDEN' });
  // Giải bị chuyển sang CANCELLED sau khi đã có kết quả: trang kết quả cũng trả 404.
  const cancelledLater = await makeEvent(at(-40 * DAY), 'Giải Hủy Sau Khi Chạy', 'CANCELLED');
  const upcoming = await makeEvent(at(15 * DAY), 'Giải Sắp Chạy');
  Object.assign(data, {
    resultA: await harness.createUser(), resultB: await harness.createUser(), noResult: await harness.createUser(),
    resultTwin: await harness.createUser(), resultHidden: await harness.createUser(),
    pointsA: await harness.createUser(), pointsB: await harness.createUser(), zeroPoints: await harness.createUser(), noPoints: await harness.createUser(),
    resultSlugs: { hue: hue.event.slug, danang: danang.event.slug },
  });
  // Tạo theo thứ tự khác ngày chạy, nên chỉ khi sắp theo ngày chạy thì danh sách mới đúng. overallRank có trong
  // schema nhưng saveResult không bao giờ ghi, nên bot không được hiện nó.
  await makeTicket(data.resultA.id, hue, 'R-HUE', 'qr-secret-RH', 'CONFIRMED', { finishResult: { chipTime: '1:52:10', gunTime: '1:53:02', overallRank: 7 } });
  await makeTicket(data.resultA.id, quyNhon, 'R-QN', 'qr-secret-RQ', 'KIT_COLLECTED', { finishResult: { chipTime: '2:05:00', gunTime: '2:06:15' } });
  // Gun time sai định dạng (dữ liệu cũ) thì không hiện.
  await makeTicket(data.resultA.id, danang, 'R-DN', 'qr-secret-RD', 'CHECKED_IN', { finishResult: { chipTime: '0:48:30', gunTime: 'chưa rõ' } });
  await makeTicket(data.resultA.id, hidden, 'R-AN', 'qr-secret-RA', 'CONFIRMED', { finishResult: { chipTime: '0:30:00' } });
  // Không tính, giống trang kết quả: chip time sai định dạng, vé đã hủy, vé chưa có kết quả.
  await makeTicket(data.resultA.id, danang, 'R-DNF', 'qr-secret-RX', 'CONFIRMED', { finishResult: { chipTime: 'DNF' } });
  await makeTicket(data.resultA.id, hue, 'R-CXL', 'qr-secret-RC', 'CANCELLED', { finishResult: { chipTime: '1:10:00' } });
  await makeTicket(data.resultA.id, upcoming, 'R-UP', 'qr-secret-RU');
  await makeTicket(data.resultB.id, danang, 'R-B01', 'qr-secret-RB', 'CONFIRMED', { finishResult: { chipTime: '0:41:00', gunTime: '0:41:30' } });
  await makeTicket(data.noResult.id, upcoming, 'R-N01', 'qr-secret-RN');
  // Hai vé cùng một giải (hai cự ly), và một người chỉ có kết quả ở giải bị ẩn.
  await makeTicket(data.resultTwin.id, danang, 'R-T01', 'qr-secret-T1', 'CONFIRMED', { finishResult: { chipTime: '0:50:00' } });
  await makeTicket(data.resultTwin.id, danang, 'R-T02', 'qr-secret-T2', 'CONFIRMED', { finishResult: { chipTime: '1:55:00' } });
  await makeTicket(data.resultHidden.id, hidden, 'R-H01', 'qr-secret-H1', 'CONFIRMED', { finishResult: { chipTime: '0:35:00' } });
  await makeTicket(data.resultHidden.id, cancelledLater, 'R-H02', 'qr-secret-H2', 'CONFIRMED', { finishResult: { chipTime: '0:45:00' } });
  await RunPoints.create({ userId: data.pointsA.id, balance: 1250, lifetimeEarned: 1300, history: [{ type: 'EARNED', amount: 1300, reason: 'Booking RUN-BI-MAT' }] });
  await RunPoints.create({ userId: data.pointsB.id, balance: 999, lifetimeEarned: 999 });
  await RunPoints.create({ userId: data.zeroPoints.id, balance: 0, lifetimeEarned: 40 });
});

test('kết quả: hiện chip time và gun time của 3 giải gần nhất, không hiện thứ hạng, có nút tới trang kết quả của giải', async () => {
  const own = await ask('kết quả chạy của tôi', data.resultA.id);
  assert.equal(own.reply, [
    'Bạn có 4 kết quả chạy, đây là 3 kết quả gần nhất:',
    '- 31/12/2030 · Giải Bị Ẩn (Half Marathon 21K) · chip time 0:30:00',
    '- 21/12/2030 · Đà Nẵng International River Run 2030 (Half Marathon 21K) · chip time 0:48:30',
    '- 11/11/2030 · Huế Heritage Marathon (Half Marathon 21K) · chip time 1:52:10 · gun time 1:53:02',
    'Thứ hạng của bạn nằm ở trang kết quả của từng giải, bạn bấm nút "Kết quả" của giải đó bên dưới để xem nhé.',
  ].join('\n'));
  assert.deepEqual(own.actions, [
    { label: 'Kết quả Đà Nẵng International River Run…', url: `/events/${data.resultSlugs.danang}/results` },
    { label: 'Kết quả Huế Heritage Marathon', url: `/events/${data.resultSlugs.hue}/results` },
  ]);
  assert.doesNotMatch(JSON.stringify(own), /qr-secret|R-B01|0:41:00|runner@test/);
});

test('kết quả: hai vé cùng một giải chỉ có một nút; giải bị ẩn hay bị hủy không có nút và không nhắc xem thứ hạng', async () => {
  const twin = await ask('kết quả của tôi', data.resultTwin.id);
  assert.equal(twin.reply.split('\n')[0], 'Bạn có 2 kết quả chạy:'); assert.match(twin.reply, /0:50:00/); assert.match(twin.reply, /1:55:00/);
  assert.deepEqual(twin.actions, [{ label: 'Kết quả Đà Nẵng International River Run…', url: `/events/${data.resultSlugs.danang}/results` }]);
  const hidden = await ask('kết quả của tôi', data.resultHidden.id);
  assert.equal(hidden.reply, [
    'Bạn có 2 kết quả chạy:',
    '- 31/12/2030 · Giải Bị Ẩn (Half Marathon 21K) · chip time 0:35:00',
    '- 1/12/2030 · Giải Hủy Sau Khi Chạy (Half Marathon 21K) · chip time 0:45:00',
  ].join('\n'));
  assert.deepEqual(hidden.actions, [{ label: 'Vé và thành tích', url: '/account' }]);
});

test('kết quả: A gõ BIB của B vẫn chỉ thấy kết quả của A', async () => {
  const own = await ask('kiểm tra giúp kết quả của BIB R-B01', data.resultA.id);
  assert.match(own.reply, /0:48:30/); assert.doesNotMatch(JSON.stringify(own), /0:41:00|0:41:30|R-B01/);
});

test('kết quả: người chưa có kết quả nào được báo như vậy', async () => {
  for (const who of [data.noResult, data.empty]) {
    const own = await ask('thành tích của tôi', who.id);
    assert.equal(own.reply, 'Bạn chưa có kết quả chạy nào. Kết quả chỉ hiện sau khi ban tổ chức nhập thời gian về đích cho vé của bạn.');
    assert.deepEqual(own.actions, [{ label: 'Vé và thành tích', url: '/account' }]);
  }
});

test('RunPoints: hiện đúng số điểm của người hỏi và cách dùng điểm', async () => {
  const own = await ask('RunPoints của tôi còn bao nhiêu', data.pointsA.id);
  assert.equal(own.reply, 'Bạn đang có 1.250 RunPoints. Khi đăng ký giải, mỗi điểm giảm 1.000đ, tối đa một nửa giá trị đơn.');
  assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }]);
  assert.doesNotMatch(JSON.stringify(own), /999|1\.300|RUN-BI-MAT/);
});

test('RunPoints: người chưa có điểm được chỉ cách tích điểm, bot không tự tạo bản ghi điểm', async () => {
  for (const who of [data.zeroPoints, data.noPoints]) {
    const own = await ask('tôi có bao nhiêu điểm', who.id);
    assert.equal(own.reply, 'Bạn chưa có RunPoints nào. Mỗi 50.000đ bạn thanh toán cho vé được cộng 1 điểm, và điểm dùng để giảm giá khi đăng ký giải sau.');
    assert.deepEqual(own.actions, [{ label: 'Ví của tôi', url: '/account/wallet' }]);
  }
  assert.equal(await RunPoints.countDocuments({ userId: data.noPoints.id }), 0);
});

// ---- Người có nhiều hơn 20 dòng: mỗi truy vấn chỉ đọc tối đa 20 dòng, nên bot không biết tổng thật.
before(async () => {
  const upcoming = await makeEvent(at(30 * DAY), 'Giải Nhiều Vé');
  const finished = await makeEvent(at(-30 * DAY), 'Giải Nhiều Kết Quả', 'COMPLETED');
  Object.assign(data, {
    manyTickets: await harness.createUser(), manyHolds: await harness.createUser(), manyTopups: await harness.createUser({ balance: 10000 }),
    manySupport: await harness.createUser(), manyResults: await harness.createUser(),
  });
  for (let n = 1; n <= 21; n += 1) {
    await makeTicket(data.manyTickets.id, upcoming, `MANY-${n}`, `qr-secret-many-${n}`);
    await makeHold(data.manyHolds.id, upcoming, at(n * MINUTE));
    await makeTopup(data.manyTopups.id, n * 10000, at(-n * MINUTE), at(23 * HOUR));
    await makeSupportTicket(data.manySupport.id, `Yêu cầu số ${n}`, 'OPEN', at(-n * MINUTE));
    await makeTicket(data.manyResults.id, finished, `DONE-${n}`, `qr-secret-done-${n}`, 'CONFIRMED', { finishResult: { chipTime: '1:00:00' } });
  }
});

test('đọc chạm trần 20 dòng thì bot nói "từ 20 … trở lên" chứ không báo một tổng có thể sai', async () => {
  for (const [question, who, line, heading] of [
    ['vé của tôi', data.manyTickets, 0, 'Bạn có từ 20 vé sắp chạy trở lên, đây là 3 vé có ngày chạy gần nhất:'],
    ['đơn của tôi', data.manyHolds, 0, 'Bạn có từ 20 đơn đang giữ chỗ trở lên, đây là 3 đơn sắp hết giờ nhất:'],
    ['ví của tôi', data.manyTopups, 1, 'Bạn có từ 20 lệnh nạp đang chờ đối soát trở lên, đây là 3 lệnh mới nhất:'],
    ['yêu cầu hỗ trợ của tôi', data.manySupport, 0, 'Bạn có từ 20 yêu cầu hỗ trợ trở lên, đây là 3 yêu cầu mới cập nhật nhất:'],
    ['kết quả của tôi', data.manyResults, 0, 'Bạn có từ 20 kết quả chạy trở lên, đây là 3 kết quả gần nhất:'],
  ]) {
    const lines = (await ask(question, who.id)).reply.split('\n');
    assert.equal(lines[line], heading, question);
    assert.equal(lines.filter(text => text.startsWith('- ')).length, 3, question);
  }
});

// ---- Bot chỉ đọc (spec 5.1): hỏi mọi tác vụ, qua cả responder lẫn route HTTP, rồi kiểm database không đổi.
test('chạy mọi tác vụ không ghi gì vào database và mọi truy vấn đều có maxTimeMS', async () => {
  const models = [Registration, Booking, Wallet, PaymentRequest, SupportTicket, RunPoints];
  // Số tài liệu và updatedAt lớn nhất của từng collection: một lệnh ghi bất kỳ sẽ làm đổi ít nhất một trong hai.
  const snapshot = () => Promise.all(models.map(async Model => {
    const newest = await Model.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean();
    return [Model.modelName, await Model.countDocuments(), newest?.updatedAt?.toISOString() ?? null];
  }));
  const before = await snapshot();
  const commands = [];
  const client = mongoose.connection.getClient();
  const listen = event => commands.push({ name: event.commandName, collection: event.command[event.commandName], maxTimeMS: event.command.maxTimeMS });
  client.on('commandStarted', listen);
  try {
    const questions = ['vé của tôi', 'đơn của tôi', 'ví của tôi', 'yêu cầu hỗ trợ của tôi', 'kết quả chạy của tôi', 'RunPoints của tôi', 'của tôi sao rồi'];
    for (const who of [data.a, data.holdF, data.holdG, data.walletA, data.crowded, data.noWallet, data.ticketA, data.noTicket, data.resultA, data.pointsA, data.noPoints]) {
      for (const question of questions) await ask(question, who.id);
    }
    for (const question of questions) {
      assert.equal((await harness.request('/support/chat', { method: 'POST', as: data.walletA, body: { message: question } })).status, 200);
    }
  } finally { client.off('commandStarted', listen); }
  assert.deepEqual(await snapshot(), before);
  const writes = commands.filter(command => ['insert', 'update', 'delete', 'findAndModify', 'bulkWrite', 'create', 'drop'].includes(command.name));
  assert.deepEqual(writes, [], 'a task must only read');
  // Lệnh đọc của tác vụ (kể cả truy vấn phụ của populate và lệnh đếm) đều phải có giới hạn thời gian.
  const reads = commands.filter(command => ['find', 'aggregate'].includes(command.name) && command.collection !== 'users');
  assert.ok(reads.length > 0);
  assert.deepEqual(reads.filter(command => command.maxTimeMS !== 1500), [], 'every task read has maxTimeMS 1500');
});
