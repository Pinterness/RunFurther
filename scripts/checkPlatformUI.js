const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    fs.mkdirSync('artifacts', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let role = 'RUNNER', application = null, moderation = { state: 'ACTIVE' }, read = false, managementRequests = 0;
    const user = () => ({ id: 'test-user', fullName: 'Người kiểm thử', systemRole: role });
    const events = [0,1,2].map(i => ({ _id: String(i), slug: 'race-' + i, name: 'Hành trình qua rừng ' + (i + 1), categories: ['5K','21K'], status: 'REGISTRATION_OPEN', price: 500000, dateInfo: { raceDate: '2030-10-10' }, location: { city: 'Đà Lạt' } }));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, ''), method = route.request().method();
      const body = method === 'POST' ? route.request().postDataJSON() : null;
      const reply = data => route.fulfill({ json: data });
      if (path === '/auth/me') return reply({ user: user() });
      if (path === '/events') return reply({ events });
      if (path === '/admin/events') { managementRequests++; return reply({ events: [] }); }
      if (path === '/organizations/mine') { managementRequests++; return reply({ organizations: [] }); }
      if (path === '/admin/organizer-access') { if (body) application = { ...body, _id: 'app-1', status: 'PENDING', userId: { fullName: 'Người tổ chức', email: 'test@example.com' } }; return reply({ application }); }
      if (path === '/admin/platform/applications') return reply({ applications: application ? [application] : [] });
      if (path === '/admin/platform/applications/app-1/review') { application = { ...application, status: body.status, reviewNote: body.reason }; return reply({ application }); }
      if (path === '/admin/platform/events') return reply({ events: [{ ...events[0], moderation, createdBy: { fullName: 'Chủ giải' } }], total: 1 });
      if (path.endsWith('/moderation')) { assert.ok(body.reason.trim()); moderation = { state: body.action, reason: body.reason }; return reply({ event: { ...events[0], moderation } }); }
      if (path.endsWith('/history')) return reply({ history: [{ _id: 'history', action: moderation.state, reason: moderation.reason, createdAt: new Date().toISOString() }] });
      if (path === '/admin/payments') return reply({ payments: [{ _id: 'topup', kind: 'TOPUP', amount: 50000, requestKey: 'TOPUP-TEST', status: 'PENDING' }] });
      if (path === '/notifications/read') { read = true; return reply({ success: true }); }
      if (path === '/notifications') return reply({ notifications: [{ key: 'ticket:1', title: 'Vé của bạn: 21K-TEST', detail: 'Xem vé trong tài khoản', at: new Date().toISOString(), href: '/account', read }] });
      return route.fulfill({ status: 404, json: { message: 'Unexpected ' + path } });
    });
    await page.goto('http://localhost:3000');
    await page.evaluate(u => { localStorage.setItem('rf_token','fixture'); localStorage.setItem('rf_user', JSON.stringify(u)); }, user());
    await page.goto('http://localhost:3000/organizer');
    await expect(page.getByRole('heading', { name: 'Đăng ký quyền tổ chức', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Tạo sự kiện|Bắt đầu tạo giải|Thêm đơn vị tổ chức/ })).toHaveCount(0);
    await expect(page.locator('.organizer-events, .organizer-intro, .market-guide')).toHaveCount(0);
    assert.equal(managementRequests, 0, 'Unapproved users must not request management data');
    await page.getByLabel('Tên đơn vị dự kiến').fill('Đội chạy Đường Rừng');
    await page.getByLabel('Số điện thoại liên hệ').fill('0900000000');
    await page.getByLabel('Giới thiệu và kế hoạch tổ chức').fill('Tổ chức giải chạy đường rừng.');
    await page.getByRole('button', { name: 'Gửi xét duyệt' }).click();
    await expect(page.getByRole('status')).toContainText('đang chờ');
    await expect(page.getByRole('button', { name: /Tạo sự kiện|Bắt đầu tạo giải|Thêm đơn vị tổ chức/ })).toHaveCount(0);
    assert.equal(managementRequests, 0, 'Pending applicants must remain in onboarding');
    await page.locator('.notification-trigger').click();
    await expect(page.locator('.notification-panel')).toContainText('21K-TEST');
    await page.getByRole('button', { name: 'Đánh dấu đã đọc' }).click();
    await expect(page.locator('.notification-dot')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.notification-panel')).toHaveCount(0);
    assert.equal(await page.locator('.account-trigger .runner-avatar').evaluate(n => n.getBoundingClientRect().width), 28);
    role = 'SUPER_ADMIN';
    await page.evaluate(u => localStorage.setItem('rf_user', JSON.stringify(u)), user());
    await page.goto('http://localhost:3000/admin');
    await page.getByRole('button', { name: 'Duyệt quyền tổ chức', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Xác nhận quyết định' })).toBeDisabled();
    await page.getByLabel('Lý do quyết định').fill('Đã xác minh thông tin đơn vị.');
    await page.getByRole('button', { name: 'Xác nhận quyết định' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.equal(application.status, 'APPROVED');
    await page.getByRole('button', { name: 'Kiểm duyệt giải', exact: true }).click();
    await page.getByRole('button', { name: 'Tạm ngừng', exact: true }).click();
    await page.getByLabel('Lý do quyết định').fill('Cần bổ sung thông tin theo yêu cầu.');
    await page.getByRole('button', { name: 'Xác nhận quyết định' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.organizer-event')).toContainText('Cần bổ sung');
    await expect(page.getByRole('button', { name: /Xóa/ })).toHaveCount(0);
    await expect(page.locator('a[href^="/organizer/events/"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Lịch sử', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Cần bổ sung');
    await page.keyboard.press('Escape');
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'admin overflow ' + width);
    }
    await page.screenshot({ path: 'artifacts/platform-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Nạp ví', exact: true }).click();
    await expect(page.locator('.organizer-panel')).toContainText('TOPUP-TEST');
    await page.goto('http://localhost:3000');
    await page.setViewportSize({ width: 1440, height: 950 });
    await expect(page.locator('.immersive-journey')).toHaveAttribute('data-enhanced', 'true');
    await page.locator('.immersive-panel-trigger[data-panel="events"]').click();
    const carousel = page.locator('.event-carousel');
    await carousel.scrollIntoViewIfNeeded();
    await page.mouse.move(0,0);
    const current = () => page.locator('.carousel-slide.is-current').getAttribute('aria-label');
    const initial = await current();
    await expect.poll(current, { timeout: 7000 }).not.toBe(initial);
    await carousel.hover();
    const stopped = await current();
    await page.waitForTimeout(5300);
    assert.equal(await current(), stopped);
    await page.getByRole('button', { name: 'Giải tiếp theo', exact: true }).click();
    await expect.poll(current).not.toBe(stopped);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(current).toBe(stopped);
    await page.screenshot({ path: 'artifacts/carousel-desktop.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.carousel-pause')).toBeDisabled();
    for (const width of [768,390,360]) {
      await page.setViewportSize({ width, height: 900 });
      await carousel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'carousel overflow ' + width);
    }
    await page.screenshot({ path: 'artifacts/carousel-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: organizer approval, moderation reason/history, super-admin boundaries, real notification UI/read state, compact avatar, carousel auto/hover/keyboard/reduced motion, 4 viewports. API fixtures only.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
