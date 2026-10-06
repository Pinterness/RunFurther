// Wallet top-up data model: transfer code uniqueness, frozen receiving account, settings history.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const Payment = require('../../src/backend/models/PaymentRequest');
const PlatformSetting = require('../../src/backend/models/PlatformSetting');
const { createBackendHarness } = require('../helpers/backendHarness');
const { ACCOUNT, OTHER_ACCOUNT } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_models' });
const { createUser } = harness;

before(harness.start);
after(harness.stop);

describe('PaymentRequest and PlatformSetting models', () => {
  it('stores transfer codes uppercased and unique while legacy requests without a code coexist', async () => {
    const user = await createUser();
    const create = (requestKey, extra = {}) =>
      Payment.create({ userId: user.id, kind: 'TOPUP', amount: 10_000, requestKey, ...extra });

    await create('model-legacy-1');
    await create('model-legacy-2');
    const coded = await create('model-coded-1', { transferCode: 'nap23456789' });

    assert.equal(coded.transferCode, 'NAP23456789');
    await assert.rejects(
      create('model-coded-2', { transferCode: 'NAP23456789' }),
      (error) => error.code === 11000 && error.keyPattern?.transferCode === 1,
    );
  });

  it('keeps bankSnapshot immutable after creation', async () => {
    const user = await createUser();
    const created = await Payment.create({
      userId: user.id,
      kind: 'TOPUP',
      amount: 10_000,
      requestKey: 'model-snapshot-1',
      transferCode: 'NAPSNAP2345',
      bankSnapshot: ACCOUNT,
    });

    const updated = await Payment.findOneAndUpdate(
      { _id: created._id },
      { $set: { bankSnapshot: OTHER_ACCOUNT } },
      { new: true },
    ).lean();

    assert.equal(updated.bankSnapshot.accountNo, ACCOUNT.accountNo);
  });

  it('keeps one PlatformSetting per key with a history capped at 50 entries', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    await PlatformSetting.deleteMany({});

    for (let change = 1; change <= 52; change += 1) {
      const bankAccountInfo = { ...ACCOUNT, accountNo: String(1000 + change) };
      await PlatformSetting.findOneAndUpdate(
        { key: 'WALLET_TOPUP' },
        {
          $set: { bankAccountInfo, updatedBy: admin.id },
          $push: { history: { $each: [{ bankAccountInfo, changedBy: admin.id }], $slice: -50 } },
        },
        { upsert: true, new: true },
      );
    }

    const settings = await PlatformSetting.find({ key: 'WALLET_TOPUP' }).lean();
    assert.equal(settings.length, 1);
    assert.equal(settings[0].history.length, 50);
    assert.equal(settings[0].bankAccountInfo.accountNo, '1052');
    assert.ok(settings[0].history.every((entry) => entry.changedAt instanceof Date));
    await assert.rejects(PlatformSetting.create({ key: 'SOMETHING_ELSE' }), {
      name: 'ValidationError',
    });
    await PlatformSetting.deleteMany({});
  });
});
