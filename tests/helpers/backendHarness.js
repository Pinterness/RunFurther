// Shared harness for API integration tests: the real Express app on a random local port and an
// in-memory MongoDB replica set (transactions require a replica set). Never touches a real database.
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../../src/backend/models/User');
const Wallet = require('../../src/backend/models/Wallet');
const { banks } = require('../../src/backend/data/banks.json');

const BANK_DIRECTORY_URL = 'https://api.vietqr.io/v2/banks';

/**
 * Builds lifecycle hooks and request helpers for one test file.
 * @param {object} options Harness options.
 * @param {import('express').Express} options.app Express app under test.
 * @param {string} options.dbName Database name inside the in-memory replica set.
 * @returns {{ start: Function, stop: Function, request: Function, createUser: Function }} Helpers.
 */
function createBackendHarness({ app, dbName }) {
  const state = { replSet: null, server: null, baseUrl: '', nativeFetch: global.fetch, users: 0 };

  // The bank directory is served from the bundled snapshot so tests never call VietQR.
  function stubBankDirectory(input, options) {
    if (String(input) !== BANK_DIRECTORY_URL) {
      return state.nativeFetch(input, options);
    }
    const data = banks.map((bank) => ({ ...bank, transferSupported: 1 }));
    return Promise.resolve(Response.json({ code: '00', data }));
  }

  async function start() {
    global.fetch = stubBankDirectory;
    state.replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(state.replSet.getUri(dbName));
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    state.server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => state.server.once('listening', resolve));
    state.baseUrl = `http://127.0.0.1:${state.server.address().port}/api`;
  }

  async function stop() {
    global.fetch = state.nativeFetch;
    if (state.server) {
      await new Promise((resolve) => state.server.close(resolve));
    }
    await mongoose.disconnect();
    if (state.replSet) {
      await state.replSet.stop();
    }
  }

  /**
   * Calls the API and returns the HTTP status with the parsed JSON body.
   * @param {string} path Path below /api, e.g. "/wallet".
   * @param {{ method?: string, body?: unknown, as?: { token: string }, headers?: object }} [options]
   * @returns {Promise<{ status: number, body: any }>} Response status and JSON body.
   */
  async function request(path, { method = 'GET', body, as, headers = {} } = {}) {
    const auth = as ? { Authorization: `Bearer ${as.token}` } : {};
    const response = await fetch(state.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  /**
   * Creates an active user with a wallet and a signed token.
   * @param {{ role?: string, balance?: number }} [options] System role and starting balance.
   * @returns {Promise<{ id: string, email: string, fullName: string, token: string }>} The user.
   */
  async function createUser({ role = 'RUNNER', balance = 0 } = {}) {
    state.users += 1;
    const user = await User.create({
      fullName: `Test ${role.toLowerCase()} ${state.users}`,
      email: `${dbName}-${state.users}@test.local`,
      passwordHash: 'unused-test-hash',
      systemRole: role,
    });
    await Wallet.create({ userId: user._id, balance, currency: 'VND' });
    const id = String(user._id);
    return {
      id,
      email: user.email,
      fullName: user.fullName,
      token: jwt.sign({ sub: id }, process.env.JWT_SECRET),
    };
  }

  return { start, stop, request, createUser };
}

module.exports = { createBackendHarness };
