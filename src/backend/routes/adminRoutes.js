const express = require('express');
const { verifyUserToken, requireSuperAdmin, requireEventAdmin } = require('../middlewares/authMiddleware');
const { getPlatformOverview, listManagedEvents } = require('../controllers/adminController');

const router = express.Router();
const management = require('../controllers/managementController');
const organizer = require('../controllers/organizerController');
router.get('/events/:eventId', verifyUserToken, requireEventAdmin, organizer.getEvent);
router.get('/events/:eventId/staff', verifyUserToken, requireEventAdmin, organizer.listStaff);
router.post('/events/:eventId/staff', verifyUserToken, requireEventAdmin, organizer.createStaff);
router.patch('/events/:eventId/staff/:accountId', verifyUserToken, requireEventAdmin, organizer.updateStaff);
router.post('/events', verifyUserToken, management.createEvent);
router.patch('/events/:eventId', verifyUserToken, requireEventAdmin, management.updateEvent);
router.post('/events/:eventId/categories', verifyUserToken, requireEventAdmin, management.saveCategory);
router.patch('/events/:eventId/categories/:categoryId', verifyUserToken, requireEventAdmin, management.saveCategory);
router.get('/events/:eventId/registrations', verifyUserToken, requireEventAdmin, management.listRunners);
router.put('/events/:eventId/registrations/:registrationId/result', verifyUserToken, requireEventAdmin, management.saveResult);
const { listPayments, reviewPayment } = require('../controllers/paymentController');
router.get('/payments', verifyUserToken, requireSuperAdmin, listPayments);
router.post('/payments/:paymentId/review', verifyUserToken, requireSuperAdmin, reviewPayment);

// Global-only operations.
router.get('/platform/overview', verifyUserToken, requireSuperAdmin, getPlatformOverview);

// Event-scoped access check; SUPER_ADMIN is also allowed by requireEventAdmin.
router.get('/events/:eventId/access', verifyUserToken, requireEventAdmin, (req, res) => {
  res.status(200).json({
    eventId: req.eventId,
    role: req.currentUser.systemRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'EVENT_ADMIN',
  });
});

// A super admin sees every event; an event admin's event assignments are returned instead.
router.get('/events', verifyUserToken, async (req, res, next) => {
  try {
    const User = require('../models/User');
    const user = await User.findOne({ _id: req.userId, status: 'ACTIVE' }).select('systemRole');
    if (!user) {
      return res.status(403).json({ message: 'Administrator access is required.' });
    }

    req.currentUser = user;
    return listManagedEvents(req, res, next);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
