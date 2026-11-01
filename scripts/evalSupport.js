// Measures how well the support bot picks articles on the 60-question eval set (spec 5.2, 5.3). Read-only.
// Usage: node scripts/evalSupport.js --seed   the 11 original articles, no database
//        node scripts/evalSupport.js          PUBLISHED articles in MONGODB_URI (dev)
//        node --env-file=.env.atlas.local scripts/evalSupport.js   the same on Atlas
// The luyen half lists every failure; the kiem half prints totals only (spec 5.2: never tune terms on it).
const mongoose = require('mongoose');
const items = require('../tests/helpers/supportEvalSet.json');
const { rankArticles, seedArticles } = require('../src/backend/services/supportKnowledge');
const { loadPublishedArticles } = require('../src/backend/services/supportKnowledgeStore');
const { evaluateSupport } = require('../src/backend/services/supportEval');
const { describeTarget } = require('./seedSupportKnowledge');

(async () => {
  let articles, target;
  if (process.argv.includes('--seed')) {
    articles = seedArticles();
    target = { source: 'seed' };
  } else {
    require('dotenv').config();
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    articles = await loadPublishedArticles();
    target = { source: 'database', ...describeTarget(process.env.MONGODB_URI, mongoose.connection.db.databaseName) };
  }
  const metrics = await evaluateSupport(items, { rank: question => rankArticles(articles, question) });
  console.log(JSON.stringify({ ...target, articles: articles.length, ...metrics }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
