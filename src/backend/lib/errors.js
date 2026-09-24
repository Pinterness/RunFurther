function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
function assert(condition, statusCode, message) {
  if (!condition) throw httpError(statusCode, message);
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
module.exports = { httpError, assert, escapeRegex };
