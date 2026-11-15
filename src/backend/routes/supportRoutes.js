const router = require('express').Router();
const { verifyUserToken, requireSuperAdmin } = require('../middlewares/authMiddleware');
const rateLimit = require('../middlewares/rateLimit');
const support = require('../controllers/supportController');
const knowledge = require('../controllers/supportKnowledgeController');
const supportAi = require('../controllers/supportAiController');
const writes = rateLimit(30);

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/chat', rateLimit(12), (req, res, next) => req.headers.authorization ? verifyUserToken(req, res, next) : next(), support.chat);
// Nút "Chưa đúng": đặt trước verifyUserToken để khách cũng bấm được; route không đọc token.
router.post('/feedback', rateLimit(6), support.feedback);
router.use(verifyUserToken);
router.post('/tickets', rateLimit(6), support.create);
router.get('/tickets', support.mine);
router.get('/tickets/:ticketId', support.detail);
router.post('/tickets/:ticketId/messages', writes, support.reply);

// Platform support can discuss submitted requests, never alter an event's operations.
router.use('/admin', requireSuperAdmin);
router.get('/admin/tickets', support.listAdmin);
router.get('/admin/tickets/:ticketId', support.detailAdmin);
router.post('/admin/tickets/:ticketId/messages', writes, support.replyAdmin);
router.patch('/admin/tickets/:ticketId', writes, support.setStatus);
// Super Admin teaches the bot. There is no delete route: an article is hidden by unpublishing it.
router.get('/admin/knowledge', knowledge.list);
router.post('/admin/knowledge', writes, knowledge.create);
router.post('/admin/knowledge/preview', knowledge.preview); // reads only, so outside the write limit
router.get('/admin/knowledge/:id', knowledge.detail);
router.put('/admin/knowledge/:id', writes, knowledge.update);
router.post('/admin/knowledge/:id/publish', writes, knowledge.publish);
router.post('/admin/knowledge/:id/unpublish', writes, knowledge.unpublish);
router.post('/admin/knowledge/:id/restore', writes, knowledge.restore);
// Hàng chờ câu bot chưa trả lời được: admin xem, đánh dấu đã xử lý hoặc bỏ qua. Không có route xóa: câu tự xóa theo TTL.
router.get('/admin/unanswered', knowledge.listUnanswered);
router.post('/admin/unanswered/:id/resolve', writes, knowledge.resolveUnanswered);
router.post('/admin/unanswered/:id/ignore', writes, knowledge.ignoreUnanswered);
// Công tắc AI: Super Admin bật tắt AI của trợ lý và xem lượt AI hôm nay. Biến môi trường vẫn là công tắc tổng.
router.get('/admin/ai', supportAi.get);
router.put('/admin/ai', writes, supportAi.update);
module.exports = router;
