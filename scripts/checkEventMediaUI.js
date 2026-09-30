const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    fs.mkdirSync('artifacts', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const png = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#465e43' } }).png().toBuffer();
    const user = { id: 'owner', fullName: 'Người chạy kiểm thử', email: 'runner@example.com', phone: '0900000000', systemRole: 'RUNNER' };
    let event = { _id: 'media-event', slug: 'media-event', name: 'Đường rừng mùa thu', status: 'REGISTRATION_OPEN', location: { city: 'Đà Lạt', venue: 'Hồ Tuyền Lâm' }, dateInfo: { registrationStart: '2030-01-01T00:00:00Z', registrationEnd: '2030-10-01T00:00:00Z', raceDate: '2030-10-10T00:00:00Z' }, bankAccountInfo: {} };
    const category = { _id: 'category', name: '21 km', code: '21K', distance: 21, price: 650000, quotaTotal: 100, quotaSold: 0, quotaHold: 0 };
    let uploaded = [], saved, remaining = 600, qrFailure = false, submitted = 0;
    const banks = [{ bin: '970422', code: 'MB', shortName: 'MBBank', name: 'Ngân hàng Quân đội' }];
    await page.route('https://img.vietqr.io/**', route => qrFailure ? route.abort() : route.fulfill({ contentType: 'image/png', body: png }));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, '');
      const reply = (json, status = 200) => route.fulfill({ json, status });
      if (request.method() === 'OPTIONS') return reply({});
      if (path === '/auth/me') return reply({ user, profile: { gender:'Nam', birthday:'1990-01-01', nationality:'Việt Nam', shirtSize:'M', club:'', emergencyContact:'Người thân', emergencyPhone:'0900000001' } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/banks') return reply({ banks });
      if (path.startsWith('/media/images/')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.endsWith('/images')) { uploaded.push(url.searchParams.get('kind')); assert.equal(request.headers()['content-type'], 'image/png'); return reply({ url: '/api/media/images/' + (url.searchParams.get('kind') === 'banner' ? 'a'.repeat(24) : 'b'.repeat(24)) }, 201); }
      if (path === '/admin/events/media-event') {
        if (request.method() === 'PATCH') { saved = request.postDataJSON(); event = { ...event, ...saved }; }
        return reply({ event, categories: [category] });
      }
      if (path === '/events/media-event/categories') return reply({ event, categories: [category] });
      if (path === '/wallet') return reply({ runPoints: { balance: 0 } });
      if (path === '/bookings/hold' && request.method() === 'POST') return reply({ booking: { _id: 'hold', orderCode: 'RUNTEST123', finalAmount: 650000 }, bankInfo: event.bankAccountInfo, vietQrUrl: 'https://img.vietqr.io/image/970422-00123456789-compact2.png?amount=650000&addInfo=RUNTEST123', holdSecondsRemaining: remaining }, 201);
      if (path === '/bookings/hold/confirm') { submitted++; return reply({ pending:true, message:'Đang chờ đối soát' }, 202); }
      if (path === '/bookings/hold') return reply({ booking: { status: 'HOLD' }, holdSecondsRemaining: remaining });
      return reply({ message: 'Unexpected route ' + path }, 404);
    });
    await page.goto(base + '/login');
    await page.evaluate(user => { localStorage.setItem('rf_token','fixture'); localStorage.setItem('rf_user',JSON.stringify(user)); }, user);
    await page.goto(base + '/organizer/events/media-event');
    await page.getByLabel('Tải ảnh bìa', { exact:true }).setInputFiles({ name:'cover.png', mimeType:'image/png', buffer:png });
    await expect(page.getByAltText('Xem trước ảnh bìa')).toBeVisible();
    await page.getByLabel('Tải logo', { exact:true }).setInputFiles({ name:'logo.png', mimeType:'image/png', buffer:png });
    await expect(page.getByAltText('Xem trước logo')).toBeVisible();
    await page.getByLabel('Ngân hàng', { exact:true }).selectOption('970422');
    await page.getByLabel('Số tài khoản', { exact:true }).fill('00123456789');
    await page.getByLabel('Tên chủ tài khoản', { exact:true }).fill('TEST ORGANIZER');
    await page.getByRole('button', { name:'Xem trước QR', exact:true }).click();
    await expect(page.getByAltText('QR xem trước tài khoản nhận tiền')).toHaveAttribute('src', /970422-00123456789-compact2/);
    await page.getByRole('button', { name:'Sao chép số tài khoản', exact:true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '00123456789');
    await page.getByRole('button', { name:'Lưu thông tin sự kiện', exact:true }).click();
    await expect.poll(() => saved?.bankAccountInfo.bankBin).toBe('970422');
    assert.ok(saved.bannerUrl && saved.logoUrl); assert.deepEqual(uploaded, ['banner','logo']);
    for (const width of [1440,768,390,360]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'editor overflow ' + width);
    }
    await page.screenshot({ path:'artifacts/event-editor-media-mobile.png', fullPage:true });
    await page.goto(base + '/events/media-event/register');
    await expect(page.locator('.checkout-event-photo>img').first()).toHaveAttribute('src', /\/api\/media\/images\/a{24}$/);
    await page.getByRole('button', { name:'Giữ Chỗ & Thanh Toán (10p)', exact:true }).click();
    await expect(page.getByAltText('QR chuyển khoản tiền vé')).toBeVisible();
    await page.getByRole('button', { name:'Sao chép nội dung chuyển khoản', exact:true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'RUNTEST123');
    for (const width of [1440,768,390,360]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'checkout overflow ' + width);
    }
    await page.screenshot({ path:'artifacts/checkout-transfer-mobile.png', fullPage:true });
    await page.getByRole('button', { name:'Tôi đã chuyển khoản — Gửi đối soát', exact:true }).click();
    await expect(page.getByRole('button', { name:'Đang chờ chủ giải đối soát' })).toBeDisabled();
    assert.equal(submitted,1);
    qrFailure = true;
    await page.goto(base + '/events/media-event/register');
    await page.getByRole('button', { name:'Giữ Chỗ & Thanh Toán (10p)', exact:true }).click();
    await expect(page.getByRole('button', { name:'Tải lại QR', exact:true })).toBeVisible();
    await expect(page.locator('.transfer-copy')).toContainText('00123456789');
    qrFailure = false;
    await page.getByRole('button', { name:'Tải lại QR', exact:true }).click();
    await expect(page.getByAltText('QR chuyển khoản tiền vé')).toBeVisible();
    remaining = 0;
    await expect(page.getByText(/Đơn đã hết hạn giữ chỗ/)).toBeVisible({ timeout: 8000 });
    await expect(page.getByAltText('QR chuyển khoản tiền vé')).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: banner/logo upload and save, bank select/QR preview, clipboard, checkout artwork, pending transfer, QR failure/retry/expiry, 4 viewports. API fixtures only.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
