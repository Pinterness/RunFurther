const router = require('express').Router();
const mongoose = require('mongoose');
const { verifyUserToken } = require('../middlewares/authMiddleware');
const Payment = require('../models/PaymentRequest');
const Application = require('../models/OrganizerApplication');
const Registration = require('../models/Registration');
const Event = require('../models/Event');
const Moderation = require('../models/EventModeration');
const Volunteer = require('../models/VolunteerApplication');
const EventAccount = require('../models/EventAccount');
const schema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, required: true }, key: { type: String, required: true }, readAt: Date });
schema.index({ userId: 1, key: 1 }, { unique: true });
const Receipt = mongoose.models.NotificationReceipt || mongoose.model('NotificationReceipt', schema);
// "50.000đ · NAPK7M2Q9XA": the transfer code lets payers and admins match the request to a bank statement.
const amountWithCode = (payment) =>
  [`${payment.amount.toLocaleString('vi-VN')}đ`, payment.transferCode].filter(Boolean).join(' · ');
async function feed(userId, systemRole) {
  const [payments, application, tickets, events] = await Promise.all([
    Payment.find({ userId }).sort({ updatedAt: -1 }).limit(20).lean(), Application.findOne({ userId }).lean(),
    Registration.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(), Event.distinct('_id', { createdBy: userId }),
  ]);
  const history = await Moderation.find({ eventId: { $in: events } }).populate('eventId', 'name').sort({ createdAt: -1 }).limit(10).lean();
  const labels = { PENDING: 'đang chờ duyệt', APPROVED: 'đã được duyệt', REJECTED: 'đã bị từ chối' };
  const items = payments.map(p => ({ key: `payment:${p._id}:${p.status}`, title: `${p.kind === 'TOPUP' ? 'Nạp ví' : 'Thanh toán vé'} ${labels[p.status]}`, detail: p.reviewNote || amountWithCode(p), href: p.kind === 'TOPUP' ? '/account/wallet' : '/account', at: p.updatedAt }));
  if (application) items.push({ key: `organizer:${application._id}:${application.updatedAt.toISOString()}`, title: `Quyền tổ chức ${labels[application.status]}`, detail: application.reviewNote || application.organizationName, href: '/organizer', at: application.updatedAt });
  for (const ticket of tickets) items.push({ key: `ticket:${ticket._id}`, title: `Vé của bạn: ${ticket.bibNumber}`, detail: 'Xem thông tin vé trong tài khoản.', href: '/account', at: ticket.updatedAt || ticket.createdAt });
  for (const h of history) items.push({ key: `moderation:${h._id}`, title: `${h.eventId?.name || 'Giải chạy'}: ${h.action === 'ACTIVE' ? 'đã khôi phục' : h.action === 'HIDDEN' ? 'đã ẩn' : 'đã tạm ngừng'}`, detail: h.reason, href: '/organizer', at: h.createdAt });
  const ownVolunteers = await Volunteer.find({ userId }).populate('eventId', 'name').sort({ updatedAt: -1 }).limit(10).lean();
  for (const a of ownVolunteers) items.push({ key: `volunteer:${a._id}:${a.status}`, title: `Đơn tình nguyện viên ${labels[a.status]}`, detail: [a.eventId?.name || 'Giải chạy', a.reviewNote].filter(Boolean).join(' · '), href: '/account#volunteers', at: a.updatedAt });
  if (systemRole !== 'SUPER_ADMIN' && events.length) {
    const owned = await EventAccount.distinct('eventId', { eventId: { $in: events }, userId, accountType: 'EVENT_ADMIN', status: 'ACTIVE' });
    const pendingVolunteers = await Volunteer.find({ eventId: { $in: owned }, status: 'PENDING' }).populate('eventId', 'name').sort({ createdAt: -1 }).limit(10).lean();
    for (const a of pendingVolunteers) items.push({ key: `volunteer-review:${a._id}`, title: 'Đơn tình nguyện viên chờ duyệt', detail: a.eventId?.name || 'Giải chạy', href: `/organizer/events/${a.eventId._id}#volunteers`, at: a.createdAt });
  }
  if (systemRole === 'SUPER_ADMIN') {
    const [applications, topups] = await Promise.all([Application.find({ status: 'PENDING' }).sort({ updatedAt: -1 }).limit(10).lean(), Payment.find({ kind: 'TOPUP', status: 'PENDING' }).sort({ createdAt: -1 }).limit(10).lean()]);
    for (const a of applications) items.push({ key: `review:${a._id}:${a.updatedAt.toISOString()}`, title: 'Đơn tổ chức chờ xét duyệt', detail: a.organizationName, href: '/admin', at: a.updatedAt });
    for (const p of topups) items.push({ key: `topup-review:${p._id}`, title: 'Nạp ví chờ đối soát', detail: amountWithCode(p), href: '/admin', at: p.createdAt });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
}
router.use(verifyUserToken);
router.get('/', async (req, res, next) => {
  try {
    const items = await feed(req.userId, req.currentUser.systemRole);
    const read = new Set((await Receipt.find({ userId: req.userId, key: { $in: items.map(i => i.key) } }).lean()).map(i => i.key));
    res.json({ notifications: items.map(i => ({ ...i, read: read.has(i.key) })) });
  } catch (error) { next(error); }
});
router.post('/read', async (req, res, next) => {
  try {
    const items = await feed(req.userId, req.currentUser.systemRole);
    const keys = new Set(Array.isArray(req.body.keys) ? req.body.keys.slice(0, 30) : []);
    const operations = items.filter(i => keys.has(i.key)).map(i => ({ updateOne: { filter: { userId: req.userId, key: i.key }, update: { $set: { readAt: new Date() } }, upsert: true } }));
    if (operations.length) await Receipt.bulkWrite(operations);
    res.json({ success: true });
  } catch (error) { next(error); }
});
module.exports = router;
