const router = require('express').Router();
const { verifyUserToken, requireSuperAdmin } = require('../middlewares/authMiddleware');
const rateLimit = require('../middlewares/rateLimit');
const support = require('../controllers/supportController');
const knowledge = require('../controllers/supportKnowledgeController');
const writes = rateLimit(30);

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/chat', rateLimit(12), (req, res, next) => req.headers.authorization ? verifyUserToken(req, res, next) : next(), support.chat);
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
module.exports = router;
