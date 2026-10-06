// Shared data and helpers for the wallet top-up tests in tests/topup/.
const assert = require('node:assert/strict');
const Wallet = require('../../src/backend/models/Wallet');

// Bank BINs come from src/backend/data/banks.json, which the harness serves instead of VietQR.
const ACCOUNT = {
  bankBin: '970422',
  bankName: 'MBBank',
  accountNo: '0123456789',
  accountName: 'CONG TY RUNFURTHER',
};
const OTHER_ACCOUNT = {
  bankBin: '970436',
  bankName: 'Vietcombank',
  accountNo: '9876543210',
  accountName: 'RUNFURTHER VIETNAM',
};

/**
 * Builds top-up helpers bound to one test harness.
 * @param {{ request: Function }} harness Harness from tests/helpers/backendHarness.js.
 * @returns {{ configureAccount: Function, openTopup: Function, balanceOf: Function }} Helpers.
 */
function createTopupHelpers({ request }) {
  async function configureAccount(admin, account = ACCOUNT) {
    const response = await request('/admin/platform/topup-account', {
      method: 'PUT',
      body: { bankAccountInfo: account },
      as: admin,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }

  function openTopup(user, amount, key) {
    return request('/wallet/topup', {
      method: 'POST',
      body: { amount },
      as: user,
      headers: { 'Idempotency-Key': key },
    });
  }

  async function balanceOf(user) {
    return (await Wallet.findOne({ userId: user.id })).balance;
  }

  return { configureAccount, openTopup, balanceOf };
}

module.exports = { ACCOUNT, OTHER_ACCOUNT, createTopupHelpers };
