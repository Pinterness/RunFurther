// Route /api/chat chỉ đọc request và trả kết quả; mọi luật nằm trong chatService và chatGate.
const { handle } = require('../lib/asyncHandler');
const chat = require('../services/chatService');

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

// Hai loại lỗi của chat mang thêm thông tin mà errorHandler chung không trả: 409 CHAT_CONVERSATION_EXISTS kèm
// conversationId (để giao diện mở đúng cuộc đã có), và 429 kèm header Retry-After (số giây nên chờ). Lỗi khác đi tiếp
// tới errorHandler chung.
exports.errors = (error, _req, res, next) => {
  if (error?.statusCode && error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  if (error?.statusCode && error.conversationId) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, conversationId: error.conversationId });
  }
  return next(error);
};
