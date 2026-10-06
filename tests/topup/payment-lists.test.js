// Payment lists for payers and for the Super Admin queue, including statement-style code search.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const ERROR_CODES = require('../../src/backend/lib/errorCodes');
const Payment = require('../../src/backend/models/PaymentRequest');
const { createBackendHarness } = require('../helpers/backendHarness');
const { ACCOUNT, createTopupHelpers } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_lists' });
const { createUser, request } = harness;
const { configureAccount, openTopup } = createTopupHelpers(harness);

before(harness.start);
after(harness.stop);

describe('GET payment lists', () => {
  it('lists only the caller’s requests, with transfer details that disappear once unpayable', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    const other = await createUser();
    await configureAccount(admin);
    const live = (await openTopup(user, 50_000, 'list-key-1')).body.paymentRequest;
    const late = (await openTopup(user, 60_000, 'list-key-2')).body.paymentRequest;
    await openTopup(other, 70_000, 'list-key-3');
    await Payment.updateOne({ _id: late._id }, { expiresAt: new Date(Date.now() - 1000) });
    const legacy = await Payment.create({
      userId: user.id,
      kind: 'TOPUP',
      amount: 10_000,
      requestKey: `TOPUP-${user.id}-legacy-list`,
    });

    const mine = await request('/wallet/payments', { as: user });
    const byId = Object.fromEntries(mine.body.payments.map((payment) => [payment._id, payment]));

    assert.equal(mine.status, 200);
    assert.deepEqual(Object.keys(byId).sort(), [live._id, late._id, String(legacy._id)].sort());
    assert.ok(byId[live._id].transfer.vietQrUrl);
    assert.deepEqual(
      {
        vietQrUrl: byId[late._id].transfer.vietQrUrl,
        expired: byId[late._id].transfer.expired,
        accountNo: byId[late._id].transfer.bankInfo.accountNo,
      },
      { vietQrUrl: null, expired: true, accountNo: ACCOUNT.accountNo },
    );
    assert.deepEqual(byId[String(legacy._id)].transfer, {
      bankInfo: null,
      vietQrUrl: null,
      transferCode: null,
      amount: 10_000,
      expiresAt: null,
      expired: false,
    });
    const pending = await request('/wallet/payments?status=PENDING', { as: user });
    const invalid = await request('/wallet/payments?status=WHATEVER', { as: user });
    assert.equal(pending.body.payments.length, 3);
    assert.deepEqual(
      { status: invalid.status, code: invalid.body.code },
      { status: 400, code: ERROR_CODES.INVALID_QUERY },
    );
  });

  it('shows the payer, flags expired requests and finds codes the way bank statements print them', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const payerA = await createUser();
    const payerB = await createUser();
    await configureAccount(admin);
    const first = (await openTopup(payerA, 50_000, 'queue-key-1')).body.paymentRequest;
    const second = (await openTopup(payerB, 60_000, 'queue-key-2')).body.paymentRequest;
    await Payment.updateOne({ _id: second._id }, { expiresAt: new Date(Date.now() - 1000) });
    await Payment.updateOne({ _id: first._id }, { status: 'REJECTED' });
    const list = (query = '') => request(`/admin/payments${query}`, { as: admin });
    const idsOf = (response) => response.body.payments.map((payment) => payment._id);
    // Statements often show the memo lowercased, spaced or hyphenated: "nap k7m2-q9xa".
    const statementText = [
      second.transferCode.slice(0, 3).toLowerCase(),
      second.transferCode.slice(3, 7).toLowerCase(),
    ].join(' ');
    const mangledMemo = `${statementText}-${second.transferCode.slice(7)}`;

    const all = await list();
    const rowA = all.body.payments.find((payment) => payment._id === first._id);
    const rowB = all.body.payments.find((payment) => payment._id === second._id);

    assert.equal(all.status, 200);
    assert.ok(all.body.payments.every((payment) => payment.kind === 'TOPUP'));
    assert.deepEqual(
      { email: rowA.userId.email, fullName: rowA.userId.fullName, expired: rowA.expired },
      { email: payerA.email, fullName: payerA.fullName, expired: false },
    );
    assert.deepEqual(
      { email: rowB.userId.email, expired: rowB.expired },
      { email: payerB.email, expired: true },
    );
    assert.equal(rowA.transfer, undefined);
    assert.ok((await list('?status=PENDING')).body.payments.every((p) => p.status === 'PENDING'));
    assert.deepEqual(idsOf(await list(`?status=REJECTED&q=${second.transferCode}`)), []);
    assert.deepEqual(idsOf(await list(`?q=${encodeURIComponent(mangledMemo)}`)), [second._id]);
    assert.deepEqual(idsOf(await list(`?q=${second.transferCode.slice(3)}`)), [second._id]);
    assert.equal((await list('?status[$ne]=PENDING')).status, 400);
    assert.equal((await list('?q[$gt]=')).status, 400);
    assert.equal((await list(`?q=${encodeURIComponent('.*')}`)).status, 200);
  });
});
