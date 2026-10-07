function readHttpConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const values = (env.CLIENT_ORIGIN || (production ? '' : 'http://localhost:3000,http://127.0.0.1:3000')).split(',').map(value => value.trim()).filter(Boolean);
  if (!values.length) throw new Error('CLIENT_ORIGIN is required in production. Set the exact frontend HTTPS origin.');
  const origins = new Set(values.map(value => {
    let url;
    try { url = new URL(value); } catch { throw new Error('CLIENT_ORIGIN must contain full origins separated by commas; wildcards are not allowed.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (production && url.protocol !== 'https:')) {
      throw new Error('CLIENT_ORIGIN must contain only HTTPS origins in production (no path, query or credentials).');
    }
    return url.origin;
  }));
  const hops = env.TRUST_PROXY_HOPS ?? '0';
  if (!/^[0-5]$/.test(String(hops))) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5. Use 1 for the direct Render service.');
  return { origins, trustProxy: Number(hops) };
}

function corsOptions(config) {
  return {
    origin(origin, callback) {
      // Server-rendered requests, health probes and CLI clients have no Origin.
      if (!origin) return callback(null, true);
      if (config.origins.has(origin)) return callback(null, true);
      return callback(Object.assign(new Error('This website origin is not allowed.'), { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' }));
    },
    credentials: false, // All authentication uses explicit Bearer / x-login-code headers.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-login-code', 'Idempotency-Key'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  };
}

function validateStartup(env = process.env) {
  readHttpConfig(env);
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required.');
  if (env.NODE_ENV === 'production' && (env.JWT_SECRET.length < 32 || /replace[-_]with|your[-_]secret|change[-_]?me/i.test(env.JWT_SECRET))) {
    throw new Error('Production JWT_SECRET must be a random secret with at least 32 characters.');
  }
}

module.exports = { readHttpConfig, corsOptions, validateStartup };
