require('dotenv').config();
const mongoose = require('mongoose');
const Registration = require('../src/backend/models/Registration');
const Category = require('../src/backend/models/EventCategory');
const Booking = require('../src/backend/models/Booking');
const Volunteer = require('../src/backend/models/VolunteerApplication');

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const duplicates = {};
  for (const [name, model, group, match] of [
    ['bookingTickets', Registration, { bookingId: '$payment.bookingId' }, {}],
    ['bibs', Registration, { eventId: '$eventId', bib: '$bibNumber' }, { bibNumber: { $type: 'string' } }],
    ['pendingVolunteers', Volunteer, { eventId: '$eventId', email: '$applicant.email' }, { status: 'PENDING' }],
  ]) {
    duplicates[name] = await model.aggregate([{ $match: match }, { $group: { _id: group, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
  }
  const categories = await Category.find().lean();
  const quotas = [];
  for (const category of categories) {
    const held = await Booking.countDocuments({ categoryId: category._id, status: 'HOLD' });
    const sold = await Booking.countDocuments({ categoryId: category._id, status: 'PAID' });
    if (held !== category.quotaHold || sold !== category.quotaSold) quotas.push({ categoryId: category._id, stored: { held: category.quotaHold, sold: category.quotaSold }, observed: { held, sold } });
  }
  console.log(JSON.stringify({ duplicates, quotas, changed: false }, null, 2));
  if (Object.values(duplicates).some(items => items.length)) {
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--indexes')) {
    // Add the named unique index alongside legacy indexes. Never drop indexes/data.
    await Registration.createIndexes();
    await Volunteer.createIndexes();
    console.log('Unique indexes are ready. Quota differences require business reconciliation.');
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
