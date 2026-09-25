const Application = require('../models/OrganizerApplication');
const Event = require('../models/Event');
const Moderation = require('../models/EventModeration');
const transaction = require('../services/transaction');
const { assert, escapeRegex } = require('../lib/errors');
async function requireOrganizerApproval(req, res, next) {
  try {
    assert(req.currentUser.systemRole !== 'SUPER_ADMIN', 403, 'Super Admin chỉ kiểm duyệt, không tạo hay vận hành giải.');
    assert(await Application.exists({ userId: req.userId, status: 'APPROVED' }), 403, 'Bạn cần được Super Admin duyệt quyền tổ chức trước.');
    next();
  } catch (error) { next(error); }
}
async function getApplication(req, res, next) {
  try { res.json({ application: await Application.findOne({ userId: req.userId }).lean() }); } catch (error) { next(error); }
}
async function apply(req, res, next) {
  try {
    assert(req.currentUser.systemRole !== 'SUPER_ADMIN', 403, 'Tài khoản kiểm duyệt không đăng ký quyền tổ chức.');
    const { organizationName, phone, description } = req.body;
    assert([organizationName, phone, description].every(value => typeof value === 'string' && value.trim()), 400, 'Nhập tên đơn vị, số điện thoại và giới thiệu hoạt động tổ chức.');
    const application = await transaction(async session => {
      let item = await Application.findOne({ userId: req.userId }).session(session);
      assert(!item || item.status === 'REJECTED', 409, 'Yêu cầu đã được duyệt hoặc đang chờ duyệt.');
      if (!item) item = new Application({ userId: req.userId });
      Object.assign(item, { organizationName, phone, description, status: 'PENDING', reviewNote: '' });
      await item.save({ session }); return item;
    });
    res.status(201).json({ application });
  } catch (error) { next(error); }
}
async function listApplications(req, res, next) {
  try { res.json({ applications: await Application.find(req.query.status ? { status: req.query.status } : {}).populate('userId', 'fullName email').sort({ updatedAt: -1 }).limit(100).lean() }); } catch (error) { next(error); }
}
async function reviewApplication(req, res, next) {
  try {
    const { status, reason } = req.body;
    assert(['APPROVED', 'REJECTED'].includes(status), 400, 'Quyết định không hợp lệ.');
    assert(typeof reason === 'string' && reason.trim() && reason.length <= 1000, 400, 'Nhập lý do xét duyệt (tối đa 1000 ký tự).');
    const application = await Application.findOneAndUpdate({ _id: req.params.applicationId, status: 'PENDING' }, { $set: { status, reviewNote: reason.trim() }, $push: { reviews: { actorId: req.userId, status, reason: reason.trim(), at: new Date() } } }, { new: true, runValidators: true });
    assert(application, 409, 'Yêu cầu đã được xử lý hoặc không tồn tại.');
    res.json({ application });
  } catch (error) { next(error); }
}
async function listEvents(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1), filter = {};
    if (req.query.search) filter.name = { $regex: escapeRegex(String(req.query.search).slice(0, 100)), $options: 'i' };
    const [events, total] = await Promise.all([Event.find(filter).select('name slug status createdBy location dateInfo moderation').populate('createdBy', 'fullName').sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30).lean(), Event.countDocuments(filter)]);
    res.json({ events, total, page });
  } catch (error) { next(error); }
}
async function moderateEvent(req, res, next) {
  try {
    const { action, reason } = req.body;
    assert(['HIDDEN', 'SUSPENDED', 'ACTIVE'].includes(action), 400, 'Thao tác kiểm duyệt không hợp lệ.');
    assert(typeof reason === 'string' && reason.trim() && reason.length <= 1000, 400, 'Phải nhập lý do kiểm duyệt (tối đa 1000 ký tự).');
    const event = await transaction(async session => {
      const item = await Event.findOneAndUpdate({ _id: req.params.eventId }, { $set: { moderation: { state: action, reason: reason.trim(), reviewedAt: new Date() } }, $inc: { activityRevision: 1 } }, { session, new: true, runValidators: true });
      assert(item, 404, 'Không tìm thấy giải.');
      await Moderation.create([{ eventId: item._id, actorId: req.userId, action, reason: reason.trim() }], { session });
      return { _id: item._id, name: item.name, moderation: item.moderation };
    });
    res.json({ event });
  } catch (error) { next(error); }
}
async function history(req, res, next) {
  try { res.json({ history: await Moderation.find({ eventId: req.params.eventId }).sort({ createdAt: -1 }).limit(100).lean() }); } catch (error) { next(error); }
}
module.exports = { requireOrganizerApproval, getApplication, apply, listApplications, reviewApplication, listEvents, moderateEvent, history };
