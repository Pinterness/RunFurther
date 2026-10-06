// Browser check for wallet top-ups and the Super Admin "Nạp ví" tab.
// Needs the web app running (npm run dev:web) and Chrome. Every API call is answered by fixtures,
// so no real database, bank or payment is touched. Usage: node scripts/checkWalletTopupUI.js
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const BANK = {
  bankBin: '970422',
  bankName: 'MBBank',
  accountNo: '0123456789',
  accountName: 'CONG TY RUNFURTHER',
};
const PAYER = { _id: 'payer', fullName: 'Người nạp', email: 'payer@example.com' };
// 1×1 transparent PNG so QR images load without calling img.vietqr.io.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const VIEWPORTS = [1440, 768, 390, 360];

const isoFromNow = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const vnd = (amount) => `${amount.toLocaleString('vi-VN')}đ`;

function createState() {
  return {
    role: 'RUNNER',
    signedIn: true,
    topupAvailable: true,
    failNextTopup: false,
    failAccountLoad: false,
    topupPosts: [],
    reviews: [],
    account: { ...BANK },
    accountSaves: 0,
    payments: [],
  };
}

function transferOf(payment) {
  const payable = payment.status === 'PENDING' && !payment.expired && Boolean(payment.transferCode);
  const qr = `https://img.vietqr.io/image/970422-0123456789-compact2.png?amount=${payment.amount}&addInfo=${payment.transferCode}`;
  return {
    bankInfo: payment.bankSnapshot ?? null,
    vietQrUrl: payable ? qr : null,
    transferCode: payment.transferCode ?? null,
    amount: payment.amount,
    expiresAt: payment.expiresAt ?? null,
    expired: Boolean(payment.expired),
  };
}

function walletSummary(state) {
  const summary = {
    wallet: { id: 'wallet', balance: 120_000, status: 'ACTIVE', currency: 'VND' },
    runPoints: { balance: 3, lifetimeEarned: 3 },
  };
  if (state.topupAvailable !== undefined) {
    summary.topup = {
      available: state.topupAvailable,
      minAmount: 10_000,
      maxAmount: 100_000_000,
      codeTtlHours: 24,
      maxActive: 3,
    };
  }
  return summary;
}

function accountSetting(state) {
  const admin = { fullName: 'Quản trị viên', email: 'admin@example.com' };
  const history = state.accountSaves
    ? [{ bankAccountInfo: state.account, changedBy: admin, changedAt: isoFromNow(0) }]
    : [];
  return {
    account: state.account,
    configured: Boolean(state.account.accountNo),
    updatedBy: admin,
    updatedAt: isoFromNow(-state.accountSaves),
    history,
  };
}

function createTopup(state, request) {
  const body = request.postDataJSON();
  state.topupPosts.push({ body, key: request.headers()['idempotency-key'] });
  if (state.failNextTopup) {
    state.failNextTopup = false;
    return [
      409,
      { message: 'Bạn đang có 3 lệnh nạp chờ thanh toán.', code: 'TOPUP_LIMIT_REACHED' },
    ];
  }
  const payment = {
    _id: `topup-${state.topupPosts.length}`,
    kind: 'TOPUP',
    amount: body.amount,
    status: 'PENDING',
    requestKey: `TOPUP-payer-${state.topupPosts.length}`,
    transferCode: 'NAPTEST2345',
    bankSnapshot: { ...BANK },
    expiresAt: isoFromNow(24 * 60 * 60 * 1000),
    createdAt: isoFromNow(0),
  };
  state.payments.unshift(payment);
  return [
    202,
    {
      paymentRequest: payment,
      transfer: transferOf(payment),
      message: 'Đã tạo lệnh nạp. Chuyển khoản đúng số tiền và nội dung bên dưới.',
    },
  ];
}

function adminQueue(state, url) {
  const status = url.searchParams.get('status');
  const code = (url.searchParams.get('q') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matches = (payment) =>
    (!status || payment.status === status) &&
    (!code || (payment.transferCode ?? '').includes(code));
  const payments = state.payments
    .filter(matches)
    .map((payment) => ({ ...payment, userId: PAYER, expired: Boolean(payment.expired) }));
  return { payments };
}

function reviewTopup(state, paymentId, body) {
  state.reviews.push(body);
  const payment = state.payments.find((item) => item._id === paymentId);
  if (body.status === 'APPROVED' && body.receivedAmount !== payment.amount) {
    return [
      409,
      { message: 'Số tiền thực nhận không khớp với lệnh nạp.', code: 'TOPUP_AMOUNT_MISMATCH' },
    ];
  }
  Object.assign(payment, {
    status: body.status,
    bankReference: body.bankReference,
    reviewNote: body.reviewNote ?? '',
  });
  return [200, { payment }];
}

// Answers every /api/** call from `state`; any unexpected call fails loudly with 404.
function apiAnswer(state, request) {
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method();
  const review = path.match(/^\/admin\/payments\/([^/]+)\/review$/);
  if (path.startsWith('/wallet') && !state.signedIn) {
    return [401, { message: 'Authentication token is required.' }];
  }
  const routes = {
    'GET /auth/me': () => [200, { user: { id: 'payer', ...PAYER, systemRole: state.role } }],
    'GET /notifications': () => [200, { notifications: [] }],
    'GET /banks': () => [
      200,
      {
        banks: [
          { bin: '970422', code: 'MB', name: 'Ngân hàng TMCP Quân đội', shortName: 'MBBank' },
        ],
      },
    ],
    'GET /wallet': () => [200, walletSummary(state)],
    'GET /wallet/ledger': () => [200, { ledger: [], pointHistory: [] }],
    'GET /wallet/payments': () => [
      200,
      { payments: state.payments.map((p) => ({ ...p, transfer: transferOf(p) })) },
    ],
    'POST /wallet/topup': () => createTopup(state, request),
    'GET /admin/platform/applications': () => [200, { applications: [] }],
    'GET /admin/platform/topup-account': () =>
      state.failAccountLoad
        ? [500, { message: 'Internal server error' }]
        : [200, accountSetting(state)],
    'PUT /admin/platform/topup-account': () => {
      state.account = { ...request.postDataJSON().bankAccountInfo };
      state.accountSaves += 1;
      return [200, accountSetting(state)];
    },
    'GET /admin/payments': () => [200, adminQueue(state, url)],
  };
  if (review && method === 'POST') {
    return reviewTopup(state, review[1], request.postDataJSON());
  }
  const handler = routes[`${method} ${path}`];
  return handler ? handler() : [404, { message: `Unexpected ${method} ${path}` }];
}

async function mockApi(page, state) {
  await page.route('https://img.vietqr.io/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  await page.route('**/api/**', (route) => {
    const [status, json] = apiAnswer(state, route.request());
    return route.fulfill({ status, json });
  });
}

// Fails on horizontal overflow at any viewport and saves a screenshot at the narrowest one.
async function checkViewports(page, label) {
  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflows, false, `${label} overflows at ${width}px`);
  }
  await page.screenshot({ path: `artifacts/${label}-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function walletScenario(page, state) {
  // Signed out: a clear message and a way back to the login page.
  state.signedIn = false;
  await page.goto(`${WEB_URL}/account/wallet`);
  await expect(page.getByText('Vui lòng đăng nhập để xem ví.')).toBeVisible();
  await expect(page.locator('.wallet-page a[href^="/login"]')).toBeVisible();

  // Closed by the Super Admin: no form at all.
  state.signedIn = true;
  state.topupAvailable = false;
  await page.reload();
  await expect(page.getByText('Nạp ví tạm đóng', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo lệnh nạp' })).toHaveCount(0);

  // An older API without the `topup` block still shows the form with default limits.
  state.topupAvailable = undefined;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tạo lệnh nạp' })).toBeVisible();

  // Quick amount + double click: exactly one request, then the transfer instructions.
  state.topupAvailable = true;
  await page.reload();
  await page.getByRole('button', { name: vnd(100_000), exact: true }).click();
  await expect(page.getByLabel('Số tiền nạp (VND)')).toHaveValue('100000');
  await page.getByRole('button', { name: 'Tạo lệnh nạp' }).dblclick();
  const details = page.locator('.transfer-details');
  await expect(details).toContainText('NAPTEST2345');
  await expect(details).toContainText('Chuyển khoản vào ví RunFurther');
  await expect(details.locator('img')).toHaveAttribute('src', /addInfo=NAPTEST2345/);
  assert.equal(state.topupPosts.length, 1, 'a double click must create exactly one top-up');
  assert.deepEqual(state.topupPosts[0].body, { amount: 100_000 });
  assert.match(state.topupPosts[0].key, /^[\da-f-]{36}$/);
  await page.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }).click();
  await expect(page.locator('.copy-status')).toContainText(/Đã sao chép|Không thể sao chép/);
  await page.screenshot({ path: 'artifacts/wallet-topup-created.png', fullPage: true });

  // After a reload the open request is still one click away.
  await page.reload();
  const card = page.locator('.topup-request', { hasText: 'NAPTEST2345' });
  await expect(card).toContainText('Chờ đối soát');
  await expect(page.locator('.transfer-details')).toHaveCount(0);
  await card.getByRole('button', { name: 'Xem hướng dẫn chuyển khoản' }).click();
  await expect(card.locator('.transfer-details')).toContainText(BANK.accountNo);

  // Expired and legacy requests never offer a QR code.
  state.payments.push(
    {
      _id: 'expired-1',
      kind: 'TOPUP',
      amount: 50_000,
      status: 'PENDING',
      requestKey: 'TOPUP-payer-old',
      transferCode: 'NAPEXPRD234',
      bankSnapshot: { ...BANK },
      expiresAt: isoFromNow(-60 * 60 * 1000),
      expired: true,
      createdAt: isoFromNow(-25 * 60 * 60 * 1000),
    },
    {
      _id: 'legacy-1',
      kind: 'TOPUP',
      amount: 30_000,
      status: 'PENDING',
      requestKey: 'TOPUP-payer-legacy',
      createdAt: isoFromNow(-48 * 60 * 60 * 1000),
    },
  );
  await page.reload();
  const expiredCard = page.locator('.topup-request', { hasText: 'NAPEXPRD234' });
  await expect(expiredCard).toContainText('Quá hạn');
  await expiredCard.getByRole('button', { name: 'Xem hướng dẫn chuyển khoản' }).click();
  await expect(expiredCard).toContainText('Mã đã hết hạn');
  await expect(expiredCard.locator('img')).toHaveCount(0);
  const legacyCard = page.locator('.topup-request', { hasText: 'Yêu cầu cũ' });
  await legacyCard.getByRole('button', { name: 'Xem hướng dẫn chuyển khoản' }).click();
  await expect(legacyCard).toContainText('không có thông tin chuyển khoản');

  // API errors are shown next to the form, not swallowed.
  state.failNextTopup = true;
  await page.getByLabel('Số tiền nạp (VND)').fill('50000');
  await page.getByRole('button', { name: 'Tạo lệnh nạp' }).click();
  await expect(page.locator('.topup-error')).toContainText('3 lệnh nạp');

  await checkViewports(page, 'wallet-topup');
}

async function openTopupTab(page, state) {
  state.role = 'SUPER_ADMIN';
  await page.goto(`${WEB_URL}/admin`);
  await page.getByRole('button', { name: 'Nạp ví', exact: true }).click();
}

async function adminAccountScenario(page, state) {
  // A failed load never shows an empty form: saving an empty form would close top-ups.
  state.failAccountLoad = true;
  await openTopupTab(page, state);
  const form = page.locator('.topup-account');
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Lưu tài khoản nhận' })).toHaveCount(0);
  state.failAccountLoad = false;
  await form.getByRole('button', { name: 'Tải lại' }).click();
  await expect(form.getByLabel('Số tài khoản')).toHaveValue(BANK.accountNo);
  await expect(form).toContainText('Quản trị viên');

  // Changing the account saves it and says it only applies to new top-ups.
  await form.getByLabel('Số tài khoản').fill('0987654321');
  await form.getByRole('button', { name: 'Lưu tài khoản nhận' }).click();
  await expect(form).toContainText('Chỉ áp dụng cho lệnh nạp mới');
  assert.deepEqual(
    { bankBin: state.account.bankBin, accountNo: state.account.accountNo },
    { bankBin: BANK.bankBin, accountNo: '0987654321' },
  );

  // Clearing every field closes top-ups.
  await form.getByRole('button', { name: 'Tắt nạp ví' }).click();
  await form.getByRole('button', { name: 'Lưu tài khoản nhận' }).click();
  await expect(form).toContainText('Đã tắt nạp ví');
  assert.equal(state.account.accountNo, '');
  await checkViewports(page, 'admin-topup-account');
}

async function adminQueueScenario(page, state) {
  await openTopupTab(page, state);
  const queue = page.locator('.organizer-panel');
  const item = (code) => queue.locator('.topup-review-item', { hasText: code });
  await expect(item('NAPTEST2345')).toContainText(PAYER.email);
  await expect(item('NAPEXPRD234')).toContainText('Quá hạn');
  await expect(queue).toContainText('TOPUP-payer-legacy');

  // The search accepts the memo the way a bank statement prints it.
  await queue.getByLabel('Tìm theo mã chuyển khoản').fill('nap test-2345');
  await queue.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(queue.locator('.topup-review-item')).toHaveCount(1);

  // The received amount is never pre-filled, and a mismatch is refused.
  await item('NAPTEST2345').getByRole('button', { name: 'Xác nhận đã nhận tiền' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('NAPTEST2345');
  await expect(dialog).toContainText(vnd(100_000));
  await expect(dialog.getByLabel('Số tiền thực nhận (đ)')).toHaveValue('');
  await dialog.getByLabel('Mã giao dịch ngân hàng').fill('FT26001');
  await dialog.getByLabel('Số tiền thực nhận (đ)').fill('99999');
  await dialog.getByRole('button', { name: 'Lưu quyết định' }).click();
  await expect(dialog.locator('.notice-error')).toContainText('không khớp');
  await dialog.getByLabel('Số tiền thực nhận (đ)').fill('100000');
  await dialog.getByRole('button', { name: 'Lưu quyết định' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(state.reviews.at(-1), {
    status: 'APPROVED',
    bankReference: 'FT26001',
    receivedAmount: 100_000,
    reviewNote: '',
  });
  await expect(item('NAPTEST2345')).toHaveCount(0);

  // Approved requests keep their bank reference for audits.
  await queue.getByLabel('Tìm theo mã chuyển khoản').fill('');
  await queue.getByRole('button', { name: 'Tìm', exact: true }).click();
  await queue.getByRole('button', { name: 'Đã duyệt', exact: true }).click();
  await expect(item('NAPTEST2345')).toContainText('FT26001');
  await checkViewports(page, 'admin-topup-queue');
}

const SCENARIOS = [walletScenario, adminAccountScenario, adminQueueScenario];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    fs.mkdirSync('artifacts', { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const state = createState();
    await mockApi(page, state);
    for (const scenario of SCENARIOS) {
      await scenario(page, state);
    }
    assert.deepEqual(pageErrors, []);
    console.log(
      `PASS: ${SCENARIOS.map((scenario) => scenario.name).join(', ')}. API fixtures only.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
