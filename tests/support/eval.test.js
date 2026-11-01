// The 60-question eval set for the support bot (spec 5.2) and the baseline its scores must match exactly (spec 5.3).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { rankArticles, seedArticles } = require('../../src/backend/services/supportKnowledge');
const { evaluateSupport, meetsBaseline } = require('../../src/backend/services/supportEval');
const items = require('../helpers/supportEvalSet.json');
const baseline = require('../helpers/supportEvalBaseline.json');

const TASKS = ['task:tickets', 'task:holds', 'task:wallet', 'task:supportTickets'];
const STYLES = ['co-dau', 'khong-dau', 'teencode', 'than-phien', 'ngan', 'dai-ngu-canh', 'tron-tieng-anh', 'phuong-ngu', 'xa', 'gan'];
// SHA-256 of the kiem half (spec 5.2): once approved it is frozen, so nobody tunes it after seeing scores.
const KIEM_SHA256 = '82626d07118419d81b70c2035be123d7882252a99d131f5d7c96e3dd6a4f6a0d';
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
  assert.ok(items.every(i => STYLES.includes(i.style)), 'every item has a known style');
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
  const floor = { luyen: { top1: 5, top2: 6, wrong: 1, nullCorrect: 2, taskCorrect: 0, wrongTotal: 4 }, kiem: { top1: 3, top2: 4, wrong: 2, nullCorrect: 3, taskCorrect: 0, wrongTotal: 5 } };
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen }, kiem: { ...floor.kiem } }, floor), []);
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen, top1: 9, wrong: 0, wrongTotal: 1 }, kiem: { ...floor.kiem } }, floor), []);
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen, top2: 5 }, kiem: { ...floor.kiem, wrong: 3, wrongTotal: 6 } }, floor), ['luyen.top2: 5 < 6', 'kiem.wrong: 3 > 2', 'kiem.wrongTotal: 6 > 5']);
  assert.deepEqual(meetsBaseline({ luyen: { ...floor.luyen }, kiem: { ...floor.kiem } }, { luyen: { top_1: 5 }, kiem: {} }), ['luyen.top_1: missing'], 'a misspelt metric must not pass');
});

test('the kiem half is frozen', () => {
  const kiem = items.filter(i => i.split === 'kiem').map(({ id, question, expected }) => [id, question, expected]);
  assert.equal(createHash('sha256').update(JSON.stringify(kiem)).digest('hex'), KIEM_SHA256,
    'kiem changed: only relabel it in its own commit that gives the reason and the numbers before and after');
});

test('seed ranking scores exactly the recorded baseline', async () => {
  const metrics = await evaluateSupport(items, { rank: q => rankArticles(seedArticles(), q) });
  assert.deepEqual(meetsBaseline(metrics, baseline), []);
  // Exact: a better score raises the floor in the same commit, so later wrong picks cannot hide in the slack.
  for (const split of ['luyen', 'kiem']) {
    for (const [name, floor] of Object.entries(baseline[split])) assert.equal(metrics[split][name], floor, `${split}.${name} improved: raise the baseline`);
  }
});
