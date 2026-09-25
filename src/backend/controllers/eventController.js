const { availableEvent } = require('../services/eventPolicy');
const Event = require("../models/Event");
const EventCategory = require("../models/EventCategory");
const Registration = require('./../models/Registration');
const { assert, escapeRegex } = require('../lib/errors');

const PUBLIC_EVENT_STATUSES = [
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "COMPLETED",
];

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

async function listEvents(req, res, next) {
  try {
    const page = parsePositiveInteger(
      req.query.page,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const limit = parsePositiveInteger(req.query.limit, 20, 100);
    const filter = { ...availableEvent, status: { $in: PUBLIC_EVENT_STATUSES } };
    if (req.query.city) filter['location.city'] = { $regex: escapeRegex(String(req.query.city).slice(0, 100)), $options: 'i' };
    if (req.query.search) filter.name = { $regex: escapeRegex(String(req.query.search).slice(0, 120)), $options: 'i' };
    if (req.query.distance) {
      const distance = Number(req.query.distance);
      assert(Number.isFinite(distance) && distance >= 0, 400, 'Invalid distance.');
      filter._id = { $in: await EventCategory.distinct('eventId', { distance }) };
    }

    const [events, total] = await Promise.all([
      Event.find(filter)
        .select("slug name status dateInfo location createdAt bannerUrl logoUrl")
        .sort({ "dateInfo.raceDate": 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Event.countDocuments(filter),
    ]);

    const categories = await EventCategory.find({ eventId: { $in: events.map(event => event._id) } }).lean();
    for (const event of events) {
      const items = categories.filter(category => String(category.eventId) === String(event._id));
      event.categories = items.map(category => category.code);
      event.price = items.length ? Math.min(...items.map(category => category.price)) : null;
      event.quota = items.reduce((sum, category) => sum + category.quotaSold, 0);
      event.quotaTotal = items.reduce((sum, category) => sum + category.quotaTotal, 0);
    }
    return res.status(200).json({
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getEventBySlug(req, res, next) {
  try {
    const slug = req.params.slug.trim().toLowerCase();
    const event = await Event.findOne({
      slug,
      ...availableEvent, status: { $in: PUBLIC_EVENT_STATUSES },
    }).lean();

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    const categories = await EventCategory.find({ eventId: event._id }).sort({ distance: 1 }).lean();
    return res.status(200).json({ event: { ...event, categories } });
  } catch (error) {
    return next(error);
  }
}

async function listEventCategories(req, res, next) {
  try {
    const slug = req.params.slug.trim().toLowerCase();
    const event = await Event.findOne({
      slug,
      ...availableEvent, status: { $in: PUBLIC_EVENT_STATUSES },
    })
      .select("_id slug name status")
      .lean();

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    const categories = await EventCategory.find({ eventId: event._id })
      .select("code name distance price quotaTotal quotaSold quotaHold rules")
      .sort({ distance: 1 })
      .lean();

    return res.status(200).json({ event, categories });
  } catch (error) {
    return next(error);
  }
}

async function listResults(req, res, next) {
  try {
    const event = await Event.findOne({ slug: req.params.slug, ...availableEvent, status: { $in: PUBLIC_EVENT_STATUSES } }).lean();
    assert(event, 404, 'Event not found.');
    const filter = { eventId: event._id, status: { $in: ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'] }, 'finishResult.chipTime': { $regex: '^\\d{1,3}:[0-5]\\d:[0-5]\\d$' } };
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.gender) filter['runnerProfile.gender'] = req.query.gender;
    const seconds = value => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    const registrations = await Registration.find(filter).select('bibNumber runnerProfile.fullName runnerProfile.gender categoryId finishResult.chipTime finishResult.gunTime').populate('categoryId', 'name code distance').lean();
    registrations.sort((a, b) => seconds(a.finishResult.chipTime) - seconds(b.finishResult.chipTime) || String(a._id).localeCompare(String(b._id)));
    let results = registrations.map((reg, index) => ({ rank: index + 1, bibNumber: reg.bibNumber, fullName: reg.runnerProfile.fullName, gender: reg.runnerProfile.gender, category: reg.categoryId, ...reg.finishResult }));
    if (req.query.search) {
      const search = String(req.query.search).toLocaleLowerCase();
      results = results.filter(row => row.fullName.toLocaleLowerCase().includes(search) || row.bibNumber.toLocaleLowerCase().includes(search));
    }
    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 20, 100);
    res.json({ results: results.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: results.length, totalPages: Math.ceil(results.length / limit) } });
  } catch (error) { next(error); }
}
module.exports = { listEvents, getEventBySlug, listEventCategories, listResults };
