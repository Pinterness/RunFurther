// Shared vocabulary for payment and top-up screens.

/** Vietnamese labels for PaymentRequest.status. */
export const PAYMENT_STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ đối soát',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
});

/** Vietnamese labels for PaymentRequest.kind. */
export const PAYMENT_KIND_LABELS = Object.freeze({
  TOPUP: 'Nạp ví',
  BOOKING: 'Thanh toán vé',
});

/** Quick amounts offered on the top-up form, in VND. */
export const QUICK_TOPUP_AMOUNTS = Object.freeze([50_000, 100_000, 200_000, 500_000, 1_000_000]);

/** Rules used until GET /api/wallet answers (or when an older API omits them). */
export const DEFAULT_TOPUP_RULES = Object.freeze({
  available: true,
  minAmount: 10_000,
  maxAmount: 100_000_000,
  codeTtlHours: 24,
  maxActive: 3,
});

/** Error codes (src/backend/lib/errorCodes.js) after which the wallet must reload its rules. */
export const TOPUP_RULE_CHANGE_CODES = Object.freeze([
  'TOPUP_CLOSED',
  'TOPUP_LIMIT_REACHED',
  'WALLET_INACTIVE',
]);
