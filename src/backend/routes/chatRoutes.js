// /api/chat (spec 4.3): mọi route cần đăng nhập. Giới hạn số tin và số lời mời đếm trong MongoDB theo tài khoản
// (chatLimits, từ lời mời trở đi), không dùng rateLimit theo IP, để người dùng chung mạng (cùng IP) không chặn lẫn nhau và giới hạn vẫn
// đúng sau khi Render ngủ dậy.
const router = require('express').Router();
const { verifyUserToken } = require('../middlewares/authMiddleware');
const chat = require('../controllers/chatController');

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(verifyUserToken);
router.get('/me', chat.me);
router.put('/me/consent', chat.giveConsent);
router.delete('/me/consent', chat.withdrawConsent);
router.post('/invites', chat.invite);
router.get('/conversations', chat.conversations);
router.get('/conversations/:id/messages', chat.messages);
router.post('/conversations/:id/messages', chat.send);
router.post('/conversations/:id/accept', chat.accept);
router.post('/conversations/:id/decline', chat.decline);
router.use(chat.errors);

module.exports = router;
