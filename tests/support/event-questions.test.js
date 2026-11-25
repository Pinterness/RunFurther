// Câu hỏi về giải chạy của trợ lý (phát hiện 25-11): "giải chạy nào" phải khớp bài lịch giải như "giải nào"; câu hỏi
// đếm ("bao nhiêu giải") được trả bằng số đếm thật trong database, không qua AI; lịch giải mặc định chỉ có giải chưa
// diễn ra, xếp gần nhất trước. Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers), không đụng database thật.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-events-test-secret';

const { app } = require('../../src/backend/server');
const Event = require('../../src/backend/models/Event');
const { createSupportResponder, isEventCountQuestion } = require('../../src/backend/services/supportAiService');
const { rankArticles, seedArticles, normalizeSupportText } = require('../../src/backend/services/supportKnowledge');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_events' });
const DAY = 24 * 60 * 60 * 1000;
// Trưa 20-11-2026 giờ Việt Nam; mọi ngày trong test tính từ mốc này để test không đổi theo ngày chạy.
const NOW = new Date('2026-11-20T05:00:00Z');
const at = days => new Date(NOW.getTime() + days * DAY);

let seq = 0;
function makeEvent(name, { race, status = 'REGISTRATION_OPEN', city = 'Cần Thơ', open = [-5, 5], state = 'ACTIVE' }) {
  seq += 1;
  return Event.create({
    name, slug: `su-kien-${seq}`, status, moderation: { state },
    location: { city, venue: 'Công viên' },
    dateInfo: { raceDate: at(race), registrationStart: at(open[0]), registrationEnd: at(open[1]) },
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
const keysFor = question => rankArticles(seedArticles(), question).map(article => article.key);

before(async () => {
  await harness.start();
  await makeEvent('Giải mở đăng ký Cần Thơ', { race: 10 });
  await makeEvent('Giải công bố Đà Nẵng', { race: 40, status: 'PUBLISHED', city: 'Đà Nẵng', open: [20, 35] });
  // Giải chạy ngay hôm nay (0 giờ UTC, tức 7 giờ sáng Việt Nam, đã qua mốc NOW) vẫn là giải chưa diễn ra trong ngày.
  await Event.create({
    name: 'Giải chạy hôm nay', slug: 'giai-hom-nay', status: 'REGISTRATION_CLOSED', location: { city: 'Huế', venue: 'Đại Nội' },
    dateInfo: { raceDate: new Date('2026-11-20T00:00:00Z'), registrationStart: at(-30), registrationEnd: at(-2) },
  });
  await makeEvent('Giải đã xong Huế', { race: -30, status: 'COMPLETED', city: 'Huế', open: [-60, -35] });
  await makeEvent('Giải bị ẩn', { race: 15, state: 'HIDDEN' });
  await makeEvent('Giải nháp', { race: 15, status: 'DRAFT' });
  await makeEvent('Giải bị hủy', { race: 15, status: 'CANCELLED' });
});
after(harness.stop);

test('A1: "giải chạy …" khớp bài lịch giải như "giải …"', () => {
  for (const question of ['giải chạy sắp tới là giải nào', 'hiện có những giải chạy nào', 'tìm giải chạy ở Đà Nẵng', 'giai chay sap toi']) {
    assert.equal(keysFor(question)[0], 'events', question);
  }
  // Câu xin mở giải có chữ "giải chạy" nhưng không hỏi lịch giải: quy đổi không được kéo nó sang bài lịch giải.
  assert.notEqual(keysFor('muốn mở giải chạy thì làm gì')[0], 'events');
});

test('A2: nhận ra câu hỏi đếm giải, không nhầm với câu hỏi giá hay giải thưởng', () => {
  const yes = ['hiện có bao nhiêu giải chạy', 'có mấy giải', 'số lượng giải chạy', 'bao nhieu giai chay', 'tổng cộng có bao nhiêu giải', 'RunFurther có bao nhiêu giải chạy vậy'];
  const no = ['giá vé giải này bao nhiêu', 'bao nhiêu giải thưởng', 'giải chạy nào sắp diễn ra', 'đăng ký bao nhiêu giải thì được giảm giá', 'mua vé như thế nào'];
  for (const question of yes) assert.equal(isEventCountQuestion(normalizeSupportText(question)), true, question);
  for (const question of no) assert.equal(isEventCountQuestion(normalizeSupportText(question)), false, question);
});

test('A2: câu hỏi đếm trả số đếm thật, chỉ tính giải công khai, không gọi AI', async () => {
  aiCalls = 0;
  const result = await answer({ message: 'hiện có bao nhiêu giải chạy' });
  assert.equal(result.mode, 'guide');
  assert.equal(aiCalls, 0);
  assert.deepEqual(result.articleKeys, []);
  assert.match(result.reply, /3 giải sắp diễn ra/);
  assert.match(result.reply, /1 giải đang mở đăng ký/);
  assert.match(result.reply, /1 giải đã diễn ra/);
  // Liệt kê giải sắp tới, gần nhất trước; không có giải ẩn, nháp, hủy hay đã xong trong danh sách.
  const order = ['Giải chạy hôm nay', 'Giải mở đăng ký Cần Thơ', 'Giải công bố Đà Nẵng'].map(name => result.reply.indexOf(name));
  assert.ok(order.every(index => index >= 0), result.reply);
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'gần nhất trước');
  assert.doesNotMatch(result.reply, /bị ẩn|nháp|bị hủy|đã xong Huế/);
  assert.ok(result.sources.some(source => source.url === '/events'));
  assert.ok(result.actions.length >= 1);
});

test('A2: câu hỏi đếm theo thành phố, và thành phố chưa có giải', async () => {
  const danang = await answer({ message: 'có bao nhiêu giải ở Đà Nẵng' });
  assert.match(danang.reply, /1 giải sắp diễn ra/);
  assert.match(danang.reply, /Giải công bố Đà Nẵng/);
  assert.doesNotMatch(danang.reply, /Cần Thơ/);
  const hanoi = await answer({ message: 'có mấy giải ở Hà Nội' });
  assert.match(hanoi.reply, /chưa có giải công khai nào sắp diễn ra/i);
  assert.equal(hanoi.mode, 'guide');
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

test('A3: lịch giải mặc định chỉ có giải chưa diễn ra, gần nhất trước; hỏi giải đã diễn ra thì có giải cũ', async () => {
  // Tắt AI để đọc đúng câu lịch giải dựng từ dữ liệu (AI bật thì viết lại câu này).
  const guide = createSupportResponder({ findArticles: async () => seedArticles(), recordMiss: null, generateReply: null, now: () => NOW });
  const upcoming = await guide({ message: 'có giải chạy nào không' });
  assert.doesNotMatch(upcoming.reply, /Giải đã xong Huế/);
  const names = ['Giải chạy hôm nay', 'Giải mở đăng ký Cần Thơ', 'Giải công bố Đà Nẵng'].map(name => upcoming.reply.indexOf(name));
  assert.ok(names.every(index => index >= 0), upcoming.reply);
  assert.deepEqual([...names].sort((x, y) => x - y), names);

  const past = await guide({ message: 'những giải nào đã diễn ra' });
  assert.match(past.reply, /Giải đã xong Huế/);
  assert.doesNotMatch(past.reply, /Giải công bố Đà Nẵng/);
});
