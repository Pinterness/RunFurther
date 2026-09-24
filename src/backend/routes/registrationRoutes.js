const express = require("express");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const {
  listMyRegistrations,
  getRegistrationById,
  getMyAchievements,
  lookupTicket,
} = require("../controllers/registrationController");

const router = express.Router();

router.get("/lookup", lookupTicket);
router.get("/me", verifyUserToken, listMyRegistrations);
router.get("/achievements/me", verifyUserToken, getMyAchievements);
router.get("/:registrationId", verifyUserToken, getRegistrationById);

module.exports = router;
