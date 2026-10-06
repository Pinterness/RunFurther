// Wallet top-up business rules: transfer codes, the platform receiving account and how a top-up is
// presented to its payer. HTTP concerns (headers, status codes, JSON) stay in the controllers.
const crypto = require('node:crypto');
const PaymentRequest = require('../models/PaymentRequest');
const PlatformSetting = require('../models/PlatformSetting');
const Wallet = require('../models/Wallet');
const ERROR_CODES = require('../lib/errorCodes');
const { assert, httpError } = require('../lib/errors');
const { normalizeBank, paymentInstructions } = require('./bankService');
const { changeBalance } = require('./walletService');

/**
 * @typedef {object} BankAccount
 * @property {string} bankBin VietQR bank identification number.
 * @property {string} bankName Short bank name shown to users.
 * @property {string} accountNo Account number (kept as text to preserve leading zeros).
 * @property {string} accountName Account holder name.
 */

/**
 * @typedef {object} TransferInstructions
 * @property {BankAccount | null} bankInfo Receiving account frozen on the request.
 * @property {string | null} vietQrUrl QR image link, only while the request can still be paid.
 * @property {string | null} transferCode Memo the payer must type in the bank transfer.
 * @property {number} amount Amount to transfer, in VND.
 * @property {Date | null} expiresAt When the code stops being offered for payment.
 * @property {boolean} expired Whether expiresAt has passed.
 */

const SETTING_KEY = 'WALLET_TOPUP';
const TOPUP_LIMITS = Object.freeze({
  min: 10_000,
  max: 100_000_000,
  ttlMs: 24 * 60 * 60 * 1000,
  maxActive: 3,
});
// No 0/O/1/I: payers retype the code from the screen and admins read it off bank statements.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_PREFIX = 'NAP';
const CODE_LENGTH = 8;
const CODE_PATTERN = /^NAP[2-9A-HJ-NP-Z]{8}$/;
// A collision needs two equal draws from 32^8 codes; five attempts make a failure practically impossible.
const MAX_CODE_ATTEMPTS = 5;
// Same money format as the UI (src/lib/format.js) and notifications: "10.000đ".
const vnd = (amount) => `${amount.toLocaleString('vi-VN')}đ`;

/**
 * Generates a transfer code such as "NAPK7M2Q9XA".
 * @param {(min: number, max: number) => number} [randomInt] Uniform integer source in [min, max).
 * @returns {string} A code matching CODE_PATTERN.
 */
function generateTransferCode(randomInt = crypto.randomInt) {
  const characters = Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)],
  );
  return `${CODE_PREFIX}${characters.join('')}`;
}

/**
 * Reads the account that receives top-ups.
 * @returns {Promise<BankAccount | null>} The validated account, or null when top-ups are closed.
 */
async function getTopupAccount() {
  const setting = await PlatformSetting.findOne({ key: SETTING_KEY }).lean();
  try {
    return normalizeBank(setting?.bankAccountInfo ?? {}, { optional: false });
  } catch {
    return null;
  }
}

/**
 * Describes the top-up rules for clients, so the UI never hard-codes limits.
 * @returns {Promise<{ available: boolean, minAmount: number, maxAmount: number, codeTtlHours: number, maxActive: number }>} Rules.
 */
async function topupConfig() {
  return {
    available: Boolean(await getTopupAccount()),
    minAmount: TOPUP_LIMITS.min,
    maxAmount: TOPUP_LIMITS.max,
    codeTtlHours: TOPUP_LIMITS.ttlMs / (60 * 60 * 1000),
    maxActive: TOPUP_LIMITS.maxActive,
  };
}

/**
 * Tells whether a top-up code is past its expiry. Requests created before codes existed never expire.
 * @param {{ expiresAt?: Date | string | null }} payment Top-up request.
 * @param {Date} [now] Current time; injectable for tests.
 * @returns {boolean} True once expiresAt has passed.
 */
function isExpired(payment, now = new Date()) {
  return Boolean(payment.expiresAt) && new Date(payment.expiresAt) <= now;
}

// Requests created before transfer codes existed have neither a code nor a frozen account.
function bankDetailsOf(payment) {
  const snapshot = payment.bankSnapshot?.toObject?.() ?? payment.bankSnapshot;
  if (!snapshot || !payment.transferCode) {
    return { bankInfo: null, vietQrUrl: null };
  }
  return paymentInstructions(snapshot, payment.amount, payment.transferCode);
}

/**
 * Builds the transfer instructions shown to the payer of one top-up request.
 * @param {object} payment Top-up request (Mongoose document or plain object).
 * @param {Date} [now] Current time; injectable for tests.
 * @returns {TransferInstructions} Instructions; the QR is withheld once the request is not payable.
 */
function presentTopup(payment, now = new Date()) {
  const expired = isExpired(payment, now);
  const { bankInfo, vietQrUrl } = bankDetailsOf(payment);
  const payable = payment.status === 'PENDING' && !expired;
  return {
    bankInfo,
    vietQrUrl: payable ? vietQrUrl : null,
    transferCode: payment.transferCode ?? null,
    amount: payment.amount,
    expiresAt: payment.expiresAt ?? null,
    expired,
  };
}

const isDuplicateOf = (error, field) => error?.code === 11000 && Boolean(error.keyPattern?.[field]);

async function findSameRequest(requestKey, amount) {
  const existing = await PaymentRequest.findOne({ requestKey });
  assert(
    !existing || existing.amount === amount,
    409,
    'Khóa giao dịch này đã được dùng cho một số tiền khác.',
    ERROR_CODES.TOPUP_KEY_REUSED,
  );
  return existing;
}

async function assertCanOpenTopup(userId, now) {
  const wallet = await Wallet.findOne({ userId }).select('status').lean();
  assert(
    !wallet || wallet.status === 'ACTIVE',
    409,
    'Ví của bạn đang bị tạm khóa nên chưa thể nạp tiền. Vui lòng liên hệ hỗ trợ.',
    ERROR_CODES.WALLET_INACTIVE,
  );
  const live = await PaymentRequest.countDocuments({
    userId,
    kind: 'TOPUP',
    status: 'PENDING',
    expiresAt: { $gt: now },
  });
  assert(
    live < TOPUP_LIMITS.maxActive,
    409,
    `Bạn đang có ${live} lệnh nạp chờ thanh toán. Hãy hoàn tất hoặc đợi lệnh hết hạn trước khi tạo lệnh mới.`,
    ERROR_CODES.TOPUP_LIMIT_REACHED,
  );
}

async function insertWithUniqueCode(fields, codeGenerator) {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await PaymentRequest.create({ ...fields, transferCode: codeGenerator() });
    } catch (error) {
      if (!isDuplicateOf(error, 'transferCode')) {
        throw error;
      }
    }
  }
  throw httpError(
    503,
    'Không tạo được mã chuyển khoản. Vui lòng thử lại.',
    ERROR_CODES.TOPUP_CODE_UNAVAILABLE,
  );
}

/**
 * Opens a top-up request, or returns the existing one for a repeated Idempotency-Key.
 * @param {object} input Request input.
 * @param {string} input.userId Payer, taken from the authenticated session.
 * @param {number} input.amount Amount in VND.
 * @param {string} input.key Client Idempotency-Key.
 * @param {Date} [input.now] Current time; injectable for tests.
 * @param {() => string} [input.codeGenerator] Transfer code source; injectable for tests.
 * @returns {Promise<{ payment: object, created: boolean }>} The request and whether it is new.
 */
async function createTopupRequest({
  userId,
  amount,
  key,
  now = new Date(),
  codeGenerator = generateTransferCode,
}) {
  assert(
    Number.isSafeInteger(amount) && amount >= TOPUP_LIMITS.min && amount <= TOPUP_LIMITS.max,
    400,
    `Số tiền nạp phải là số nguyên từ ${vnd(TOPUP_LIMITS.min)} đến ${vnd(TOPUP_LIMITS.max)}.`,
    ERROR_CODES.TOPUP_INVALID_AMOUNT,
  );
  const requestKey = `TOPUP-${userId}-${key}`;
  const existing = await findSameRequest(requestKey, amount);
  if (existing) {
    return { payment: existing, created: false };
  }
  await assertCanOpenTopup(userId, now);
  const bankSnapshot = await getTopupAccount();
  assert(
    bankSnapshot,
    409,
    'Nạp ví tạm đóng. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.',
    ERROR_CODES.TOPUP_CLOSED,
  );
  const expiresAt = new Date(now.getTime() + TOPUP_LIMITS.ttlMs);
  const fields = { userId, kind: 'TOPUP', amount, requestKey, bankSnapshot, expiresAt };
  try {
    return { payment: await insertWithUniqueCode(fields, codeGenerator), created: true };
  } catch (error) {
    if (!isDuplicateOf(error, 'requestKey')) {
      throw error;
    }
    // A concurrent call with the same Idempotency-Key inserted first: answer with its record.
    return { payment: await findSameRequest(requestKey, amount), created: false };
  }
}

/**
 * Approves a pending top-up inside the caller's transaction. Checks separation of duties and the
 * amount read from the bank statement, then credits the wallet exactly once (the ledger
 * idempotency key is unique per request). The caller saves the payment document.
 * @param {object} payment Pending top-up request (Mongoose document).
 * @param {{ reviewerId: string, receivedAmount: unknown }} review Reviewer and amount actually received.
 * @param {import('mongoose').ClientSession} session Active transaction session.
 * @returns {Promise<object>} Extra response fields (none for top-ups).
 */
async function approveTopup(payment, { reviewerId, receivedAmount }, session) {
  assert(
    String(payment.userId) !== String(reviewerId),
    403,
    'Bạn không thể tự duyệt lệnh nạp của chính mình.',
    ERROR_CODES.TOPUP_SELF_APPROVAL,
  );
  assert(
    Number.isSafeInteger(receivedAmount) && receivedAmount > 0,
    400,
    'Nhập số tiền thực nhận (số nguyên, đơn vị VND).',
    ERROR_CODES.TOPUP_RECEIVED_AMOUNT_REQUIRED,
  );
  assert(
    receivedAmount === payment.amount,
    409,
    'Số tiền thực nhận không khớp với lệnh nạp. Hãy từ chối kèm ghi chú và hoàn tiền thủ công.',
    ERROR_CODES.TOPUP_AMOUNT_MISMATCH,
  );
  await changeBalance(
    {
      userId: payment.userId,
      amount: payment.amount,
      type: 'CREDIT',
      referenceType: 'TOPUP',
      referenceId: payment._id,
      key: `TOPUP-${payment._id}`,
    },
    session,
  );
  payment.receivedAmount = receivedAmount;
  return {};
}

module.exports = {
  SETTING_KEY,
  TOPUP_LIMITS,
  CODE_PATTERN,
  generateTransferCode,
  getTopupAccount,
  topupConfig,
  isExpired,
  presentTopup,
  createTopupRequest,
  approveTopup,
};
