// Loads the 11 original support topics (src/backend/services/supportKnowledge.js) into SupportArticle.
// Dry-run unless --apply is supplied. Only missing keys are created: an existing article is never
// overwritten, not even its updatedAt, so whatever an admin edited survives any number of reruns.
// Usage: node scripts/seedSupportKnowledge.js [--apply]
// Atlas (after a backup, DEPLOYMENT.md section 10): node --env-file=.env.atlas.local scripts/seedSupportKnowledge.js [--apply]
const mongoose = require('mongoose');
const SupportArticle = require('../src/backend/models/SupportArticle');
const { seedArticles } = require('../src/backend/services/supportKnowledge');

// Hosts only, without user or password. A multi-host URI (h1:27017,h2:27017) is not a valid WHATWG
// URL, so the authority is cut out by hand instead of new URL(). The database name comes from the
// open connection: the Atlas URI names no database, so the real one is the driver default "test".
function describeTarget(uri, databaseName) {
  const authority = String(uri).replace(/^mongodb(?:\+srv)?:\/\//, '').split(/[/?]/)[0];
  return { hosts: authority.slice(authority.lastIndexOf('@') + 1), database: databaseName };
}

// Uses the open Mongoose connection; never connects by itself.
async function seedSupportKnowledge({ apply = false } = {}) {
  const articles = seedArticles().map(({ id, ...article }) => article);
  const created = [], skipped = [];
  if (!apply) {
    const existing = new Set(await SupportArticle.distinct('key', { key: { $in: articles.map(article => article.key) } }));
    for (const { key } of articles) (existing.has(key) ? skipped : created).push(key);
    return { created, skipped };
  }
  // The CLI connects with autoIndex off so a dry run creates nothing; build the unique key index here.
  await SupportArticle.createIndexes();
  for (const article of articles) {
    const now = new Date();
    // Without timestamps: false, Mongoose adds $set: { updatedAt } and touches every existing article.
    const result = await SupportArticle.updateOne(
      { key: article.key },
      { $setOnInsert: { ...article, createdAt: now, updatedAt: now } },
      { upsert: true, timestamps: false },
    );
    (result.upsertedCount ? created : skipped).push(article.key);
  }
  return { created, skipped };
}

if (require.main === module) {
  require('dotenv').config();
  const apply = process.argv.includes('--apply');
  (async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    const result = await seedSupportKnowledge({ apply });
    console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', ...describeTarget(process.env.MONGODB_URI, mongoose.connection.db.databaseName), ...result }, null, 2));
    if (!apply) console.log('No data changed. Check database and hosts, then repeat with --apply.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}

module.exports = { seedSupportKnowledge, describeTarget };
