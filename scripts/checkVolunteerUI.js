const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const user = { id: 'volunteer-user', fullName: 'Volunteer Tester', email: 'volunteer@test.local', systemRole: 'RUNNER', createdAt: '2026-01-01' };
    const event = { _id: 'event-ui', name: 'Volunteer Review Fixture', slug: 'volunteer-fixture', status: 'REGISTRATION_OPEN', location: { city: 'Can Tho', venue: 'Park' }, dateInfo: { raceDate: '2030-12-01', registrationStart: '2026-01-01', registrationEnd: '2030-11-01' } };
    let isOwner = true, failList = true, submitted = null;
    const applications = ['First Volunteer', 'Second Volunteer'].map((name, index) => ({ _id: 'application-' + index, applicant: { fullName: name, email: index + '@test.local', phone: '0900000000', tShirtSize: 'L', note: 'Morning shift' }, userId: user.id, eventId: event, desiredRole: 'CHECKIN', status: 'PENDING', createdAt: '2026-10-01' }));
    await page.addInitScript(user => { localStorage.setItem('rf_token', 'fixture-token'); localStorage.setItem('rf_user', JSON.stringify(user)); }, user);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, '');
      const reply = (json, status = 200) => route.fulfill({ json, status });
      if (path === '/auth/me') return reply({ user, profile: { club: '' } });
      if (path === '/admin/organizer-access') return reply({ application: { status: 'APPROVED' } });
      if (path === '/admin/events/event-ui') return reply({ event, categories: [] });
      if (path === '/admin/events/event-ui/volunteers') {
        if (failList) return reply({ message: 'Temporary queue failure' }, 503);
        const list = applications.filter(item => item.status === url.searchParams.get('status'));
        return reply({ applications: list, total: list.length, page: 1, totalPages: 1 });
      }
      if (path.match(/^\/admin\/events\/event-ui\/volunteers\/application-\d\/review$/)) {
        const body = request.postDataJSON(), application = applications.find(item => path.includes('/' + item._id + '/'));
        Object.assign(application, body, { loginCode: body.status === 'APPROVED' ? 'CURRENTFIXTURECODE' : null });
        return reply({ application });
      }
      if (path === '/staff/volunteers/me') return reply({ applications, total: applications.length, page: 1, totalPages: 1 });
      if (path.endsWith('/volunteers/apply')) {
        submitted = request.postDataJSON(); return reply({ application: { _id: 'saved-receipt', status: 'PENDING' } }, 201);
      }
      if (path === '/notifications') return reply({ notifications: [{ key: 'volunteer-fixture', title: 'Đơn tình nguyện viên', detail: 'Review result', href: isOwner ? '/organizer/events/event-ui#volunteers' : '/account#volunteers', at: '2026-10-01', read: false }] });
      if (path === '/registrations/me') return reply({ registrations: [] });
      if (path === '/bookings/me') return reply({ bookings: [] });
      if (path === '/wallet') return reply({ wallet: { balance: 0 }, runPoints: { balance: 0 } });
      if (path === '/registrations/achievements/me') return reply({ achievements: { completedRaces: 0, totalKm: 0 } });
      return reply({ message: 'Unexpected fixture route ' + path }, 404);
    });
    await page.goto(base + '/organizer/events/event-ui#volunteers', { waitUntil: 'networkidle' });
    await expect(page.locator('.volunteer-applications [role="alert"]')).toContainText('Temporary queue failure');
    failList = false;
    await page.locator('.volunteer-applications').getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.locator('.volunteer-card')).toHaveCount(2);
    await page.locator('.volunteer-card').first().getByRole('button', { name: 'Duyệt đơn' }).click();
    await page.getByLabel('Vị trí phân công').selectOption('RACE_KIT');
    await page.getByLabel('Lời nhắn cho tình nguyện viên (tùy chọn)').fill('Gate A at 6 AM');
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.locator('.volunteer-card')).toHaveCount(1);
    assert.equal(applications[0].assignedRole, 'RACE_KIT');
    await page.locator('.volunteer-card').getByRole('button', { name: 'Từ chối' }).click();
    await page.getByLabel('Lý do từ chối').fill('Team is full');
    await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.locator('.volunteer-card')).toHaveCount(0);
    await page.locator('.volunteer-applications').getByRole('button', { name: 'Đã duyệt', exact: true }).click();
    await expect(page.locator('.volunteer-card')).toContainText('Gate A at 6 AM');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.volunteer-card')).toHaveCount(0);
    isOwner = false;
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Thông báo/ }).click();
    await page.locator('.notification-panel').getByRole('link', { name: /Đơn tình nguyện viên/ }).click();
    await expect(page.locator('.volunteer-card')).toHaveCount(2);
    await page.getByRole('button', { name: /^Vé của tôi/ }).click();
    await page.getByRole('button', { name: /^Thông báo/ }).click();
    await page.locator('.notification-panel').getByRole('link', { name: /Đơn tình nguyện viên/ }).click();
    await expect(page.locator('.volunteer-card')).toHaveCount(2);
    await expect(page.locator('.volunteer-card').first()).toContainText('Gate A at 6 AM');
    await page.getByText('Xem mã nhân sự của tôi', { exact: true }).click();
    await expect(page.locator('.volunteer-access code')).toHaveText('CURRENTFIXTURECODE');
    await expect(page.locator('.volunteer-card').last()).toContainText('Team is full');
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Account overflow at ' + width);
    }
    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/volunteer-account-mobile.png', fullPage: true });
    // Server-rendered event data is read-only; ALL browser API writes above are intercepted.
    const response = await fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/events?upcoming=true&limit=1');
    assert.ok(response.ok); const { events } = await response.json();
    if (events.length) {
      await page.goto(base + '/events/' + events[0].slug, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Đăng ký tình nguyện viên', exact: true }).click();
      await page.getByLabel('Họ và tên', { exact: true }).fill('Volunteer Form Fixture');
      await page.getByLabel('Email', { exact: true }).fill('fixture@test.local');
      await page.getByLabel('Số điện thoại', { exact: true }).fill('0900000000');
      await page.getByRole('button', { name: 'Gửi đơn đăng ký' }).click();
      await expect(page.getByRole('dialog')).toContainText('saved-receipt');
      assert.equal(submitted.desiredRole, 'CHECKIN');
      await page.getByRole('link', { name: 'Theo dõi đơn của tôi' }).click();
      await expect(page.locator('.volunteer-card')).toHaveCount(2);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: owner queue retry, approval/rejection, reload, notification deep link, private result/code, mobile layout and saved application receipt. All mutations use fixtures.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
