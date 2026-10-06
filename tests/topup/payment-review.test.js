// Reviewing top-ups: single credit, concurrency, received amount, separation of duties.
// Runs against the real Express app and an in-memory MongoDB replica set (tests/helpers).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-topup-test-secret';
// The rate limiter is keyed by IP and every request in this file comes from 127.0.0.1.
process.env.WALLET_TOPUP_RATE_LIMIT = '1000';

const { app } = require('../../src/backend/server');
const ERROR_CODES = require('../../src/backend/lib/errorCodes');
const Ledger = require('../../src/backend/models/Ledger');
const Payment = require('../../src/backend/models/PaymentRequest');
const { createBackendHarness } = require('../helpers/backendHarness');
const { createTopupHelpers } = require('../helpers/topupFixtures');

const harness = createBackendHarness({ app, dbName: 'runfurther_topup_review' });
const { createUser, request } = harness;
const { configureAccount, openTopup, balanceOf } = createTopupHelpers(harness);

before(harness.start);
after(harness.stop);

describe('POST /api/admin/payments/:paymentId/review', () => {
  function reviewTopup(admin, paymentId, body) {
    return request(`/admin/payments/${paymentId}/review`, { method: 'POST', body, as: admin });
  }

  it('credits the wallet exactly once and keeps the evidence', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser({ balance: 5_000 });
    await configureAccount(admin);
    const payment = (await openTopup(user, 50_000, 'approve-key-1')).body.paymentRequest;

    const approved = await reviewTopup(admin, payment._id, {
      status: 'APPROVED',
      bankReference: ' FT26001 ',
      receivedAmount: 50_000,
      reviewNote: 'Khớp sao kê',
    });

    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual(
      {
        status: approved.body.payment.status,
        receivedAmount: approved.body.payment.receivedAmount,
        bankReference: approved.body.payment.bankReference,
        reviewedBy: approved.body.payment.reviewedBy,
      },
      {
        status: 'APPROVED',
        receivedAmount: 50_000,
        bankReference: 'FT26001',
        reviewedBy: admin.id,
      },
    );
    assert.equal(await balanceOf(user), 55_000);
    const entries = await Ledger.find({ idempotencyKey: `TOPUP-${payment._id}` }).lean();
    assert.equal(entries.length, 1);
    assert.deepEqual(
      {
        type: entries[0].type,
        amount: entries[0].amount,
        balanceBefore: entries[0].balanceBefore,
        balanceAfter: entries[0].balanceAfter,
        referenceType: entries[0].referenceType,
        referenceId: String(entries[0].referenceId),
      },
      {
        type: 'CREDIT',
        amount: 50_000,
        balanceBefore: 5_000,
        balanceAfter: 55_000,
        referenceType: 'TOPUP',
        referenceId: payment._id,
      },
    );

    const replay = await reviewTopup(admin, payment._id, {
      status: 'APPROVED',
      bankReference: 'FT26001',
      receivedAmount: 50_000,
    });
    const flip = await reviewTopup(admin, payment._id, { status: 'REJECTED', reviewNote: 'Đổi ý' });

    assert.equal(replay.status, 200);
    assert.equal(await balanceOf(user), 55_000);
    assert.equal(flip.status, 409);
  });

  it('credits once under concurrent approvals and never lets one bank reference fund two top-ups', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    const first = (await openTopup(user, 50_000, 'concurrent-key-1')).body.paymentRequest;
    const second = (await openTopup(user, 50_000, 'concurrent-key-2')).body.paymentRequest;
    const approve = (payment) =>
      reviewTopup(admin, payment._id, {
        status: 'APPROVED',
        bankReference: 'FT-RACE-1',
        receivedAmount: 50_000,
      });

    const results = await Promise.all([approve(first), approve(first), approve(first)]);
    const reused = await approve(second);

    assert.ok(
      results.every((response) => response.status === 200),
      JSON.stringify(results),
    );
    assert.equal(await balanceOf(user), 50_000);
    assert.equal(await Ledger.countDocuments({ idempotencyKey: `TOPUP-${first._id}` }), 1);
    assert.equal(reused.status, 409);
    assert.equal((await Payment.findById(second._id)).status, 'PENDING');
    assert.equal(await Ledger.countDocuments({ idempotencyKey: `TOPUP-${second._id}` }), 0);
  });

  it('refuses a received amount that differs from the request, so money is never guessed', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    const payment = (await openTopup(user, 50_000, 'mismatch-key-1')).body.paymentRequest;
    const approveWith = (extra) =>
      reviewTopup(admin, payment._id, {
        status: 'APPROVED',
        bankReference: 'FT-MISMATCH',
        ...extra,
      });

    const responses = {
      less: await approveWith({ receivedAmount: 49_999 }),
      more: await approveWith({ receivedAmount: 50_001 }),
      missing: await approveWith({}),
      text: await approveWith({ receivedAmount: '50000' }),
      fraction: await approveWith({ receivedAmount: 50_000.5 }),
    };

    assert.deepEqual(
      Object.fromEntries(
        Object.entries(responses).map(([name, response]) => [name, response.body.code]),
      ),
      {
        less: ERROR_CODES.TOPUP_AMOUNT_MISMATCH,
        more: ERROR_CODES.TOPUP_AMOUNT_MISMATCH,
        missing: ERROR_CODES.TOPUP_RECEIVED_AMOUNT_REQUIRED,
        text: ERROR_CODES.TOPUP_RECEIVED_AMOUNT_REQUIRED,
        fraction: ERROR_CODES.TOPUP_RECEIVED_AMOUNT_REQUIRED,
      },
    );
    assert.equal((await Payment.findById(payment._id)).status, 'PENDING');
    assert.equal(await balanceOf(user), 0);

    const rejected = await reviewTopup(admin, payment._id, {
      status: 'REJECTED',
      reviewNote: 'Sai số tiền, hoàn tiền thủ công',
    });
    assert.deepEqual(
      { status: rejected.status, paymentStatus: rejected.body.payment.status },
      { status: 200, paymentStatus: 'REJECTED' },
    );
    assert.equal(await balanceOf(user), 0);
  });

  it('forbids approving your own top-up while another Super Admin can approve it', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const colleague = await createUser({ role: 'SUPER_ADMIN' });
    await configureAccount(admin);
    const own = (await openTopup(admin, 50_000, 'self-key-1')).body.paymentRequest;
    const body = { status: 'APPROVED', bankReference: 'FT-SELF-1', receivedAmount: 50_000 };

    const selfApproval = await reviewTopup(admin, own._id, body);

    assert.deepEqual(
      { status: selfApproval.status, code: selfApproval.body.code },
      { status: 403, code: ERROR_CODES.TOPUP_SELF_APPROVAL },
    );
    assert.equal(await balanceOf(admin), 0);
    assert.equal((await reviewTopup(colleague, own._id, body)).status, 200);
    assert.equal(await balanceOf(admin), 50_000);
  });

  it('still approves expired and legacy requests when the money really arrived', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    await configureAccount(admin);
    const late = (await openTopup(user, 20_000, 'late-key-1')).body.paymentRequest;
    await Payment.updateOne(
      { _id: late._id },
      { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    );
    const legacy = await Payment.create({
      userId: user.id,
      kind: 'TOPUP',
      amount: 30_000,
      requestKey: `TOPUP-${user.id}-legacy-key`,
    });

    const lateReview = await reviewTopup(admin, late._id, {
      status: 'APPROVED',
      bankReference: 'FT-LATE',
      receivedAmount: 20_000,
    });
    const legacyReview = await reviewTopup(admin, legacy._id, {
      status: 'APPROVED',
      bankReference: 'FT-LEGACY',
      receivedAmount: 30_000,
    });

    assert.deepEqual([lateReview.status, legacyReview.status], [200, 200]);
    assert.equal(await balanceOf(user), 50_000);
  });

  it('keeps runners and payers out of the Super Admin queue', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const user = await createUser();
    const runner = await createUser();
    await configureAccount(admin);
    const payment = (await openTopup(user, 50_000, 'authz-key-1')).body.paymentRequest;
    const body = { status: 'APPROVED', bankReference: 'FT-AUTHZ-1', receivedAmount: 50_000 };

    const statuses = [
      (await request('/admin/payments', { as: runner })).status,
      (await request('/admin/payments')).status,
      (await reviewTopup(runner, payment._id, body)).status,
      (await reviewTopup(user, payment._id, body)).status,
    ];

    assert.deepEqual(statuses, [403, 401, 403, 403]);
    assert.equal((await Payment.findById(payment._id)).status, 'PENDING');
    assert.equal(await balanceOf(user), 0);
  });
});
