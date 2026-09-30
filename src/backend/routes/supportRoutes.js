const router = require('express').Router();
const { verifyUserToken, requireSuperAdmin } = require('../middlewares/authMiddleware');
const rateLimit = require('../middlewares/rateLimit');
const support = require('../controllers/supportController');
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
module.exports = router;
