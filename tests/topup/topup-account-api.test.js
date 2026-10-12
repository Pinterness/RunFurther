// Super Admin API for the account that receives wallet top-ups.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const Payment = require('../../src/backend/models/PaymentRequest');
const Wallet = require('../../src/backend/models/Wallet');
const { createBackendHarness } = require('../helpers/backendHarness');
const { ACCOUNT, OTHER_ACCOUNT } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_account' });
const { createUser, request } = harness;

before(harness.start);
after(harness.stop);

describe('GET/PUT /api/admin/platform/topup-account', () => {
  const ACCOUNT_PATH = '/admin/platform/topup-account';

  it('is restricted to Super Admins', async () => {
    const runner = await createUser();
    const admin = await createUser({ role: 'SUPER_ADMIN' });

    const anonymous = await request(ACCOUNT_PATH);
    const runnerRead = await request(ACCOUNT_PATH, { as: runner });
    const runnerWrite = await request(ACCOUNT_PATH, {
      method: 'PUT',
      body: { bankAccountInfo: ACCOUNT },
      as: runner,
    });
    const adminRead = await request(ACCOUNT_PATH, { as: admin });

    assert.deepEqual(
      [anonymous.status, runnerRead.status, runnerWrite.status, adminRead.status],
      [401, 403, 403, 200],
    );
  });

  it('validates, audits and can clear the receiving account', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    await PlatformSetting.deleteMany({});
    const save = (body) => request(ACCOUNT_PATH, { method: 'PUT', body, as: admin });
    const invalidBodies = [
      {},
      { bankAccountInfo: [] },
      { bankAccountInfo: null },
      { bankTransferEnabled: 'false' },
      { bankAccountInfo: { ...ACCOUNT, bankBin: '000000' } },
      { bankAccountInfo: { ...ACCOUNT, accountNo: '12 34' } },
      { bankAccountInfo: { ...ACCOUNT, accountName: 'X' } },
    ];

    for (const body of invalidBodies) {
      assert.equal((await save(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(await PlatformSetting.countDocuments(), 0);

    const saved = await save({ bankAccountInfo: ACCOUNT });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(
      {
        configured: saved.body.configured,
        accountNo: saved.body.account.accountNo,
        updatedBy: saved.body.updatedBy.email,
        history: saved.body.history.length,
      },
      { configured: true, accountNo: ACCOUNT.accountNo, updatedBy: admin.email, history: 1 },
    );

    const unchanged = await save({ bankAccountInfo: ACCOUNT });
    assert.equal(unchanged.body.history.length, 1);

    const changed = await save({ bankAccountInfo: OTHER_ACCOUNT });
    assert.deepEqual(
      changed.body.history.map((entry) => entry.bankAccountInfo.accountNo),
      [OTHER_ACCOUNT.accountNo, ACCOUNT.accountNo],
    );
    assert.equal(changed.body.history[0].changedBy.email, admin.email);

    const cleared = await save({
      bankAccountInfo: { bankBin: '', bankName: '', accountNo: '', accountName: '' },
    });
    assert.deepEqual(
      {
        status: cleared.status,
        configured: cleared.body.configured,
        history: cleared.body.history.length,
      },
      { status: 200, configured: false, history: 3 },
    );
    assert.equal((await request(ACCOUNT_PATH, { as: admin })).body.configured, false);
  });

  it('hides a disabled account, restores it, replaces/deletes it and still reconciles existing transfers', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const payer = await createUser();
    await PlatformSetting.deleteMany({});
    const save = body => request(ACCOUNT_PATH, { method: 'PUT', body, as: admin });
    const open = key => request('/wallet/topup', { method: 'POST', body: { amount: 50000 }, as: payer, headers: { 'Idempotency-Key': key } });
    assert.equal((await save({ bankAccountInfo: ACCOUNT, bankTransferEnabled: true })).status, 200);
    const original = await open('original-bank');
    assert.equal(original.status, 202);
    const paymentId = original.body.paymentRequest._id;
    const disabled = await save({ bankTransferEnabled: false });
    assert.equal(disabled.body.configured, false);
    assert.equal(disabled.body.account.accountNo, ACCOUNT.accountNo);
    assert.equal(disabled.body.history[0].bankTransferEnabled, false);
    const reloaded = await request(ACCOUNT_PATH, { as: admin });
    assert.equal(reloaded.body.bankTransferEnabled, false);
    assert.equal(reloaded.body.account.accountNo, ACCOUNT.accountNo);
    assert.equal((await request('/wallet', { as: payer })).body.topup.available, false);
    assert.equal((await open('disabled-bank')).status, 409);
    const replay = await open('original-bank');
    assert.equal(replay.body.transfer.bankInfo, null);
    assert.equal(replay.body.transfer.vietQrUrl, null);
    assert.equal(replay.body.paymentRequest.bankSnapshot, undefined);
    const hidden = (await request('/wallet/payments', { as: payer })).body.payments[0];
    assert.equal(hidden.transfer.blocked, true);
    assert.equal(hidden.transfer.bankInfo, null);
    assert.equal(hidden.bankSnapshot, undefined);
    assert.equal((await save({ bankTransferEnabled: true })).body.account.accountNo, ACCOUNT.accountNo);
    assert.ok((await open('original-bank')).body.transfer.vietQrUrl);

    // Three obsolete instructions must not prevent opening a request for the replacement account.
    assert.equal((await open('old-bank-2')).status, 202);
    assert.equal((await open('old-bank-3')).status, 202);
    await save({ bankTransferEnabled: false });
    const replacement = await save({ bankAccountInfo: OTHER_ACCOUNT });
    assert.equal(replacement.body.bankTransferEnabled, false);
    await save({ bankTransferEnabled: true });
    const newPayment = await open('new-bank');
    assert.equal(newPayment.status, 202, JSON.stringify(newPayment.body));
    assert.equal(newPayment.body.transfer.bankInfo.accountNo, OTHER_ACCOUNT.accountNo);
    assert.equal((await open('original-bank')).body.transfer.bankInfo, null);
    const removed = await save({ bankAccountInfo: {}, bankTransferEnabled: false });
    assert.equal(removed.body.account.accountNo, '');
    assert.equal((await save({ bankTransferEnabled: true })).status, 400);
    assert.equal((await request('/wallet/payments', { as: payer })).body.payments.every(p => p.transfer.blocked && !p.transfer.bankInfo && !p.transfer.vietQrUrl), true);
    assert.equal((await Payment.findById(paymentId)).bankSnapshot.accountNo, ACCOUNT.accountNo);
    const review = await request(`/admin/payments/${paymentId}/review`, {
      method: 'POST', as: admin,
      body: { status: 'APPROVED', receivedAmount: 50000, bankReference: 'TRANSFER-BEFORE-BANK-DISABLED' },
    });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal((await Wallet.findOne({ userId: payer.id })).balance, 50000);
    assert.equal((await save({ bankAccountInfo: OTHER_ACCOUNT, bankTransferEnabled: true })).body.configured, true);
  });
});
