const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readSepayConnections } = require('../src/backend/config/sepay');

// Creates a private file only; never contacts SePay, the bank, Render or the live database.
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
function main() {
  const file = path.resolve(__dirname, '../.env.sepay.local');
  const id = arg('--id') || 'platform';
  const eventId = arg('--event-id');
  const entry = { id, kind: eventId ? 'BOOKING' : 'TOPUP', ...(eventId ? { eventId } : {}),
    bankBin: arg('--bank-bin'), accountNumber: arg('--account'), subAccount: arg('--sub-account') || '',
    secret: crypto.randomBytes(32).toString('hex'), enabled: true };
  if (!entry.bankBin || !entry.accountNumber) throw new Error('Usage: npm run sepay:env -- --bank-bin 970422 --account YOUR_ACCOUNT [--id race-name --event-id EVENT_ID]');
  let connections = [];
  if (fs.existsSync(file)) {
    const env = require('dotenv').parse(fs.readFileSync(file));
    connections = readSepayConnections(env).map(({ gatewayNames, ...connection }) => connection);
  }
  if (connections.some(connection => connection.id === id)) throw new Error('Connection id already exists. Existing secrets were preserved.');
  connections.push(entry);
  const value = JSON.stringify(connections);
  readSepayConnections({ SEPAY_CONNECTIONS: value });
  fs.writeFileSync(file, '# PRIVATE — ignored by Git. Render: copy the JSON inside the single quotes.\n# SePay HMAC: use the secret of the matching connection. Never use NEXT_PUBLIC.\nSEPAY_CONNECTIONS=\'' + value + '\'\n', { mode: 0o600 });
  console.log('Prepared .env.sepay.local. Secret values are not printed. Webhook path: /api/payments/webhooks/sepay/' + id);
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
