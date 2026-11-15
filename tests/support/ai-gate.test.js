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
