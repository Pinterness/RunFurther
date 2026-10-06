const Wallet = require('../models/Wallet');
const Ledger = require('../models/Ledger');
const RunPoints = require('../models/RunPoints');
const User = require('../models/User');
const ERROR_CODES = require('../lib/errorCodes');
const { assert } = require('../lib/errors');
const { createTopupRequest, presentTopup, topupConfig } = require('../services/topupService');

const LEDGER_PAGE_SIZE = 100;
const IDEMPOTENCY_KEY_PATTERN = /^[\w-]{8,100}$/;
const TOPUP_MESSAGES = {
  PENDING:
    'Đã tạo lệnh nạp. Chuyển khoản đúng số tiền và nội dung bên dưới; số dư chỉ được cộng sau khi quản trị viên xác nhận đã nhận tiền.',
  APPROVED: 'Lệnh nạp này đã được xác nhận, số dư đã được cộng.',
  REJECTED: 'Lệnh nạp này đã bị từ chối. Xem ghi chú hoặc tạo lệnh mới.',
};

async function getWalletSummary(req, res, next) {
  try {
    const { userId } = req;
    const wallet = await Wallet.findOneAndUpdate(
      { userId },
      { $setOnInsert: { balance: 0, status: 'ACTIVE', currency: 'VND' } },
      { upsert: true, new: true },
    );
    const runPoints = await RunPoints.findOneAndUpdate(
      { userId },
      { $setOnInsert: { balance: 0, lifetimeEarned: 0 } },
      { upsert: true, new: true },
    );
    await User.findByIdAndUpdate(userId, { walletId: wallet._id });
    res.json({
      wallet: { id: wallet._id, balance: wallet.balance, status: wallet.status, currency: 'VND' },
      runPoints: { balance: runPoints.balance, lifetimeEarned: runPoints.lifetimeEarned },
      topup: await topupConfig(),
    });
  } catch (error) {
    next(error);
  }
}

async function getWalletLedger(req, res, next) {
  try {
    const wallet = await Wallet.findOne({ userId: req.userId });
    const points = await RunPoints.findOne({ userId: req.userId }).lean();
    const ledger = wallet
      ? await Ledger.find({ walletId: wallet._id })
          .sort({ createdAt: -1 })
          .limit(LEDGER_PAGE_SIZE)
          .lean()
      : [];
    res.json({ ledger, pointHistory: points?.history ?? [] });
  } catch (error) {
    next(error);
  }
}

async function topUpWallet(req, res, next) {
  try {
    const key = req.headers['idempotency-key'];
    assert(
      typeof key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(key),
      400,
      'Thiếu hoặc sai header Idempotency-Key (8–100 ký tự chữ, số, "-" hoặc "_").',
      ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
    );
    const { payment } = await createTopupRequest({
      userId: req.userId,
      amount: req.body.amount,
      key,
    });
    res.status(202).json({
      paymentRequest: payment,
      transfer: presentTopup(payment),
      message: TOPUP_MESSAGES[payment.status],
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getWalletSummary, getWalletLedger, topUpWallet };
