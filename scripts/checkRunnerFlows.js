const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let account = { user: { id: 'runner-1', fullName: 'Nguyễn Minh Anh', email: 'runner@test.local', phone: '0900123456', avatarTheme: 'forest', createdAt: '2025-01-01T00:00:00Z' }, profile: { birthday: '1996-07-14', gender: 'Nữ', nationality: 'Việt Nam', shirtSize: 'M', club: 'Sunday Running Club', emergencyContact: 'Người thân', emergencyPhone: '0900111222' } };
    const race = { _id: 'race-1', name: 'Dalat Forest Trail', slug: 'dalat-forest', status: 'REGISTRATION_OPEN', dateInfo: { raceDate: '2030-10-20T00:00:00Z' }, location: { city: 'Đà Lạt' } };
    const category = { _id: 'category-1', name: 'Half Marathon', code: '21K', distance: 21, price: 650000, rules: { minAge: 16 }, quotaTotal: 500, quotaSold: 100, quotaHold: 0 };
    const ticket = { _id: 'ticket-1', eventId: race, categoryId: category, status: 'CONFIRMED', bibNumber: '21K-0128', qrToken: 'RF-isolated-browser-fixture', runnerProfile: { fullName: account.user.fullName }, logistics: { shirtSize: 'M', hasCheckedIn: false, raceKitIssued: false }, payment: { paidAmount: 650000 } };
    const listings = [
      { _id: 'listing-1', listingType: 'BIB_TRANSFER', title: 'Hẹn bạn ở đường trail Đà Lạt', description: 'Nhượng lại suất 21km vì thay đổi lịch trình. Cùng tiếp nối một hành trình trong rừng thông.', price: 600000, originalPrice: 650000, bibNumber: '21K-0128', categoryInfo: 'Half Marathon · 21 km', eventId: race, sellerId: { _id: 'seller-1', fullName: 'Trần Hoàng Nam' } },
      { _id: 'listing-2', listingType: 'BIB_TRANSFER', title: 'Suất chạy 10km dành cho người bắt đầu', description: 'Một đường chạy đẹp và nhiều năng lượng. Mình nhượng lại đúng giá gốc.', price: 350000, originalPrice: 350000, bibNumber: '10K-0314', categoryInfo: '10 km', eventId: { ...race, name: 'Saigon Riverside Run' }, sellerId: { _id: 'seller-2', fullName: 'Lê Thảo My' } },
      { _id: 'listing-3', listingType: 'BIB_TRANSFER', title: 'Chuyển nhượng BIB full marathon', description: 'Sẵn sàng cho cự ly mới cùng cộng đồng.', price: 850000, originalPrice: 950000, bibNumber: '42K-0046', categoryInfo: 'Full Marathon · 42 km', eventId: { ...race, name: 'Hanoi Autumn Marathon' }, sellerId: { _id: 'seller-3', fullName: 'Phạm Quốc Huy' } }
    ];
    let expired = false, registrationRequests = 0, signupBody, createBody, buyBody, savedBody, profileUnavailable = false, marketUnavailable = false;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, ''), method = route.request().method();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (method === 'OPTIONS') return reply({});
      if (path === '/auth/me') {
        if (expired) return reply({ message: 'Phiên đăng nhập đã hết hạn.' }, 401);
        if (profileUnavailable) return reply({ message: 'Không tải được hồ sơ.' }, 503);
        if (method === 'PATCH') { savedBody = route.request().postDataJSON(); account = { user: { ...account.user, ...savedBody, profile: undefined }, profile: savedBody.profile }; }
        return reply(account);
      }
      if (path === '/auth/register') { signupBody = route.request().postDataJSON(); account = { user: { ...account.user, fullName: signupBody.fullName, phone: signupBody.phone, email: signupBody.email }, profile: signupBody.profile }; return reply({ user: account.user, token: 'isolated-ui-token' }, 201); }
      if (path === '/registrations/me') { registrationRequests++; return reply({ registrations: [ticket] }); }
      if (path === '/bookings/me') return reply({ bookings: [{ _id: 'hold-1', status: 'HOLD', eventId: race, orderCode: 'RF-HOLD-TEST', finalAmount: 650000 }] });
      if (path === '/registrations/achievements/me') return reply({ achievements: { completedRaces: 2, totalKm: 31 } });
      if (path === '/wallet') return reply({ wallet: { balance: 1500000 }, runPoints: { balance: 150 } });
      if (path === '/marketplace') {
        if (marketUnavailable) return reply({ message: 'Không tải được tin đăng.' }, 503);
        if (method === 'POST') { createBody = route.request().postDataJSON(); return reply({ listing: createBody }, 201); }
        const filtered = url.searchParams.get('listingType') === 'GEAR' ? [] : listings;
        return reply({ listings: filtered, pagination: { total: filtered.length, totalPages: filtered.length ? 1 : 0, page: 1 } });
      }
      if (path.endsWith('/buy')) { buyBody = route.request().postDataJSON(); return reply({ message: 'Success' }); }
      if (path === '/events/dalat-forest/categories') return reply({ event: race, categories: [category] });
      if (path === '/events') return reply({ events: [] });
      return reply({ message: 'Unexpected API ' + path }, 404);
    });
    await page.goto(base + '/marketplace', { waitUntil: 'networkidle' });
    await expect(page.locator('.market-card')).toHaveCount(3);
    await page.getByRole('button', { name: 'Đăng tin của bạn' }).click();
    await expect(page.getByRole('dialog')).toContainText('Đăng nhập để tiếp tục');
    assert.equal(await page.locator('input[name="title"]').count(), 0);
    assert.equal(registrationRequests, 0, 'Guest must not request private tickets');
    assert.equal(await page.getByRole('dialog').getByRole('link', { name: 'Đăng nhập', exact: true }).getAttribute('href'), '/login?next=%2Fmarketplace');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/marketplace-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Đồ chạy bộ', exact: true }).click();
    await expect(page.locator('.market-empty')).toContainText('Chưa có tin');
    marketUnavailable = true;
    await page.getByRole('button', { name: 'Chuyển nhượng BIB', exact: true }).click();
    await expect(page.locator('#main-content').getByRole('alert')).toContainText('Không tải được tin đăng');
    marketUnavailable = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.locator('.market-card')).toHaveCount(3);
    await page.evaluate(() => localStorage.setItem('rf_token', 'expired-fixture'));
    expired = true;
    await page.getByRole('button', { name: 'Đăng tin của bạn' }).click();
    await expect(page.getByRole('dialog')).toContainText('Đăng nhập để tiếp tục');
    assert.equal(registrationRequests, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('rf_token')), null);
    await page.keyboard.press('Escape'); expired = false;
    await page.evaluate(() => localStorage.setItem('rf_token', 'isolated-ui-token'));
    await page.getByRole('button', { name: 'Đăng tin của bạn' }).click();
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await page.getByLabel('Vé của bạn').selectOption('ticket-1');
    await page.getByLabel('Tiêu đề').fill('Nhượng BIB kiểm thử');
    await page.getByLabel('Giá (VNĐ)').fill('600000');
    assert.equal(await page.getByLabel('Giá (VNĐ)').getAttribute('max'), '715000');
    await page.getByRole('dialog').getByRole('button', { name: 'Đăng tin', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(createBody.registrationId, 'ticket-1');
    await page.getByRole('button', { name: 'Xem & mua', exact: true }).first().click();
    await expect(page.getByLabel('Họ và tên', { exact: true })).toHaveValue(account.user.fullName);
    await expect(page.getByLabel('Ngày sinh', { exact: true })).toHaveValue(account.profile.birthday);
    await page.getByRole('button', { name: 'Xác nhận thanh toán 600.000đ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(buyBody.newRunnerProfile.emergencyPhone, account.profile.emergencyPhone);
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await expect(page.locator('.runner-ticket')).toHaveCount(1);
    await expect(page.locator('.pending-bookings')).toContainText('Chưa cấp vé');
    await page.getByRole('button', { name: 'Xem vé' }).click();
    await expect(page.getByAltText('Mã QR vé để nhân sự kiểm tra')).toBeVisible();
    assert.match(await page.getByAltText('Mã QR vé để nhân sự kiểm tra').getAttribute('src'), /^data:image\/png;base64,/);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'artifacts/account-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Hồ sơ người chạy', exact: true }).click();
    await page.getByLabel('Họ và tên', { exact: true }).fill('Nguyễn Minh An');
    await page.getByRole('button', { name: 'Đại dương', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Đã lưu hồ sơ');
    assert.equal(savedBody.avatarTheme, 'ocean');
    await expect(page.locator('.account-trigger .avatar-ocean')).toHaveCount(1);
    await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: 'artifacts/profile-desktop.png', fullPage: true });
    profileUnavailable = true;
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await expect(page.locator('#main-content').getByRole('alert')).toContainText('Không tải được hồ sơ');
    profileUnavailable = false;
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.locator('.runner-ticket')).toHaveCount(1);
    await page.goto(base + '/events/dalat-forest/register', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('input[type="email"]').inputValue(), account.user.email);
    await expect(page.locator('#runner-birthday')).toHaveValue(account.profile.birthday);
    const values = await page.locator('input').evaluateAll(nodes => nodes.map(node => node.value));
    assert.ok(values.includes('Nguyễn Minh An')); assert.ok(values.includes('0900111222'));
    // Responsive checks cover account tickets, profile, marketplace and signup.
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/marketplace', '/account', '/register', '/events/dalat-forest/register']) {
        await page.goto(base + path, { waitUntil: 'networkidle' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path + ' overflow at ' + width);
        if (path === '/account') {
          if (width === 390) await page.screenshot({ path: 'artifacts/account-mobile.png', fullPage: true });
          await page.getByRole('button', { name: 'Hồ sơ người chạy', exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Profile overflow at ' + width);
        }
        if (path === '/marketplace' && width === 390) await page.screenshot({ path: 'artifacts/marketplace-mobile.png', fullPage: true });
      }
    }
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(base + '/events/dalat-forest/register', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Đăng nhập để đăng ký giải.' })).toBeVisible();
    await page.getByRole('link', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.locator('.auth-switch').getByRole('link', { name: 'Đăng nhập', exact: true })).toHaveAttribute('href', '/login?next=%2Fevents%2Fdalat-forest%2Fregister');
    await page.goto(base + '/register?next=%2Faccount', { waitUntil: 'networkidle' });
    await page.getByLabel('Họ và tên', { exact: true }).fill('Runner Mới');
    await page.getByLabel('Email', { exact: true }).fill('newrunner@test.local');
    await page.getByLabel('Số điện thoại', { exact: true }).fill('0900999888');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByLabel('Ngày sinh', { exact: true }).fill('1998-06-12');
    await page.locator('#signup-runner-gender').selectOption('Nữ');
    await page.getByLabel('Size áo mặc định').selectOption('L');
    await page.getByLabel('Người liên hệ khẩn cấp').fill('Gia đình');
    await page.getByLabel('Số điện thoại khẩn cấp').fill('0900333444');
    await page.getByRole('button', { name: 'Tạo tài khoản & lưu hồ sơ' }).click();
    await page.waitForURL('**/account');
    assert.equal(signupBody.profile.shirtSize, 'L'); assert.equal(signupBody.profile.birthday, '1998-06-12');
    await page.goto(base, { waitUntil: 'networkidle' });
    await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced', 'true', { timeout: 20000 });
    await page.locator('.immersive-panel-trigger[data-panel="distance"]').click();
    await page.locator('.distance-workspace').hover();
    assert.equal(await page.locator('.track-runner').evaluate(node => getComputedStyle(node).animationPlayState), 'running');
    await page.locator('.distance-workspace').screenshot({ path: 'artifacts/challenge-interaction.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.track-runner').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('Runner flows passed: guest/expired login gates, listing create/buy, QR, profile/avatar save, checkout autofill, signup, 4 viewport sizes and reduced motion. API fixtures only; no production data changed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
