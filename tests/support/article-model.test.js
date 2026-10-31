// Support knowledge articles stored in MongoDB: internal-only source links, field limits, unique keys.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-article-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const { internalPath } = require('../../src/lib/internalPath.cjs');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_article' });
before(harness.start);
after(harness.stop);

const valid = { key: 'doi-co-ao', title: 'Đổi cỡ áo', terms: ['đổi size áo'], answer: 'Liên hệ ban tổ chức trước ngày nhận kit.', sources: [{ title: 'Vé của tôi', url: '/account' }], suggestions: [] };
const fresh = patch => ({ ...valid, key: 'k-' + Math.random().toString(36).slice(2, 8), ...patch });

test('internalPath keeps same-origin paths and rejects everything else', () => {
  assert.equal(internalPath('/account/wallet?tab=1#x'), '/account/wallet?tab=1#x');
  for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil', '/a b', 'account', '', null, '/\u0000x'])
    assert.equal(internalPath(bad), null, String(bad));
});

test('a new article is DRAFT, version 0, priority 0', async () => {
  const article = await SupportArticle.create(fresh());
  assert.deepEqual([article.status, article.version, article.priority], ['DRAFT', 0, 0]);
});

test('article rejects external links, empty-after-normalize terms and over-limit fields', async () => {
  for (const patch of [
    { sources: [{ title: 'x', url: '//evil.example' }] }, { sources: [{ title: 'x', url: 'https://evil.example/x' }] }, { terms: ['🙂'] }, { terms: [] },
    { terms: Array.from({ length: 31 }, (_, i) => 'cum ' + i) }, { answer: 'x'.repeat(2001) }, { title: 'x'.repeat(121) },
    { key: 'Bad Key' }, { priority: 10 }, { priority: 1.5 }, { suggestions: ['a', 'b', 'c', 'd'] },
    { sources: [1, 2, 3, 4].map(i => ({ title: 't', url: '/a' + i })) },
  ]) await assert.rejects(SupportArticle.create(fresh(patch)), { name: 'ValidationError' }, JSON.stringify(patch));
});

test('terms are trimmed when saved', async () => {
  const article = await SupportArticle.create(fresh({ terms: ['  đổi size áo  '] }));
  assert.deepEqual(article.terms, ['đổi size áo']);
});

test('key is unique', async () => {
  await SupportArticle.create(fresh({ key: 'trung-ma' }));
  await assert.rejects(SupportArticle.create(fresh({ key: 'trung-ma' })), { code: 11000 });
});

test('key never changes after creation', async () => {
  const article = await SupportArticle.create(fresh({ key: 'ma-co-dinh' }));
  await SupportArticle.updateOne({ _id: article._id }, { key: 'ma-moi' });
  article.key = 'ma-khac';
  await article.save();
  assert.equal((await SupportArticle.findById(article._id).lean()).key, 'ma-co-dinh');
});
