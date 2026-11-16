// Kiểm giao diện hồ sơ cộng đồng (P11, Task 11.4) trên web đang chạy (npm run dev:web), mọi API đều là dữ liệu giả
// qua page.route nên không cần backend hay database.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

const XSS = '<img src=x onerror="window.__communityXss=1">';
const CONSENT = { version: 'profile-v1', text: 'Văn bản đồng ý mẫu: tắt là xóa hẳn hồ sơ cộng đồng.' };
const card = (handle, displayName, bio = '') => ({ handle, displayName, avatarTheme: 'ocean', bio, memberSince: '2026-01', canMessage: false });

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const account = {
      user: { _id: 'u1', fullName: 'Người Chạy Thử', email: 'runner@test.local', phone: '0900000000', avatarTheme: 'forest', createdAt: '2026-01-02T00:00:00.000Z' },
      profile: { gender: 'Không chia sẻ', birthday: '1995-03-10', nationality: 'Việt Nam', shirtSize: 'M', club: '', emergencyContact: '', emergencyPhone: '' },
    };
    const me = { profile: null, eligible: false, consentText: CONSENT };
    let pages = { 1: { profiles: [], page: 1, hasMore: false } };
    const details = {
      'nguoi-xss': { ...card('nguoi-xss', XSS, XSS), club: 'CLB Sông Hàn' },
    };
    const puts = [];
    let deletes = 0;

    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (method === 'OPTIONS') return reply({});
      if (path === '/auth/me') return reply(account);
      if (path === '/registrations/me') return reply({ registrations: [] });
      if (path === '/bookings/me') return reply({ bookings: [] });
      if (path === '/wallet') return reply({ wallet: { balance: 0 }, runPoints: { balance: 0 } });
      if (path === '/registrations/achievements/me') return reply({ achievements: { completedRaces: 0, totalKm: 0 } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/admin/organizer-access') return reply({ application: null });
      if (path === '/community/me' && method === 'GET') return reply(me);
      if (path === '/community/me' && method === 'PUT') {
        const body = request.postDataJSON(); puts.push(body);
        const created = !me.profile;
        me.profile = { handle: 'nguoi-chay-thu', bio: body.bio ?? me.profile?.bio ?? '', showClub: body.showClub ?? false, showResults: body.showResults ?? false, consentVersion: 'profile-v1', consentAt: '2026-11-16T03:00:00.000Z' };
        return reply({ profile: me.profile }, created ? 201 : 200);
      }
      if (path === '/community/me' && method === 'DELETE') { deletes++; me.profile = null; return route.fulfill({ status: 204 }); }
      if (path === '/community/profiles') return reply(pages[url.searchParams.get('page') || '1']);
      const match = /^\/community\/profiles\/([^/]+)$/.exec(path);
      if (match) {
        const found = details[decodeURIComponent(match[1])];
        return found ? reply(found) : reply({ message: 'Không tìm thấy hồ sơ.', code: 'COMMUNITY_NOT_FOUND' }, 404);
      }
      return reply({ message: 'Không có dữ liệu giả cho ' + path }, 404);
    });

    // Khách chưa đăng nhập: cả danh sách lẫn trang hồ sơ đều chuyển tới /login và giữ đường quay lại.
    await page.goto(base + '/community');
    await expect(page).toHaveURL(/\/login\?next=%2Fcommunity$/);
    await page.goto(base + '/community/nguoi-xss');
    await expect(page).toHaveURL(/\/login\?next=%2Fcommunity%2Fnguoi-xss$/);
    await page.evaluate(() => localStorage.setItem('rf_token', 'community-fixture-only'));

    // Chưa đủ tuổi: giải thích và chỉ sang "Hồ sơ người chạy", không có ô đồng ý.
    await page.goto(base + '/account#community');
    const tab = page.getByRole('button', { name: 'Cộng đồng', exact: true });
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('đủ 16 tuổi', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Tôi đồng ý công khai hồ sơ')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sang Hồ sơ người chạy' }).click();
    await expect(page.getByRole('button', { name: 'Hồ sơ người chạy', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Đủ tuổi: ô đồng ý không tick sẵn, nút bật bị khóa tới khi tick, hai ô tùy chọn mặc định tắt.
    me.eligible = true;
    await tab.click();
    const consent = page.getByLabel('Tôi đồng ý công khai hồ sơ');
    await expect(consent).not.toBeChecked();
    await expect(page.getByText(CONSENT.text)).toBeVisible();
    await expect(page.getByLabel('Hiện câu lạc bộ')).not.toBeChecked();
    await expect(page.getByLabel('Hiện thành tích')).not.toBeChecked();
    const enable = page.getByRole('button', { name: 'Bật hồ sơ' });
    await expect(enable).toBeDisabled();
    await page.getByLabel('Lời giới thiệu').fill('Chạy sáng ven sông');
    await consent.check();
    await expect(enable).toBeEnabled();
    await enable.click();
    await expect(page.getByRole('link', { name: /\/community\/nguoi-chay-thu/ })).toBeVisible();
    assert.deepEqual(puts[0], { consentVersion: 'profile-v1', bio: 'Chạy sáng ven sông', showClub: false, showResults: false });

    // Tắt hồ sơ: hộp xác nhận; "Giữ lại" không gọi gì, "Xóa hồ sơ" gọi DELETE (trả 204) và quay về màn hình đồng ý.
    await page.getByRole('button', { name: 'Tắt và xóa hồ sơ cộng đồng' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Giữ lại' }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(deletes, 0);
    await page.getByRole('button', { name: 'Tắt và xóa hồ sơ cộng đồng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa hồ sơ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Đã tắt và xóa hồ sơ cộng đồng');
    await expect(page.getByLabel('Tôi đồng ý công khai hồ sơ')).not.toBeChecked();
    assert.equal(deletes, 1);

    // Danh sách trống có lời mời bật hồ sơ.
    await page.goto(base + '/community');
    await expect(page.getByText('Chưa có ai bật hồ sơ cộng đồng')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bật hồ sơ của bạn' })).toHaveAttribute('href', '/account#community');

    // Danh sách có người: họ tên và lời giới thiệu chứa HTML hiện ra là chữ; "Xem thêm" nối trang 2.
    pages = { 1: { profiles: [card('nguoi-xss', XSS, XSS)], page: 1, hasMore: true }, 2: { profiles: [card('le-van-c', 'Lê Văn C')], page: 2, hasMore: false } };
    await page.goto(base + '/community');
    await expect(page.getByRole('link', { name: new RegExp(XSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toHaveAttribute('href', '/community/nguoi-xss');
    await page.getByRole('button', { name: 'Xem thêm' }).click();
    await expect(page.getByRole('link', { name: /Lê Văn C/ })).toHaveAttribute('href', '/community/le-van-c');
    await expect(page.getByRole('button', { name: 'Xem thêm' })).toHaveCount(0);
    assert.equal(await page.locator('img[src="x"]').count(), 0);

    // Trang hồ sơ: chữ thuần, không có thẻ img mới, không chạy onerror.
    await page.goto(base + '/community/nguoi-xss');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(XSS);
    await expect(page.getByText('@nguoi-xss')).toBeVisible();
    await expect(page.getByText('CLB Sông Hàn')).toBeVisible();
    await expect(page.getByText('tháng 01/2026', { exact: false })).toBeVisible();
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__communityXss), undefined);

    // Hồ sơ không xem được.
    await page.goto(base + '/community/khong-ton-tai');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy hồ sơ' })).toBeVisible();

    // 400 px: không cuộn ngang ở cả ba màn hình.
    await page.setViewportSize({ width: 400, height: 800 });
    for (const path of ['/community', '/community/nguoi-xss', '/account#community']) {
      await page.goto(base + path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${path} cuộn ngang ${overflow}px`);
    }

    assert.deepEqual(errors, []);
    console.log('PASS: khách chuyển tới /login, chưa đủ tuổi thấy giải thích, ô đồng ý không tick sẵn và khóa nút bật, PUT gửi profile-v1, tắt hồ sơ có hộp xác nhận và DELETE 204, danh sách trống và phân trang, HTML trong họ tên hiện là chữ, 404, 400px không cuộn ngang (API giả).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
