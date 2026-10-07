const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');

function frontendOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('--web-url must be a public HTTPS origin, without a path.');
  return url.origin;
}
async function createEnvironments({ source, apiUrl, webUrl, secret = crypto.randomBytes(48).toString('hex') }) {
  const { normalizeApiBase } = await import('../src/lib/apiConfig.mjs');
  if (!/^mongodb(?:\+srv)?:\/\//.test(source.MONGODB_URI || '')) throw new Error('The source .env must contain MONGODB_URI.');
  if (/mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(source.MONGODB_URI)) throw new Error('A local MongoDB URI cannot be reached from Render. Use an Atlas URI containing the existing data.');
  return {
    vercel: { NEXT_PUBLIC_API_URL: normalizeApiBase(apiUrl, { required: true, httpsOnly: true }) },
    render: { NODE_ENV: 'production', NODE_VERSION: '24.x', MONGODB_URI: source.MONGODB_URI, CLIENT_ORIGIN: frontendOrigin(webUrl), JWT_SECRET: secret, JWT_EXPIRES_IN: '7d', TRUST_PROXY_HOPS: '1', SUPPORT_AI_PROVIDER: 'guide', WALLET_TOPUP_RATE_LIMIT: '10' },
  };
}
const serialize = values => Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
async function main() {
  const args = process.argv.slice(2);
  const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
  const apiUrl = value('--api-url'), webUrl = value('--web-url');
  if (!apiUrl || !webUrl) throw new Error('Usage: npm run deploy:env -- --api-url https://YOUR-API.onrender.com --web-url https://YOUR-WEB.vercel.app');
  const root = path.resolve(__dirname, '..');
  const files = ['.env.vercel.local', '.env.render.local'].map(file => path.join(root, file));
  if (files.some(file => fs.existsSync(file))) throw new Error('Deployment env files already exist. Edit their URL values directly; existing secrets were not overwritten.');
  const source = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  const environments = await createEnvironments({ source, apiUrl, webUrl });
  fs.writeFileSync(files[0], '# Vercel Environment Variables. Replace example URLs before deploying.\n' + serialize(environments.vercel), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(files[1], '# Render Environment Variables. Private: contains database credentials and a generated JWT secret.\n# Replace example URLs before deploying. Never commit this file.\n' + serialize(environments.render), { flag: 'wx', mode: 0o600 });
  console.log('Created .env.vercel.local and .env.render.local (gitignored). Existing .env and database were not changed. Secret values are not printed.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createEnvironments, serialize };
