// One rule for "is this a link inside RunFurther?", shared by the support chat (browser) and the
// support article model (server): a same-origin path such as /account, never //host, \ or spaces.
function internalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000- ]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://runfurther.invalid');
    return url.origin === 'https://runfurther.invalid' ? url.pathname + url.search + url.hash : null;
  } catch { return null; }
}

module.exports = { internalPath };
