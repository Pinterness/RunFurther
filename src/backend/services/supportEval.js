// Quality numbers for the support bot on the eval set (spec 5.2, 5.3). Pure: the caller supplies how a
// question is ranked against articles and how it is routed to a private-data task.
// The kiem half returns totals only, so nobody tunes terms by looking at its questions.
const SPLITS = ['luyen', 'kiem'];
const LOWER_IS_BETTER = ['wrong', 'wrongTotal'];

const emptyMetrics = () => ({
  total: 0, articleTotal: 0, top1: 0, top2: 0, miss: 0, wrong: 0,
  nullTotal: 0, nullCorrect: 0, taskTotal: 0, taskCorrect: 0, wrongTotal: 0,
});

async function evaluateSupport(items, { rank, routeTask = () => null }) {
  const result = { luyen: { ...emptyMetrics(), failures: [] }, kiem: emptyMetrics() };
  for (const item of items) {
    const metrics = result[item.split];
    if (!metrics) throw new Error(`Unknown split "${item.split}" in ${item.id}`);
    metrics.total += 1;
    const task = routeTask(item.question);
    const got = task ? [task] : (await rank(item.question)).map(article => article.key);
    let correct;
    if (String(item.expected).startsWith('task:')) {
      metrics.taskTotal += 1;
      correct = task === item.expected;
      if (correct) metrics.taskCorrect += 1; else metrics.wrongTotal += 1;
    } else if (item.expected === null) {
      metrics.nullTotal += 1;
      correct = got.length === 0;
      if (correct) metrics.nullCorrect += 1; else metrics.wrongTotal += 1;
    } else {
      metrics.articleTotal += 1;
      correct = got[0] === item.expected;
      if (correct) { metrics.top1 += 1; metrics.top2 += 1; }
      else if (got.includes(item.expected)) metrics.top2 += 1;
      else if (got.length) { metrics.wrong += 1; metrics.wrongTotal += 1; }
      else metrics.miss += 1;
    }
    if (!correct && metrics.failures) metrics.failures.push({ id: item.id, question: item.question, expected: item.expected, got });
  }
  return result;
}

// Lists every number that is worse than the recorded floor, e.g. "kiem.top2: 9 < 10". Empty means OK.
function meetsBaseline(metrics, baseline) {
  const worse = [];
  for (const split of SPLITS) {
    for (const [name, floor] of Object.entries(baseline[split] || {})) {
      const value = metrics[split][name];
      // A misspelt metric is undefined, and undefined < floor is false: report it instead of passing.
      if (typeof value !== 'number') worse.push(`${split}.${name}: missing`);
      else if (LOWER_IS_BETTER.includes(name) ? value > floor : value < floor) {
        worse.push(`${split}.${name}: ${value} ${LOWER_IS_BETTER.includes(name) ? '>' : '<'} ${floor}`);
      }
    }
  }
  return worse;
}

module.exports = { evaluateSupport, meetsBaseline };
