const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const Ledger = require('../models/Ledger');
const transaction = require('./transaction');
const { assert } = require('../lib/errors');

async function changeBalance({ userId, amount, type, referenceType, referenceId, key }, session) {
  assert(session, 500, 'A transaction is required.');
  assert(Number.isSafeInteger(amount) && amount > 0, 400, 'Amount must be a positive integer in VND.');
  assert(['CREDIT', 'DEBIT'].includes(type), 400, 'Invalid ledger type.');
  const existing = await Ledger.findOne({ idempotencyKey: key }).session(session);
  if (existing) {
    const owner = await Wallet.findOne({ _id: existing.walletId, userId }).session(session);
    assert(owner && existing.amount === amount && existing.type === type && existing.referenceType === referenceType && String(existing.referenceId) === String(referenceId), 409, 'Payment key was used for a different operation.');
    return existing;
  }
  let wallet = await Wallet.findOne({ userId }).session(session);
  if (!wallet && type === 'CREDIT') {
    [wallet] = await Wallet.create([{ userId, balance: 0, currency: 'VND' }], { session });
  }
  assert(wallet && wallet.status === 'ACTIVE', 409, 'Active wallet is required.');
  assert(type !== 'DEBIT' || wallet.balance >= amount, 409, 'Insufficient wallet balance.');
  const before = wallet.balance;
  wallet.balance += type === 'CREDIT' ? amount : -amount;
  assert(Number.isSafeInteger(wallet.balance), 400, 'Wallet balance exceeds supported range.');
  await wallet.save({ session });
  const [ledger] = await Ledger.create([{
    transactionId: new mongoose.Types.ObjectId(), walletId: wallet._id, type, amount,
    balanceBefore: before, balanceAfter: wallet.balance,
    source: type === 'DEBIT' ? 'WALLET' : referenceType,
    destination: type === 'DEBIT' ? referenceType : 'WALLET',
    referenceType, referenceId, idempotencyKey: key,
  }], { session });
  return ledger;
}
async function processPayment(userId, amount, referenceType, referenceId, key, session) {
  const work = async (s) => ({ ledger: await changeBalance({ userId, amount, type: 'DEBIT', referenceType, referenceId, key }, s) });
  return session ? work(session) : transaction(work);
}
module.exports = { processPayment, changeBalance };

