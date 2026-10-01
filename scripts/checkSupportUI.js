const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    let role = 'SUPER_ADMIN', listFails = true, detailFails = true, replyFails = true, releaseReply;
    const now = '2030-04-15T08:00:00.000Z';
    const tickets = [1, 2, 3].map(index => ({
      _id: 'ticket-' + index, subject: 'Cần hỗ trợ vé ' + index, status: 'OPEN', createdAt: now, updatedAt: now,
      userId: { _id: 'runner-' + index, fullName: 'Người chạy ' + index, email: 'runner' + index + '@example.test' },
      messages: [{ role: 'customer', content: index === 1 ? 'Chưa thấy vé. <img src=x onerror="window.supportInjected=true">' : 'Nhờ kiểm tra yêu cầu giúp tôi.', createdAt: now }],
    }));
    await page.addInitScript(() => {
      localStorage.setItem('rf_token', 'support-fixture-only');
      localStorage.setItem('rf_user', JSON.stringify({ id: 'admin', fullName: 'Quản trị kiểm thử', systemRole: 'SUPER_ADMIN' }));
    });
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = data => route.fulfill({ json: data });
      if (path === '/auth/me') return reply({ user: { id: 'admin', fullName: 'Quản trị kiểm thử', systemRole: role } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/admin/platform/applications') return reply({ applications: [] });
      if (path === '/support/tickets') return reply({ tickets: [], total: 0, page: 1, totalPages: 0 });
      if (path.startsWith('/support/admin/tickets')) {
        assert.equal(request.headers().authorization, 'Bearer support-fixture-only');
        if (path === '/support/admin/tickets') {
          if (listFails) return route.fulfill({ status: 503, json: { message: 'Hộp thư tạm thời chưa tải được.' } });
          const filtered = tickets.filter(ticket => ticket.status === url.searchParams.get('status'));
          const currentPage = Number(url.searchParams.get('page')) || 1;
          return reply({ tickets: filtered.slice((currentPage - 1) * 2, currentPage * 2).map(ticket => ({ ...ticket, messages: ticket.messages.slice(-1) })), total: filtered.length, page: currentPage, totalPages: Math.ceil(filtered.length / 2) });
        }
        const id = path.split('/')[4], ticket = tickets.find(item => item._id === id);
        if (!ticket) return route.fulfill({ status: 404, json: { message: 'Không tìm thấy yêu cầu.' } });
        if (method === 'GET') {
          if (detailFails) return route.fulfill({ status: 503, json: { message: 'Hội thoại tạm thời chưa tải được.' } });
          return reply({ ticket });
        }
        const body = request.postDataJSON(); writes.push({ id, method, body });
        if (method === 'POST') {
          if (replyFails) return route.fulfill({ status: 503, json: { message: 'Phản hồi chưa được gửi. Vui lòng thử lại.' } });
          await new Promise(resolve => { releaseReply = resolve; });
          ticket.messages.push({ role: 'support', content: body.message, createdAt: now }); ticket.status = 'ANSWERED';
          return reply({ ticket });
        }
        if (method === 'PATCH') { ticket.status = body.status; return reply({ ticket }); }
      }
      return route.fulfill({ status: 404, json: { message: 'Fixture does not implement ' + path } });
    });

    await page.goto(base + '/admin', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Hỗ trợ khách', exact: true }).click();
    const inbox = page.locator('.support-inbox');
    await expect(inbox.getByRole('alert')).toContainText('Hộp thư tạm thời');
    listFails = false;
    await inbox.getByRole('button', { name: 'Tải lại danh sách' }).click();
    await expect(inbox.locator('.support-ticket-row')).toHaveCount(2);
    await inbox.getByRole('navigation', { name: 'Trang yêu cầu hỗ trợ' }).getByRole('button', { name: 'Sau' }).click();
    await expect(inbox.locator('.support-ticket-row')).toHaveCount(1);
    await expect(inbox.locator('.support-ticket-row')).toContainText('Cần hỗ trợ vé 3');
    await inbox.getByRole('navigation', { name: 'Trang yêu cầu hỗ trợ' }).getByRole('button', { name: 'Trước' }).click();
    await inbox.locator('.support-ticket-row').first().click();
    await expect(inbox.getByRole('alert')).toContainText('Hội thoại tạm thời');
    detailFails = false;
    await inbox.getByRole('button', { name: 'Tải lại hội thoại' }).click();
    await expect(inbox.locator('.support-inbox-message-log')).toContainText('<img src=x');
    await expect(inbox.locator('.support-inbox-message-log img')).toHaveCount(0);
    assert.equal(await page.evaluate(() => Boolean(window.supportInjected)), false);
    const textarea = inbox.getByLabel('Phản hồi của RunFurther');
    await expect(textarea).toHaveAttribute('maxlength', '4000');
    await expect(inbox.getByRole('button', { name: 'Gửi phản hồi' })).toBeDisabled();
    await textarea.fill('   ');
    await expect(inbox.getByRole('button', { name: 'Gửi phản hồi' })).toBeDisabled();
    const answer = 'Đã tiếp nhận. Bạn có thể xem vé trong tài khoản.\nRunFurther sẽ đồng hành cùng bạn.';
    await textarea.fill(answer);
    await inbox.locator('.support-ticket-row').nth(1).click();
    await expect(inbox.locator('.support-thread-heading h3')).toHaveText('Cần hỗ trợ vé 2');
    await expect(textarea).toHaveValue('');
    await inbox.locator('.support-ticket-row').first().click();
    await expect(inbox.locator('.support-thread-heading h3')).toHaveText('Cần hỗ trợ vé 1');
    await expect(textarea).toHaveValue(answer);
    await inbox.getByRole('button', { name: 'Gửi phản hồi' }).click();
    await expect(inbox.getByRole('alert')).toContainText('Phản hồi chưa được gửi');
    await expect(textarea).toHaveValue(answer);
    replyFails = false;
    await inbox.getByRole('button', { name: 'Gửi phản hồi' }).click();
    await expect(textarea).toBeDisabled();
    await expect(inbox.getByRole('button', { name: 'Đóng yêu cầu' })).toBeDisabled();
    await expect(inbox.getByRole('button', { name: 'Cần phản hồi', exact: true })).toBeDisabled();
    await expect.poll(() => typeof releaseReply).toBe('function');
    releaseReply();
    await expect(inbox.locator('.support-write-status')).toHaveText('Đã gửi phản hồi.');
    await expect(textarea).toHaveValue('');
    await expect(inbox.locator('.support-inbox-message-staff')).toContainText(answer);
    assert.equal(writes.filter(item => item.method === 'POST').length, 2, 'One failed send and one deliberate retry');
    assert.equal(writes.at(-1).body.message, answer);
    await inbox.getByRole('button', { name: 'Đã phản hồi', exact: true }).click();
    await expect(inbox.locator('.support-ticket-row')).toHaveCount(1);
    await inbox.locator('.support-ticket-row').click();
    await inbox.getByRole('button', { name: 'Đóng yêu cầu' }).click();
    await expect(inbox.locator('.support-write-status')).toHaveText('Đã đóng yêu cầu.');
    await expect(textarea).toHaveCount(0);
    await inbox.getByRole('button', { name: 'Đã đóng', exact: true }).click();
    await inbox.locator('.support-ticket-row').click();
    await inbox.getByRole('button', { name: 'Mở lại yêu cầu' }).click();
    await expect(inbox.locator('.support-write-status')).toHaveText('Đã mở lại yêu cầu.');
    await expect(textarea).toBeEnabled();
    assert.deepEqual(writes.filter(item => item.method === 'PATCH').map(item => item.body.status), ['CLOSED', 'OPEN']);
    await inbox.getByRole('button', { name: 'Cần phản hồi', exact: true }).click();
    await inbox.locator('.support-ticket-row').first().click();
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Support inbox overflow at ' + width);
      const pageCounter = await inbox.locator('.support-pagination span').boundingBox();
      assert.ok(pageCounter.height < 28, 'Pagination stays on one line, isolated from chat CSS at ' + width);
      const replyGap = await inbox.locator('.support-reply textarea').evaluate(node => node.nextElementSibling.getBoundingClientRect().top - node.getBoundingClientRect().bottom);
      assert.ok(replyGap >= 12, 'Reply actions have space below the textarea at ' + width);
    }
    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/support-inbox-mobile.png', fullPage: true });
    role = 'RUNNER';
    await page.goto(base + '/admin', { waitUntil: 'networkidle' });
    await expect(page.locator('.organizer-page').getByRole('alert')).toContainText('chỉ dành cho Super Admin');
    await expect(page.getByRole('button', { name: 'Hỗ trợ khách', exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: admin support inbox, list/detail retry, pagination, plain text, per-ticket drafts, failed/successful reply, busy guard, close/reopen, status filters, mobile layout and role gate (API fixtures only).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
