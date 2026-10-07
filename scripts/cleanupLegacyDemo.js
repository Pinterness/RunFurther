// One-time cleanup of the audited legacy seed. Dry run unless --apply is supplied.
require('dotenv').config();
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const orgId = '6ab25bdf6b73b0572c9261ab';
const fixtures = [
  ['6ab25bdf6b73b0572c9261ae', 'hue-heritage-run-2025', 'Hue Heritage Run 2025', 4],
  ['6ab25bdf6b73b0572c9261c0', 'dalat-ultra-trail-2024', 'Dalat Ultra Trail 2024', 4],
  ['6ab25be06b73b0572c9261d0', 'hcmc-night-run-10k-2024', 'HCMC Night Run 10K 2024', 2],
];
const encode = value => EJSON.stringify(value, { relaxed: false });
const hash = value => crypto.createHash('sha256').update(encode(value)).digest('hex');
function references(value, ids) {
  if (value == null) return false;
  if (value._bsontype === 'ObjectId' || typeof value === 'string') return ids.has(String(value));
  if (typeof value === 'object') return Object.values(value).some(child => references(child, ids));
  return false;
}
function plan(snapshot) {
  const events = snapshot.events.filter(event => fixtures.some(([id]) => String(event._id) === id));
  if (!events.length) return {};
  assert.equal(events.length, 3, 'Partial seed detected; inspect manually.');
  const categories = [], accounts = [];
  for (const [id, slug, name, count] of fixtures) {
    const event = events.find(item => String(item._id) === id);
    assert.equal(event.slug, slug); assert.equal(event.name, name);
    assert.equal(String(event.organizerId), orgId); assert.ok(!event.createdBy);
    const relatedCategories = snapshot.eventcategories.filter(item => String(item.eventId) === id);
    assert.equal(relatedCategories.length, count);
    // These audited legacy records contain counters but no actual tickets or transactions.
    // Reference checks below reject any real booking, registration, payment or application.
    const auditedSold = {
      'hue-heritage-run-2025': { '5K': 400, '10K': 600, '21K': 800, '42K': 400 },
      'dalat-ultra-trail-2024': { '10K': 320, '21K': 480, '55K': 320, '85K': 200 },
      'hcmc-night-run-10k-2024': { '5K': 400, '10K': 600 },
    };
    for (const item of relatedCategories) {
      assert.equal(item.quotaSold, auditedSold[slug][item.code], 'Counter changed since audit.');
      assert.equal(item.quotaHold, 0, 'Seed has active holds.');
    }
    categories.push(...relatedCategories);
    const relatedAccounts = snapshot.eventaccounts.filter(item => String(item.eventId) === id);
    assert.equal(relatedAccounts.length, 3);
    for (const item of relatedAccounts) {
      assert.equal(item.loginCode, { STAFF_MANAGER: 'MGR999', CHECKIN: 'CHK101', RACE_KIT: 'KIT202' }[item.accountType]);
    }
    accounts.push(...relatedAccounts);
  }
  const organizations = snapshot.organizations.filter(item => String(item._id) === orgId);
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].slug, 'vng-run-club');
  assert.equal(organizations[0].name, 'VNG Marathon Series');
  const removed = { events, eventcategories: categories, eventaccounts: accounts, organizations };
  const ids = new Set(Object.values(removed).flat().map(item => String(item._id)));
  for (const [collection, docs] of Object.entries(snapshot)) {
    for (const doc of docs) {
      if ((removed[collection] || []).some(item => String(item._id) === String(doc._id))) continue;
      assert.ok(!references(doc, ids), `Protected record references demo data in ${collection}; aborting.`);
    }
  }
  return removed;
}
async function run() {
  assert.ok(process.env.MONGODB_URI, 'MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const db = mongoose.connection.db;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name).sort();
  const read = async session => Object.fromEntries(await Promise.all(names.map(async name => [name, await db.collection(name).find({}, { session }).sort({ _id: 1 }).toArray()])));
  const apply = process.argv.includes('--apply');
  const session = await mongoose.startSession();
  let backupPath, backupHash;
  try {
    await session.withTransaction(async () => {
      const before = await read(session), removed = plan(before);
      const counts = Object.fromEntries(Object.entries(removed).map(([name, docs]) => [name, docs.length]));
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', remove: counts, preservedUsers: before.users.length }));
      if (!apply || !Object.keys(removed).length) return;
      const retained = Object.fromEntries(Object.entries(before).map(([name, docs]) => [name, docs.filter(doc => !(removed[name] || []).some(item => String(item._id) === String(doc._id)))]));
      const digest = hash(removed);
      if (backupHash) assert.equal(digest, backupHash, 'Snapshot changed during retry; rerun audit.');
      else {
        const dir = path.resolve(__dirname, '../.cache/demo-cleanup-' + new Date().toISOString().replace(/[:.]/g, '-'));
        fs.mkdirSync(dir, { recursive: true }); backupPath = path.join(dir, 'backup.ejson');
        fs.writeFileSync(backupPath, encode({ createdAt: new Date(), removed, retainedHashes: Object.fromEntries(Object.entries(retained).map(([name, docs]) => [name, hash(docs)])) }), { flag: 'wx' });
        assert.equal(hash(EJSON.parse(fs.readFileSync(backupPath, 'utf8')).removed), digest);
        backupHash = digest;
      }
      for (const name of ['eventaccounts', 'eventcategories', 'events', 'organizations']) {
        const result = await db.collection(name).deleteMany({ _id: { $in: removed[name].map(doc => doc._id) } }, { session });
        assert.equal(result.deletedCount, removed[name].length);
      }
      const after = await read(session);
      for (const name of names) assert.equal(hash(after[name]), hash(retained[name]), `Protected data changed in ${name}.`);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (backupPath) console.log(JSON.stringify({ committed: true, backup: path.relative(process.cwd(), backupPath), protectedDataUnchanged: true }));
  } finally { await session.endSession(); }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { plan };
