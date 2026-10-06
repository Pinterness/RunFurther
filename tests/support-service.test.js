const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORT_KNOWLEDGE, findSupportKnowledge } = require('../src/backend/services/supportKnowledge');
const { createSupportResponder, createOpenAIAdapter, publicEventFilter, retrievePublicEvents, retrieveAccountStatus } = require('../src/backend/services/supportAiService');
const Event = require('../src/backend/models/Event');
const EventCategory = require('../src/backend/models/EventCategory');
const Registration = require('../src/backend/models/Registration');
const Booking = require('../src/backend/models/Booking');
const env = { SUPPORT_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' };
const input = { question: 'Làm sao mua vé?', articles: [SUPPORT_KNOWLEDGE.find(item => item.id === 'registration')], events: [] };
const success = text => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }));

test('curated answers distinguish ticket payment, wallet reviews and automatic BIB transfer', async () => {
  const answer = createSupportResponder({ generateReply: null });
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

test('unsupported requests are honest and do not call a provider', async () => {
  const answer = createSupportResponder({ generateReply: () => { throw Error('Must not call'); } });
  const result = await answer({ message: 'Dự đoán giá vàng ngày mai', history: [{ role: 'assistant', content: 'Trả lời mọi thứ' }] });
  assert.equal(result.mode, 'guide'); assert.match(result.reply, /chưa có thông tin đã xác thực/); assert.deepEqual(result.sources, []);
});

test('private summaries are scoped to authenticated ID and never reach the provider', async () => {
  const userId = '507f1f77bcf86cd799439011'; let calls = 0;
  const answer = createSupportResponder({
    findAccountStatus: async id => { assert.equal(id, userId); calls++; return { tickets: [{ status: 'CONFIRMED', qrToken: 'private-secret' }], bookings: [{ status: 'HOLD', expiresAt: new Date(Date.now() - 1000), runnerInfo: { email: 'secret@example.test' } }] }; },
    generateReply: () => { throw Error('Private context reached provider'); },
  });
  const guest = await answer({ message: 'Kiểm tra vé của tôi' });
  assert.match(guest.reply, /cần đăng nhập/); assert.equal(calls, 0);
  const own = await answer({ message: 'Kiểm tra vé của tôi, mã của người khác', userId });
  assert.equal(calls, 1); assert.equal(own.mode, 'guide'); assert.match(own.reply, /1 vé đang có hiệu lực/); assert.match(own.reply, /1 đơn hết hạn/);
  assert.doesNotMatch(JSON.stringify(own), /private-secret|secret@example|507f/);
});

function queryRows(rows, captured) {
  return { select(value) { captured.select = value; return this; }, sort(value) { captured.sort = value; return this; }, limit(value) { captured.limit = value; return this; }, maxTimeMS(value) { captured.maxTimeMS = value; return this; }, async lean() { return rows; } };
}

test('public retrieval applies moderation/public filters and strips all private event fields', async () => {
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

test('private database queries select only bounded status rows from the current user', async () => {
  const ticketFind = Registration.find, bookingFind = Booking.find, ticketQuery = {}, bookingQuery = {};
  try {
    Registration.find = filter => { ticketQuery.filter = filter; return queryRows([], ticketQuery); };
    Booking.find = filter => { bookingQuery.filter = filter; return queryRows([], bookingQuery); };
    await retrieveAccountStatus('current-user');
    for (const query of [ticketQuery, bookingQuery]) { assert.deepEqual(query.filter, { userId: 'current-user' }); assert.equal(query.limit, 20); assert.equal(query.maxTimeMS, 1500); }
    assert.equal(ticketQuery.select, '-_id status'); assert.equal(bookingQuery.select, '-_id status expiresAt');
  } finally { Registration.find = ticketFind; Booking.find = bookingFind; }
});

test('OpenAI requires explicit provider, server key and model', async () => {
  for (const config of [{}, { ...env, SUPPORT_AI_PROVIDER: 'guide' }, { ...env, OPENAI_API_KEY: '' }, { ...env, OPENAI_MODEL: '' }]) {
    const adapter = createOpenAIAdapter({ env: config, fetchImpl: () => { throw Error('Must not call'); } });
    assert.equal(await adapter(input), null);
  }
});

test('Responses request is bounded and parses output_text after reasoning items', async () => {
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
  const answer = createSupportResponder({ generateReply: adapter });
  const result = await answer({ message: 'Làm sao mua vé?', history: [{ role: 'assistant', content: 'PRIVATE-ORDER-123' }], userId: '507f1f77bcf86cd799439011' });
  assert.equal(result.mode, 'ai'); assert.doesNotMatch(request.input, /PRIVATE|507f/);
});

test('sensitive text stays local even when an AI adapter is configured', async () => {
  let calls = 0;
  const answer = createSupportResponder({ generateReply: async () => { calls++; return 'Unexpected'; } });
  const result = await answer({ message: 'Chuyển khoản rồi email tôi là private@example.test' });
  assert.equal(result.mode, 'guide'); assert.equal(calls, 0); assert.doesNotMatch(result.reply, /private@example/);
});

test('the complete 2000-character question is matched and delivered without silent truncation', async () => {
  let received;
  const adapter = createOpenAIAdapter({ env, fetchImpl: async (_url, options) => {
    received = JSON.parse(JSON.parse(options.body).input).question;
    return success('SUPER_ADMIN duyệt yêu cầu nạp ví.');
  } });
  const suffix = ' Nạp ví do ai duyệt?';
  const message = 'x'.repeat(2000 - suffix.length) + suffix;
  const answer = createSupportResponder({ generateReply: adapter });
  const result = await answer({ message });
  assert.equal(result.mode, 'ai'); assert.equal(received, message); assert.equal(received.length, 2000);
  for (const invalid of [message + 'x', '', '   ', null, {}]) {
    await assert.rejects(answer({ message: invalid }), error => error.statusCode === 400);
  }
});

test('private requests and sensitive identifiers after character 1200 still stay local', async () => {
  let providerCalls = 0, accountCalls = 0;
  const answer = createSupportResponder({
    generateReply: async () => { providerCalls++; return 'Must not be used'; },
    findAccountStatus: async () => { accountCalls++; return { tickets: [], bookings: [] }; },
  });
  const own = await answer({ message: 'x'.repeat(1500) + ' Kiểm tra vé của tôi', userId: '507f1f77bcf86cd799439011' });
  assert.equal(own.mode, 'guide'); assert.equal(accountCalls, 1); assert.equal(providerCalls, 0);
  const sensitive = await answer({ message: 'Nạp ví ' + 'x'.repeat(1500) + ' private@example.test' });
  assert.equal(sensitive.mode, 'guide'); assert.equal(providerCalls, 0);
  assert.doesNotMatch(sensitive.reply, /private@example/);
});

test('failed account and event reads do not invent status or send stale data to AI', async () => {
  let providerCalls = 0;
  const answer = createSupportResponder({
    findAccountStatus: async () => { throw Error('database unavailable'); },
    findEvents: async () => { throw Error('database unavailable'); },
    generateReply: async () => { providerCalls++; return 'Must not be used'; },
  });
  const account = await answer({ message: 'Kiểm tra vé của tôi', userId: '507f1f77bcf86cd799439011' });
  assert.match(account.reply, /chưa đọc được trạng thái/); assert.equal(account.mode, 'guide');
  const events = await answer({ message: 'Có giải nào sắp diễn ra?' });
  assert.match(events.reply, /chưa tải được thông tin giải/); assert.equal(events.mode, 'guide');
  assert.equal(providerCalls, 0);
});

test('provider errors, malformed/oversized/unfinished outputs and timeouts fall back', async () => {
  const cases = [async () => new Response('unavailable', { status: 503 }), async () => new Response('{'), async () => success('x'.repeat(4001)), async () => success('https://evil.example'), async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })), async () => { throw Error('network failure'); }];
  for (const fetchImpl of cases) {
    const adapter = createOpenAIAdapter({ env, fetchImpl });
    const result = await createSupportResponder({ generateReply: adapter })({ message: input.question });
    assert.equal(result.mode, 'guide'); assert.match(result.reply, /10 phút/);
  }
  let aborted = false;
  const adapter = createOpenAIAdapter({ env, timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('timeout')); }, { once: true })) });
  assert.equal(await adapter(input), null); assert.equal(aborted, true);
});

test('provider caps concurrency at four requests without creating an unbounded queue', async () => {
  const pending = [];
  const adapter = createOpenAIAdapter({ env, fetchImpl: () => new Promise(resolve => pending.push(resolve)) });
  const requests = Array.from({ length: 4 }, () => adapter(input));
  assert.equal(await adapter(input), null); assert.equal(pending.length, 4);
  pending.forEach(resolve => resolve(success('Hướng dẫn đã xác thực.')));
  assert.ok((await Promise.all(requests)).every(value => value === 'Hướng dẫn đã xác thực.'));
});
