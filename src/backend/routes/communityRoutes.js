// /api/community (spec 4.3): mọi route cần đăng nhập, vì hồ sơ cộng đồng chỉ hiện với thành viên (spec D2).
const router = require('express').Router();
const { verifyUserToken } = require('../middlewares/authMiddleware');
const rateLimit = require('../middlewares/rateLimit');
const community = require('../controllers/communityController');
const writes = rateLimit(30);
// Đọc danh sách và hồ sơ: đủ rộng cho người dùng thật, chặn việc quét hàng loạt.
const reads = rateLimit(120);

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(verifyUserToken);
router.get('/me', community.me);
router.put('/me', writes, community.saveMe);
router.delete('/me', writes, community.deleteMe);
router.get('/profiles', reads, community.list);
router.get('/profiles/:handle', reads, community.detail);

module.exports = router;
