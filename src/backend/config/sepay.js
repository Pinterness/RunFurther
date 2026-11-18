const { banks } = require('../data/banks.json');

// Deployment-owned allowlist. Never take an event, receiving account or secret from a webhook body.
// Empty configuration keeps the existing manual payment flows working.
function readSepayConnections(env = process.env) {
  let entries;
  try { entries = JSON.parse(env.SEPAY_CONNECTIONS || '[]'); } catch {
    throw new Error('SEPAY_CONNECTIONS must be a JSON array.');
  }
  // Only describe the field and rule. User-supplied values (even ids) may contain secrets.
  const invalid = (field, rule) => { throw new Error(`Invalid SEPAY_CONNECTIONS${field}: ${rule} See SEPAY_SETUP.md; values are not logged.`); };
  if (!Array.isArray(entries)) invalid('', 'Use a JSON array: [{...}], not a single object or quoted JSON string.');
  if (entries.length > 100) invalid('', 'At most 100 connections are allowed.');
  const ids = new Set(), secrets = new Set();
  return entries.map((entry, index) => {
    const field = (name, rule) => invalid(`[${index}]${name ? '.' + name : ''}`, rule);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) field('', 'Each connection must be a JSON object.');
    const { id, kind, eventId, bankBin, accountNumber, secret, enabled = true, subAccount = '' } = entry;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) field('id', 'Use 3-64 lowercase letters, digits or hyphens, starting with a letter or digit.');
    if (ids.has(id)) field('id', 'Connection ids must be unique.');
    if (!['TOPUP', 'BOOKING'].includes(kind)) field('kind', 'Use TOPUP or BOOKING (uppercase).');
    if (typeof enabled !== 'boolean') field('enabled', 'Use true or false without quotation marks.');
    if (kind === 'BOOKING' ? !/^[a-f0-9]{24}$/.test(eventId || '') : eventId != null) {
      field('eventId', kind === 'BOOKING' ? 'A lowercase 24-character hexadecimal event id is required.' : 'Omit eventId for TOPUP.');
    }
    const bank = banks.find(item => item.bin === bankBin);
    if (!bank) field('bankBin', 'Use a supported bank BIN as a quoted string (MBBank: "970422").');
    if (typeof accountNumber !== 'string' || !/^[a-zA-Z0-9]{1,19}$/.test(accountNumber)) field('accountNumber', 'Use a quoted string of 1-19 letters or digits, without spaces; preserve leading zeros.');
    if (typeof subAccount !== 'string' || !/^[a-zA-Z0-9]{0,50}$/.test(subAccount)) field('subAccount', 'Use an empty string "" for the main account, or a quoted VA of at most 50 letters or digits.');
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) field('secret', 'Use a string of 32-256 characters matching the SePay HMAC secret.');
    if (secrets.has(secret)) field('secret', 'Each connection must have a different HMAC secret.');
    if (/replace|change.?me|your.?secret/i.test(secret)) field('secret', 'Replace the placeholder with a generated HMAC secret, matching SePay.');
    ids.add(id); secrets.add(secret);
    return { id, kind, eventId: eventId || null, bankBin, accountNumber, subAccount, secret, enabled,
      gatewayNames: [bank.code, bank.shortName, bank.name].map(value => value.toLowerCase().replace(/[^a-z0-9]/g, '')) };
  });
}

function automaticTransfer(kind, bank, eventId) {
  if (!bank) return false;
  return readSepayConnections().some(connection => connection.enabled && connection.kind === kind &&
    connection.eventId === (eventId ? String(eventId) : null) && connection.bankBin === bank.bankBin &&
    (connection.subAccount || connection.accountNumber) === bank.accountNo);
}

module.exports = { readSepayConnections, automaticTransfer };
