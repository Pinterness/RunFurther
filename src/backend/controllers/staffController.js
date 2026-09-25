const { availableEvent, lockOperationalEvent } = require('../services/eventPolicy');
const crypto = require('crypto');
const EventAccount = require('../models/EventAccount');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const VolunteerApplication = require('../models/VolunteerApplication');
const transaction = require('../services/transaction');
const { assert, escapeRegex } = require('../lib/errors');
const roles = ['CHECKIN', 'RACE_KIT', 'MARSHAL', 'WATER_STATION', 'TIMING', 'MEDICAL', 'VOLUNTEER'];

async function staffLogin(req, res, next) {
  try {
    const { loginCode } = req.body;
    assert(typeof loginCode === 'string' && loginCode.trim(), 400, 'Staff PIN is required.');
    const account = await EventAccount.findOne({ eventId: req.params.eventId, loginCode: loginCode.trim().toUpperCase(), status: 'ACTIVE' }).populate('eventId', 'name');
    assert(account?.eventId, 401, 'Invalid staff PIN.');
    assert(account.accountType !== 'EVENT_ADMIN', 403, 'Quản lý sự kiện phải đăng nhập bằng tài khoản cá nhân.');
    if (account.userId) assert(await require('../models/User').exists({ _id: account.userId, status: 'ACTIVE', systemRole: { $ne: 'SUPER_ADMIN' } }), 401, 'Tài khoản nhân sự không còn hoạt động.');
    assert(await Event.exists({ _id: req.params.eventId, ...availableEvent }), 409, 'Event is suspended or hidden.');
    res.json({ staff: { id: account._id, employeeName: account.employeeName, accountType: account.accountType, eventId: account.eventId._id, eventName: account.eventId.name, loginCode: account.loginCode } });
  } catch (error) { next(error); }
}
async function searchRunner(req, res, next) {
  try {
    assert(typeof req.query.q === 'string' && req.query.q.trim() && req.query.q.length <= 120, 400, 'Search must contain 1–120 characters.');
    const q = req.query.q.trim(), regex = escapeRegex(q);
    const runners = await Registration.find({ eventId: req.params.eventId, $or: [
      { bibNumber: { $regex: regex, $options: 'i' } }, { qrToken: q },
      { 'runnerProfile.phone': { $regex: regex } }, { 'runnerProfile.fullName': { $regex: regex, $options: 'i' } }, { 'runnerProfile.email': { $regex: regex, $options: 'i' } },
    ] }).select('bibNumber status runnerProfile.fullName runnerProfile.phone logistics categoryId').populate('categoryId', 'name code distance').limit(20).lean();
    res.json({ runners });
  } catch (error) { next(error); }
}
function logisticsAction(kind) {
  return async (req, res, next) => {
    try {
      const { registrationId, qrToken, bibNumber, issuedShirtSize } = req.body;
      const filter = { eventId: req.params.eventId, status: { $in: ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'] } };
      if (registrationId) filter._id = registrationId;
      else if (typeof qrToken === 'string' && qrToken) filter.qrToken = qrToken;
      else if (typeof bibNumber === 'string' && bibNumber.trim()) filter.bibNumber = bibNumber.trim().toUpperCase();
      else assert(false, 400, 'Registration, QR or BIB is required.');
      const result = await transaction(async session => {
      await lockOperationalEvent(req.params.eventId, session);
        const registration = await Registration.findOne(filter).session(session);
        assert(registration, 404, 'No eligible registration found.');
        const field = kind === 'checkin' ? 'hasCheckedIn' : 'raceKitIssued';
        const duplicate = registration.logistics[field];
        if (!duplicate) {
          registration.logistics[field] = true;
          registration.logistics[kind === 'checkin' ? 'checkedInAt' : 'raceKitIssuedAt'] = new Date();
          if (kind === 'kit') registration.logistics.issuedShirtSize = issuedShirtSize || registration.logistics.shirtSize;
          registration.status = registration.logistics.hasCheckedIn ? 'CHECKED_IN' : 'KIT_COLLECTED';
          await registration.save({ session });
        }
        return { registration, [kind === 'checkin' ? 'alreadyCheckedIn' : 'alreadyIssued']: duplicate, message: duplicate ? 'Đã thực hiện trước đó.' : 'Thao tác thành công.' };
      });
      res.json(result);
    } catch (error) { next(error); }
  };
}
async function applyVolunteer(req, res, next) {
  try {
    const { applicant, desiredRole = 'VOLUNTEER' } = req.body;
    assert(applicant && ['fullName', 'email', 'phone'].every(k => typeof applicant[k] === 'string' && applicant[k].trim()), 400, 'Name, email and phone are required.');
    assert(roles.includes(desiredRole), 400, 'Invalid volunteer role.');
    const event = await Event.findOne({ _id: req.params.eventId, ...availableEvent, status: { $in: ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] }, 'dateInfo.raceDate': { $gt: new Date() } });
    assert(event, 409, 'This event is not accepting volunteers.');
    const application = await VolunteerApplication.create({ eventId: event._id, userId: req.userId || null, applicant, desiredRole });
    res.status(201).json({ application, message: 'Đã gửi đơn tình nguyện viên.' });
  } catch (error) { next(error); }
}
async function listVolunteerApplications(req, res, next) {
  try {
    const filter = { eventId: req.params.eventId };
    if (req.query.status) filter.status = req.query.status;
    res.json({ applications: await VolunteerApplication.find(filter).sort({ createdAt: -1 }).limit(200).lean() });
  } catch (error) { next(error); }
}
async function reviewVolunteerApplication(req, res, next) {
  try {
    const { status, assignedRole, reviewNote = '' } = req.body;
    assert(['APPROVED', 'REJECTED'].includes(status), 400, 'Invalid review status.');
    const result = await transaction(async session => {
      await lockOperationalEvent(req.params.eventId, session);
      const application = await VolunteerApplication.findOne({ _id: req.params.applicationId, eventId: req.params.eventId }).session(session);
      assert(application, 404, 'Application not found.');
      if (application.status !== 'PENDING') {
        assert(application.status === status, 409, 'Application already reviewed.');
        return { application, loginCode: application.loginCode };
      }
      const reviewer = req.userId || req.staffAccount?.userId || req.staffAccount?.createdBy;
      application.status = status;
      application.reviewedBy = reviewer;
      application.reviewedAt = new Date();
      application.reviewNote = reviewNote;
      if (status === 'APPROVED') {
        const role = assignedRole || application.desiredRole;
        assert(roles.includes(role), 400, 'Volunteer applications cannot grant administrative roles.');
        let pin;
        do { pin = String(crypto.randomInt(100000, 1000000)); }
        while (await EventAccount.exists({ eventId: req.params.eventId, loginCode: pin }).session(session));
        const [account] = await EventAccount.create([{ eventId: req.params.eventId, userId: application.userId, employeeName: application.applicant.fullName, accountType: role, loginCode: pin, createdBy: reviewer }], { session });
        application.assignedRole = role;
        application.loginCode = pin;
        application.eventAccountId = account._id;
      }
      await application.save({ session });
      return { application, loginCode: application.loginCode, message: 'Đã xử lý đơn.' };
    });
    res.json(result);
  } catch (error) { next(error); }
}
module.exports = { staffLogin, searchRunner, checkinRunner: logisticsAction('checkin'), issueRaceKit: logisticsAction('kit'), applyVolunteer, listVolunteerApplications, reviewVolunteerApplication };

