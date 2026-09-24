const express = require('express');
const { register, login, getCurrentUser, updateCurrentUser } = require('../controllers/authController');
const { verifyUserToken } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', verifyUserToken, getCurrentUser);
router.patch('/me', verifyUserToken, updateCurrentUser);

module.exports = router;
