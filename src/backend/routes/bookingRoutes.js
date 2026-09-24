const express = require("express");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const {
  createBookingHold,
  confirmBooking,
  listMyBookings,
  getBookingById,
} = require("../controllers/bookingController");

const router = express.Router();

router.get("/me", verifyUserToken, listMyBookings);
router.post("/hold", verifyUserToken, createBookingHold);
router.get("/:bookingId", verifyUserToken, getBookingById);
router.post("/:bookingId/confirm", verifyUserToken, confirmBooking);

module.exports = router;
