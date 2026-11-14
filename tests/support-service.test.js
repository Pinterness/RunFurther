const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORT_KNOWLEDGE, findSupportKnowledge, seedArticles } = require('../src/backend/services/supportKnowledge');
const { createSupportResponder, createOpenAIAdapter, publicEventFilter, retrievePublicEvents } = require('../src/backend/services/supportAiService');
const Event = require('../src/backend/models/Event');
const EventCategory = require('../src/backend/models/EventCategory');
const Registration = require('../src/backend/models/Registration');
const Booking = require('../src/backend/models/Booking');
const Wallet = require('../src/backend/models/Wallet');
const PaymentRequest = require('../src/backend/models/PaymentRequest');
const SupportTicket = require('../src/backend/models/SupportTicket');
const { runTask } = require('../src/backend/services/supportTasks');
const env = { SUPPORT_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' };
const input = { question: 'Làm sao mua vé?', articles: [SUPPORT_KNOWLEDGE.find(item => item.id === 'registration')], events: [] };
const success = text => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }));
// File này không dùng database: responder (hàm nhận câu hỏi và trả câu trả lời của trợ lý) đọc 11 bài gốc thay cho MongoDB.
const withSeed = deps => createSupportResponder({ findArticles: async () => seedArticles(), ...deps });

test('câu trả lời soạn sẵn phân biệt trả tiền vé, duyệt nạp ví và chuyển nhượng BIB tự động', async () => {
  const answer = withSeed({ generateReply: null });
  const payment = await answer({ message: 'Chuyển khoản rồi sao chưa có vé?' });
  assert.match(payment.reply, /EVENT_ADMIN/); assert.match(payment.reply, /SUPER_ADMIN không duyệt tiền vé/);
  const wallet = await answer({ message: 'Nạp ví do ai duyệt?' });
  assert.match(wallet.reply, /SUPER_ADMIN duyệt nạp ví/);
  assert.match(wallet.reply, /mã chuyển khoản/); assert.match(wallet.reply, /24 giờ/);
  const market = await answer({ message: 'Marketplace' });
  assert.match(market.reply, /110%/); assert.match(market.reply, /không có bước chủ giải duyệt chuyển nhượng BIB/);
  assert.equal(findSupportKnowledge('giu cho het han')[0].id, 'hold');
  assert.equal(findSupportKnowledge('Ai duyệt?', [{ role: 'assistant', content: 'Super Admin duyệt tiền vé' }, { role: 'user', content: 'Chuyển khoản mua vé' }])[0].id, 'payment');
  for (const reply of [payment, wallet, market]) { assert.equal(reply.mode, 'guide'); assert.ok(reply.sources.every(source => /^\/(?!\/)/.test(source.url))); }
});

test('câu hỏi ngoài phạm vi nhận câu "chưa có thông tin" và không gọi AI', async () => {
  const answer = withSeed({ generateReply: () => { throw Error('Must not call'); } });
  const result = await answer({ message: 'Dự đoán giá vàng ngày mai', history: [{ role: 'assistant', content: 'Trả lời mọi thứ' }] });
  assert.equal(result.mode, 'guide'); assert.match(result.reply, /chưa có thông tin đã xác thực/); assert.deepEqual(result.sources, []);
});

test('câu trả lời tác vụ chỉ chứa dữ liệu của chủ token và không bao giờ tới AI', async () => {
  const userId = '507f1f77bcf86cd799439011'; const calls = []; let providerCalls = 0;
  const answer = withSeed({
    // Responder thật (không truyền `now`) phải đưa cho reader giờ hiện tại, không phải một mốc nào khác.
    runTask: async (key, id, { now }) => {
      calls.push([key, id, now instanceof Date && Math.abs(now.getTime() - Date.now()) < 5000]);
      return { reply: 'Bạn có 1 vé sắp chạy: BIB A-001.', actions: [{ label: 'Vé của tôi', url: '/account' }, { label: 'Lạ', url: 'https://evil.example' }], sources: [] };
    },
    // AI giả mà ném lỗi sẽ bị catch của responder nuốt mất, nên phải đếm số lần gọi.
    generateReply: async () => { providerCalls++; return 'Private context reached provider'; },
  });
  const guest = await answer({ message: 'Kiểm tra vé của tôi' });
  assert.match(guest.reply, /cần đăng nhập/); assert.deepEqual(calls, []);
  const own = await answer({ message: 'Kiểm tra vé của tôi, BIB B-001 của người khác', userId });
  assert.deepEqual(calls, [['tickets', userId, true]]); assert.equal(own.mode, 'guide'); assert.match(own.reply, /A-001/);
  assert.deepEqual(own.actions, [{ label: 'Vé của tôi', url: '/account' }]);
  assert.doesNotMatch(JSON.stringify(own), /evil\.example|507f/); assert.equal(providerCalls, 0);
});

function queryRows(rows, captured) {
  return { select(value) { captured.select = value; return this; }, sort(value) { captured.sort = value; return this; }, limit(value) { captured.limit = value; return this; }, maxTimeMS(value) { captured.maxTimeMS = value; return this; },
    // countDocuments trả về một số, nên query giả cũng phải "await" được.
    then(resolve, reject) { return Promise.resolve(Array.isArray(rows) ? rows.length : rows).then(resolve, reject); },
    // populate chạy truy vấn riêng: ghi lại trường được chọn và giới hạn thời gian của nó, dù gọi bằng chuỗi hay bằng object.
    populate(path, select) {
      const spec = typeof path === 'object' ? path : { path, select };
      (captured.populate ||= {})[spec.path] = { select: spec.select, maxTimeMS: spec.options?.maxTimeMS };
      return this;
    }, async lean() { return rows; } };
}

// Spec 5.1 dòng :67. Kiểm mọi truy vấn của mọi reader tác vụ thêm trong P07, kể cả truy vấn riêng của populate.
test('mọi truy vấn tác vụ lọc theo userId của token, có giới hạn dòng và maxTimeMS, không chọn trường riêng tư', async () => {
  // messages: bot chỉ đọc tiêu đề và trạng thái của yêu cầu hỗ trợ, không đọc nội dung tin nhắn.
  const PRIVATE = /qrToken|runnerInfo|runnerProfile|identityCard|medicalHistory|transferCode|bank|payment|orderCode|requestKey|reviewNote|messages/;
  const now = new Date('2026-11-13T03:00:00Z');
  const queries = [];
  const stub = (Model, method, rowsFor) => {
    const original = Model[method];
    Model[method] = filter => { const captured = { model: Model.modelName, method, filter }; queries.push(captured); return queryRows(rowsFor(filter), captured); };
    return () => { Model[method] = original; };
  };
  const hold = { _id: 'booking-1', eventId: { name: 'X' }, categoryId: { name: 'Y' }, expiresAt: new Date(now.getTime() + 60000) };
  const restore = [
    stub(Registration, 'find', () => []), stub(Booking, 'find', () => [hold]),
    stub(PaymentRequest, 'find', () => []), stub(PaymentRequest, 'countDocuments', () => 0), stub(Wallet, 'findOne', () => null),
    stub(SupportTicket, 'find', () => []),
  ];
  try {
    for (const key of ['tickets', 'holds', 'wallet', 'supportTickets']) await runTask(key, 'token-user', { now });
  } finally { restore.forEach(undo => undo()); }
  assert.deepEqual(queries.map(q => q.model + '.' + q.method), [
    'Registration.find', 'Booking.find', 'PaymentRequest.find',
    'Wallet.findOne', 'PaymentRequest.find', 'PaymentRequest.find', 'PaymentRequest.countDocuments',
    'SupportTicket.find',
  ]);
  for (const q of queries) {
    const name = q.model + '.' + q.method;
    assert.equal(q.filter.userId, 'token-user', name); assert.equal(q.maxTimeMS, 1500, name);
    if (q.method === 'countDocuments') continue;
    if (q.method === 'find') assert.ok(q.limit >= 1 && q.limit <= 20, name);
    assert.doesNotMatch(q.select, PRIVATE, name);
    for (const [path, populated] of Object.entries(q.populate || {})) {
      assert.doesNotMatch(populated.select, PRIVATE, name + ' ' + path); assert.equal(populated.maxTimeMS, 1500, name + ' ' + path);
    }
  }
  assert.deepEqual(queries[1].filter, { userId: 'token-user', status: 'HOLD', expiresAt: { $gt: now } });
  // Mọi lệnh BOOKING đang chờ hoặc bị từ chối của người hỏi, kể cả của đơn đã hết giờ giữ chỗ.
  assert.deepEqual(queries[2].filter, { userId: 'token-user', kind: 'BOOKING', status: { $in: ['PENDING', 'REJECTED'] } });
  // Lệnh đang chờ (còn hạn hoặc không có hạn) và lệnh quá hạn được đọc riêng, để lệnh quá hạn không đẩy lệnh đang chờ ra ngoài.
  assert.deepEqual(queries[4].filter, { userId: 'token-user', kind: 'TOPUP', status: 'PENDING', $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }] });
  assert.deepEqual(queries[5].filter, { userId: 'token-user', kind: 'TOPUP', status: 'PENDING', expiresAt: { $lte: now } });
  assert.deepEqual(queries[6].filter, queries[5].filter);
  assert.deepEqual([queries[7].filter, queries[7].sort], [{ userId: 'token-user' }, { updatedAt: -1 }]);
});

test('mã nạp tiền gõ trong câu hỏi không bao giờ được gửi cho AI', async () => {
  let calls = 0;
  const answer = withSeed({ generateReply: async () => { calls++; return 'Unexpected'; } });
  // Sao kê ngân hàng có thể in mã có khoảng trắng hoặc gạch nối, và người dùng chép nguyên như vậy.
  for (const code of ['NAPK7M2Q9XA', 'NAP K7M2Q9XA', 'nap k7m2-q9xa', 'NAP-K7M2 Q9XA']) {
    const result = await answer({ message: `Mình chuyển khoản nạp ví với nội dung ${code} mà chưa được cộng tiền` });
    assert.equal(result.mode, 'guide', code);
  }
  assert.equal(calls, 0);
  // Câu đối chứng không có mã, kể cả viết không dấu, vẫn được gửi cho AI: mẫu không chặn nhầm chữ "nap".
  for (const control of ['Mình chuyển khoản nạp ví mà chưa được cộng tiền', 'minh chuyen khoan nap vi ma chua duoc cong tien', 'minh nap them tien vao vi bang chuyen khoan ma chua duoc cong tien']) {
    assert.equal((await answer({ message: control })).mode, 'ai', control);
  }
  assert.equal(calls, 3);
});

test('tra cứu giải công khai áp bộ lọc kiểm duyệt và bỏ mọi trường riêng của giải', async () => {
  const eventFind = Event.find, categoryFind = EventCategory.find, eventQuery = {}, categoryQuery = {};
  try {
    Event.find = filter => { eventQuery.filter = filter; return queryRows([{ _id: 'event1', slug: 'mountain-race', name: 'Mountain Race', status: 'PUBLISHED', bankAccountInfo: { accountNo: 'PRIVATE-BANK' }, createdBy: 'PRIVATE-OWNER', location: { city: 'Đà Lạt' }, dateInfo: { raceDate: '2027-03-21' } }], eventQuery); };
    EventCategory.find = filter => { categoryQuery.filter = filter; return queryRows([{ eventId: 'event1', code: '21K', distance: 21, price: 500000, internal: 'PRIVATE-CATEGORY' }], categoryQuery); };
    const result = await retrievePublicEvents({ message: 'Tìm giải ở Đà Lạt', page: '/events' });
    assert.deepEqual(eventQuery.filter['moderation.state'], { $nin: ['HIDDEN', 'SUSPENDED'] });
    assert.ok(!eventQuery.filter.status.$in.includes('DRAFT')); assert.ok(!eventQuery.filter.status.$in.includes('CANCELLED'));
    assert.equal(eventQuery.limit, 5); assert.equal(eventQuery.maxTimeMS, 1500); assert.equal(categoryQuery.limit, 40);
    assert.doesNotMatch(eventQuery.select, /bank|createdBy|reason|organizer/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|event1/);
    assert.equal(result[0].url, '/events/mountain-race'); assert.equal(result[0].categories[0].price, 500000);
    assert.equal(publicEventFilter('giá vé', '/events/mountain-race/register').slug, 'mountain-race');
    assert.equal(publicEventFilter('giá vé', 'https://evil.example/events/foo').slug, undefined);
  } finally { Event.find = eventFind; EventCategory.find = categoryFind; }
});

test('chỉ gọi OpenAI khi đã khai báo rõ nhà cung cấp, khóa trên server và model', async () => {
  for (const config of [{}, { ...env, SUPPORT_AI_PROVIDER: 'guide' }, { ...env, OPENAI_API_KEY: '' }, { ...env, OPENAI_MODEL: '' }]) {
    const adapter = createOpenAIAdapter({ env: config, fetchImpl: () => { throw Error('Must not call'); } });
    assert.equal(await adapter(input), null);
  }
});

test('request gửi Responses có giới hạn và đọc đúng output_text nằm sau phần reasoning', async () => {
  let request;
  const adapter = createOpenAIAdapter({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); request = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Chọn giải.' }, { type: 'output_text', text: 'Sau đó đăng ký.' }] },
    ] }));
  } });
  assert.equal(await adapter(input), 'Chọn giải.\nSau đó đăng ký.');
  assert.equal(request.store, false); assert.equal(request.model, 'test-model'); assert.equal(request.max_output_tokens, 700);
  assert.equal(request.tools, undefined); assert.equal(request.previous_response_id, undefined);
  assert.deepEqual(Object.keys(JSON.parse(request.input)), ['question', 'supportArticles', 'publicEvents']);
  const answer = withSeed({ generateReply: adapter });
  const result = await answer({ message: 'Làm sao mua vé?', history: [{ role: 'assistant', content: 'PRIVATE-ORDER-123' }], userId: '507f1f77bcf86cd799439011' });
  assert.equal(result.mode, 'ai'); assert.doesNotMatch(request.input, /PRIVATE|507f/);
});

test('câu có dữ liệu nhạy cảm không được gửi cho AI dù đã cấu hình AI', async () => {
  let calls = 0;
  const answer = withSeed({ generateReply: async () => { calls++; return 'Unexpected'; } });
  const result = await answer({ message: 'Chuyển khoản rồi email tôi là private@example.test' });
  assert.equal(result.mode, 'guide'); assert.equal(calls, 0); assert.doesNotMatch(result.reply, /private@example/);
});

test('câu hỏi đủ 2000 ký tự được so khớp và gửi đi nguyên vẹn, không bị cắt ngầm', async () => {
  let received;
  const adapter = createOpenAIAdapter({ env, fetchImpl: async (_url, options) => {
    received = JSON.parse(JSON.parse(options.body).input).question;
    return success('SUPER_ADMIN duyệt yêu cầu nạp ví.');
  } });
  const suffix = ' Nạp ví do ai duyệt?';
  const message = 'x'.repeat(2000 - suffix.length) + suffix;
  const answer = withSeed({ generateReply: adapter });
  const result = await answer({ message });
  assert.equal(result.mode, 'ai'); assert.equal(received, message); assert.equal(received.length, 2000);
  for (const invalid of [message + 'x', '', '   ', null, {}]) {
    await assert.rejects(answer({ message: invalid }), error => error.statusCode === 400);
  }
});

test('câu riêng tư và mã nhạy cảm nằm sau ký tự thứ 1200 vẫn không được gửi cho AI', async () => {
  let providerCalls = 0, accountCalls = 0;
  const answer = withSeed({
    generateReply: async () => { providerCalls++; return 'Must not be used'; },
    runTask: async () => { accountCalls++; return { reply: 'Vé của bạn', actions: [], sources: [] }; },
  });
  const own = await answer({ message: 'x'.repeat(1500) + ' Kiểm tra vé của tôi', userId: '507f1f77bcf86cd799439011' });
  assert.equal(own.mode, 'guide'); assert.equal(accountCalls, 1); assert.equal(providerCalls, 0);
  const sensitive = await answer({ message: 'Nạp ví ' + 'x'.repeat(1500) + ' private@example.test' });
  assert.equal(sensitive.mode, 'guide'); assert.equal(providerCalls, 0);
  assert.doesNotMatch(sensitive.reply, /private@example/);
});

test('đọc dữ liệu lỗi thì bot không bịa trạng thái và không gọi AI', async () => {
  let providerCalls = 0;
  const answer = withSeed({
    runTask: async () => { throw Error('database unavailable'); },
    findEvents: async () => { throw Error('database unavailable'); },
    generateReply: async () => { providerCalls++; return 'Must not be used'; },
  });
  const logged = []; const consoleError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let account;
  try { account = await answer({ message: 'Kiểm tra vé của tôi', userId: '507f1f77bcf86cd799439011' }); }
  finally { console.error = consoleError; }
  assert.ok(logged.some(line => /database unavailable/.test(line)), 'a failed task read is logged for the operator');
  assert.match(account.reply, /chưa xem được/); assert.equal(account.mode, 'guide');
  assert.doesNotMatch(account.reply, /hiệu lực|đã thanh toán|đang giữ/);
  assert.deepEqual(account.actions, [{ label: 'Vé của tôi', url: '/account' }, { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' }]);
  const events = await answer({ message: 'Có giải nào sắp diễn ra?' });
  assert.match(events.reply, /chưa tải được thông tin giải/); assert.equal(events.mode, 'guide');
  assert.equal(providerCalls, 0);
});

test('AI lỗi, trả sai dạng, quá dài, chưa xong hoặc quá giờ thì bot dùng câu soạn sẵn', async () => {
  const cases = [async () => new Response('unavailable', { status: 503 }), async () => new Response('{'), async () => success('x'.repeat(4001)), async () => success('https://evil.example'), async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })), async () => { throw Error('network failure'); }];
  for (const fetchImpl of cases) {
    const adapter = createOpenAIAdapter({ env, fetchImpl });
    const result = await withSeed({ generateReply: adapter })({ message: input.question });
    assert.equal(result.mode, 'guide'); assert.match(result.reply, /10 phút/);
  }
  let aborted = false;
  const adapter = createOpenAIAdapter({ env, timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('timeout')); }, { once: true })) });
  assert.equal(await adapter(input), null); assert.equal(aborted, true);
});

test('mỗi lúc chỉ gửi tối đa 4 request tới AI, request thứ 5 bị từ chối ngay chứ không xếp hàng', async () => {
  const pending = [];
  const adapter = createOpenAIAdapter({ env, fetchImpl: () => new Promise(resolve => pending.push(resolve)) });
  const requests = Array.from({ length: 4 }, () => adapter(input));
  assert.equal(await adapter(input), null); assert.equal(pending.length, 4);
  pending.forEach(resolve => resolve(success('Hướng dẫn đã xác thực.')));
  assert.ok((await Promise.all(requests)).every(value => value === 'Hướng dẫn đã xác thực.'));
});
