// Express error responses: status mapping, generic 500s and stable `code` values for known errors.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../src/backend/middlewares/errorHandler');
const { httpError } = require('../src/backend/lib/errors');

async function respondTo(error) {
  const app = express().disable('x-powered-by');
  app.get('/', () => {
    throw error;
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('errorHandler', () => {
  it('returns the message and code of an HTTP error', async () => {
    const response = await respondTo(httpError(409, 'Nạp ví tạm đóng.', 'TOPUP_CLOSED'));

    assert.deepEqual(response, {
      status: 409,
      body: { message: 'Nạp ví tạm đóng.', code: 'TOPUP_CLOSED' },
    });
  });

  it('omits code when an HTTP error has none', async () => {
    const response = await respondTo(httpError(404, 'Không tìm thấy.'));

    assert.deepEqual(response, { status: 404, body: { message: 'Không tìm thấy.' } });
  });

  it('maps duplicate keys to 409 without exposing driver details', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

    const response = await respondTo(duplicate);

    assert.deepEqual(response, {
      status: 409,
      body: { message: 'Duplicate record or transaction reference.' },
    });
  });

  it('maps validation and cast errors to 400', async () => {
    const invalid = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' });

    const response = await respondTo(invalid);

    assert.deepEqual(response, { status: 400, body: { message: 'Cast to ObjectId failed' } });
  });

  it('hides unexpected errors behind a generic 500 and logs them', async (t) => {
    const log = t.mock.method(console, 'error', () => {});
    const crash = Object.assign(new Error('connection string leaked'), { code: 'ECONNRESET' });

    const response = await respondTo(crash);

    assert.deepEqual(response, { status: 500, body: { message: 'Internal server error' } });
    assert.equal(log.mock.callCount(), 1);
  });
});
