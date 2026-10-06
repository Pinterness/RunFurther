// Super Admin endpoints for the account that receives wallet top-ups.
// Saving only affects new top-ups: every request keeps the bankSnapshot it was created with.
const PlatformSetting = require('../models/PlatformSetting');
const { listBanks, normalizeBank } = require('../services/bankService');
const { SETTING_KEY, getTopupAccount } = require('../services/topupService');
const { assert } = require('../lib/errors');

const HISTORY_LIMIT = 50;
const HISTORY_SHOWN = 10;
const IDENTITY_FIELDS = ['bankBin', 'accountNo', 'accountName'];

const toPerson = (user) => (user ? { fullName: user.fullName, email: user.email } : null);

const sameAccount = (left = {}, right = {}) =>
  IDENTITY_FIELDS.every((field) => (left[field] ?? '') === (right[field] ?? ''));

function toAccount(info = {}) {
  return {
    bankBin: info.bankBin ?? '',
    bankName: info.bankName ?? '',
    accountNo: info.accountNo ?? '',
    accountName: info.accountName ?? '',
  };
}

async function presentSetting() {
  const setting = await PlatformSetting.findOne({ key: SETTING_KEY })
    .populate('updatedBy', 'fullName email')
    .populate('history.changedBy', 'fullName email')
    .lean();
  const history = (setting?.history ?? []).slice(-HISTORY_SHOWN).reverse();
  return {
    account: toAccount(setting?.bankAccountInfo),
    configured: Boolean(await getTopupAccount()),
    updatedBy: toPerson(setting?.updatedBy),
    updatedAt: setting?.updatedAt ?? null,
    history: history.map((entry) => ({
      bankAccountInfo: toAccount(entry.bankAccountInfo),
      changedBy: toPerson(entry.changedBy),
      changedAt: entry.changedAt,
    })),
  };
}

async function getTopupAccountSetting(_req, res, next) {
  try {
    res.json(await presentSetting());
  } catch (error) {
    next(error);
  }
}

async function saveTopupAccountSetting(req, res, next) {
  try {
    const input = req.body?.bankAccountInfo;
    assert(
      input && typeof input === 'object' && !Array.isArray(input),
      400,
      'Thông tin tài khoản nhận không hợp lệ.',
    );
    await listBanks();
    // All fields empty means "close top-ups"; partly filled input is rejected by normalizeBank.
    const account = normalizeBank(input);
    const current = await PlatformSetting.findOne({ key: SETTING_KEY }).lean();
    if (!current || !sameAccount(current.bankAccountInfo, account)) {
      const change = { bankAccountInfo: account, changedBy: req.userId, changedAt: new Date() };
      await PlatformSetting.findOneAndUpdate(
        { key: SETTING_KEY },
        {
          $set: { bankAccountInfo: account, updatedBy: req.userId },
          $push: { history: { $each: [change], $slice: -HISTORY_LIMIT } },
        },
        { upsert: true },
      );
    }
    res.json(await presentSetting());
  } catch (error) {
    next(error);
  }
}

module.exports = { getTopupAccountSetting, saveTopupAccountSetting };
