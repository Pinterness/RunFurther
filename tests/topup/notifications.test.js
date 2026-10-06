// Payment notifications carry the transfer code for payers and for the Super Admin queue.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createTopupHelpers } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_notifications' });
const { createUser, request } = harness;
const { configureAccount, openTopup } = createTopupHelpers(harness);

before(harness.start);
after(harness.stop);

describe('notifications', () => {
  it('show the transfer code to the payer and to the Super Admin queue', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    const payment = (await openTopup(user, 50_000, 'notify-key-1')).body.paymentRequest;
    const feedOf = async (viewer) =>
      (await request('/notifications', { as: viewer })).body.notifications;

    const adminFeed = await feedOf(admin);
    const userFeed = await feedOf(user);

    assert.ok(
      adminFeed.some(
        (item) =>
          item.key === `topup-review:${payment._id}` && item.detail.includes(payment.transferCode),
      ),
    );
    assert.ok(
      userFeed.some(
        (item) =>
          item.key === `payment:${payment._id}:PENDING` &&
          item.detail.includes(payment.transferCode),
      ),
    );

    await request(`/admin/payments/${payment._id}/review`, {
      method: 'POST',
      body: { status: 'APPROVED', bankReference: 'FT-NOTIFY-1', receivedAmount: 50_000 },
      as: admin,
    });
    const approved = (await feedOf(user)).find(
      (item) => item.key === `payment:${payment._id}:APPROVED`,
    );

    assert.equal(approved.title, 'Nạp ví đã được duyệt');
    assert.equal(
      (await feedOf(admin)).some((item) => item.key === `topup-review:${payment._id}`),
      false,
    );
  });
});
