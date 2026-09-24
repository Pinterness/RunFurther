const express = require("express");
const { verifyUserToken } = require("../middlewares/authMiddleware");
const {
  getWalletSummary,
  getWalletLedger,
  topUpWallet,
} = require("../controllers/walletController");

const router = express.Router();
const { listPayments } = require('../controllers/paymentController');
router.get('/payments', verifyUserToken, listPayments);

router.get("/", verifyUserToken, getWalletSummary);
router.get("/ledger", verifyUserToken, getWalletLedger);
router.post("/topup", verifyUserToken, topUpWallet);

module.exports = router;
