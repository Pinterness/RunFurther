// Cổng AI (spec 4.8, T15): bảy điều kiện, kiểm theo thứ tự nhà cung cấp → câu nhạy cảm → khách → công tắc → tuổi →
// lượt tài khoản → lượt ngày. Việc không cần DB chạy trước, việc giữ lượt chạy cuối. File này không kết nối DB:
// mọi bước đọc DB được thay bằng hàm giả.
const test = require('node:test');
const assert = require('node:assert/strict');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const { createAiGate, defaultFindDob, ADULT_AGE } = require('../../src/backend/services/supportAiGate');
const { createSupportResponder, createChatAdapter } = require('../../src/backend/services/supportAiService');
const { createAccountAllowance } = require('../../src/backend/services/aiUsageService');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');

const U = '507f1f77bcf86cd799439011';
const AI_ENV = { SUPPORT_AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', SUPPORT_AI_MODEL: 'm' };
// 10 giờ sáng 05-11-2026 giờ Việt Nam.
const ok = { env: AI_ENV, isSwitchOn: async () => true, findDob: async () => new Date('1990-05-01'), reserve: async () => true, now: () => new Date('2026-11-05T03:00:00Z') };
const allow = async () => ({ allowed: true, reason: null });
const withSeed = deps => createSupportResponder({ findArticles: async () => seedArticles(), recordMiss: null, ...deps });

test('tuổi tối thiểu để dùng AI là 18', () => { assert.equal(ADULT_AGE, 18); });

test('mỗi điều kiện không đạt đều chặn lời gọi và cho biết lý do, đúng thứ tự', async () => {
  const cases = [
    [{ env: {} }, U, 'provider'], [{ env: { ...AI_ENV, GEMINI_API_KEY: '' } }, U, 'provider'],
    [{}, null, 'guest'], [{}, 'not-an-object-id', 'guest'],
    [{ isSwitchOn: async () => false }, U, 'switch'], [{ isSwitchOn: async () => { throw new Error('db'); } }, U, 'switch'],
    [{ findDob: async () => null }, U, 'age'],
    [{ findDob: async () => new Date('2008-11-06') }, U, 'age'], // 17 tuổi, mai mới tròn 18
    [{ findDob: async () => new Date('2008-11-05') }, U, null], // tròn 18 đúng hôm nay
    [{ findDob: async () => new Date('2099-01-01') }, U, 'age'], [{ findDob: async () => new Date('invalid') }, U, 'age'],
    [{ findDob: async () => '1990-05-01' }, U, 'age'], [{ findDob: async () => { throw new Error('db'); } }, U, 'age'],
    [{ reserve: async () => false }, U, 'daily-limit'], [{ reserve: async () => { throw new Error('db'); } }, U, 'daily-limit'],
  ];
  for (const [patch, userId, reason] of cases) {
    const result = await createAiGate({ ...ok, ...patch })({ userId, question: 'giữ chỗ bao lâu' });
    assert.deepEqual(result, { allowed: reason === null, reason }, JSON.stringify(patch) + ' ' + userId);
  }
  assert.equal((await createAiGate(ok)({ userId: U, question: 'Tôi là Trần Thị B' })).reason, 'sensitive');
  // Chưa cấu hình nhà cung cấp thì báo 'provider' trước cả câu nhạy cảm và khách.
  assert.equal((await createAiGate({ ...ok, env: {} })({ userId: null, question: 'email tôi là a@b.com' })).reason, 'provider');
});

test('câu nhạy cảm của khách bị chặn ở bước nhạy cảm, trước mọi lần đọc DB', async () => {
  let reads = 0;
  const gate = createAiGate({ ...ok, isSwitchOn: async () => { reads++; return true; }, findDob: async () => { reads++; return new Date('1990-05-01'); }, reserve: async () => { reads++; return true; } });
  const result = await gate({ userId: null, question: 'email tôi là a@b.com' });
  assert.deepEqual([result.reason, reads], ['sensitive', 0]);
  // Khách hỏi câu bình thường cũng không làm cổng đọc DB.
  assert.deepEqual([(await gate({ userId: null, question: 'giữ chỗ bao lâu' })).reason, reads], ['guest', 0]);
});

test('câu AI thứ 31 của một tài khoản trong cùng ngày Pacific bị từ chối; tài khoản khác vẫn dùng được', async () => {
  const gate = createAiGate(ok);
  for (let i = 0; i < 30; i++) assert.equal((await gate({ userId: U, question: 'giữ chỗ bao lâu' })).allowed, true, String(i));
  assert.deepEqual(await gate({ userId: U, question: 'giữ chỗ bao lâu' }), { allowed: false, reason: 'account-limit' });
  assert.equal((await gate({ userId: '507f1f77bcf86cd799439012', question: 'giữ chỗ bao lâu' })).allowed, true);
});

test('lượt của tài khoản chỉ bị trừ khi đã giữ được lượt ngày', async () => {
  const allowance = createAccountAllowance({ perDay: 1 });
  let left = 0;
  const gate = createAiGate({ ...ok, allowance, reserve: async () => left-- > 0 });
  for (let i = 0; i < 5; i++) assert.equal((await gate({ userId: U, question: 'giữ chỗ bao lâu' })).reason, 'daily-limit');
  left = 1;
  assert.equal((await gate({ userId: U, question: 'giữ chỗ bao lâu' })).allowed, true);
  assert.equal((await gate({ userId: U, question: 'giữ chỗ bao lâu' })).reason, 'account-limit');
});

test('không bao giờ giữ lượt cho khách, người chưa đủ tuổi, câu nhạy cảm, hay responder không có adapter', async () => {
  let reserves = 0;
  const reserve = async () => { reserves++; return true; };
  await createAiGate({ ...ok, reserve })({ userId: null, question: 'giữ chỗ bao lâu' });
  await createAiGate({ ...ok, reserve, findDob: async () => new Date('2010-01-01') })({ userId: U, question: 'giữ chỗ bao lâu' });
  await createAiGate({ ...ok, reserve })({ userId: U, question: 'Mình bị hen suyễn có chạy được không' });
  const gateCalls = [];
  const result = await withSeed({ generateReply: null, canUseAi: async input => { gateCalls.push(input); return { allowed: true, reason: null }; } })({ message: 'giữ chỗ bao lâu', userId: U });
  assert.equal(result.mode, 'guide');
  assert.deepEqual([reserves, gateCalls.length], [0, 0]);
});

test('defaultFindDob chỉ chọn trường dob của đúng userId, có giới hạn thời gian', async () => {
  const original = RunnerProfile.findOne, captured = {};
  RunnerProfile.findOne = filter => {
    captured.filter = filter;
    const query = { select(value) { captured.select = value; return query; }, maxTimeMS(value) { captured.maxTimeMS = value; return query; }, async lean() { return { dob: new Date('1990-05-01') }; } };
    return query;
  };
  try {
    assert.deepEqual(await defaultFindDob(U), new Date('1990-05-01'));
  } finally { RunnerProfile.findOne = original; }
  assert.deepEqual(captured, { filter: { userId: U }, select: 'dob', maxTimeMS: 1500 });
});

test('khách hỏi câu chung nhận guide, adapter không bao giờ được gọi', async () => {
  let calls = 0;
  const answer = withSeed({ canUseAi: createAiGate(ok), generateReply: async () => { calls++; return 'AI'; } });
  const result = await answer({ message: 'giữ chỗ bao lâu' });
  assert.deepEqual([result.mode, calls], ['guide', 0]);
  assert.match(result.reply, /10 phút/);
  // Đối chứng: cùng câu, người lớn đã đăng nhập thì có nhận câu của AI.
  assert.equal((await answer({ message: 'giữ chỗ bao lâu', userId: U })).mode, 'ai');
});

test('người lớn qua được cổng mà Gemini lỗi, trả rỗng hay câu bị cắt thì vẫn nhận guide', async () => {
  const replies = [
    async () => new Response('busy', { status: 503 }),
    async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }),
    async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'Bạn giữ chỗ được' } }] }),
  ];
  for (const fetchImpl of replies) {
    const result = await withSeed({ canUseAi: allow, generateReply: createChatAdapter({ env: AI_ENV, fetchImpl }) })({ message: 'giữ chỗ bao lâu', userId: U });
    assert.equal(result.mode, 'guide'); assert.match(result.reply, /10 phút/);
  }
  // Hàm AI trả null hoặc ném lỗi cũng vậy.
  for (const generateReply of [async () => null, async () => { throw new Error('boom'); }]) {
    assert.equal((await withSeed({ canUseAi: allow, generateReply })({ message: 'giữ chỗ bao lâu', userId: U })).mode, 'guide');
  }
  // Cổng ném lỗi thì coi như không qua cổng.
  let calls = 0;
  const broken = await withSeed({ canUseAi: async () => { throw new Error('gate down'); }, generateReply: async () => { calls++; return 'AI'; } })({ message: 'giữ chỗ bao lâu', userId: U });
  assert.deepEqual([broken.mode, calls], ['guide', 0]);
});

test('lịch sử chat, userId và trang đang mở không bao giờ tới nhà cung cấp', async () => {
  let seen, gateInput;
  const answer = withSeed({ canUseAi: async input => { gateInput = input; return { allowed: true, reason: null }; },
    generateReply: async input => { seen = JSON.stringify(input); return 'ok'; } });
  const result = await answer({ message: 'Nạp ví do ai duyệt?', history: [{ role: 'user', content: 'PRIVATE-ORDER-123' }], userId: U, page: '/trang-rieng-xyz' });
  assert.equal(result.mode, 'ai');
  // Không dùng /account/wallet làm chuỗi kiểm: bài wallet có sẵn nguồn đó.
  assert.doesNotMatch(seen, /PRIVATE-ORDER-123|507f1f77bcf86cd799439011|trang-rieng-xyz/);
  // Cổng chỉ nhận userId và câu hỏi, không nhận lịch sử hay trang.
  assert.deepEqual(Object.keys(gateInput).sort(), ['question', 'userId']);
});

test('chủ đề giải mà không có giải công khai nào thì giữ câu "chưa tìm thấy", không hỏi cổng và không gọi AI', async () => {
  let gateCalls = 0, aiCalls = 0;
  const answer = withSeed({ findEvents: async () => [], canUseAi: async () => { gateCalls++; return { allowed: true, reason: null }; }, generateReply: async () => { aiCalls++; return 'AI viết chung chung về giải'; } });
  const result = await answer({ message: 'Có giải nào sắp diễn ra?', userId: U });
  assert.equal(result.mode, 'guide');
  assert.match(result.reply, /Chưa tìm thấy giải công khai phù hợp/);
  assert.deepEqual([gateCalls, aiCalls], [0, 0]);
  // Đối chứng: có giải công khai thì AI vẫn được dùng.
  const withEvents = withSeed({ findEvents: async () => [{ name: 'Giải Huế', url: '/events/giai-hue', city: 'Huế', date: '01/02/2031', registrationOpen: true, categories: [] }], canUseAi: async () => ({ allowed: true, reason: null }), generateReply: async () => 'AI' });
  assert.equal((await withEvents({ message: 'Có giải nào sắp diễn ra?', userId: U })).mode, 'ai');
});

// P09, lỗi nhẹ (1) của code-review P08: adapter chỉ cho 4 lời gọi Gemini chạy cùng lúc. Trước đây responder hỏi cổng
// trước, cổng giữ một lượt ngày và một lượt của tài khoản, rồi adapter mới từ chối câu thứ 5, nên câu đó tốn lượt mà
// không được gọi. Nay responder giữ chỗ gọi AI trước khi hỏi cổng: hết chỗ thì trả guide, không hỏi cổng.
// Fetch giả dừng khi bị hủy và adapter hết giờ sau 1 giây, nên nếu code sai để lọt lời gọi thứ 5 thì test đỏ chứ không treo.
test('đang có 4 lời gọi AI chạy dở thì câu thứ 5 nhận guide mà không tốn lượt; xong thì chỗ được trả lại đúng một lần', { timeout: 10000 }, async () => {
  const pending = []; let reserved = 0;
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => { pending.push(resolve); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
  const adapter = createChatAdapter({ env: AI_ENV, timeoutMs: 1000, fetchImpl });
  const ask = withSeed({ generateReply: adapter, canUseAi: createAiGate({ ...ok, reserve: async () => { reserved += 1; return true; } }) });
  const waitFor = async check => { for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check()); };
  const reply = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Đơn được giữ chỗ trong 10 phút.' } }] });
  // Vòng 2 chứng minh 4 chỗ được trả lại sau vòng 1 (4 câu lại được gọi AI), và chỉ trả đúng một lần (câu thứ 5 vẫn bị
  // chặn): responder và adapter cùng gọi hàm trả chỗ, nếu trả hai lần thì vòng 2 sẽ cho tới 8 lời gọi cùng lúc.
  for (const round of [1, 2]) {
    const before = pending.length;
    const running = Array.from({ length: 4 }, () => ask({ message: 'giữ chỗ được bao lâu', userId: U }));
    await waitFor(() => pending.length === before + 4);
    const fifth = await ask({ message: 'giữ chỗ được bao lâu', userId: U });
    assert.equal(fifth.mode, 'guide', 'vòng ' + round); assert.match(fifth.reply, /10 phút/);
    assert.deepEqual([reserved, pending.length], [round * 4, before + 4], 'vòng ' + round);
    pending.slice(before).forEach(resolve => resolve(reply()));
    assert.ok((await Promise.all(running)).every(result => result.mode === 'ai'), 'vòng ' + round);
  }
});

// P09, lỗi nhẹ (3) của code-review P08: trước đây cổng kiểm "còn lượt của tài khoản" rồi mới trừ sau một await (giữ
// lượt ngày), nên nhiều câu của cùng tài khoản tới cùng lúc đều qua bước kiểm. Nay kiểm và trừ trong cùng một bước.
test('nhiều câu của cùng tài khoản tới cùng lúc thì không vượt giới hạn câu AI của tài khoản', async () => {
  const allowance = createAccountAllowance({ perDay: 2 });
  const gate = createAiGate({ ...ok, allowance, reserve: async () => { await new Promise(resolve => setImmediate(resolve)); return true; } });
  const results = await Promise.all(Array.from({ length: 5 }, () => gate({ userId: U, question: 'giữ chỗ bao lâu' })));
  assert.equal(results.filter(result => result.allowed).length, 2);
  assert.equal(results.filter(result => result.reason === 'account-limit').length, 3);
});

// Code-review P09: chỗ gọi AI chỉ được giữ ngay trước bước trừ lượt, sau các bước đọc DB của cổng (công tắc, ngày sinh),
// nên các câu đang chờ cổng đọc DB không chiếm chỗ của câu khác. Hết chỗ thì cổng từ chối 'busy' mà chưa trừ lượt nào.
test('cổng chỉ giữ chỗ gọi AI sau các bước đọc DB; hết chỗ thì từ chối "busy" mà không trừ lượt', async () => {
  const steps = [];
  const allowance = createAccountAllowance({ perDay: 5 });
  const gate = createAiGate({ ...ok, allowance, isSwitchOn: async () => { steps.push('switch'); return true; }, findDob: async () => { steps.push('dob'); return new Date('1990-05-01'); }, reserve: async () => { steps.push('reserve'); return true; } });
  const busy = await gate({ userId: U, question: 'giữ chỗ bao lâu' }, { claimSlot: () => { steps.push('slot'); return false; } });
  assert.deepEqual(busy, { allowed: false, reason: 'busy' });
  assert.deepEqual(steps, ['switch', 'dob', 'slot']);
  assert.equal(allowance.canUse(U, ok.now()), true);
  // Không truyền claimSlot thì cổng chạy như trước.
  assert.equal((await gate({ userId: U, question: 'giữ chỗ bao lâu' })).allowed, true);
});

test('4 câu đang chờ cổng đọc ngày sinh không chiếm chỗ: câu thứ 5 vẫn được gọi AI', { timeout: 10000 }, async () => {
  let releaseDob, dobCalls = 0;
  const held = new Promise(resolve => { releaseDob = resolve; });
  const reply = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Đơn được giữ chỗ trong 10 phút.' } }] });
  const adapter = createChatAdapter({ env: AI_ENV, fetchImpl: async () => reply() });
  const ask = withSeed({ generateReply: adapter, canUseAi: createAiGate({ ...ok, findDob: async () => { dobCalls++; if (dobCalls <= 4) await held; return new Date('1990-05-01'); } }) });
  const waitFor = async check => { for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check()); };
  const waiting = Array.from({ length: 4 }, () => ask({ message: 'giữ chỗ được bao lâu', userId: U }));
  await waitFor(() => dobCalls === 4);
  assert.equal((await ask({ message: 'giữ chỗ được bao lâu', userId: U })).mode, 'ai');
  releaseDob();
  assert.ok((await Promise.all(waiting)).every(result => result.mode === 'ai'));
});
