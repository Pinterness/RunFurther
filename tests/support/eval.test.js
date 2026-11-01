// The 60-question eval set for the support bot (spec 5.2) and the floor its scores may not drop below (spec 5.3).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankArticles, seedArticles } = require('../../src/backend/services/supportKnowledge');
const { evaluateSupport, meetsBaseline } = require('../../src/backend/services/supportEval');
const items = require('../helpers/supportEvalSet.json');
const baseline = require('../helpers/supportEvalBaseline.json');

const TASKS = ['task:tickets', 'task:holds', 'task:wallet', 'task:supportTickets'];
const D2_PROBES = ['giữ chỗ được bao lâu', 'mình chuyển tiền rồi mà chưa thấy vé', 'bán lại vé cho bạn được không', 'cho mình hỏi số bib ở đâu',
  'khi nào có kết quả chạy', 'muốn mở giải chạy thì làm gì', 'nhận áo và bib ở đâu', 'cho mình hỏi chút', 'quên mật khẩu thì làm sao',
  'tôi không đăng nhập được', 'nạp tiền vào ví bao lâu được duyệt', 'hủy đăng ký có được hoàn tiền không'];

test('eval set: 60 unique items, 2+2 per article key, 4+4 null, 4+4 task, D2 probes in luyen', () => {
  assert.equal(items.length, 60); assert.equal(new Set(items.map(i => i.id)).size, 60);
  const count = pred => ({ luyen: items.filter(i => pred(i) && i.split === 'luyen').length, kiem: items.filter(i => pred(i) && i.split === 'kiem').length });
  for (const { key } of seedArticles()) assert.deepEqual(count(i => i.expected === key), { luyen: 2, kiem: 2 }, key);
  assert.deepEqual(count(i => i.expected === null), { luyen: 4, kiem: 4 });
  assert.deepEqual(count(i => String(i.expected).startsWith('task:')), { luyen: 4, kiem: 4 });
  for (const probe of D2_PROBES) assert.equal(items.find(i => i.question === probe)?.split, 'luyen', probe);
  assert.ok(items.every(i => ['luyen', 'kiem'].includes(i.split)));
  assert.ok(items.filter(i => String(i.expected).startsWith('task:')).every(i => TASKS.includes(i.expected)));
  assert.equal(items.find(i => i.question === 'đổi size áo được không'), undefined, 'P05 changes the right answer to this question');
});

test('evaluateSupport counts top-1, top-2, wrong, miss, null and task items', async () => {
  const set = [['a', 'hold', 'luyen'], ['b', 'payment', 'luyen'], ['c', 'tickets', 'luyen'], ['d', 'results', 'luyen'], ['e', null, 'kiem'], ['f', 'task:wallet', 'kiem']]
    .map(([question, expected, split]) => ({ id: question, question, expected, split }));
  const ranks = { a: ['hold'], b: ['wallet', 'payment'], c: ['events'], d: [], e: ['hold'], f: ['wallet'] };
  const m = await evaluateSupport(set, { rank: q => ranks[q].map(key => ({ key })), routeTask: q => (q === 'f' ? 'task:wallet' : null) });
  assert.deepEqual([m.luyen.articleTotal, m.luyen.top1, m.luyen.top2, m.luyen.wrong, m.luyen.miss], [4, 1, 2, 1, 1]);
  assert.deepEqual([m.kiem.nullTotal, m.kiem.nullCorrect, m.kiem.taskTotal, m.kiem.taskCorrect, m.kiem.wrongTotal], [1, 0, 1, 1, 1]);
  assert.equal(m.luyen.failures.length, 3); assert.equal(m.kiem.failures, undefined);
});

test('a question sent to the wrong task, or to a task when it is not one, counts as a wrong pick', async () => {
  const set = [['g', 'hold', 'luyen'], ['h', null, 'luyen'], ['i', 'task:holds', 'luyen'], ['j', 'task:tickets', 'luyen']]
    .map(([question, expected, split]) => ({ id: question, question, expected, split }));
  const routes = { g: 'task:holds', h: 'task:wallet', i: 'task:wallet', j: null };
  const m = await evaluateSupport(set, { rank: () => [], routeTask: q => routes[q] });
  assert.deepEqual([m.luyen.wrong, m.luyen.nullCorrect, m.luyen.taskCorrect, m.luyen.wrongTotal], [1, 0, 0, 4]);
  assert.deepEqual(m.luyen.failures.map(f => f.got), [['task:holds'], ['task:wallet'], ['task:wallet'], []]);
});

test('meetsBaseline reports only the numbers that got worse', () => {
  const floor = { luyen: { top1: 5, top2: 6, nullCorrect: 2, taskCorrect: 0, wrongTotal: 4 }, kiem: { top1: 3, top2: 4, nullCorrect: 3, taskCorrect: 0, wrongTotal: 5 } };
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen }, kiem: { ...floor.kiem } }, floor), []);
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen, top1: 9, wrongTotal: 1 }, kiem: { ...floor.kiem } }, floor), []);
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen, top2: 5 }, kiem: { ...floor.kiem, wrongTotal: 6 } }, floor), ['luyen.top2: 5 < 6', 'kiem.wrongTotal: 6 > 5']);
});

test('seed ranking is not worse than the recorded baseline', async () => {
  const metrics = await evaluateSupport(items, { rank: q => rankArticles(seedArticles(), q) });
  assert.deepEqual(meetsBaseline(metrics, baseline), []);
});
