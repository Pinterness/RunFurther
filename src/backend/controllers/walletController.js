const Wallet = require('../models/Wallet');
const Ledger = require('../models/Ledger');
const RunPoints = require('../models/RunPoints');
const User = require('../models/User');
const PaymentRequest = require('../models/PaymentRequest');
const { assert } = require('../lib/errors');

async function getWalletSummary(req, res, next) {
  try {
    const userId = req.userId;
    const wallet = await Wallet.findOneAndUpdate({ userId }, { $setOnInsert: { balance: 0, status: 'ACTIVE', currency: 'VND' } }, { upsert: true, new: true });
    const runPoints = await RunPoints.findOneAndUpdate({ userId }, { $setOnInsert: { balance: 0, lifetimeEarned: 0 } }, { upsert: true, new: true });
    await User.findByIdAndUpdate(userId, { walletId: wallet._id });
    res.json({ wallet: { id: wallet._id, balance: wallet.balance, status: wallet.status, currency: 'VND' }, runPoints: { balance: runPoints.balance, lifetimeEarned: runPoints.lifetimeEarned } });
  } catch (error) { next(error); }
}
async function getWalletLedger(req, res, next) {
  try {
    const wallet = await Wallet.findOne({ userId: req.userId });
    const points = await RunPoints.findOne({ userId: req.userId }).lean();
    const ledger = wallet ? await Ledger.find({ walletId: wallet._id }).sort({ createdAt: -1 }).limit(100).lean() : [];
    res.json({ ledger, pointHistory: points?.history || [] });
  } catch (error) { next(error); }
}
async function topUpWallet(req, res, next) {
  try {
    const { amount } = req.body;
    const key = req.headers['idempotency-key'];
    assert(Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000, 400, 'Amount must be an integer between 1 and 100,000,000 VND.');
    assert(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(key), 400, 'A valid Idempotency-Key header is required.');
    const paymentRequest = await PaymentRequest.findOneAndUpdate({ requestKey: 'TOPUP-' + req.userId + '-' + key }, { $setOnInsert: { userId: req.userId, kind: 'TOPUP', amount } }, { upsert: true, new: true });
    assert(paymentRequest.amount === amount, 409, 'This key was used for a different amount.');
    res.status(202).json({ paymentRequest, message: 'Yêu cầu nạp tiền đang chờ đối soát. Số dư chưa được cộng.' });
  } catch (error) { next(error); }
}
module.exports = { getWalletSummary, getWalletLedger, topUpWallet };

