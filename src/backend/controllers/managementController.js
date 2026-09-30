const { lockOperationalEvent } = require('../services/eventPolicy');
const Event = require('../models/Event');
const EventCategory = require('../models/EventCategory');
const Organization = require('../models/Organization');
const Registration = require('../models/Registration');
const EventAccount = require('../models/EventAccount');
const transaction = require('../services/transaction');
const { assert } = require('../lib/errors');
const { normalizeBank, listBanks } = require('../services/bankService');
const { validateImages } = require('./imageController');
function pick(body, keys) { return Object.fromEntries(keys.filter(key => body[key] !== undefined).map(key => [key, body[key]])); }
function validateDates(dates) {
  const { registrationStart, registrationEnd, raceDate } = dates;
  assert(new Date(registrationStart) < new Date(registrationEnd) && new Date(registrationEnd) <= new Date(raceDate), 400, 'Invalid registration and race dates.');
}
async function createEvent(req, res, next) {
  try {
    const data = pick(req.body, ['slug', 'name', 'dateInfo', 'location', 'organizerId', 'bankAccountInfo', 'bannerUrl', 'logoUrl']);
    assert(data.dateInfo, 400, 'Event dates are required.');
    validateDates(data.dateInfo);
    if (data.bankAccountInfo !== undefined) { await listBanks(); data.bankAccountInfo = normalizeBank(data.bankAccountInfo); }
    await validateImages(data, req.userId);
    const event = await transaction(async session => {
      {
        const org = await Organization.findOne({ _id: data.organizerId, ownerId: req.userId, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).session(session);
        assert(org, 403, 'An active organization owned by you is required.');
      }
      const [event] = await Event.create([{ ...data, createdBy: req.userId, status: 'DRAFT' }], { session });
      const user = await require('../models/User').findById(req.userId).session(session);
      await EventAccount.create([{ eventId: event._id, userId: req.userId, employeeName: user.fullName, accountType: 'EVENT_ADMIN', loginCode: require('crypto').randomBytes(12).toString('hex'), createdBy: req.userId }], { session });
      return event;
    });
    res.status(201).json({ event });
  } catch (error) { next(error); }
}
async function updateEvent(req, res, next) {
  try {
    const data = pick(req.body, ['name', 'dateInfo', 'location', 'bankAccountInfo', 'bannerUrl', 'logoUrl', 'status']);
    if (data.bankAccountInfo !== undefined) { await listBanks(); data.bankAccountInfo = normalizeBank(data.bankAccountInfo); }
    const event = await transaction(async session => {
    const event = await lockOperationalEvent(req.params.eventId, session);
    assert(event, 404, 'Event not found.');
    if (req.body.status === 'REGISTRATION_OPEN' && event.status !== 'REGISTRATION_OPEN') {
      assert(await require('../models/EventCategory').exists({ eventId: event._id, quotaTotal: { $gt: 0 } }), 409, 'Thêm ít nhất một cự ly có số suất trước khi mở đăng ký.');
    }
    await validateImages(data, req.userId, event);
    Object.assign(event, data);
    validateDates(event.dateInfo);
    await event.save({ session });
    return event;
    });
    res.json({ event });
  } catch (error) { next(error); }
}
async function saveCategory(req, res, next) {
  try {
    const category = await transaction(async session => {
      const event = await lockOperationalEvent(req.params.eventId, session);
      assert(event, 404, 'Event not found.');
      const data = pick(req.body, ['code', 'name', 'distance', 'price', 'quotaTotal', 'rules']);
      let category;
      if (req.params.categoryId) {
        category = await EventCategory.findOne({ _id: req.params.categoryId, eventId: event._id }).session(session);
        assert(category, 404, 'Category not found.');
        Object.assign(category, data);
      } else category = new EventCategory({ ...data, eventId: event._id });
      assert(Number.isSafeInteger(category.price) && category.price >= 0, 400, 'Price must be integer VND.');
      assert(Number.isSafeInteger(category.quotaTotal) && category.quotaTotal >= category.quotaHold + category.quotaSold, 409, 'Quota cannot be lower than held and sold tickets.');
      await category.save({ session });
      return category;
    });
    res.status(req.params.categoryId ? 200 : 201).json({ category });
  } catch (error) { next(error); }
}
async function listRunners(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const filter = { eventId: req.params.eventId };
    const registrations = await Registration.find(filter).populate('categoryId', 'name code distance').sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
    res.json({ registrations, total: await Registration.countDocuments(filter), page });
  } catch (error) { next(error); }
}
async function saveResult(req, res, next) {
  try {
    const data = pick(req.body, ['chipTime', 'gunTime']);
    assert(typeof data.chipTime === 'string' && /^\d{1,3}:[0-5]\d:[0-5]\d$/.test(data.chipTime), 400, 'chipTime must be HHH:MM:SS.');
    if (data.gunTime) assert(/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(data.gunTime), 400, 'Invalid gunTime.');
    const registration = await transaction(async session => {
    await lockOperationalEvent(req.params.eventId, session);
    const registration = await Registration.findOneAndUpdate({ _id: req.params.registrationId, eventId: req.params.eventId, status: { $in: ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'] } }, { $set: { finishResult: data } }, { session, new: true, runValidators: true });
    assert(registration, 404, 'Eligible registration not found.');
    return registration;
    });
    res.json({ registration });
  } catch (error) { next(error); }
}
module.exports = { createEvent, updateEvent, saveCategory, listRunners, saveResult };

