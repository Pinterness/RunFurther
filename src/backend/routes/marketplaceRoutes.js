const express = require("express");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const {
  listListings,
  createListing,
  buyListing,
  cancelListing,
} = require("../controllers/marketplaceController");

const router = express.Router();

router.get("/", listListings);
router.post("/", verifyUserToken, createListing);
router.post("/:listingId/buy", verifyUserToken, buyListing);
router.delete("/:listingId", verifyUserToken, cancelListing);

module.exports = router;
