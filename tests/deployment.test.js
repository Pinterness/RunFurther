const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { readHttpConfig, corsOptions, validateStartup } = require('../src/backend/config/deployment');
const { createEnvironments, serialize } = require('../scripts/prepareDeployEnv');
const rateLimit = require('../src/backend/middlewares/rateLimit');
const { errorHandler } = require('../src/backend/middlewares/errorHandler');

test('Hosted API URLs normalize root and trailing slash, and refuse local or malformed destinations', async () => {
  const { normalizeApiBase } = await import('../src/lib/apiConfig.mjs');
  assert.equal(normalizeApiBase('https://race-api.onrender.com/'), 'https://race-api.onrender.com/api');
  assert.equal(normalizeApiBase(' https://race-api.onrender.com/api/ '), 'https://race-api.onrender.com/api');
  assert.equal(normalizeApiBase(''), 'http://localhost:5000/api');
  assert.throws(() => normalizeApiBase('', { required: true }));
  for (const value of ['http://localhost:5000/api', 'https://localhost/api', 'https://127.0.0.1/api', 'https://[::1]/api', '/api', 'https://user:password@api.example.com/api', 'https://api.example.com/api?secret=x', 'https://api.example.com/api#x', 'https://api.example.com/wrong/api']) {
    assert.throws(() => normalizeApiBase(value, { required: true, httpsOnly: true }), value);
  }
});

test('Production requires exact origins and strong secrets, proxy trust defaults to zero', () => {
  const env = { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://race.vercel.app, https://www.race.example/', MONGODB_URI: 'mongodb+srv://fixture.invalid/db', JWT_SECRET: 'a'.repeat(64), TRUST_PROXY_HOPS: '1' };
  assert.doesNotThrow(() => validateStartup(env));
  assert.deepEqual([...readHttpConfig(env).origins], ['https://race.vercel.app', 'https://www.race.example']);
  for (const CLIENT_ORIGIN of ['', '*', 'https://*.vercel.app', 'https://race.vercel.app/api', 'http://race.example', 'https://user:pass@race.example', 'https://race.example?x=1']) assert.throws(() => readHttpConfig({ ...env, CLIENT_ORIGIN }));
  assert.throws(() => readHttpConfig({ ...env, TRUST_PROXY_HOPS: 'true' }));
  assert.throws(() => validateStartup({ ...env, JWT_SECRET: 'replace-with-a-long-random-secret' }));
  assert.throws(() => validateStartup({ ...env, JWT_SECRET: 'REPLACE_WITH_RANDOM_SECRET_AT_LEAST_32_CHARACTERS' }));
  assert.throws(() => validateStartup({ ...env, MONGODB_URI: '' }));
  assert.equal(readHttpConfig({}).trustProxy, 0);
});

test('CORS permits configured domains, SSR and auth preflight; per-client limits cannot use spoofed leftmost IPs', async () => {
  const app = express(), config = readHttpConfig({ CLIENT_ORIGIN: 'https://race.vercel.app,https://www.race.example', TRUST_PROXY_HOPS: '1' });
  app.set('trust proxy', config.trustProxy); app.use(cors(corsOptions(config)));
  app.get('/limited', rateLimit(1), (req, res) => res.json({ ip: req.ip }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/limited';
  try {
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://race.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,x-login-code' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://race.vercel.app');
    assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
    for (const Origin of ['https://attacker.vercel.app', 'https://race.vercel.app.attacker.example', 'null']) assert.equal((await fetch(url, { headers: { Origin } })).status, 403);
    const first = await fetch(url, { headers: { Origin: 'https://www.race.example', 'X-Forwarded-For': '203.0.113.44, 198.51.100.1' } });
    assert.equal(first.status, 200); assert.equal((await first.json()).ip, '198.51.100.1');
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.99, 198.51.100.1' } })).status, 429);
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.2' } })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Deployment env export retains the database, separates secrets and round-trips quoted credentials', async () => {
  const source = { MONGODB_URI: 'mongodb+srv://fixture:p%24ss@cluster.invalid/existing?retryWrites=true&w=majority', OPENAI_API_KEY: 'do-not-copy', SEED_MONGODB_URI: 'do-not-copy' };
  const result = await createEnvironments({ source, apiUrl: 'https://api.example.com/', webUrl: 'https://race.vercel.app/' });
  assert.deepEqual(Object.keys(result.vercel), ['NEXT_PUBLIC_API_URL']);
  assert.equal(result.render.MONGODB_URI, source.MONGODB_URI); assert.match(result.render.JWT_SECRET, /^[a-f0-9]{96}$/);
  assert.equal(result.render.CLIENT_ORIGIN, 'https://race.vercel.app'); assert.equal(result.render.OPENAI_API_KEY, undefined);
  assert.equal(result.render.SEED_MONGODB_URI, undefined); assert.deepEqual(dotenv.parse(serialize(result.render)), result.render);
  await assert.rejects(createEnvironments({ source: { MONGODB_URI: 'mongodb://127.0.0.1/db' }, apiUrl: 'https://api.example.com', webUrl: 'https://race.vercel.app' }));
});

test('HTML wake-up and gateway responses produce a recoverable message without echoing HTML or secrets', async () => {
  const { readApiJson } = await import('../src/lib/apiUrl.js');
  for (const status of [200, 502, 503]) {
    await assert.rejects(readApiJson(new Response('<html>private-host-details</html>', { status, headers: { 'Content-Type': 'text/html' } })), error => error.code === 'API_UNAVAILABLE' && !error.message.includes('private-host-details'));
  }
  assert.deepEqual(await readApiJson(Response.json({ message: 'Invalid credentials' }, { status: 401 })), { message: 'Invalid credentials' });
});
