const { banks } = require('../data/banks.json');

// Deployment-owned allowlist. Never take an event, receiving account or secret from a webhook body.
// Empty configuration keeps the existing manual payment flows working.
function readSepayConnections(env = process.env) {
  let entries;
  try { entries = JSON.parse(env.SEPAY_CONNECTIONS || '[]'); } catch {
    throw new Error('SEPAY_CONNECTIONS must be a JSON array.');
  }
  const invalid = () => { throw new Error('Invalid SEPAY_CONNECTIONS. See SEPAY_SETUP.md; secret values are not logged.'); };
  if (!Array.isArray(entries) || entries.length > 100) invalid();
  const ids = new Set(), secrets = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object') invalid();
    const { id, kind, eventId, bankBin, accountNumber, secret, enabled = true, subAccount = '' } = entry;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id) || ids.has(id)) invalid();
    if (!['TOPUP', 'BOOKING'].includes(kind) || typeof enabled !== 'boolean') invalid();
    if (kind === 'BOOKING' ? !/^[a-f0-9]{24}$/.test(eventId || '') : eventId != null) invalid();
    const bank = banks.find(item => item.bin === bankBin);
    if (!bank || typeof accountNumber !== 'string' || !/^[a-zA-Z0-9]{1,19}$/.test(accountNumber)) invalid();
    if (typeof subAccount !== 'string' || !/^[a-zA-Z0-9]{0,50}$/.test(subAccount)) invalid();
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256 || secrets.has(secret) || /replace|change.?me|your.?secret/i.test(secret)) invalid();
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
