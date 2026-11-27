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
    const me = { profile: null, eligible: false, consentText: CONSENT, results: null };
    let pages = { 1: { profiles: [], page: 1, hasMore: false } };
    const details = {
      'nguoi-xss': { ...card('nguoi-xss', XSS, XSS), club: 'CLB Sông Hàn', results: { completedRaces: 4, totalKm: 62.2, bestTimes: { '5K': '0:25:30', '21K': '1:50:10' } } },
    };
    const puts = [], searches = [];
    let deletes = 0;
    // Công tắc lỗi giả: xóa lỗi 500, PUT hết phiên 401, tìm kiếm lỗi một lần, danh sách chậm rồi 401.
    let failDelete = false, put401 = false, failSearch = false, slowExpired = false;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        if (put401) return reply({ message: 'Phiên đăng nhập đã hết hạn.' }, 401);
        const body = request.postDataJSON(); puts.push(body);
        const created = !me.profile;
        me.profile = { handle: body.handle ?? me.profile?.handle ?? 'nguoi-chay-thu', bio: body.bio ?? me.profile?.bio ?? '', showClub: body.showClub ?? false, showResults: body.showResults ?? false, consentVersion: 'profile-v1', consentAt: '2026-11-16T03:00:00.000Z' };
        return reply({ profile: me.profile }, created ? 201 : 200);
      }
      if (path === '/community/me' && method === 'DELETE') {
        if (failDelete) return reply({ message: 'Chưa xóa được hồ sơ. Bạn thử lại nhé.' }, 500);
        deletes++; me.profile = null; return route.fulfill({ status: 204 });
      }
      if (path === '/community/profiles' && url.searchParams.get('q')) {
        const q = url.searchParams.get('q'); searches.push(q);
        if (failSearch) { failSearch = false; return reply({ message: 'Máy chủ đang bận.' }, 503); }
        return reply({ profiles: q === 'nguyen' ? [card('nguyen-van-a', 'Nguyễn Văn A')] : [], page: 1, hasMore: false });
      }
      if (path === '/community/profiles' && slowExpired) { await wait(1500); return reply({ message: 'Phiên đăng nhập đã hết hạn.' }, 401); }
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
    // Chưa có kết quả giải nào thì báo ngay cạnh ô "Hiện thành tích" (spec D1).
    await expect(page.getByText('Chưa có kết quả giải nào', { exact: false })).toBeVisible();
    const enable = page.getByRole('button', { name: 'Bật hồ sơ' });
    await expect(enable).toBeDisabled();
    await page.getByLabel('Lời giới thiệu').fill('Chạy sáng ven sông');
    await consent.check();
    await expect(enable).toBeEnabled();
    await enable.click();
    await expect(page.getByRole('link', { name: /\/community\/nguoi-chay-thu/ })).toBeVisible();
    assert.deepEqual(puts[0], { consentVersion: 'profile-v1', bio: 'Chạy sáng ven sông', showClub: false, showResults: false });
    // Nút vừa bấm biến mất, nên focus chuyển tới dòng thông báo thay vì rơi về đầu trang.
    await expect(page.getByRole('status')).toBeFocused();

    // Chỉ sửa lời giới thiệu thì không gửi handle (handle cũ có thể là dạng nay bị cấm).
    await page.getByLabel('Lời giới thiệu').fill('Đổi lời giới thiệu');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByRole('status')).toContainText('Đã lưu');
    assert.equal('handle' in puts[1], false, JSON.stringify(puts[1]));

    // Đổi handle sau khi bật: ô nhập có handle hiện tại, lưu thì gửi handle mới và link đổi theo.
    const handleInput = page.getByLabel('Tên hồ sơ trên đường dẫn');
    await expect(handleInput).toHaveValue('nguoi-chay-thu');
    await handleInput.fill('chay-cung-nam');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByRole('link', { name: /\/community\/chay-cung-nam/ })).toBeVisible();
    assert.equal(puts[2].handle, 'chay-cung-nam');
    assert.equal('consentVersion' in puts[2], false);

    // Tắt hồ sơ: hộp xác nhận; "Giữ lại" không gọi gì, "Xóa hồ sơ" gọi DELETE (trả 204) và quay về màn hình đồng ý.
    await page.getByRole('button', { name: 'Tắt và xóa hồ sơ cộng đồng' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Giữ lại' }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(deletes, 0);
    // Xóa lỗi: lỗi hiện ngay trong hộp (phần còn lại của trang đang bị che), hộp vẫn mở để thử lại.
    failDelete = true;
    await page.getByRole('button', { name: 'Tắt và xóa hồ sơ cộng đồng' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa hồ sơ' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Chưa xóa được hồ sơ');
    failDelete = false;
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa hồ sơ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Đã tắt và xóa hồ sơ cộng đồng');
    await expect(page.getByRole('status')).toBeFocused();
    await expect(page.getByLabel('Tôi đồng ý công khai hồ sơ')).not.toBeChecked();
    assert.equal(deletes, 1);

    // Có kết quả thì dòng xem trước kể đủ những gì sẽ hiện, cả thời gian tốt nhất.
    me.results = { completedRaces: 4, totalKm: 62.2, bestTimes: { '5K': '0:25:30', '21K': '1:50:10' } };
    await page.getByRole('button', { name: /Vé của tôi/ }).click();
    await tab.click();
    await expect(page.getByText('21K 1:50:10', { exact: false })).toBeVisible();

    // Chủ hồ sơ nay chưa đủ 16 tuổi: báo hồ sơ đang ẩn, không có form sửa, vẫn xóa được.
    me.profile = { handle: 'nguoi-chay-thu', bio: '', showClub: false, showResults: false, consentVersion: 'profile-v1', consentAt: '2026-11-16T03:00:00.000Z' };
    me.eligible = false;
    await page.getByRole('button', { name: /Vé của tôi/ }).click();
    await tab.click();
    await expect(page.getByText('đang ẩn', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tắt và xóa hồ sơ cộng đồng' })).toBeVisible();

    // Hết phiên giữa chừng trong tab: chuyển tới đăng nhập rồi quay lại đúng tab.
    me.eligible = true;
    await page.getByRole('button', { name: /Vé của tôi/ }).click();
    await tab.click();
    put401 = true;
    await page.getByLabel('Lời giới thiệu').fill('Lưu khi hết phiên');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%23community$/);
    put401 = false; me.profile = null;
    await page.evaluate(() => localStorage.setItem('rf_token', 'community-fixture-only'));

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

    await expect(page).toHaveTitle(/Cộng đồng/);

    // Tìm theo tên: gửi q, hiện kết quả; lỗi thì "Thử lại" gửi lại đúng từ khóa; không ai khớp thì báo và có nút xem lại tất cả.
    const searchBox = page.getByLabel('Tìm theo tên');
    failSearch = true;
    await searchBox.fill('nguyen');
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByRole('link', { name: /Nguyễn Văn A/ })).toHaveAttribute('href', '/community/nguyen-van-a');
    await expect(page.locator('.community-card')).toHaveCount(1);
    await searchBox.fill('khong co ai');
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await expect(page.getByText('Không tìm thấy người chạy nào', { exact: false })).toBeVisible();
    await expect(page.getByText('Chưa có ai bật hồ sơ cộng đồng')).toHaveCount(0);
    await page.getByRole('button', { name: 'Xem tất cả' }).click();
    await expect(page.locator('.community-card')).toHaveCount(1);
    await expect(searchBox).toHaveValue('');
    assert.deepEqual(searches, ['nguyen', 'nguyen', 'khong co ai']);

    // Phản hồi 401 về muộn sau khi người dùng đã sang trang khác: không bị kéo về trang đăng nhập.
    slowExpired = true;
    await page.goto(base + '/community');
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Tra cứu', exact: true }).click();
    await expect(page).toHaveURL(/\/lookup$/);
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(/\/lookup$/);
    slowExpired = false;
    await page.evaluate(() => localStorage.setItem('rf_token', 'community-fixture-only'));

    // Trang hồ sơ: chữ thuần, không có thẻ img mới, không chạy onerror.
    await page.goto(base + '/community/nguoi-xss');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(XSS);
    await expect(page.getByText('@nguoi-xss')).toBeVisible();
    await expect(page).toHaveTitle(/@nguoi-xss/);
    await expect(page.getByText('CLB Sông Hàn')).toBeVisible();
    await expect(page.getByText('tháng 01/2026', { exact: false })).toBeVisible();
    // Khối thành tích: chỉ số tổng hợp.
    const results = page.getByRole('region', { name: 'Thành tích' });
    await expect(results).toContainText('4');
    await expect(results).toContainText('62,2');
    await expect(results).toContainText('1:50:10');
    await expect(results).toContainText('Tốt nhất 21K');
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
    // Bốn tab của /account xếp 2 × 2: hai tab đầu cùng một hàng, hai tab sau cùng hàng dưới.
    // Đo vị trí thật vì luật lưới chung của .runner-tabs (3 cột) có thể đè lên và đẩy "Cộng đồng" xuống một mình.
    const tabs = await page.locator('.account-tabs button').evaluateAll(buttons => buttons.map(b => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), width: Math.round(r.width) }; }));
    assert.equal(tabs.length, 4);
    assert.ok(tabs[0].top === tabs[1].top && tabs[2].top === tabs[3].top && tabs[2].top > tabs[0].top, `tab không xếp 2 × 2: ${JSON.stringify(tabs)}`);
    assert.ok(tabs[3].width < 220, `tab Cộng đồng rộng ${tabs[3].width}px`);

    // Header có thêm mục "Cộng đồng": với tên người dùng dài, các bề rộng quanh 800px vẫn không cuộn ngang.
    await page.evaluate(() => localStorage.setItem('rf_user', JSON.stringify({ fullName: 'Nguyễn Hoàng Bảo Ngọc Trâm Anh', systemRole: 'RUNNER' })));
    await page.goto(base + '/community');
    await page.setViewportSize({ width: 801, height: 800 });
    // Đợi header hiện tên người dùng rồi mới đo; quét từng pixel quanh 800px vì chỗ tràn chỉ rộng chừng 10px.
    await expect(page.locator('.account-name')).toHaveText('Nguyễn Hoàng Bảo Ngọc Trâm Anh');
    for (let width = 801; width <= 1160; width += width < 830 ? 1 : 15) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `header ở ${width}px cuộn ngang ${overflow}px`);
    }

    assert.deepEqual(errors, []);
    console.log('PASS: khách chuyển tới /login, chưa đủ tuổi thấy giải thích, ô đồng ý không tick sẵn và khóa nút bật, PUT gửi profile-v1, focus về dòng thông báo, chỉ gửi handle khi đổi, đổi handle, xem trước thành tích đủ thời gian tốt nhất, hồ sơ đang ẩn khi chủ chưa đủ tuổi, hết phiên trong tab chuyển tới đăng nhập, tắt hồ sơ có hộp xác nhận, lỗi xóa hiện trong hộp và DELETE 204, danh sách trống, phân trang, tìm theo tên và "Thử lại" đúng từ khóa, 401 về muộn không kéo người đã rời trang, tiêu đề trang, HTML trong họ tên hiện là chữ, khối thành tích, 404, 400px không cuộn ngang và tab 2 × 2, header 801–1160px không cuộn ngang với tên dài (API giả).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
