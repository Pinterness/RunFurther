// Opening a top-up: availability, transfer codes, validation, limits, races and rate limiting.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const ERROR_CODES = require('../../src/backend/lib/errorCodes');
const Payment = require('../../src/backend/models/PaymentRequest');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const Wallet = require('../../src/backend/models/Wallet');
const {
  CODE_PATTERN,
  TOPUP_LIMITS,
  createTopupRequest,
} = require('../../src/backend/services/topupService');
const { createBackendHarness } = require('../helpers/backendHarness');
const { ACCOUNT, OTHER_ACCOUNT, createTopupHelpers } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_create' });
const { createUser, request } = harness;
const { configureAccount, openTopup, balanceOf } = createTopupHelpers(harness);

before(harness.start);
after(harness.stop);

describe('POST /api/wallet/topup', () => {
  it('stays closed until a Super Admin configures the receiving account', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await PlatformSetting.deleteMany({});

    const before = await request('/wallet', { as: user });
    const closed = await openTopup(user, 50_000, 'closed-key-1');

    assert.equal(before.body.topup.available, false);
    assert.deepEqual(
      { status: closed.status, code: closed.body.code },
      { status: 409, code: ERROR_CODES.TOPUP_CLOSED },
    );
    assert.equal(await Payment.countDocuments({ userId: user.id }), 0);

    await configureAccount(admin);
    const after = await request('/wallet', { as: user });

    assert.deepEqual(after.body.topup, {
      available: true,
      minAmount: 10_000,
      maxAmount: 100_000_000,
      codeTtlHours: 24,
      maxActive: 3,
    });
    assert.equal(JSON.stringify(after.body).includes(ACCOUNT.accountNo), false);
  });

  it('returns a unique code, a frozen account and a VietQR link, and replays the same request for the same key', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);

    const first = await openTopup(user, 50_000, 'create-key-1');
    const payment = first.body.paymentRequest;

    assert.equal(first.status, 202, JSON.stringify(first.body));
    assert.match(payment.transferCode, CODE_PATTERN);
    assert.deepEqual(
      { kind: payment.kind, status: payment.status, amount: payment.amount },
      { kind: 'TOPUP', status: 'PENDING', amount: 50_000 },
    );
    assert.deepEqual(
      {
        transferCode: first.body.transfer.transferCode,
        expired: first.body.transfer.expired,
        accountNo: first.body.transfer.bankInfo.accountNo,
      },
      { transferCode: payment.transferCode, expired: false, accountNo: ACCOUNT.accountNo },
    );
    assert.ok(first.body.transfer.vietQrUrl.includes(`addInfo=${payment.transferCode}`));
    assert.ok(first.body.transfer.vietQrUrl.includes('amount=50000'));
    const ttl = new Date(payment.expiresAt) - Date.now();
    assert.ok(ttl > TOPUP_LIMITS.ttlMs - 60_000 && ttl <= TOPUP_LIMITS.ttlMs, String(ttl));

    const replay = await openTopup(user, 50_000, 'create-key-1');
    assert.deepEqual(
      {
        status: replay.status,
        id: replay.body.paymentRequest._id,
        code: replay.body.paymentRequest.transferCode,
      },
      { status: 202, id: payment._id, code: payment.transferCode },
    );

    const reused = await openTopup(user, 60_000, 'create-key-1');
    assert.deepEqual(
      { status: reused.status, code: reused.body.code },
      { status: 409, code: ERROR_CODES.TOPUP_KEY_REUSED },
    );

    await configureAccount(admin, OTHER_ACCOUNT);
    const oldRequest = await openTopup(user, 50_000, 'create-key-1');
    const newRequest = await openTopup(user, 50_000, 'create-key-2');

    assert.equal(oldRequest.body.transfer.bankInfo.accountNo, ACCOUNT.accountNo);
    assert.equal(newRequest.body.transfer.bankInfo.accountNo, OTHER_ACCOUNT.accountNo);
    assert.notEqual(newRequest.body.paymentRequest.transferCode, payment.transferCode);
    assert.equal(await Payment.countDocuments({ userId: user.id }), 2);
    assert.equal(await balanceOf(user), 0);
  });

  it('rejects invalid amounts and idempotency keys before storing anything', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    const invalidAmounts = [9_999, 100_000_001, 12_345.5, '50000', null, -50_000, 0];
    const invalidKeys = ['short', 'has spaces in it', 'x'.repeat(101)];

    for (const [index, amount] of invalidAmounts.entries()) {
      const response = await openTopup(user, amount, `bad-amount-${index}`);
      assert.deepEqual(
        { status: response.status, code: response.body.code },
        { status: 400, code: ERROR_CODES.TOPUP_INVALID_AMOUNT },
        String(amount),
      );
    }
    for (const key of invalidKeys) {
      const response = await openTopup(user, 50_000, key);
      assert.deepEqual(
        { status: response.status, code: response.body.code },
        { status: 400, code: ERROR_CODES.INVALID_IDEMPOTENCY_KEY },
        key,
      );
    }
    const missingKey = await request('/wallet/topup', {
      method: 'POST',
      body: { amount: 50_000 },
      as: user,
    });
    const anonymous = await request('/wallet/topup', {
      method: 'POST',
      body: { amount: 50_000 },
      headers: { 'Idempotency-Key': 'anonymous-key' },
    });

    assert.equal(missingKey.status, 400);
    assert.equal(anonymous.status, 401);
    assert.equal(await Payment.countDocuments({ userId: user.id }), 0);
    assert.equal((await openTopup(user, TOPUP_LIMITS.min, 'edge-min-key')).status, 202);
    assert.equal((await openTopup(user, TOPUP_LIMITS.max, 'edge-max-key')).status, 202);
  });

  it('allows at most three live requests per user; expiry or review frees a slot', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    const other = await createUser();
    await configureAccount(admin);
    const opened = [];
    for (const index of [1, 2, 3]) {
      const response = await openTopup(user, 10_000 * index, `cap-key-${index}`);
      opened.push(response.body.paymentRequest);
    }

    const fourth = await openTopup(user, 40_000, 'cap-key-4');

    assert.deepEqual(
      { status: fourth.status, code: fourth.body.code },
      { status: 409, code: ERROR_CODES.TOPUP_LIMIT_REACHED },
    );
    assert.equal((await openTopup(user, 10_000, 'cap-key-1')).status, 202);
    assert.equal((await openTopup(other, 40_000, 'cap-key-4')).status, 202);

    await Payment.updateOne({ _id: opened[0]._id }, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await openTopup(user, 40_000, 'cap-key-4')).status, 202);
    await Payment.updateOne({ _id: opened[1]._id }, { status: 'REJECTED' });
    assert.equal((await openTopup(user, 50_000, 'cap-key-5')).status, 202);
    assert.equal((await openTopup(user, 60_000, 'cap-key-6')).status, 409);
  });

  it('refuses suspended or closed wallets so money is never sent where it cannot be credited', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);

    for (const status of ['SUSPENDED', 'CLOSED']) {
      await Wallet.updateOne({ userId: user.id }, { status });
      const response = await openTopup(user, 50_000, `frozen-${status.toLowerCase()}`);
      assert.deepEqual(
        { status: response.status, code: response.body.code },
        { status: 409, code: ERROR_CODES.WALLET_INACTIVE },
      );
    }

    assert.equal(await Payment.countDocuments({ userId: user.id }), 0);
    await Wallet.updateOne({ userId: user.id }, { status: 'ACTIVE' });
    assert.equal((await openTopup(user, 50_000, 'frozen-active')).status, 202);
  });

  it('regenerates colliding codes and lets concurrent identical requests share one record', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    await Payment.create({
      userId: user.id,
      kind: 'TOPUP',
      amount: 10_000,
      requestKey: 'collision-holder',
      transferCode: 'NAPTAKEN234',
    });
    const codes = ['NAPTAKEN234', 'NAPTAKEN234', 'NAPFRESH234'];

    const result = await createTopupRequest({
      userId: user.id,
      amount: 20_000,
      key: 'collide-key-1',
      codeGenerator: () => codes.shift(),
    });

    assert.deepEqual(
      { created: result.created, code: result.payment.transferCode, unused: codes.length },
      { created: true, code: 'NAPFRESH234', unused: 0 },
    );
    await assert.rejects(
      createTopupRequest({
        userId: user.id,
        amount: 20_000,
        key: 'collide-key-2',
        codeGenerator: () => 'NAPTAKEN234',
      }),
      { statusCode: 503, code: ERROR_CODES.TOPUP_CODE_UNAVAILABLE },
    );

    const racers = await Promise.all(
      Array.from({ length: 4 }, () => openTopup(user, 30_000, 'race-key-1')),
    );

    assert.ok(
      racers.every((response) => response.status === 202),
      JSON.stringify(racers),
    );
    assert.equal(new Set(racers.map((response) => response.body.paymentRequest._id)).size, 1);
    assert.equal(await Payment.countDocuments({ requestKey: `TOPUP-${user.id}-race-key-1` }), 1);
  });

  it('is rate limited per IP by WALLET_TOPUP_RATE_LIMIT', async () => {
    const serverPath = require.resolve('../../src/backend/server');
    delete require.cache[serverPath];
    process.env.WALLET_TOPUP_RATE_LIMIT = '2';
    const { app: limitedApp } = require('../../src/backend/server');
    process.env.WALLET_TOPUP_RATE_LIMIT = '1000';
    const listener = limitedApp.listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));

    try {
      const url = `http://127.0.0.1:${listener.address().port}/api/wallet/topup`;
      const statuses = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        statuses.push((await fetch(url, { method: 'POST' })).status);
      }
      assert.deepEqual(statuses, [401, 401, 429]);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });
});
