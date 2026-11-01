// Seeding the 11 original support topics: dry run by default, create-only with --apply, never overwrite.
// Runs against an in-memory MongoDB replica set (tests/helpers). The tests run in order and share one database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-seed-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');
const { seedSupportKnowledge, describeTarget } = require('../../scripts/seedSupportKnowledge');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_seed' });
before(harness.start);
after(harness.stop);

test('every seed article passes the SupportArticle rules and keeps its old id as key', () => {
  const articles = seedArticles();
  assert.equal(articles.length, 11);
  for (const article of articles) {
    assert.equal(article.id, article.key);
    assert.equal(new SupportArticle(article).validateSync(), undefined, article.key);
  }
});

test('describeTarget lists every host, never the credentials, and takes the database from the connection', () => {
  const multi = describeTarget('mongodb://u:p%40ss@h1.example:27017,h2.example:27017/?ssl=true&replicaSet=atlas-x', 'test');
  assert.deepEqual(multi, { hosts: 'h1.example:27017,h2.example:27017', database: 'test' });
  assert.deepEqual(describeTarget('mongodb+srv://u:p%40ss@cluster.example/?retryWrites=true', 'test'), { hosts: 'cluster.example', database: 'test' });
  assert.deepEqual(describeTarget('mongodb://127.0.0.1:27017/runfurther_dev?replicaSet=rs0', 'runfurther_dev'), { hosts: '127.0.0.1:27017', database: 'runfurther_dev' });
  assert.doesNotMatch(JSON.stringify(multi), /p%40ss|u:/);
});

test('dry run lists 11 creations and writes nothing', async () => {
  const result = await seedSupportKnowledge();
  assert.equal(result.created.length, 11); assert.equal(await SupportArticle.countDocuments(), 0);
});

test('apply creates 11 PUBLISHED articles carrying the old tie-break order as priority', async () => {
  await seedSupportKnowledge({ apply: true });
  assert.equal(await SupportArticle.countDocuments({ status: 'PUBLISHED' }), 11);
  const articles = await SupportArticle.find().lean();
  assert.ok(articles.every(a => a.createdAt instanceof Date && a.updatedAt instanceof Date && a.id === undefined), 'timestamps set, no legacy id field');
  const priority = Object.fromEntries(articles.map(a => [a.key, a.priority]));
  assert.deepEqual([priority.payment, priority.hold, priority.tickets, priority.events], [2, 2, 1, 0]);
});

test('a second apply creates nothing and never touches an existing article, not even updatedAt', async () => {
  await SupportArticle.updateOne({ key: 'hold' }, { answer: 'Bản admin đã sửa' });
  const before = await SupportArticle.find().sort({ key: 1 }).lean();
  const result = await seedSupportKnowledge({ apply: true });
  assert.deepEqual(result.created, []); assert.equal(result.skipped.length, 11);
  const after = await SupportArticle.find().sort({ key: 1 }).lean();
  assert.equal(after.find(a => a.key === 'hold').answer, 'Bản admin đã sửa');
  assert.deepEqual(after.map(a => +a.updatedAt), before.map(a => +a.updatedAt));
});
