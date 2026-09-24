// Explicit recovery for a legacy event only. Dry-run unless --apply is supplied.
// Usage: node scripts/setLegacyEventCreator.js --event-id ID --creator-email EMAIL [--apply]
// The operator must verify the historical creator before running --apply.
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Event = require('../src/backend/models/Event');
const User = require('../src/backend/models/User');
const EventAccount = require('../src/backend/models/EventAccount');
const transaction = require('../src/backend/services/transaction');
const args = process.argv.slice(2);
function argument(key) { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; }
(async () => {
  const eventId = argument('--event-id'), email = argument('--creator-email');
  if (!mongoose.isValidObjectId(eventId) || !email || email.startsWith('--')) throw new Error('Supply --event-id ID and --creator-email EMAIL. Default is dry-run.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const event = await Event.findById(eventId);
  const creator = await User.findOne({ email: email.trim().toLowerCase(), status: 'ACTIVE' });
  if (!event || !creator) throw new Error('Event or active creator account not found.');
  if (event.createdBy) throw new Error('Event already has a creator. Ownership reassignment is not supported.');
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'APPLY' : 'DRY_RUN', eventId: String(event._id), eventName: event.name, proposedCreatorId: String(creator._id), proposedCreatorEmail: creator.email }, null, 2));
  if (!args.includes('--apply')) { console.log('No data changed. Verify the historical creator before repeating with --apply.'); return; }
  await transaction(async session => {
    // Raw collection update is intentional: normal application writes cannot change immutable createdBy.
    const updated = await Event.collection.updateOne({ _id: event._id, createdBy: null }, { $set: { createdBy: creator._id, updatedAt: new Date() } }, { session });
    if (updated.modifiedCount !== 1) throw new Error('Event ownership changed; no update applied.');
    await EventAccount.findOneAndUpdate({ eventId: event._id, userId: creator._id, accountType: 'EVENT_ADMIN' }, { $set: { status: 'ACTIVE' }, $setOnInsert: { employeeName: creator.fullName, loginCode: crypto.randomBytes(12).toString('hex'), createdBy: creator._id } }, { upsert: true, session, runValidators: true });
  });
  console.log('Recorded the verified creator and active EVENT_ADMIN assignment. Existing staff assignments were preserved.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
