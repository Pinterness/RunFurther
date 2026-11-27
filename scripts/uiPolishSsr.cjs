// Preload only in a local UI test preview: node --require ./scripts/uiPolishSsr.cjs .../next start.
const { respond } = require('./uiPolishFixtures.cjs');
const nativeFetch = global.fetch;
global.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  if (url.pathname.startsWith('/api/')) {
    if ((init?.method || input.method || 'GET') !== 'GET') throw new Error('UI tests cannot write API data');
    const body = respond(url);
    return Promise.resolve(Response.json(body || { message:'No UI fixture' }, { status:body?200:404 }));
  }
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('External fetch blocked in UI preview');
  return nativeFetch(input,init);
};
