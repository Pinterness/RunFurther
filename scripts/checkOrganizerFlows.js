const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    fs.mkdirSync('artifacts', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const user = { id: 'owner-1', fullName: 'Ban tổ chức kiểm thử', email: 'owner@test.local', systemRole: 'RUNNER' };
    let events = [], organizations = [], categories = [], accounts = [], created, changed, assigned, changedStaff, forbidden = false;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, ''), method = route.request().method(), body = method === 'POST' || method === 'PATCH' ? route.request().postDataJSON() : null;
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (path === '/admin/organizer-access') return reply({ application: { status: 'APPROVED' } });
      if (path === '/auth/me') return reply({ user });
      if (path === '/organizations/mine') return reply({ organizations });
      if (path === '/organizations') { const organization = { ...body, _id: 'org-1' }; organizations.push(organization); return reply({ organization }, 201); }
      if (path === '/admin/events') {
        if (method === 'GET') return reply({ events });
        created = body; events = [{ ...body, _id: 'event-1', createdBy: user.id, status: 'DRAFT' }]; return reply({ event: events[0] }, 201);
      }
      if (forbidden && path.startsWith('/admin/events/')) return reply({ message: 'Bạn không có quyền quản lý sự kiện này.' }, 403);
      if (path === '/admin/events/event-1') {
        if (method === 'PATCH') { changed = body; events[0] = { ...events[0], ...body }; }
        return reply({ event: events[0], categories });
      }
      if (path === '/admin/events/event-1/categories') { categories.push({ ...body, _id: 'category-1', quotaSold: 0, quotaHold: 0 }); return reply({ category: categories[0] }, 201); }
      if (path === '/admin/events/event-1/staff') {
        if (method === 'POST') { assigned = body; accounts.push({ ...body, _id: 'staff-1', status: 'ACTIVE', loginCode: 'TESTCODE12345678' }); return reply({ account: accounts[0] }, 201); }
        return reply({ accounts });
      }
      if (path === '/admin/events/event-1/staff/staff-1') { changedStaff = body; accounts[0] = { ...accounts[0], ...body }; return reply({ account: accounts[0] }); }
      if (path === '/admin/events/event-1/registrations') return reply({ registrations: [], total: 0 });
      return reply({ message: 'Unexpected route ' + path }, 404);
    });
    await page.goto(base + '/organizer', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: 'Đăng nhập để bắt đầu' })).toHaveAttribute('href', '/login?next=%2Forganizer');
    await page.evaluate(user => { localStorage.setItem('rf_token', 'ui-fixture'); localStorage.setItem('rf_user', JSON.stringify(user)); }, user);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Giải chạy đầu tiên của bạn.' })).toBeVisible();
    await page.getByRole('button', { name: 'Tạo sự kiện', exact: false }).click();
    await page.getByLabel('Tên đơn vị', { exact: true }).fill('Câu lạc bộ Đường Rừng');
    await page.getByLabel('Đường dẫn đơn vị').click();
    await expect(page.getByLabel('Đường dẫn đơn vị')).toHaveValue('cau-lac-bo-duong-rung');
    await page.getByRole('button', { name: 'Lưu đơn vị & tiếp tục' }).click();
    await expect(page.getByRole('dialog')).toContainText('Tạo sự kiện');
    await page.locator('#event-name').fill('Đường Rừng Trail 2030');
    await page.locator('#event-city').fill('Đà Lạt');
    await page.locator('#event-venue').fill('Hồ Tuyền Lâm');
    await page.locator('#event-registrationStart').fill('2030-01-01T08:00');
    await page.locator('#event-registrationEnd').fill('2030-05-01T18:00');
    await page.locator('#event-raceDate').fill('2030-05-10T05:00');
    await page.getByRole('button', { name: 'Tạo sự kiện bản nháp' }).click();
    await page.waitForURL('**/organizer/events/event-1');
    assert.equal(created.organizerId, 'org-1');
    assert.equal(created.createdBy, undefined);
    await page.getByRole('button', { name: 'Cự ly & vé', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm cự ly', exact: true }).click();
    for (const [label,value] of [['Tên cự ly','Trail 21 km'],['Mã cự ly','21K'],['Quãng đường (km)','21'],['Giá vé (VNĐ)','650000'],['Tổng số suất','100']]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('dialog').getByRole('button', { name: 'Lưu cự ly', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.organizer-event')).toContainText('21 km');
    await page.getByRole('button', { name: 'Thông tin giải', exact: true }).click();
    await page.locator('select[name="status"]').selectOption('REGISTRATION_OPEN');
    await page.getByRole('button', { name: 'Lưu thông tin sự kiện' }).click();
    await expect(page.locator('#main-content').getByRole('status')).toContainText('Đã lưu');
    assert.equal(changed.status, 'REGISTRATION_OPEN');
    await page.getByRole('button', { name: 'Nhân sự', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm nhân sự', exact: true }).click();
    await page.getByLabel('Họ tên nhân sự', { exact: true }).fill('Nguyễn Minh Anh');
    await page.getByLabel('Vị trí phân công').fill('Cổng xuất phát');
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo phân công', exact: true }).click();
    await expect(page.locator('.organizer-staff')).toContainText('Nguyễn Minh Anh');
    assert.equal(assigned.accountType, 'CHECKIN'); assert.equal(assigned.eventId, undefined);
    await page.getByText('Xem mã đăng nhập', { exact: true }).click();
    await expect(page.locator('.organizer-staff code')).toContainText('TESTCODE12345678');
    await page.getByRole('button', { name: 'Khóa quyền', exact: true }).click();
    await expect(page.locator('.organizer-staff')).toContainText('Đã khóa');
    assert.equal(changedStaff.status, 'INACTIVE');
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ['Thông tin giải','Cự ly & vé','Nhân sự','Người chạy']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, tab + ' overflow at ' + width);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Nhân sự', exact: true }).click();
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: 'artifacts/organizer-staff.png', fullPage: true });
    await page.goto(base + '/organizer', { waitUntil: 'networkidle' });
    await expect(page.locator('.organizer-event')).toHaveCount(1);
    await page.screenshot({ path: 'artifacts/organizer-dashboard.png', fullPage: true });
    forbidden = true;
    await page.goto(base + '/organizer/events/event-1', { waitUntil: 'networkidle' });
    await expect(page.locator('#main-content').getByRole('alert')).toContainText('không có quyền');
    assert.equal(await page.locator('#event-name').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS organizer UI: guest gate, organization onboarding, event creation, category, publish, staff assignment/revocation, 4 viewports, forbidden event. API fixtures only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
