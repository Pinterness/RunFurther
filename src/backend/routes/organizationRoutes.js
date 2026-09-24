const express = require("express");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const {
  listOrganizations,
  getOrganizationBySlug,
  createOrganization,
} = require("../controllers/organizationController");

const router = express.Router();

router.get("/", listOrganizations);
router.get('/mine', verifyUserToken, async (req, res, next) => {
  try {
    const organizations = await require('../models/Organization').find({ ownerId: req.userId, status: 'ACTIVE', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).lean();
    res.json({ organizations });
  } catch (error) { next(error); }
});
router.get("/:slug", getOrganizationBySlug);
router.post("/", verifyUserToken, createOrganization);

module.exports = router;
