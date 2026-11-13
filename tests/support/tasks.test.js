// Private-data tasks of the support bot (spec 4.7, plan P07): routing, guests, unclear questions and actions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seedArticles, normalizeSupportText } = require('../../src/backend/services/supportKnowledge');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { routeTask, toActions, createTaskRunner } = require('../../src/backend/services/supportTasks');

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
