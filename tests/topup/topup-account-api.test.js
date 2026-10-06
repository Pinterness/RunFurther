// Super Admin API for the account that receives wallet top-ups.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
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
});
