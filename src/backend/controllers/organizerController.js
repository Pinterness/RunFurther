const crypto = require('crypto');
const Event = require('../models/Event');
const Category = require('../models/EventCategory');
const EventAccount = require('../models/EventAccount');
const User = require('../models/User');
const { assert } = require('../lib/errors');
const roles = ['STAFF_MANAGER', 'CHECKIN', 'RACE_KIT', 'CHECKPOINT', 'MARSHAL', 'TIMING', 'WATER_STATION', 'MEDICAL', 'VOLUNTEER'];
async function getEvent(req, res, next) {
  try {
    const event = await Event.findById(req.params.eventId).lean();
    assert(event, 404, 'Không tìm thấy sự kiện.');
    const categories = await Category.find({ eventId: event._id }).sort({ distance: 1 }).lean();
    res.json({ event, categories });
  } catch (error) { next(error); }
}
async function listStaff(req, res, next) {
  try {
    const accounts = await EventAccount.find({ eventId: req.params.eventId }).populate('userId', 'fullName email').sort({ createdAt: -1 }).lean();
    // Owner management uses personal login; its staff code is never exposed.
    res.json({ accounts: accounts.map(account => account.accountType === 'EVENT_ADMIN' ? { ...account, loginCode: undefined } : account) });
  } catch (error) { next(error); }
}
async function createStaff(req, res, next) {
  try {
    const { employeeName, accountType, email, locationName = '' } = req.body;
    assert(roles.includes(accountType), 400, 'Vai trò nhân sự không hợp lệ. Không thể cấp thêm EVENT_ADMIN.');
    assert(typeof employeeName === 'string' && employeeName.trim(), 400, 'Nhập tên nhân sự.');
    assert(typeof locationName === 'string', 400, 'Vị trí không hợp lệ.');
    let userId = null;
    if (email) {
      assert(typeof email === 'string', 400, 'Email không hợp lệ.');
      const user = await User.findOne({ email: email.trim().toLowerCase(), status: 'ACTIVE' });
      assert(user, 400, 'Email chưa có tài khoản đang hoạt động. Bỏ trống để nhân sự dùng mã đăng nhập.');
      userId = user._id;
    }
    const account = await EventAccount.create({ eventId: req.params.eventId, employeeName, accountType, userId, assignment: { locationName }, loginCode: crypto.randomBytes(8).toString('hex').toUpperCase(), createdBy: req.userId });
    res.status(201).json({ account });
  } catch (error) { next(error); }
}
async function updateStaff(req, res, next) {
  try {
    const account = await EventAccount.findOne({ _id: req.params.accountId, eventId: req.params.eventId });
    assert(account, 404, 'Không tìm thấy nhân sự trong sự kiện này.');
    assert(account.accountType !== 'EVENT_ADMIN', 403, 'Không thay đổi chủ sự kiện qua phân công nhân sự.');
    if (req.body.accountType !== undefined) { assert(roles.includes(req.body.accountType), 400, 'Vai trò không hợp lệ.'); account.accountType = req.body.accountType; }
    if (req.body.status !== undefined) { assert(['ACTIVE', 'INACTIVE'].includes(req.body.status), 400, 'Trạng thái không hợp lệ.'); account.status = req.body.status; }
    if (req.body.rotateCode === true) account.loginCode = crypto.randomBytes(8).toString('hex').toUpperCase();
    await account.save();
    res.json({ account });
  } catch (error) { next(error); }
}
module.exports = { getEvent, listStaff, createStaff, updateStaff };
