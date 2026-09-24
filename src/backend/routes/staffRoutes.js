const express = require("express");
const {
  verifyUserToken,
  verifyStaffLoginCode,
  requireAccountType,
  requireEventRoles,
} = require("../middlewares/authMiddleware");
const {
  staffLogin,
  searchRunner,
  checkinRunner,
  issueRaceKit,
  applyVolunteer,
  listVolunteerApplications,
  reviewVolunteerApplication,
} = require("../controllers/staffController");

const router = express.Router();

// Staff Login with PIN
router.post("/events/:eventId/login", require('../middlewares/rateLimit')(15), staffLogin);

// Volunteer Application (Public)
router.post("/events/:eventId/volunteers/apply", (req, res, next) => req.headers.authorization ? verifyUserToken(req, res, next) : next(), applyVolunteer);

// Volunteer Management for Staff Manager / Event Admin
router.get(
  "/events/:eventId/volunteers",
  requireEventRoles(['EVENT_ADMIN', 'STAFF_MANAGER']),
  listVolunteerApplications,
);
router.post(
  "/events/:eventId/volunteers/:applicationId/review",
  requireEventRoles(['EVENT_ADMIN', 'STAFF_MANAGER']),
  reviewVolunteerApplication,
);

// Search runners (Accessible by staff login code or logged-in user token)
router.get("/events/:eventId/search", requireEventRoles(['EVENT_ADMIN', 'STAFF_MANAGER', 'CHECKIN', 'RACE_KIT']), searchRunner);

// Check-in (Accessible with staff PIN or event token)
router.post("/events/:eventId/checkin", requireEventRoles(['EVENT_ADMIN', 'STAFF_MANAGER', 'CHECKIN']), checkinRunner);

// Race-kit issuance (1-Click)
router.post("/events/:eventId/race-kit", requireEventRoles(['EVENT_ADMIN', 'STAFF_MANAGER', 'RACE_KIT']), issueRaceKit);

module.exports = router;
