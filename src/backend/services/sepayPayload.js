const crypto = require('crypto');
const { assert } = require('../lib/errors');

function verifySignature(raw, headers, secret, now = Date.now()) {
  const timestamp = headers['x-sepay-timestamp'];
  const signature = headers['x-sepay-signature'];
  assert(Buffer.isBuffer(raw) && typeof timestamp === 'string' && /^\d{10}$/.test(timestamp) &&
    Math.abs(now / 1000 - Number(timestamp)) <= 300 && typeof signature === 'string' &&
    /^sha256=[a-f0-9]{64}$/i.test(signature), 401, 'Invalid SePay signature.', 'SEPAY_UNAUTHORIZED');
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  assert(crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')), 401, 'Invalid SePay signature.', 'SEPAY_UNAUTHORIZED');
}

// SePay bank timestamps are Vietnam local time, independent of the Render server timezone.
function parsePaidAt(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value), 400, 'Invalid transactionDate.');
  const date = new Date(value.replace(' ', 'T') + '+07:00');
  assert(Number.isFinite(date.getTime()) && new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' ') === value,
    400, 'Invalid transactionDate.');
  return date;
}

function paymentCode(content, code) {
  const matches = [...(content + ' ' + code).toUpperCase().matchAll(/(?<![A-Z0-9])(?:NAP[2-9A-HJ-NP-Z]{8}|RUN[A-F0-9]{16})(?![A-Z0-9])/g)];
  const codes = [...new Set(matches.map(match => match[0]))];
  return codes.length === 1 ? codes[0] : '';
}

function parsePayload(payload, connection) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), 400, 'Invalid SePay payload.');
  const providerId = String(payload.id ?? '');
  assert((typeof payload.id === 'number' && Number.isSafeInteger(payload.id) && payload.id > 0) ||
    (typeof payload.id === 'string' && /^(?:[1-9]\d{0,19}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(payload.id)),
  400, 'Invalid transaction id.');
  const text = (value, max, optional = false) => {
    if (optional && value == null) return '';
    assert(typeof value === 'string' && value.length <= max && !/[\u0000-\u001f]/.test(value), 400, 'Invalid transaction text.');
    return value.trim();
  };
  const gateway = text(payload.gateway, 150).toLowerCase().replace(/[^a-z0-9]/g, '');
  const accountNumber = text(payload.accountNumber, 50), subAccount = text(payload.subAccount, 50, true);
  assert(connection.gatewayNames.includes(gateway) && accountNumber === connection.accountNumber && subAccount === connection.subAccount,
    403, 'Receiving account does not match this connection.', 'SEPAY_ACCOUNT_MISMATCH');
  assert(['in', 'out'].includes(payload.transferType) && Number.isSafeInteger(payload.transferAmount) && payload.transferAmount > 0,
    400, 'Invalid transaction direction or amount.');
  const content = text(payload.content, 2000, true), code = text(payload.code, 100, true);
  const referenceCode = text(payload.referenceCode, 200).toUpperCase();
  assert(referenceCode.length >= 3, 400, 'Missing bank reference.');
  const paidAt = parsePaidAt(payload.transactionDate);
  assert(paidAt.getTime() <= Date.now() + 300000, 400, 'Transaction date is in the future.');
  const transferCode = paymentCode(content, code);
  const data = { connectionId: connection.id, kind: connection.kind, eventId: connection.eventId,
    providerId, bankBin: connection.bankBin, accountNumber, subAccount, referenceCode,
    transferType: payload.transferType, amount: payload.transferAmount, paidAt, transferCode, content };
  // Ignore delivery-only fields (e.g. description, accumulated balance) on provider retries.
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { ...data, fingerprint };
}

module.exports = { verifySignature, parsePayload, parsePaidAt, paymentCode };
