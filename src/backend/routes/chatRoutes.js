// /api/chat (spec 4.3): mọi route cần đăng nhập. Giới hạn số tin và số lời mời đếm trong MongoDB theo tài khoản
// (chatLimits, từ lời mời trở đi), không dùng rateLimit theo IP, để người dùng chung mạng (cùng IP) không chặn lẫn nhau và giới hạn vẫn
// đúng sau khi Render ngủ dậy. Ngoài ra mọi route có một giới hạn tốc độ rộng theo token (chatRateLimit), đặt trước
// bước xác thực, để polling bị lạm dụng không làm chậm database của cả site.
const router = require('express').Router();
const { verifyUserToken, requireSuperAdmin } = require('../middlewares/authMiddleware');
const createChatRateLimit = require('../middlewares/chatRateLimit');
const chat = require('../controllers/chatController');

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(createChatRateLimit());
router.use(verifyUserToken);
router.get('/me', chat.me);
router.put('/me/consent', chat.giveConsent);
router.delete('/me/consent', chat.withdrawConsent);
router.post('/invites', chat.invite);
router.get('/conversations', chat.conversations);
router.get('/conversations/:id', chat.conversation);
router.get('/conversations/:id/messages', chat.messages);
router.post('/conversations/:id/messages', chat.send);
router.post('/conversations/:id/read', chat.read);
router.get('/unread', chat.unread);
router.post('/conversations/:id/block', chat.block);
router.get('/blocks', chat.blocks);
router.delete('/blocks/:id', chat.unblock);
router.post('/conversations/:id/accept', chat.accept);
router.post('/conversations/:id/decline', chat.decline);
// Báo cáo vi phạm (P15): người tham gia báo cáo; chỉ Super Admin xem hàng chờ, xử lý và bỏ khóa.
router.post('/conversations/:id/reports', chat.report);
router.get('/admin/reports', requireSuperAdmin, chat.adminReports);
router.post('/admin/reports/:id/resolve', requireSuperAdmin, chat.resolveReport);
router.post('/admin/members/:reportId/unlock', requireSuperAdmin, chat.unlockMember);
router.use(chat.errors);

module.exports = router;
