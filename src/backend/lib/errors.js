/**
 * Creates an error that the Express error handler turns into an HTTP response.
 * @param {number} statusCode HTTP status, 4xx for problems the caller can fix.
 * @param {string} message Text shown to the user.
 * @param {string} [code] Stable machine-readable reason from lib/errorCodes.js.
 * @returns {Error & { statusCode: number, code?: string }} The error to throw.
 */
function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

/**
 * Throws an HTTP error unless a precondition holds.
 * @param {unknown} condition Value that must be truthy.
 * @param {number} statusCode HTTP status to answer with.
 * @param {string} message Text shown to the user.
 * @param {string} [code] Stable machine-readable reason from lib/errorCodes.js.
 * @returns {void}
 */
function assert(condition, statusCode, message, code) {
  if (!condition) {
    throw httpError(statusCode, message, code);
  }
}

/**
 * Escapes text for use inside a regular expression.
 * @param {unknown} value Text to escape.
 * @returns {string} The escaped text.
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { httpError, assert, escapeRegex };
