// Top-up business rules that need no HTTP: code generation, availability, transfer instructions.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const {
  CODE_PATTERN,
  TOPUP_LIMITS,
  generateTransferCode,
  getTopupAccount,
  presentTopup,
  topupConfig,
} = require('../../src/backend/services/topupService');
const { createBackendHarness } = require('../helpers/backendHarness');
const { ACCOUNT } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_service' });

before(harness.start);
after(harness.stop);

describe('topupService', () => {
  it('generates unambiguous NAP codes from an injectable random source', () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generateTransferCode()));

    assert.equal(codes.size, 5_000);
    assert.ok([...codes].every((code) => CODE_PATTERN.test(code)));
    assert.equal(
      generateTransferCode(() => 0),
      'NAP22222222',
    );
    assert.equal(
      generateTransferCode(() => 31),
      'NAPZZZZZZZZ',
    );
    assert.equal(CODE_PATTERN.test('NAP0O1I2345'), false);
  });

  it('reports top-ups as available only with a valid receiving account', async () => {
    await PlatformSetting.deleteMany({});
    assert.deepEqual(TOPUP_LIMITS, {
      min: 10_000,
      max: 100_000_000,
      ttlMs: 86_400_000,
      maxActive: 3,
    });
    assert.deepEqual(await topupConfig(), {
      available: false,
      minAmount: 10_000,
      maxAmount: 100_000_000,
      codeTtlHours: 24,
      maxActive: 3,
    });

    await PlatformSetting.create({ key: 'WALLET_TOPUP', bankAccountInfo: ACCOUNT });
    assert.equal((await topupConfig()).available, true);
    assert.deepEqual(await getTopupAccount(), ACCOUNT);

    await PlatformSetting.updateOne(
      { key: 'WALLET_TOPUP' },
      { $set: { 'bankAccountInfo.bankBin': '000000' } },
    );
    assert.equal((await topupConfig()).available, false);
    await PlatformSetting.deleteMany({});
  });

  it('offers a QR only while a request is payable and never invents data for legacy requests', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    const payment = {
      amount: 50_000,
      status: 'PENDING',
      transferCode: 'NAP23456789',
      bankSnapshot: ACCOUNT,
      expiresAt: new Date('2026-10-06T10:00:00Z'),
    };

    const live = presentTopup(payment, now);
    const expired = presentTopup(payment, new Date('2026-10-06T10:00:00Z'));
    const approved = presentTopup({ ...payment, status: 'APPROVED' }, now);
    const legacy = presentTopup({ amount: 30_000, status: 'PENDING' }, now);

    assert.equal(live.expired, false);
    assert.equal(live.bankInfo.accountNo, ACCOUNT.accountNo);
    assert.ok(
      live.vietQrUrl.startsWith('https://img.vietqr.io/image/970422-0123456789-compact2.png?'),
    );
    assert.ok(live.vietQrUrl.includes('amount=50000'));
    assert.ok(live.vietQrUrl.includes('addInfo=NAP23456789'));
    assert.deepEqual(
      {
        expired: expired.expired,
        vietQrUrl: expired.vietQrUrl,
        accountNo: expired.bankInfo.accountNo,
      },
      { expired: true, vietQrUrl: null, accountNo: ACCOUNT.accountNo },
    );
    assert.equal(approved.vietQrUrl, null);
    assert.deepEqual(legacy, {
      bankInfo: null,
      vietQrUrl: null,
      transferCode: null,
      amount: 30_000,
      expiresAt: null,
      expired: false,
    });
  });
});
