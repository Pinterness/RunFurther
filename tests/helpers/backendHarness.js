// Shared harness for API integration tests: the real Express app on a random local port and an
// in-memory MongoDB replica set (transactions require a replica set). Never touches a real database.
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../../src/backend/models/User');
const Wallet = require('../../src/backend/models/Wallet');
const RunnerProfile = require('../../src/backend/models/RunnerProfile');
const { banks } = require('../../src/backend/data/banks.json');

const BANK_DIRECTORY_URL = 'https://api.vietqr.io/v2/banks';

/**
 * Builds lifecycle hooks and request helpers for one test file.
 * @param {object} options Harness options.
 * @param {import('express').Express} options.app Express app under test.
 * @param {string} options.dbName Database name inside the in-memory replica set.
 * @param {boolean} [options.monitorCommands] Bật theo dõi lệnh MongoDB (sự kiện commandStarted của driver), để test
 *   kiểm được những lệnh nào đã được gửi đi, ví dụ chứng minh một chức năng chỉ đọc chứ không ghi.
 * @returns {{ start: Function, stop: Function, request: Function, createUser: Function }} Helpers.
 */
function createBackendHarness({ app, dbName, monitorCommands = false }) {
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
    await mongoose.connect(state.replSet.getUri(dbName), { monitorCommands });
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
    // Phản hồi 204 không có nội dung, nên body là null thay vì lỗi đọc JSON.
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /**
   * Creates an active user with a wallet and a signed token.
   * @param {{ role?: string, balance?: number, dob?: string, createdAt?: Date, fullName?: string }} [options]
   *   System role and starting balance. `dob` ('YYYY-MM-DD') tạo thêm RunnerProfile có ngày sinh đó; `createdAt` đặt
   *   ngày tạo tài khoản; `fullName` thay họ tên mặc định.
   * @returns {Promise<{ id: string, email: string, fullName: string, token: string }>} The user.
   */
  async function createUser({ role = 'RUNNER', balance = 0, dob, createdAt, fullName } = {}) {
    state.users += 1;
    const user = await User.create({
      fullName: fullName ?? `Test ${role.toLowerCase()} ${state.users}`,
      email: `${dbName}-${state.users}@test.local`,
      passwordHash: 'unused-test-hash',
      systemRole: role,
    });
    // timestamps của Mongoose tự đặt createdAt khi tạo, nên ngày tạo cũ được ghi thẳng vào collection.
    if (createdAt) await User.collection.updateOne({ _id: user._id }, { $set: { createdAt } });
    if (dob) await RunnerProfile.create({ userId: user._id, dob: new Date(dob) });
    await Wallet.create({ userId: user._id, balance, currency: 'VND' });
    const id = String(user._id);
    return {
      id,
      email: user.email,
      fullName: user.fullName,
      token: jwt.sign({ sub: id }, process.env.JWT_SECRET),
    };
  }

  // Gốc URL của API (".../api"), cho test cần đọc header của phản hồi bằng fetch trực tiếp.
  const baseUrl = () => state.baseUrl;

  return { start, stop, request, createUser, baseUrl };
}

module.exports = { createBackendHarness };
