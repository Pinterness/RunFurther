const mongoose = require('mongoose');
const Ticket = require('../models/SupportTicket');

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} phải có từ 1 đến ${max} ký tự.`);
  return value.trim();
}
function ticketId(req) {
  if (!mongoose.isObjectIdOrHexString(req.params.ticketId)) fail(400, 'Mã yêu cầu không hợp lệ.');
  return req.params.ticketId;
}
const scope = (req, admin = false) => ({ _id: ticketId(req), ...(!admin ? { userId: req.userId } : {}) });
const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };

exports.chat = handle(async (req, res) => {
  const message = text(req.body.message, 2000, 'Tin nhắn');
  const history = req.body.history ?? [];
  if (!Array.isArray(history) || history.length > 10) fail(400, 'Lịch sử chat không hợp lệ.');
  const safeHistory = history.map(item => {
    if (!item || !['user', 'assistant'].includes(item.role)) fail(400, 'Vai trò tin nhắn không hợp lệ.');
    return { role: item.role, content: text(item.content, 4000, 'Tin nhắn lịch sử') };
  });
  if (safeHistory.reduce((n, item) => n + item.content.length, 0) > 16000) fail(400, 'Lịch sử chat quá dài.');
  const page = typeof req.body.page === 'string' && /^\/(?!\/)[a-zA-Z0-9/_?=&%.-]*$/.test(req.body.page) ? req.body.page.slice(0, 250) : '/';
  const { answerSupport } = require('../services/supportAiService');
  const answer = await answerSupport({ message, history: safeHistory, userId: req.userId || null, page });
  res.set('Cache-Control', 'no-store').json(answer);
});

exports.create = handle(async (req, res) => {
  const ticket = await Ticket.create({
    userId: req.userId, subject: text(req.body.subject, 160, 'Tiêu đề'),
    messages: [{ role: 'customer', authorId: req.userId, content: text(req.body.message, 4000, 'Nội dung') }],
  });
  res.status(201).json({ ticket });
});

function list(admin) { return handle(async (req, res) => {
  const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
  const filter = admin ? {} : { userId: req.userId };
  if (req.query.status) {
    if (!['OPEN', 'ANSWERED', 'CLOSED'].includes(req.query.status)) fail(400, 'Trạng thái không hợp lệ.');
    filter.status = req.query.status;
  }
  let query = Ticket.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20)
    .select({ subject: 1, status: 1, userId: 1, createdAt: 1, updatedAt: 1, messages: { $slice: -1 } });
  if (admin) query = query.populate('userId', 'fullName email');
  const [tickets, total] = await Promise.all([query.lean(), Ticket.countDocuments(filter)]);
  res.json({ tickets, page, totalPages: Math.ceil(total / 20), total });
}); }
function detail(admin) { return handle(async (req, res) => {
  let query = Ticket.findOne(scope(req, admin));
  if (admin) query = query.populate('userId', 'fullName email');
  const ticket = await query.lean();
  if (!ticket) fail(404, 'Không tìm thấy yêu cầu hỗ trợ.');
  res.json({ ticket });
}); }
function reply(admin) { return handle(async (req, res) => {
  const content = text(req.body.message, 4000, 'Nội dung');
  const filter = scope(req, admin);
  // Bound the thread atomically, including concurrent replies and close operations.
  let query = Ticket.findOneAndUpdate({ ...filter, status: { $ne: 'CLOSED' }, 'messages.99': { $exists: false } }, {
    $push: { messages: { role: admin ? 'support' : 'customer', authorId: req.userId, content, createdAt: new Date() } },
    $set: { status: admin ? 'ANSWERED' : 'OPEN' },
  }, { new: true, runValidators: true });
  if (admin) query = query.populate('userId', 'fullName email');
  const ticket = await query.lean();
  if (!ticket) {
    const existing = await Ticket.findOne(filter).select('status').lean();
    if (!existing) fail(404, 'Không tìm thấy yêu cầu hỗ trợ.');
    fail(409, existing.status === 'CLOSED' ? 'Yêu cầu đã đóng. Vui lòng tạo yêu cầu mới nếu cần hỗ trợ thêm.' : 'Cuộc trao đổi đã đủ 100 tin nhắn. Vui lòng tạo yêu cầu mới.');
  }
  res.json({ ticket });
}); }
exports.mine = list(false);
exports.listAdmin = list(true);
exports.detail = detail(false);
exports.detailAdmin = detail(true);
exports.reply = reply(false);
exports.replyAdmin = reply(true);
exports.setStatus = handle(async (req, res) => {
  if (!['OPEN', 'CLOSED'].includes(req.body.status)) fail(400, 'Chỉ được mở lại hoặc đóng yêu cầu.');
  const ticket = await Ticket.findOneAndUpdate(scope(req, true), { $set: { status: req.body.status } }, { new: true, runValidators: true }).populate('userId', 'fullName email').lean();
  if (!ticket) fail(404, 'Không tìm thấy yêu cầu hỗ trợ.');
  res.json({ ticket });
});
