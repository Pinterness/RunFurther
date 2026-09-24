const Event = require('../models/Event');
const EventAccount = require('../models/EventAccount');
const User = require('../models/User');

async function getPlatformOverview(_req, res, next) {
  try {
    const [users, events, eventAdmins] = await Promise.all([
      User.countDocuments(),
      Event.countDocuments(),
      EventAccount.countDocuments({ accountType: 'EVENT_ADMIN', status: 'ACTIVE' }),
    ]);

    return res.status(200).json({ users, events, eventAdmins });
  } catch (error) {
    return next(error);
  }
}

async function listManagedEvents(req, res, next) {
  try {
    if (req.currentUser.systemRole === 'SUPER_ADMIN') {
      const events = await Event.find().sort({ 'dateInfo.raceDate': -1 }).lean();
      return res.status(200).json({ events });
    }

    const accounts = await EventAccount.find({
      userId: req.currentUser._id,
      accountType: 'EVENT_ADMIN',
      status: 'ACTIVE',
    })
      .populate('eventId')
      .lean();

    return res.status(200).json({ events: accounts.map((account) => account.eventId).filter(event => event && String(event.createdBy) === String(req.currentUser._id)) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getPlatformOverview, listManagedEvents };
