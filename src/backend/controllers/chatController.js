// Route /api/chat chỉ đọc request và trả kết quả; mọi luật nằm trong chatService và chatGate.
const { handle } = require('../lib/asyncHandler');
const chat = require('../services/chatService');
const reports = require('../services/chatReports');
const realtime = require('../services/chatRealtimeSetting');

exports.me = handle(async (req, res) => {
  res.json(await chat.getMe(req.userId));
});

exports.giveConsent = handle(async (req, res) => {
  res.json(await chat.giveConsent(req.userId, req.body));
});

exports.withdrawConsent = handle(async (req, res) => {
  await chat.withdrawConsent(req.userId);
  res.status(204).end();
});

exports.invite = handle(async (req, res) => {
  const { status, conversation, message } = await chat.createInvite(req.userId, req.body);
  res.status(status).json({ conversation, message });
});

exports.accept = handle(async (req, res) => {
  res.json({ conversation: await chat.acceptConversation(req.userId, req.params.id) });
});

exports.decline = handle(async (req, res) => {
  res.json({ conversation: await chat.declineConversation(req.userId, req.params.id) });
});

exports.conversations = handle(async (req, res) => {
  res.json(await chat.listConversations(req.userId, req.query));
});

exports.conversation = handle(async (req, res) => {
  res.json({ conversation: await chat.getConversation(req.userId, req.params.id) });
});

exports.messages = handle(async (req, res) => {
  res.json(await chat.listMessages(req.userId, req.params.id, req.query));
});

exports.block = handle(async (req, res) => {
  await chat.blockConversation(req.userId, req.params.id);
  res.status(204).end();
});

exports.blocks = handle(async (req, res) => {
  res.json(await chat.listBlocks(req.userId));
});

exports.unblock = handle(async (req, res) => {
  await chat.unblock(req.userId, req.params.id);
  res.status(204).end();
});

exports.read = handle(async (req, res) => {
  await chat.markRead(req.userId, req.params.id, req.body);
  res.status(204).end();
});

exports.unread = handle(async (req, res) => {
  res.json(await chat.unreadCount(req.userId));
});

exports.report = handle(async (req, res) => {
  const { status, report } = await reports.createReport(req.userId, req.params.id, req.body);
  res.status(status).json({ report });
});

exports.adminReports = handle(async (req, res) => {
  res.json(await reports.listReports({ status: typeof req.query.status === 'string' ? req.query.status : undefined }));
});

exports.resolveReport = handle(async (req, res) => {
  res.json(await reports.resolveReport(req.userId, req.params.id, req.body));
});

exports.unlockMember = handle(async (req, res) => {
  await reports.unlockFromReport(req.params.reportId);
  res.status(204).end();
});

exports.send = handle(async (req, res) => {
  const { status, message } = await chat.sendMessage(req.userId, req.params.id, req.body);
  res.status(status).json({ message });
});

// Hai loại lỗi của chat mang thêm thông tin mà errorHandler chung không trả: 409 CHAT_CONVERSATION_EXISTS kèm
// conversationId (để giao diện mở đúng cuộc đã có), và 429 kèm header Retry-After (số giây nên chờ). Lỗi khác đi tiếp
// tới errorHandler chung.
exports.realtimeSetting = handle(async (_req, res) => {
  res.json({ setting: await realtime.presentRealtimeSetting() });
});

exports.updateRealtimeSetting = handle(async (req, res) => {
  await realtime.setRealtime(req.body?.realtimeEnabled, req.userId);
  res.json({ setting: await realtime.presentRealtimeSetting() });
});

exports.errors = (error, _req, res, next) => {
  if (error?.statusCode && error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  if (error?.statusCode && error.conversationId) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, conversationId: error.conversationId });
  }
  return next(error);
};
