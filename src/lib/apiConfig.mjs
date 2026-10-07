// Shared by Next build configuration, server rendering and browser API calls.
export function normalizeApiBase(value, { required = false, httpsOnly = false } = {}) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input && required) throw new Error('Set NEXT_PUBLIC_API_URL to your Render HTTPS URL ending in /api before building.');
  let url;
  try { url = new URL(input || 'http://localhost:5000/api'); }
  catch { throw new Error('NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_API_URL must not contain credentials, query parameters or a fragment.');
  }
  if (httpsOnly && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Hosted deployments require a public HTTPS NEXT_PUBLIC_API_URL, not localhost.');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname && pathname !== '/api') throw new Error('NEXT_PUBLIC_API_URL must use the API origin or end in /api.');
  return url.origin + '/api';
}
