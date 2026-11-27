// Câu hỏi về giải chạy của trợ lý (phát hiện 25-11, sửa lần hai sau phản biện): "giải chạy nào" phải khớp bài lịch
// giải như "giải nào"; câu hỏi đếm ("bao nhiêu giải") được trả bằng số đếm thật trong database, không qua AI, và không
// bắt nhầm câu khác; lịch giải mặc định chỉ có giải chưa diễn ra, xếp gần nhất trước.
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-events-test-secret';

const { app } = require('../../src/backend/server');
const Event = require('../../src/backend/models/Event');
const { createSupportResponder, isEventCountQuestion, isOpenEventsQuestion } = require('../../src/backend/services/supportAiService');
const { rankArticles, seedArticles, normalizeSupportText } = require('../../src/backend/services/supportKnowledge');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_events', monitorCommands: true });
const DAY = 24 * 60 * 60 * 1000;
// Trưa 20-11-2026 giờ Việt Nam. 0 giờ hôm nay giờ Việt Nam là 2026-11-19T17:00Z; 0 giờ UTC là 2026-11-20T00:00Z.
const NOW = new Date('2026-11-20T05:00:00Z');
const at = days => new Date(NOW.getTime() + days * DAY);

let seq = 0;
function makeEvent(name, { race, status = 'REGISTRATION_CLOSED', city = 'Cần Thơ', open = [-30, -2], state = 'ACTIVE' }) {
  seq += 1;
  return Event.create({
    name, slug: `su-kien-${seq}`, status, moderation: { state },
    location: { city, venue: 'Công viên' },
    dateInfo: { raceDate: race instanceof Date ? race : at(race), registrationStart: at(open[0]), registrationEnd: at(open[1]) },
  });
}

let aiCalls = 0;
const answer = createSupportResponder({
  findArticles: async () => seedArticles(),
  recordMiss: null,
  canUseAi: async () => ({ allowed: true }),
  generateReply: async () => { aiCalls += 1; return 'AI không được dùng cho câu đếm'; },
  now: () => NOW,
});
// Tắt AI để đọc đúng câu lịch giải dựng từ dữ liệu (AI bật thì viết lại câu này).
const guide = createSupportResponder({ findArticles: async () => seedArticles(), recordMiss: null, generateReply: null, now: () => NOW });
const keysFor = (question, articles = seedArticles()) => rankArticles(articles, question).map(article => article.key);
const isCount = question => isEventCountQuestion(normalizeSupportText(question));
const COUNT_REPLY = /giải sắp diễn ra|chưa có giải công khai nào sắp diễn ra/;

before(async () => {
  await harness.start();
  // Sáu giải chưa diễn ra (tính từ 0 giờ hôm nay giờ Việt Nam), trong đó chỉ một giải đang trong khung đăng ký.
  await makeEvent('Giải mở đăng ký Cần Thơ', { race: 10, status: 'REGISTRATION_OPEN', open: [-5, 5] });
  await makeEvent('Giải công bố Đà Nẵng', { race: 40, status: 'PUBLISHED', city: 'Đà Nẵng', open: [20, 35] });
  await makeEvent('Giải hết hạn đăng ký Đà Nẵng', { race: 20, status: 'REGISTRATION_OPEN', city: 'Đà Nẵng', open: [-20, -2] });
  await makeEvent('Giải chạy hôm nay Huế', { race: new Date('2026-11-20T00:00:00Z'), city: 'Huế' });
  // 00:30 sáng 20-11 giờ Việt Nam: chưa diễn ra nếu tính đúng giờ Việt Nam, "đã qua" nếu lỡ tính 0 giờ theo UTC.
  await makeEvent('Giải nửa đêm Cần Thơ', { race: new Date('2026-11-19T17:30:00Z') });
  // Đúng 0 giờ 20-11 giờ Việt Nam: là giải hôm nay, không được tính vào "đã diễn ra".
  await makeEvent('Giải đúng không giờ Cần Thơ', { race: new Date('2026-11-19T17:00:00Z') });
  // Hai giải đã qua: 23:30 tối 19-11 giờ Việt Nam, và một tháng trước ở Huế.
  await makeEvent('Giải tối qua Cần Thơ', { race: new Date('2026-11-19T16:30:00Z'), status: 'COMPLETED' });
  await makeEvent('Giải đã xong Huế', { race: -30, status: 'COMPLETED', city: 'Huế', open: [-60, -35] });
  // Không bao giờ được đếm hay liệt kê.
  await makeEvent('Giải bị ẩn', { race: 15, state: 'HIDDEN' });
  await makeEvent('Giải nháp', { race: 15, status: 'DRAFT' });
  await makeEvent('Giải bị hủy', { race: 15, status: 'CANCELLED' });
});
after(harness.stop);

test('A1: "giải chạy …" khớp bài lịch giải (hai câu này trước bản sửa không ra bài nào)', () => {
  for (const question of ['hiện có những giải chạy nào', 'giai chay sap toi']) assert.equal(keysFor(question)[0], 'events', question);
});

test('A1: chỉ quy đổi câu hỏi, không quy đổi từ khóa: từ khóa "giải chạy" của admin không bắt mọi câu có chữ "giải"', () => {
  const custom = [...seedArticles(), { key: 'bai-admin', terms: ['giải chạy'], priority: 0 }];
  for (const question of ['giải thích giúp mình phí dịch vụ', 'đổi giải thưởng ở đâu', 'giai doan dang ky la gi']) {
    assert.ok(!keysFor(question, custom).includes('bai-admin'), question);
  }
  assert.ok(keysFor('mình muốn tìm giải chạy', custom).includes('bai-admin'));
});

test('A2: nhận ra câu hỏi đếm giải', () => {
  const yes = ['hiện có bao nhiêu giải chạy', 'có mấy giải', 'số lượng giải chạy', 'bao nhieu giai chay', 'tổng cộng có bao nhiêu giải',
    'RunFurther có bao nhiêu giải chạy vậy', 'cho mình hỏi có bao nhiêu giải đang mở', 'có bao nhiêu giải ở Đà Nẵng', 'có bao nhiêu giải ở TP HCM'];
  for (const question of yes) assert.equal(isCount(question), true, question);
});

test('A2: không bắt nhầm câu có chữ "giải"/"số" mang nghĩa khác, câu hỏi dữ liệu riêng, hay câu có điều kiện chưa lọc được', () => {
  const no = [
    // Sau khi bỏ dấu vẫn chứa "giai" hay "so" (phản biện 25-11).
    'Đăng ký có mấy giai đoạn?', 'có mấy giải pháp thanh toán', 'sợ giải bị hoãn có được hoàn tiền không', 'Nộp hồ sơ giải chạy ở đâu',
    'mã số giải là gì', 'giá vé giải này bao nhiêu', 'bao nhiêu giải thưởng', 'đăng ký bao nhiêu giải thì được giảm giá', 'mua vé như thế nào',
    // Dữ liệu riêng của người hỏi.
    'tôi có mấy giải đã đăng ký', 'có bao nhiêu giải của tôi', 'mình đã chạy bao nhiêu giải rồi',
    // Điều kiện bot chưa lọc được: tháng, cự ly, thành phố ngoài danh sách, giải đã qua.
    'tháng 12 có bao nhiêu giải', 'có bao nhiêu giải 42km', 'có bao nhiêu giải ở Quy Nhơn', 'có bao nhiêu giải đã diễn ra',
  ];
  for (const question of no) assert.equal(isCount(question), false, question);
});

test('A2: câu hỏi đếm trả số đếm thật theo 0 giờ giờ Việt Nam, chỉ tính giải công khai, không gọi AI', async () => {
  aiCalls = 0;
  const result = await answer({ message: 'hiện có bao nhiêu giải chạy' });
  assert.equal(result.mode, 'guide');
  assert.equal(aiCalls, 0);
  assert.deepEqual(result.articleKeys, []);
  assert.match(result.reply, /có 6 giải sắp diễn ra/);
  assert.match(result.reply, /trong đó 1 giải đang mở đăng ký/);
  assert.match(result.reply, /có 2 giải đã diễn ra/);
  // Năm giải gần nhất, gần nhất trước; giải thứ sáu được nhắc bằng câu "… và 1 giải khác".
  const names = ['Giải đúng không giờ Cần Thơ', 'Giải nửa đêm Cần Thơ', 'Giải chạy hôm nay Huế', 'Giải mở đăng ký Cần Thơ', 'Giải hết hạn đăng ký Đà Nẵng'];
  const order = names.map(name => result.reply.indexOf(name));
  assert.ok(order.every(index => index >= 0), result.reply);
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'gần nhất trước');
  assert.match(result.reply, /và 1 giải khác/);
  assert.doesNotMatch(result.reply, /Giải công bố Đà Nẵng|bị ẩn|nháp|bị hủy|tối qua|đã xong Huế/);
  assert.ok(result.sources.some(source => source.url === '/events'));
  assert.ok(result.actions.length >= 1);
});

test('A2: câu hỏi đếm theo thành phố lọc cả giải sắp tới lẫn giải đã qua; tên gọi khác của thành phố cũng nhận', async () => {
  const danang = await answer({ message: 'có bao nhiêu giải ở Đà Nẵng' });
  assert.match(danang.reply, /có 2 giải sắp diễn ra ở Đà Nẵng, trong đó 0 giải đang mở đăng ký/);
  assert.doesNotMatch(danang.reply, /Cần Thơ|đã diễn ra/);
  const hue = await answer({ message: 'có bao nhiêu giải ở Huế' });
  assert.match(hue.reply, /có 1 giải sắp diễn ra ở Huế/);
  assert.match(hue.reply, /có 1 giải đã diễn ra/);
  const hcm = await answer({ message: 'có bao nhiêu giải ở TP HCM' });
  assert.match(hcm.reply, /chưa có giải công khai nào sắp diễn ra ở Hồ Chí Minh/);
});

test('A2: câu hỏi dữ liệu riêng không nhận số giải toàn sàn', async () => {
  const owned = await answer({ message: 'tôi có mấy giải đã đăng ký' });
  assert.doesNotMatch(owned.reply, COUNT_REPLY);
  // "của tôi" mà không nói rõ tác vụ: bot hỏi lại bằng các nút, không trả số giải.
  const ambiguous = await answer({ message: 'có bao nhiêu giải của tôi' });
  assert.doesNotMatch(ambiguous.reply, COUNT_REPLY);
  assert.match(ambiguous.reply, /Bạn muốn xem vé/);
});

test('A2: câu hỏi đếm có điều kiện chưa lọc được thì không trả số giả', async () => {
  for (const message of ['tháng 12 có bao nhiêu giải', 'có bao nhiêu giải 42km', 'có bao nhiêu giải ở Quy Nhơn']) {
    assert.doesNotMatch((await guide({ message })).reply, /có \d+ giải sắp diễn ra/, message);
  }
});

test('A2: database lỗi thì báo chưa tải được, không đoán số', async () => {
  const broken = createSupportResponder({
    findArticles: async () => seedArticles(), recordMiss: null, generateReply: null, now: () => NOW,
    countEvents: async () => { throw new Error('database unavailable'); },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await broken({ message: 'có bao nhiêu giải' });
    assert.match(result.reply, /chưa tải được thông tin giải/);
    assert.doesNotMatch(result.reply, /\d+ giải/);
  } finally { console.error = quiet; }
});

test('A3: lịch giải mặc định chỉ có giải chưa diễn ra, gần nhất trước', async () => {
  const upcoming = await guide({ message: 'có giải chạy nào không' });
  assert.doesNotMatch(upcoming.reply, /tối qua|đã xong Huế/);
  const names = ['Giải đúng không giờ Cần Thơ', 'Giải nửa đêm Cần Thơ', 'Giải chạy hôm nay Huế'].map(name => upcoming.reply.indexOf(name));
  assert.ok(names.every(index => index >= 0), upcoming.reply);
  assert.deepEqual([...names].sort((x, y) => x - y), names);
  // Có chữ "trước đây" nhưng đang hỏi giải sắp tới: vẫn là lịch giải sắp tới.
  const mixed = await guide({ message: 'trước đây tôi chưa chạy giải nào, có giải nào sắp tới không' });
  assert.match(mixed.reply, /Giải đúng không giờ Cần Thơ/);
  assert.doesNotMatch(mixed.reply, /tối qua|đã xong Huế/);
});

const isOpen = question => isOpenEventsQuestion(normalizeSupportText(question));
const OPEN_REPLY = /giải đang mở đăng ký|chưa có giải nào đang mở đăng ký|chưa có giải nào sắp diễn ra/;

test('B1: nhận ra câu hỏi "giải nào đang mở đăng ký"', () => {
  const yes = ['giải nào còn mở đăng ký', 'Giải nào đang mở đăng ký?', 'có giải nào đang mở đăng ký không', 'những giải đang mở đăng ký',
    'giải chạy nào còn nhận đăng ký', 'còn giải nào mở bán vé không', 'danh sách giải đang mở đăng ký', 'ở Đà Nẵng có giải nào đang mở đăng ký không'];
  for (const question of yes) assert.equal(isOpen(question), true, question);
});

test('B1: không bắt nhầm câu hỏi cách đăng ký, câu dữ liệu riêng, câu có điều kiện chưa lọc được', () => {
  const no = [
    // Hỏi cách làm hay thời điểm, không hỏi danh sách giải.
    'làm sao đăng ký giải chạy', 'đăng ký giải như thế nào', 'khi nào giải mở đăng ký', 'giai đoạn mở đăng ký là gì', 'mở đăng ký rồi mua vé ở đâu', 'giải đang mở đăng ký thì đăng ký như thế nào',
    // Dữ liệu riêng, điều kiện chưa lọc được, giải đã qua, nơi chốn ngoài danh sách.
    'giải tôi đã đăng ký còn mở không', 'giải nào của tôi còn mở đăng ký', 'giải nào mở đăng ký tháng 12', 'giải 21km nào còn mở đăng ký', 'năm ngoái giải nào mở đăng ký',
    'ở Quy Nhơn có giải nào đang mở đăng ký không',
  ];
  for (const question of no) assert.equal(isOpen(question), false, question);
});

test('B1: trả danh sách giải đang trong hạn đăng ký từ database, không gọi AI', async () => {
  aiCalls = 0;
  const result = await answer({ message: 'giải nào còn mở đăng ký' });
  assert.equal(aiCalls, 0);
  assert.equal(result.mode, 'guide');
  assert.deepEqual(result.articleKeys, []);
  assert.match(result.reply, /Hiện RunFurther có 1 giải đang mở đăng ký/);
  assert.match(result.reply, /Giải mở đăng ký Cần Thơ/);
  // Trạng thái REGISTRATION_OPEN nhưng đã hết hạn, hay chưa tới ngày mở, đều không phải "đang mở".
  assert.doesNotMatch(result.reply, /Giải hết hạn đăng ký Đà Nẵng|Giải công bố Đà Nẵng|bị ẩn|nháp|bị hủy/);
  assert.ok(result.sources.some(source => source.title === 'Giải mở đăng ký Cần Thơ'));
});

test('B1: chưa có giải nào đang mở thì nói thẳng, kèm giải sắp diễn ra; lọc theo thành phố', async () => {
  const danang = await answer({ message: 'ở Đà Nẵng có giải nào đang mở đăng ký không' });
  assert.match(danang.reply, /chưa có giải nào đang mở đăng ký ở Đà Nẵng/);
  assert.match(danang.reply, /Giải hết hạn đăng ký Đà Nẵng/);
  assert.match(danang.reply, /Giải công bố Đà Nẵng/);
  assert.doesNotMatch(danang.reply, /Cần Thơ|\(đang mở đăng ký\)/);
  const hcm = await answer({ message: 'ở TP HCM có giải nào đang mở đăng ký không' });
  assert.match(hcm.reply, /chưa có giải nào sắp diễn ra ở Hồ Chí Minh/);
});

test('B1: hai thành phố cùng có giải đang mở thì hỏi theo thành phố chỉ ra giải của thành phố đó', async () => {
  // Tạo tạm rồi xóa ngay, để không làm lệch số đếm của các test khác trong file.
  const extra = await makeEvent('Giải mở đăng ký Huế', { race: 12, status: 'REGISTRATION_OPEN', city: 'Huế', open: [-3, 6] });
  try {
    const canTho = await answer({ message: 'ở Cần Thơ có giải nào đang mở đăng ký không' });
    assert.match(canTho.reply, /có 1 giải đang mở đăng ký ở Cần Thơ/);
    assert.match(canTho.reply, /Giải mở đăng ký Cần Thơ/);
    assert.doesNotMatch(canTho.reply, /Giải mở đăng ký Huế/);
    const all = await answer({ message: 'giải nào còn mở đăng ký' });
    assert.match(all.reply, /có 2 giải đang mở đăng ký/);
  } finally {
    await Event.deleteOne({ _id: extra._id });
  }
});

test('B1: câu gợi ý bot đưa sau câu đếm dẫn tới đúng danh sách giải đang mở, không ra bài hướng dẫn', async () => {
  const counted = await answer({ message: 'hiện có bao nhiêu giải chạy' });
  const chip = counted.suggestions.find(text => /mở đăng ký/.test(text));
  assert.ok(chip, JSON.stringify(counted.suggestions));
  const followed = await answer({ message: chip });
  assert.match(followed.reply, OPEN_REPLY);
  assert.deepEqual(followed.articleKeys, []);
});

test('B1: database lỗi thì báo chưa tải được, không đoán', async () => {
  const broken = createSupportResponder({
    findArticles: async () => seedArticles(), recordMiss: null, generateReply: null, now: () => NOW,
    countEvents: async () => { throw new Error('database unavailable'); },
    listOpen: async () => { throw new Error('database unavailable'); },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await broken({ message: 'giải nào còn mở đăng ký' });
    assert.match(result.reply, /chưa tải được thông tin giải/);
    assert.doesNotMatch(result.reply, /\d+ giải/);
  } finally { console.error = quiet; }
});

test('A3: hỏi giải đã diễn ra thì có giải cũ, vừa xong trước', async () => {
  const past = await guide({ message: 'những giải nào đã diễn ra' });
  const order = ['Giải tối qua Cần Thơ', 'Giải đã xong Huế'].map(name => past.reply.indexOf(name));
  assert.ok(order.every(index => index >= 0), past.reply);
  assert.ok(order[0] < order[1], 'giải vừa xong đứng trước');
  assert.doesNotMatch(past.reply, /Giải công bố Đà Nẵng|Giải đúng không giờ/);
});

// Phản biện 26-11 (sau PR #15): bộ nhận câu hỏi phải khớp trọn một khuôn, không cướp câu hỏi của bài khác; luật nơi
// chốn không nhầm "hiện tại", "tại sao"; giải đã chạy sáng nay không còn "đang mở"; đường thường gặp tốn 2 lệnh.
const mongoose = require('mongoose');

test('B2: nhận các cách hỏi thật (viết tắt, không dấu, "đăng kí", còn slot, bán vé, hiện tại, thành phố viết tắt)', () => {
  const yes = ['giai nao dang mo dk', 'giải nào đang mở đk', 'giải nào đang mở', 'giải nào còn đăng ký được', 'giải nào còn đăng ký được không',
    'giải nào đang cho đăng ký', 'giải nào còn vé', 'còn giải nào còn slot không', 'giải nào đang mở bán vé', 'giải nào đang bán vé',
    'có giải nào đang bán vé không', 'giải gì đang mở đăng ký', 'giải chạy gì đang mở đăng ký', 'đang có giải nào mở đăng ký',
    'có giải chạy nào mở đăng ký không ạ', 'các giải đang nhận đăng ký', 'giải nào còn hạn đăng ký', 'giải nào chưa hết hạn đăng ký',
    'list giải đang mở đăng ký', 'giải nào mở đăng ký rồi', 'hiện tại có giải nào mở đăng ký không', 'giải sắp tới nào đang mở đăng ký',
    'giải nào đang mở đăng kí', 'giai nao dang mo dang ki ko', 'ở HN có giải nào đang mở đăng ký không', 'Đà Lạt có giải nào đang mở đăng ký không',
    'giải nào ở Huế đang mở đăng ký', 'giải nào ở Vũng Tàu còn mở bán vé', 'cho mình hỏi giải nào còn mở đăng ký vậy', 'giải nào vừa mở đăng ký'];
  for (const question of yes) assert.equal(isOpen(question), true, question);
});

test('B2: không cướp câu hỏi có thêm ý khác (hoàn tiền, tuổi, thanh toán, hủy vé, hóa đơn...) — các câu đó đi tới bài tri thức', () => {
  const no = ['các giải mở bán vé có hoàn tiền không', 'giải đang mở đăng ký có giới hạn tuổi không', 'giải đang mở bán vé sao tôi không mua được',
    'những giải mở đăng ký có được chuyển nhượng vé không', 'giải đang mở đăng ký thì thanh toán bằng gì', 'các giải mở đăng ký có cần giấy khám sức khỏe không',
    'giải đang mở đăng ký có xuất hóa đơn không', 'giải nào mở đăng ký mà hết chỗ thì sao', 'giải đang mở bán vé có giảm giá nhóm không',
    'vì sao giải nào cũng mở đăng ký muộn', 'giải nào còn mở đăng ký có bao nhiêu chỗ', 'giải chạy nào đang mở đăng ký giá rẻ nhất',
    'tại sao giải đang mở đăng ký mà tôi không thấy nút mua', 'tôi muốn hủy vé giải đang mở đăng ký', 'giải nào đang mở đăng ký sáng nay'];
  for (const question of no) assert.equal(isOpen(question), false, question);
  // Hai câu tiêu biểu vẫn đến đúng bài như trước PR #15.
  assert.equal(keysFor('các giải mở bán vé có hoàn tiền không')[0], 'payment');
  assert.equal(keysFor('những giải mở đăng ký có được chuyển nhượng vé không')[0], 'marketplace');
});

test('B2: "hiện tại", "tại sao", "tài khoản" không bị luật nơi chốn hiểu là "tại + địa danh" (cả câu đếm)', () => {
  assert.equal(isCount('hiện tại có bao nhiêu giải'), true);
  assert.equal(isCount('hiện tại có bao nhiêu giải chạy ở Huế'), true);
  assert.equal(isOpen('hiện tại có giải nào mở đăng ký không'), true);
  assert.equal(isCount('có bao nhiêu giải ở Quy Nhơn'), false, 'nơi chốn lạ vẫn bị loại');
  assert.equal(isOpen('ở Quy Nhơn có giải nào đang mở đăng ký không'), false);
});

test('B2: câu "bao nhiêu giải đang mở đăng ký" đi đường đếm (được xét trước), trả số đếm', async () => {
  const result = await answer({ message: 'có bao nhiêu giải đang mở đăng ký' });
  assert.match(result.reply, /giải sắp diễn ra, trong đó 1 giải đang mở đăng ký/);
});

// Tạo tạm các giải, chạy thử, rồi xóa, để không làm lệch số đếm của các test khác.
async function withEvents(specs, run) {
  const created = [];
  try { for (const spec of specs) created.push(await makeEvent(...spec)); await run(); }
  finally { await Event.deleteMany({ _id: { $in: created.map(event => event._id) } }); }
}

test('B2: hơn 5 giải đang mở: liệt kê 5 giải gần nhất trước, ghi "… và N giải khác"', async () => {
  const specs = [3, 6, 9, 12, 15, 18].map(days => ['Giải mở thêm ' + days, { race: days + 30, status: 'REGISTRATION_OPEN', city: 'Hà Nội', open: [-2, 20] }]);
  await withEvents(specs, async () => {
    const result = await answer({ message: 'giải nào còn mở đăng ký' });
    assert.match(result.reply, /Hiện RunFurther có 7 giải đang mở đăng ký/);
    assert.match(result.reply, /… và 2 giải khác/);
    const names = ['Giải mở đăng ký Cần Thơ', 'Giải mở thêm 3', 'Giải mở thêm 6', 'Giải mở thêm 9', 'Giải mở thêm 12'];
    const order = names.map(name => result.reply.indexOf(name));
    assert.ok(order.every(index => index >= 0), result.reply);
    assert.deepEqual([...order].sort((x, y) => x - y), order, 'gần nhất trước');
    assert.doesNotMatch(result.reply, /Giải mở thêm 15|Giải mở thêm 18/);
  });
});

test('B2: biên thời gian: hết hạn đúng lúc này thì không còn mở, mở đúng lúc này thì đã mở, giải chạy sáng nay không còn "đang mở"', async () => {
  await withEvents([
    ['Giải vừa hết hạn', { race: 20, status: 'REGISTRATION_OPEN', city: 'Huế', open: [-10, 0] }],
    ['Giải vừa mở', { race: 21, status: 'REGISTRATION_OPEN', city: 'Huế', open: [0, 10] }],
    // 07:00 sáng 20-11 giờ Việt Nam, trước NOW (12:00): đã chạy xong dù hạn đăng ký tới mai.
    ['Giải chạy sáng nay', { race: new Date('2026-11-20T00:00:00Z'), status: 'REGISTRATION_OPEN', city: 'Huế', open: [-10, 1] }],
  ], async () => {
    const result = await answer({ message: 'giải nào ở Huế đang mở đăng ký' });
    assert.match(result.reply, /Giải vừa mở/);
    assert.doesNotMatch(result.reply, /Giải vừa hết hạn|Giải chạy sáng nay/);
    const counted = await answer({ message: 'có bao nhiêu giải ở Huế' });
    assert.match(counted.reply, /trong đó 1 giải đang mở đăng ký/);
  });
});

test('B2: có giải đang mở thì chỉ tốn 2 lệnh MongoDB (một lệnh đếm, một lệnh lấy giải)', async () => {
  const names = [];
  const client = mongoose.connection.getClient();
  const onStart = event => names.push(event.commandName + ':' + (event.command[event.commandName] || ''));
  client.on('commandStarted', onStart);
  try { await answer({ message: 'giải nào còn mở đăng ký' }); } finally { client.off('commandStarted', onStart); }
  assert.equal(names.length, 2, names.join(' '));
});
