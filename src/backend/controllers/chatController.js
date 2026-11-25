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
