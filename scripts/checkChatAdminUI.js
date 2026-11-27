// Kiểm giao diện trang /admin/messages (P15.2): hàng chờ báo cáo tin nhắn của Super Admin, trên web đang chạy
// (npm run dev:web). Mọi API là dữ liệu giả qua page.route nên không cần backend hay database.
// Chạy: node scripts/checkChatAdminUI.js (WEB_TEST_URL để đổi địa chỉ, CHROME_PATH nếu không có Chrome cài sẵn,
// CHAT_UI_SHOTS=<thư mục> để chụp ảnh).
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

const XSS = '<img src=x onerror="window.__adminXss=1">';
const at = minutes => new Date(Date.UTC(2026, 10, 26, 3, minutes)).toISOString();
const person = (displayName, locked) => ({ displayName, avatarTheme: 'forest', ...(locked === undefined ? {} : { locked }) });

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Dữ liệu giả: r1 tin quấy rối (có mã HTML), r2 tin lừa đảo, r3 đã bị người khác xử lý (resolve trả 409).
    const reports = {
      r1: { id: 'r1', reason: 'HARASSMENT', note: 'Nhắn liên tục lúc nửa đêm', status: 'OPEN', createdAt: at(40), message: { seq: 2, text: XSS, sentAt: at(30) }, reporter: person('Lê Phượng My'), reported: person('Kẻ Quấy Rối', false) },
      r2: { id: 'r2', reason: 'SCAM', note: '', status: 'OPEN', createdAt: at(35), message: { seq: 5, text: 'Chuyển khoản 500k để giữ BIB nhé', sentAt: at(20) }, reporter: person('Vinh Quang'), reported: person('Người Bán BIB', false) },
      r3: { id: 'r3', reason: 'SPAM', note: '', status: 'OPEN', createdAt: at(10), message: { seq: 1, text: 'Mua giày giảm giá', sentAt: at(5) }, reporter: person('Nguyễn Test'), reported: person('Shop Giày', false) },
    };
    let role = 'SUPER_ADMIN', forbidden = false, r3Conflict = true;
    const lists = [], actions = [];
    const gates = {};
    const closeGate = name => { let release; gates[name] = { promise: new Promise(resolve => { release = resolve; }), release }; };
    const openGate = name => { gates[name]?.release(); delete gates[name]; };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    // Chỉ tìm trong trang: Next có vùng thông báo chuyển trang cũng mang role="alert".
    const alert = page.locator('.chat-shell [role="alert"]'), notice = page.locator('.chat-shell .notice[role="status"]');

    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (method === 'OPTIONS') return reply({});
      if (path === '/auth/me') return reply({ user: { _id: 'admin', fullName: 'Quản Trị', email: 'admin@test.local', systemRole: role } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/chat/admin/reports' && method === 'GET') {
        const status = url.searchParams.get('status');
        lists.push(status);
        // Chụp dữ liệu lúc request tới, để phản hồi bị giữ lại đúng là dữ liệu cũ.
        const snapshot = JSON.parse(JSON.stringify(Object.values(reports).filter(r => r.status === status)));
        if (gates['list-' + status]) await gates['list-' + status].promise;
        if (forbidden) return reply({ message: 'Bạn không có quyền.' }, 403);
        return reply({ reports: snapshot });
      }
      const resolve = /^\/chat\/admin\/reports\/(r\d)\/resolve$/.exec(path);
      if (resolve && method === 'POST') {
        const { action } = request.postDataJSON(), report = reports[resolve[1]];
        actions.push({ id: report.id, action });
        if (gates['resolve-' + report.id]) await gates['resolve-' + report.id].promise;
        if (report.id === 'r3' && r3Conflict) { r3Conflict = false; return reply({ message: 'Báo cáo này đã được xử lý.', code: 'CHAT_REPORT_HANDLED' }, 409); }
        report.status = action === 'LOCK' ? 'LOCKED' : 'DISMISSED';
        report.reported.locked = action === 'LOCK';
        return reply({ report: { id: report.id, status: report.status } });
      }
      const unlock = /^\/chat\/admin\/members\/(r\d)\/unlock$/.exec(path);
      if (unlock && method === 'POST') {
        actions.push({ id: unlock[1], action: 'UNLOCK' });
        reports[unlock[1]].reported.locked = false;
        return route.fulfill({ status: 204 });
      }
      return reply({ message: 'Không có dữ liệu giả cho ' + path }, 404);
    });

    // Khách chưa đăng nhập: chuyển tới /login, giữ đường quay lại.
    await page.goto(base + '/admin/messages');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fmessages$/);
    await page.evaluate(() => localStorage.setItem('rf_token', 'admin-fixture-only'));

    // Người dùng thường: báo không có quyền và không hỏi hàng chờ.
    role = 'USER';
    await page.goto(base + '/admin/messages');
    await expect(alert).toHaveText('Khu vực này chỉ dành cho Super Admin.');
    await wait(500);
    assert.deepEqual(lists, [], 'người không phải Super Admin không được gọi API hàng chờ');

    // Super Admin: hàng chờ "Đang chờ" có tên hai bên, lý do, ghi chú, bản chụp tin (mã HTML hiện thành chữ), không email.
    role = 'SUPER_ADMIN';
    await page.goto(base + '/admin/messages');
    const panel = page.getByRole('tabpanel', { name: 'Đang chờ' });
    const item = name => panel.getByRole('listitem').filter({ hasText: name });
    await expect(page.getByRole('tab', { name: 'Đang chờ' })).toHaveAttribute('aria-selected', 'true');
    await expect(item('Kẻ Quấy Rối')).toContainText('Lê Phượng My báo cáo Kẻ Quấy Rối');
    await expect(item('Kẻ Quấy Rối')).toContainText('Quấy rối, xúc phạm · Nhắn liên tục lúc nửa đêm');
    await expect(item('Kẻ Quấy Rối').getByText(XSS)).toBeVisible();
    await expect(panel.locator('img')).toHaveCount(0);
    // Nhãn đầu trang theo quy tắc Unslop (U03, U08): viết câu thường, tối thiểu 12px.
    const label = await page.locator('main .section-index').evaluate(el => ({ text: el.textContent, size: parseFloat(getComputedStyle(el).fontSize) }));
    assert.ok(label.size >= 12 && label.text !== label.text.toLocaleUpperCase('vi'), `nhãn đầu trang ${JSON.stringify(label)}`);
    assert.equal(await page.evaluate(() => window.__adminXss), undefined, 'bản chụp tin không được chạy như HTML');
    await expect(item('Người Bán BIB')).toContainText('Lừa đảo, đòi chuyển tiền');
    assert.doesNotMatch(await panel.innerText(), /@/, 'hàng chờ không hiện email');
    // Giờ theo Việt Nam: tin gửi 03:30 UTC hiện 10:30.
    await expect(item('Kẻ Quấy Rối')).toContainText('Tin gửi lúc 10:30');

    // Ảnh chụp để người làm tự nhìn giao diện (chỉ khi đặt CHAT_UI_SHOTS=<thư mục>): hàng chờ đủ ba báo cáo, một báo cáo
    // đang mở bước xác nhận khóa. "Không khóa" để trả trang về như cũ, không gửi request nào.
    if (process.env.CHAT_UI_SHOTS) {
      await item('Người Bán BIB').getByRole('button', { name: 'Khóa nhắn tin' }).click();
      await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/admin-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 400, height: 800 });
      await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/admin-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await item('Người Bán BIB').getByRole('button', { name: 'Không khóa' }).click();
    }

    // "Bỏ qua": gửi DISMISS, báo đã bỏ qua, tải lại hàng chờ nên báo cáo rời khỏi mục "Đang chờ".
    await item('Kẻ Quấy Rối').getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(notice).toHaveText('Đã bỏ qua báo cáo.');
    await expect(item('Kẻ Quấy Rối')).toHaveCount(0);
    assert.deepEqual(actions.at(-1), { id: 'r1', action: 'DISMISS' });

    // "Khóa nhắn tin" phải xác nhận ngay trong trang; "Không khóa" thì không gửi gì.
    const sentBefore = actions.length;
    await item('Người Bán BIB').getByRole('button', { name: 'Khóa nhắn tin' }).click();
    const confirm = item('Người Bán BIB').getByRole('group', { name: /Khóa quyền nhắn tin của Người Bán BIB\?/ });
    await expect(confirm).toBeFocused();
    await expect(confirm).toContainText('vẫn mua vé và dùng ví');
    await confirm.getByRole('button', { name: 'Không khóa' }).click();
    await expect(confirm).toHaveCount(0);
    assert.equal(actions.length, sentBefore, '"Không khóa" không được gửi request');
    await item('Người Bán BIB').getByRole('button', { name: 'Khóa nhắn tin' }).click();
    await confirm.getByRole('button', { name: 'Xác nhận khóa' }).click();
    await expect(notice).toHaveText('Đã khóa nhắn tin của Người Bán BIB.');
    assert.deepEqual(actions.at(-1), { id: 'r2', action: 'LOCK' });

    // Báo cáo đã bị admin khác xử lý (409): hiện lỗi của server, báo cáo vẫn nằm đó.
    await item('Shop Giày').getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(alert).toHaveText('Báo cáo này đã được xử lý.');

    // Mục "Đã khóa": có "Bỏ khóa"; bỏ khóa xong hiện "Đã bỏ khóa." và không còn nút.
    await page.getByRole('tab', { name: 'Đã khóa' }).click();
    const lockedPanel = page.getByRole('tabpanel', { name: 'Đã khóa' });
    await expect(alert).toHaveCount(0);
    await lockedPanel.getByRole('button', { name: 'Bỏ khóa' }).click();
    await expect(notice).toHaveText('Đã bỏ khóa nhắn tin của Người Bán BIB.');
    await expect(lockedPanel.getByText('Đã bỏ khóa.')).toBeVisible();
    await expect(lockedPanel.getByRole('button', { name: 'Bỏ khóa' })).toHaveCount(0);
    assert.deepEqual(actions.at(-1), { id: 'r2', action: 'UNLOCK' });

    // Đổi tab nhanh: phản hồi cũ của "Đang chờ" về sau không được đè lên danh sách "Đã bỏ qua".
    closeGate('list-OPEN');
    await page.getByRole('tab', { name: 'Đang chờ' }).click();
    await page.getByRole('tab', { name: 'Đã bỏ qua' }).click();
    const dismissedPanel = page.getByRole('tabpanel', { name: 'Đã bỏ qua' });
    await expect(dismissedPanel.getByText('Lê Phượng My báo cáo Kẻ Quấy Rối')).toBeVisible();
    openGate('list-OPEN');
    await wait(800);
    await expect(dismissedPanel.getByText('Shop Giày')).toHaveCount(0);
    await expect(dismissedPanel.getByText('Lê Phượng My báo cáo Kẻ Quấy Rối')).toBeVisible();

    // Đổi tab lúc "Bỏ qua" còn chờ server (lần này server nhận): tải lại sau thao tác phải theo tab đang mở
    // ("Đã khóa"), không theo tab lúc bấm.
    await page.getByRole('tab', { name: 'Đang chờ' }).click();
    closeGate('resolve-r3');
    await item('Shop Giày').getByRole('button', { name: 'Bỏ qua' }).click();
    await page.getByRole('tab', { name: 'Đã khóa' }).click();
    const lockedAgain = page.getByRole('tabpanel', { name: 'Đã khóa' });
    await expect(lockedAgain.getByText('Vinh Quang báo cáo Người Bán BIB')).toBeVisible();
    openGate('resolve-r3');
    await wait(800);
    await expect(lockedAgain.getByText('Shop Giày')).toHaveCount(0);
    await expect(lockedAgain.getByText('Vinh Quang báo cáo Người Bán BIB')).toBeVisible();

    // Điện thoại 400px: không cuộn ngang.
    await page.setViewportSize({ width: 400, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'không cuộn ngang ở 400px');
    await page.setViewportSize({ width: 1280, height: 900 });

    // Bị hạ quyền giữa chừng (API trả 403): báo không có quyền, ẩn hàng chờ.
    forbidden = true;
    await page.getByRole('tab', { name: 'Đã bỏ qua' }).click();
    await expect(alert).toHaveText('Khu vực này chỉ dành cho Super Admin.');
    await expect(page.getByRole('tablist')).toHaveCount(0);

    assert.deepEqual(errors, [], 'không có lỗi JavaScript trên trang');
    console.log('checkChatAdminUI: đạt', { lists: lists.length, actions: actions.length });
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
