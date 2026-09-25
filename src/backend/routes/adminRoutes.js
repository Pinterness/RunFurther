const express = require('express');
const { verifyUserToken, requireSuperAdmin, requireEventAdmin } = require('../middlewares/authMiddleware');
const { getPlatformOverview, listManagedEvents } = require('../controllers/adminController');

const router = express.Router();
const management = require('../controllers/managementController');
const organizer = require('../controllers/organizerController');
const platform = require('../controllers/platformController');
router.get('/organizer-access', verifyUserToken, platform.getApplication);
router.post('/organizer-access', verifyUserToken, platform.apply);
router.get('/platform/applications', verifyUserToken, requireSuperAdmin, platform.listApplications);
router.post('/platform/applications/:applicationId/review', verifyUserToken, requireSuperAdmin, platform.reviewApplication);
router.get('/platform/events', verifyUserToken, requireSuperAdmin, platform.listEvents);
router.post('/platform/events/:eventId/moderation', verifyUserToken, requireSuperAdmin, platform.moderateEvent);
router.get('/platform/events/:eventId/history', verifyUserToken, requireSuperAdmin, platform.history);
router.get('/events/:eventId', verifyUserToken, requireEventAdmin, organizer.getEvent);
router.get('/events/:eventId/staff', verifyUserToken, requireEventAdmin, organizer.listStaff);
router.post('/events/:eventId/staff', verifyUserToken, requireEventAdmin, organizer.createStaff);
router.patch('/events/:eventId/staff/:accountId', verifyUserToken, requireEventAdmin, organizer.updateStaff);
router.post('/events', verifyUserToken, platform.requireOrganizerApproval, management.createEvent);
router.patch('/events/:eventId', verifyUserToken, requireEventAdmin, management.updateEvent);
router.post('/events/:eventId/categories', verifyUserToken, requireEventAdmin, management.saveCategory);
router.patch('/events/:eventId/categories/:categoryId', verifyUserToken, requireEventAdmin, management.saveCategory);
router.get('/events/:eventId/registrations', verifyUserToken, requireEventAdmin, management.listRunners);
router.put('/events/:eventId/registrations/:registrationId/result', verifyUserToken, requireEventAdmin, management.saveResult);
const { listPayments, reviewPayment } = require('../controllers/paymentController');
router.get('/events/:eventId/payments', verifyUserToken, requireEventAdmin, listPayments);
router.post('/events/:eventId/payments/:paymentId/review', verifyUserToken, requireEventAdmin, reviewPayment);
router.get('/payments', verifyUserToken, requireSuperAdmin, listPayments);
router.post('/payments/:paymentId/review', verifyUserToken, requireSuperAdmin, reviewPayment);

// Global-only operations.
router.get('/platform/overview', verifyUserToken, requireSuperAdmin, getPlatformOverview);

// Event ownership is required; platform moderators cannot operate events.
router.get('/events/:eventId/access', verifyUserToken, requireEventAdmin, (req, res) => {
  res.status(200).json({
    eventId: req.eventId,
    role: 'EVENT_ADMIN',
  });
});

// Only events owned by the current organizer are returned.
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
