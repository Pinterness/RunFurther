// Turns thrown errors into JSON responses: `{ message }`, plus a stable `code` for errors created
// with httpError(status, message, code). Internal details never reach the client.
const DUPLICATE_KEY = 11000;
const BAD_REQUEST_ERRORS = ['ValidationError', 'CastError'];

function statusOf(error) {
  if (error.statusCode) {
    return error.statusCode;
  }
  if (error.code === DUPLICATE_KEY) {
    return 409;
  }
  if (BAD_REQUEST_ERRORS.includes(error.name) || error.type === 'entity.parse.failed') {
    return 400;
  }
  return 500;
}

function messageOf(error, status) {
  if (status === 500) {
    return 'Internal server error';
  }
  return error.code === DUPLICATE_KEY
    ? 'Duplicate record or transaction reference.'
    : error.message;
}

// Express recognises error middleware by its four parameters, so `_next` must stay.
function errorHandler(error, _req, res, _next) {
  const status = statusOf(error);
  if (status === 500) {
    console.error(error);
  }
  const body = { message: messageOf(error, status) };
  if (error.statusCode && typeof error.code === 'string') {
    body.code = error.code;
  }
  res.status(status).json(body);
}

module.exports = { errorHandler };
