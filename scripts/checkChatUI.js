// Kiểm giao diện trang /messages (P13, Task 13.2) trên web đang chạy (npm run dev:web). Mọi API là dữ liệu giả qua
// page.route nên không cần backend hay database; page.clock điều khiển đồng hồ để kiểm polling 5 giây.
// Chạy: node scripts/checkChatUI.js (WEB_TEST_URL để đổi địa chỉ, CHROME_PATH nếu không có Chrome cài sẵn).
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

const XSS = '<img src=x onerror="window.__chatXss=1">';
const person = (displayName, handle) => ({ displayName, avatarTheme: 'forest', handle });
const at = minutes => new Date(Date.UTC(2026, 10, 26, 3, minutes)).toISOString();

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Dữ liệu giả: c1 đang trò chuyện (có tin chưa đọc), c2 mình mời và đang chờ, c3 người khác mời mình.
    const conversations = {
      c1: { id: 'c1', status: 'ACTIVE', isRequester: true, other: person('Lê Phượng My', 'le-phuong-my'), lastMessageAt: at(42), unread: true },
      c2: { id: 'c2', status: 'REQUEST', isRequester: true, other: person('Vinh Quang', 'vinh-quang'), lastMessageAt: at(30), unread: false },
      c3: { id: 'c3', status: 'REQUEST', isRequester: false, other: person('Nguyễn Test', 'nguyen-test'), lastMessageAt: at(20), unread: true },
      c4: { id: 'c4', status: 'ACTIVE', isRequester: false, other: person('Trần Dài', 'tran-dai'), lastMessageAt: at(15), unread: false },
      c5: { id: 'c5', status: 'ACTIVE', isRequester: false, other: person('Phạm Chậm', 'pham-cham'), lastMessageAt: at(12), unread: false },
      c6: { id: 'c6', status: 'ACTIVE', isRequester: false, other: person('Đỗ Biến Mất', 'do-bien-mat'), lastMessageAt: at(11), unread: false },
    };
    const messages = {
      c1: [
        { seq: 1, mine: true, text: 'Chào bạn, mình cũng chạy 10K Hà Nội', createdAt: at(10), clientMessageId: '00000000-0000-4000-8000-000000000001' },
        { seq: 2, mine: false, text: XSS, createdAt: at(42) },
      ],
      c2: [{ seq: 1, mine: true, text: 'Bạn có muốn tập chung không?', createdAt: at(30), clientMessageId: '00000000-0000-4000-8000-000000000002' }],
      c3: [{ seq: 1, mine: false, text: 'Chào bạn, mình muốn hỏi về BIB 21K', createdAt: at(20) }],
      c4: Array.from({ length: 60 }, (_, i) => ({ seq: i + 1, mine: false, text: 'Tin số ' + (i + 1), createdAt: at(15) })),
      c5: [{ seq: 1, mine: false, text: 'Tin đầu của cuộc chậm', createdAt: at(12) }],
      c6: [{ seq: 1, mine: false, text: 'Cuộc sắp biến mất', createdAt: at(11) }],
    };
    // Cổng giữ request: request có tên cổng đang đóng phải chờ tới khi script gọi openGate.
    const gates = {};
    const closeGate = name => { let release; gates[name] = { promise: new Promise(resolve => { release = resolve; }), release }; };
    const openGate = name => { gates[name]?.release(); delete gates[name]; };
    const through = async name => { if (gates[name]) await gates[name].promise; };
    const lastMessage = id => { const last = messages[id][messages[id].length - 1]; return { seq: last.seq, mine: last.mine, text: last.text.slice(0, 120) }; };
    const posts = [], reads = [], polls = [], reports = [];
    // Công tắc hành vi giả của POST tin: 'ok' (chậm 600ms), 'overlap' (polling trả tin trước phản hồi POST),
    // 'network' (đứt mạng một lần), 'unavailable' (403).
    let sendMode = 'ok', pollExpired = false, pollDelivered = false;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (method === 'OPTIONS') return reply({});
      if (path === '/auth/me') return reply({ user: { _id: 'me', fullName: 'Người Chạy Thử', email: 'runner@test.local' } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/chat/me') return reply({ consent: true, consentText: { version: 'chat-v1', text: 'Văn bản mẫu' }, locked: false, eligible: true, realtime: false });
      if (path === '/chat/unread') return reply({ count: Object.values(conversations).filter(c => c.unread).length });
      if (path === '/chat/conversations' && method === 'GET') {
        const box = url.searchParams.get('box') || 'chats';
        // Chụp dữ liệu lúc request tới, để phản hồi bị giữ lại đúng là dữ liệu cũ.
        const snapshot = JSON.parse(JSON.stringify(Object.values(conversations).map(c => ({ ...c, lastMessage: lastMessage(c.id) }))));
        await through('list-' + box);
        const list = snapshot.filter(c => (box === 'invites' ? c.status === 'REQUEST' && !c.isRequester : c.status === 'ACTIVE' || c.isRequester));
        return reply({ conversations: list, hasMore: false });
      }
      const one = /^\/chat\/conversations\/([^/]+)$/.exec(path);
      if (one && method === 'GET') {
        const found = conversations[decodeURIComponent(one[1])];
        return found ? reply({ conversation: { ...found, lastMessage: lastMessage(found.id) } }) : reply({ message: 'Không tìm thấy cuộc trò chuyện.', code: 'CHAT_NOT_FOUND' }, 404);
      }
      const match = /^\/chat\/conversations\/(c\d)\/(messages|read|accept|decline|block|reports)$/.exec(path);
      if (match) {
        const [, id, action] = match;
        if (action === 'messages' && method === 'GET') {
          const after = url.searchParams.get('afterSeq'), before = url.searchParams.get('beforeSeq');
          if (after !== null) {
            polls.push({ id, after: Number(after), at: Date.now() });
            if (pollExpired) return reply({ message: 'Phiên đăng nhập đã hết hạn.' }, 401);
            if (id === 'c6') return reply({ message: 'Không tìm thấy cuộc trò chuyện.', code: 'CHAT_NOT_FOUND' }, 404);
            await through('poll-' + id);
            const list = messages[id].filter(m => m.seq > Number(after));
            if (list.length) pollDelivered = true;
            return reply({ messages: list, hasMore: false });
          }
          await through('initial-' + id);
          // Trang 50 tin như API thật: mới nhất, hoặc ngay trước beforeSeq.
          const pool = before === null ? messages[id] : messages[id].filter(m => m.seq < Number(before));
          return reply({ messages: pool.slice(-50), hasMore: pool.length > 50 });
        }
        if (action === 'messages' && method === 'POST') {
          const body = request.postDataJSON(); posts.push(body);
          if (sendMode === 'network') { sendMode = 'ok'; return route.abort('internetdisconnected'); }
          if (sendMode === 'unavailable') return reply({ message: 'Không gửi được tin.', code: 'CHAT_UNAVAILABLE' }, 403);
          if (sendMode === 'overlap') {
            sendMode = 'ok'; pollDelivered = false;
            const saved = { seq: messages[id].length + 1, mine: true, text: body.text, createdAt: at(50), clientMessageId: body.clientMessageId };
            messages[id].push(saved);
            for (let i = 0; i < 40 && !pollDelivered; i++) await wait(100);
            return reply({ message: saved }, 201);
          }
          await wait(600);
          const existing = messages[id].find(m => m.clientMessageId === body.clientMessageId);
          if (existing) return reply({ message: existing }, 200);
          const saved = { seq: messages[id].length + 1, mine: true, text: body.text, createdAt: at(50), clientMessageId: body.clientMessageId };
          messages[id].push(saved);
          return reply({ message: saved }, 201);
        }
        if (action === 'reports') { reports.push({ id, ...request.postDataJSON() }); return reply({ report: { id: 'r1', status: 'OPEN', reason: 'HARASSMENT' } }, 201); }
        if (action === 'read') { reads.push({ id, ...request.postDataJSON() }); conversations[id].unread = false; return route.fulfill({ status: 204 }); }
        if (action === 'accept') { conversations[id].status = 'ACTIVE'; return reply({ conversation: { ...conversations[id], lastMessage: lastMessage(id) } }); }
        if (action === 'decline') { conversations[id].status = 'DECLINED'; conversations[id].unread = false; return reply({ conversation: { ...conversations[id], lastMessage: lastMessage(id) } }); }
        if (action === 'block') { delete conversations[id]; return route.fulfill({ status: 204 }); }
      }
      return reply({ message: 'Không có dữ liệu giả cho ' + path }, 404);
    });

    // Khách chưa đăng nhập: chuyển tới /login, giữ đường quay lại.
    await page.goto(base + '/messages');
    await expect(page).toHaveURL(/\/login\?next=%2Fmessages$/);
    await page.evaluate(() => localStorage.setItem('rf_token', 'chat-fixture-only'));

    // Đồng hồ giả từ đây, để đếm polling chính xác.
    await page.clock.install({ time: new Date('2026-11-26T03:55:00Z') });
    await page.goto(base + '/messages');
    const tabChats = page.getByRole('tab', { name: 'Trò chuyện' }), tabInvites = page.getByRole('tab', { name: /Lời mời/ });
    await expect(tabChats).toHaveAttribute('aria-selected', 'true');
    await expect(tabInvites).toBeVisible();

    // Cuộc mình mời và đang chờ: thấy "Đang chờ chấp nhận", ô nhập bị khóa.
    await page.getByRole('link', { name: /Vinh Quang/ }).click();
    await expect(page.getByText('Đang chờ chấp nhận', { exact: false }).first()).toBeVisible();

    // Theo quy tắc Unslop của giao diện chung (U03, U08, U11): tab 14px, nhãn đầu trang viết câu thường từ 12px,
    // không còn mũi tên ký tự. Đọc textContent để tính cả nút quay về danh sách, nút này chỉ hiện trên điện thoại.
    const look = await page.evaluate(() => {
      const label = document.querySelector('main .section-index');
      return { tab: parseFloat(getComputedStyle(document.querySelector('.chat-tab')).fontSize), label: label.textContent, labelSize: parseFloat(getComputedStyle(label).fontSize), text: document.querySelector('main').textContent };
    });
    assert.ok(look.tab >= 14, `tab chỉ ${look.tab}px`);
    assert.ok(look.labelSize >= 12 && look.label !== look.label.toLocaleUpperCase('vi'), `nhãn đầu trang ${JSON.stringify([look.label, look.labelSize])}`);
    assert.doesNotMatch(look.text, /[↗←→]/, 'trang tin nhắn còn mũi tên ký tự');
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeDisabled();

    // Lời mời: có Chấp nhận / Từ chối / Chặn; chặn phải xác nhận ngay trong trang.
    await tabInvites.click();
    await page.getByRole('link', { name: /Nguyễn Test/ }).click();
    await expect(page.getByRole('button', { name: 'Chấp nhận' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Từ chối' })).toBeVisible();
    await page.getByRole('button', { name: 'Chặn', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Xác nhận chặn' })).toBeVisible();
    await page.getByRole('button', { name: 'Không chặn' }).click();
    await page.getByRole('button', { name: 'Chấp nhận' }).click();
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeEnabled();

    // Mở cuộc c1: tin XSS hiện ra là chữ, không chạy; đánh dấu đã đọc tới seq lớn nhất đang hiện.
    await tabChats.click();
    await page.getByRole('link', { name: /Lê Phượng My/ }).click();
    const log = page.getByRole('log');
    await expect(log.getByText(XSS)).toBeVisible();
    await expect(log.locator('img')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.__chatXss), undefined, 'tin nhắn không được chạy như HTML');
    await expect.poll(() => reads.filter(r => r.id === 'c1').map(r => r.upToSeq)).toContain(2);

    // Báo cáo (P15.2): chỉ tin của người kia có nút; phải chọn lý do mới gửi được; gửi đúng seq của tin được chọn;
    // gửi xong báo đã nhận, đóng hộp thì focus về lại nút "Báo cáo" của tin đó.
    const reportButtons = log.getByRole('button', { name: /^Báo cáo tin/ });
    await expect(reportButtons).toHaveCount(1);
    await reportButtons.click();
    const reportBox = log.getByRole('group', { name: 'Báo cáo tin của Lê Phượng My' });
    await expect(reportBox).toBeFocused();
    const sendReport = reportBox.getByRole('button', { name: 'Gửi báo cáo' });
    await expect(sendReport).toBeDisabled();
    await reportBox.getByRole('radio', { name: 'Quấy rối, xúc phạm' }).check();
    await reportBox.getByLabel('Ghi chú thêm (không bắt buộc)').fill('  Gửi đoạn mã lạ  ');
    if (process.env.CHAT_UI_SHOTS) await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/report-form.png' });
    // Dòng lý do báo cáo cao ít nhất 44px để dễ bấm (UX_UI_AUDIT_UNSLOP.md U03).
    const reasonHeight = await reportBox.locator('.chat-report-reasons label').first().evaluate(el => el.getBoundingClientRect().height);
    assert.ok(reasonHeight >= 44, `dòng lý do báo cáo chỉ cao ${reasonHeight}px`);
    await sendReport.click();
    await expect(reportBox.getByRole('status')).toContainText('Đã gửi báo cáo.');
    assert.deepEqual(reports, [{ id: 'c1', seq: 2, reason: 'HARASSMENT', note: 'Gửi đoạn mã lạ' }]);
    await reportBox.getByRole('button', { name: 'Đóng' }).click();
    await expect(reportBox).toHaveCount(0);
    await expect(reportButtons).toBeFocused();

    // Polling: 5 giây một lần khi khung mở và tab hiện; tab ẩn thì không gọi; hiện lại thì gọi ngay.
    const pollsOf = () => polls.filter(p => p.id === 'c1').length;
    const before = pollsOf();
    await page.clock.runFor(5000);
    await expect.poll(pollsOf).toBe(before + 1);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = pollsOf();
    await page.clock.runFor(20000);
    await wait(800);
    assert.equal(pollsOf(), hidden, 'tab ẩn thì không polling');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(pollsOf).toBe(hidden + 1);

    // Gửi: bấm đúp chỉ một POST; bong bóng "Đang gửi" rồi thành tin thật; polling trả lại đúng tin đó thì vẫn chỉ một bong bóng.
    const input = page.getByLabel('Nội dung tin nhắn'), send = page.getByRole('button', { name: 'Gửi', exact: true });
    await input.fill('Hẹn bạn 5 giờ ở cổng Trần Nhân Tông');
    await send.dblclick();
    await expect(page.getByText('Đang gửi')).toBeVisible();
    await page.clock.runFor(700);
    await expect(page.getByText('Đang gửi')).toHaveCount(0);
    assert.equal(posts.length, 1, 'bấm đúp chỉ gửi một lần');
    // Chỉ đếm trong khung tin: dòng xem trước bên danh sách cũng có câu này.
    await expect(log.getByText('Hẹn bạn 5 giờ ở cổng Trần Nhân Tông')).toHaveCount(1);
    // Polling và phản hồi gửi cùng trả một tin: polling tới trước khi POST trả lời, tin vẫn chỉ hiện một lần.
    sendMode = 'overlap';
    await input.fill('Tin tới hai đường');
    await send.click();
    await page.clock.runFor(5000);
    await expect.poll(() => pollDelivered).toBe(true);
    // Chờ POST trả lời (bong bóng tạm biến mất), thêm chút thời gian thật để phản hồi kịp gộp vào.
    await expect(page.getByText('Đang gửi')).toHaveCount(0, { timeout: 6000 });
    await wait(500);
    await expect(log.getByText('Tin tới hai đường')).toHaveCount(1);

    // Đứt mạng: hiện "Chưa gửi được" và nút "Gửi lại"; gửi lại dùng đúng clientMessageId cũ.
    sendMode = 'network';
    await input.fill('Mang theo BIB nha');
    await send.click();
    await expect(page.getByText('Chưa gửi được')).toBeVisible();
    await page.getByRole('button', { name: 'Gửi lại' }).click();
    await page.clock.runFor(700);
    await expect(page.getByText('Chưa gửi được')).toHaveCount(0);
    assert.equal(posts.at(-1).clientMessageId, posts.at(-2).clientMessageId, 'gửi lại phải dùng cùng clientMessageId');
    await expect(log.getByText('Mang theo BIB nha')).toHaveCount(1);

    // 403 CHAT_UNAVAILABLE: chỉ nói "Không gửi được tin.", không có chữ "chặn".
    sendMode = 'unavailable';
    await input.fill('Tin này không tới');
    await send.click();
    const refused = page.locator('.chat-compose [role="alert"]');
    await expect(refused).toHaveText('Không gửi được tin.');
    assert.doesNotMatch(await page.locator('.chat-compose').innerText(), /chặn/i, 'câu báo lỗi không được lộ chuyện bị chặn');
    sendMode = 'ok';

    // Ảnh chụp để người làm tự nhìn giao diện (chỉ khi đặt CHAT_UI_SHOTS=<thư mục>).
    if (process.env.CHAT_UI_SHOTS) {
      await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/chat-desktop.png' });
      await page.setViewportSize({ width: 400, height: 800 });
      await page.screenshot({ path: process.env.CHAT_UI_SHOTS + '/chat-mobile.png' });
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    // Điện thoại 400px: không cuộn ngang. Bàn phím: Tab đi tới ô nhập rồi nút gửi.
    await page.setViewportSize({ width: 400, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'không cuộn ngang ở 400px');
    await page.setViewportSize({ width: 1280, height: 900 });
    await input.focus();
    await input.fill('Kiểm tra bàn phím');
    await page.keyboard.press('Tab');
    await expect(send).toBeFocused();

    // Chữ tab đúng độ đậm thiết kế (khai báo font sai cú pháp từng làm trình duyệt bỏ cả dòng).
    assert.equal(await tabChats.evaluate(el => getComputedStyle(el).fontWeight), '600');

    // Mở cuộc từ danh sách: focus tới tên cuộc. Tải đầu còn chờ thì chưa polling (lastSeq = 0 sẽ kéo về tin cũ nhất).
    const pollsFor = id => polls.filter(p => p.id === id).length;
    closeGate('initial-c5');
    await page.getByRole('link', { name: /Phạm Chậm/ }).click();
    await expect(page.locator('#chat-thread-title')).toBeFocused();
    await page.clock.runFor(15000);
    await wait(500);
    assert.equal(pollsFor('c5'), 0, 'không polling trước khi tải đầu xong');
    openGate('initial-c5');
    await expect(log.getByText('Tin đầu của cuộc chậm')).toBeVisible();

    // Một chuỗi polling duy nhất: ẩn rồi hiện tab lúc một lần hỏi đang chờ thì không mở chuỗi thứ hai.
    closeGate('poll-c5');
    await page.clock.runFor(5000);
    await expect.poll(() => pollsFor('c5')).toBe(1);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    }
    await wait(500);
    assert.equal(pollsFor('c5'), 1, 'ẩn/hiện tab lúc đang hỏi không tạo thêm lần hỏi');
    openGate('poll-c5');
    await page.clock.runFor(5000);
    await expect.poll(() => pollsFor('c5')).toBe(2);
    await page.clock.runFor(5000);
    await expect.poll(() => pollsFor('c5')).toBe(3);

    // Polling gặp 404 (cuộc không còn) thì dừng hẳn.
    await page.getByRole('link', { name: /Đỗ Biến Mất/ }).click();
    await expect(log.getByText('Cuộc sắp biến mất')).toBeVisible();
    await page.clock.runFor(5000);
    await expect.poll(() => pollsFor('c6')).toBe(1);
    await page.clock.runFor(30000);
    await wait(500);
    assert.equal(pollsFor('c6'), 1, '404 thì dừng polling');

    // Xem tin cũ hơn: giữ nguyên chỗ đang xem, không nhảy xuống đáy.
    await page.getByRole('link', { name: /Trần Dài/ }).click();
    // Bong bóng có tiền tố ẩn "Trần Dài: " cho trình đọc màn hình, nên so phần cuối chữ.
    await expect(log.locator('.chat-bubble', { hasText: /Tin số 60$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Xem tin cũ hơn' }).click();
    await expect(log.locator('.chat-bubble', { hasText: /Tin số 1$/ })).toBeAttached();
    const scroll = await log.evaluate(el => ({ top: el.scrollTop, bottom: el.scrollHeight - el.clientHeight }));
    assert.ok(scroll.top < scroll.bottom - 100, 'xem tin cũ không được nhảy xuống đáy: ' + JSON.stringify(scroll));

    // Liên kết ?c=: mở được cuộc theo id; id không có thì báo rõ.
    await page.goto(base + '/messages?c=c4');
    await expect(page.locator('#chat-thread-title')).toHaveText('Trần Dài');
    await page.goto(base + '/messages?c=c9');
    await expect(page.getByText('Không tìm thấy cuộc trò chuyện này.')).toBeVisible();

    // Dữ liệu danh sách cũ về muộn không được ghi đè lời mời vừa chấp nhận; chấp nhận xong focus vào ô nhập.
    conversations.c7 = { id: 'c7', status: 'REQUEST', isRequester: false, other: person('Lý Mời Mới', 'ly-moi-moi'), lastMessageAt: at(48), unread: true };
    messages.c7 = [{ seq: 1, mine: false, text: 'Mình chạy cùng nhé', createdAt: at(48) }];
    await page.clock.runFor(30000);
    await tabInvites.click();
    await page.getByRole('link', { name: /Lý Mời Mới/ }).click();
    closeGate('list-invites');
    await page.clock.runFor(30000);
    await page.getByRole('button', { name: 'Chấp nhận' }).click();
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeEnabled();
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeFocused();
    openGate('list-invites');
    await wait(800);
    await expect(page.getByRole('button', { name: 'Chấp nhận' })).toHaveCount(0);
    await expect(page.getByLabel('Nội dung tin nhắn')).toBeEnabled();
    await tabChats.click();
    await page.getByRole('link', { name: /Lê Phượng My/ }).click();
    // Polling chỉ được hẹn sau khi tải đầu xong, nên chờ tin hiện ra rồi mới tua đồng hồ.
    await expect(log.locator('.chat-bubble', { hasText: /Mang theo BIB nha$/ })).toBeVisible();

    // 401 khi polling: dừng polling và chuyển tới /login giữ đường quay lại.
    pollExpired = true;
    await page.clock.runFor(5000);
    await expect(page).toHaveURL(/\/login\?next=%2Fmessages/);
    const afterExpired = polls.length;
    await page.clock.runFor(20000);
    assert.equal(polls.length, afterExpired, 'hết phiên thì dừng polling');

    assert.deepEqual(errors, [], 'không có lỗi JavaScript trên trang');
    console.log('checkChatUI: đạt', { posts: posts.length, reads: reads.length, polls: polls.length });
    await checkRealtime(browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Realtime (P14, Task 14.3): page.routeWebSocket đóng vai server Socket.IO (giao thức Engine.IO 4: gói mở "0{...}",
// CONNECT "40", sự kiện "42[...]"), API vẫn là dữ liệu giả. Kiểm: socket nối thì polling dừng; tín hiệu của khung đang
// mở thì lấy afterSeq ngay; tab ẩn thì đóng socket, hiện lại thì nối lại và lấy bù; đứt mà nối lại 5 lần không được
// thì quay về polling và thôi thử; realtime: false thì không mở socket.
async function checkRealtime(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const conversations = {
    c1: { id: 'c1', status: 'ACTIVE', isRequester: true, other: person('Lê Phượng My', 'le-phuong-my'), lastMessageAt: at(40), unread: false },
    c2: { id: 'c2', status: 'ACTIVE', isRequester: false, other: person('Vinh Quang', 'vinh-quang'), lastMessageAt: at(30), unread: false },
  };
  const messages = { c1: [{ seq: 1, mine: false, text: 'Tin đầu', createdAt: at(40) }], c2: [{ seq: 1, mine: false, text: 'Tin cuộc hai', createdAt: at(30) }] };
  const lastMessage = id => { const last = messages[id][messages[id].length - 1]; return { seq: last.seq, mine: last.mine, text: last.text }; };
  let realtime = true, refuse = false, lists = 0, failNextPoll = false;
  const polls = [], auths = [], sockets = [];
  const pollsOf = id => polls.filter(p => p === id).length;
  const openSockets = () => sockets.filter(s => s.open).length;

  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (method === 'OPTIONS') return reply({});
    if (path === '/auth/me') return reply({ user: { _id: 'me', fullName: 'Người Chạy Thử', email: 'runner@test.local' } });
    if (path === '/notifications') return reply({ notifications: [] });
    if (path === '/chat/me') return reply({ consent: true, consentText: { version: 'chat-v1', text: 'Văn bản mẫu' }, locked: false, eligible: true, realtime });
    if (path === '/chat/unread') return reply({ count: 0 });
    if (path === '/chat/conversations' && method === 'GET') {
      lists += 1;
      const box = url.searchParams.get('box') || 'chats';
      const list = box === 'invites' ? [] : Object.values(conversations).map(c => ({ ...c, lastMessage: lastMessage(c.id) }));
      return reply({ conversations: list, hasMore: false, realtime });
    }
    const one = /^\/chat\/conversations\/(c\d)$/.exec(path);
    if (one) return reply({ conversation: { ...conversations[one[1]], lastMessage: lastMessage(one[1]) } });
    const match = /^\/chat\/conversations\/(c\d)\/(messages|read)$/.exec(path);
    if (match && match[2] === 'read') return route.fulfill({ status: 204 });
    if (match && method === 'GET') {
      const after = url.searchParams.get('afterSeq');
      if (after === null) return reply({ messages: messages[match[1]], hasMore: false });
      polls.push(match[1]);
      if (failNextPoll) { failNextPoll = false; return reply({ message: 'Máy chủ đang khởi động lại.' }, 503); }
      return reply({ messages: messages[match[1]].filter(m => m.seq > Number(after)), hasMore: false });
    }
    return reply({ message: 'Không có dữ liệu giả cho ' + path }, 404);
  });

  // Server Socket.IO giả. refuse = true: nhận kết nối rồi im lặng, không gửi gói mở, giống Render đang ngủ giữ kết nối
  // lại; client chờ hết timeout 20 giây của Socket.IO rồi tính là một lần nối thất bại.
  await page.routeWebSocket(/\/socket\.io\//, ws => {
    const entry = { ws, open: true };
    sockets.push(entry);
    ws.onClose(() => { entry.open = false; });
    if (refuse) { entry.open = false; return; }
    ws.send('0' + JSON.stringify({ sid: 'engine-' + sockets.length, upgrades: [], pingInterval: 3600000, pingTimeout: 3600000, maxPayload: 1000000 }));
    ws.onMessage(message => {
      if (String(message).startsWith('40')) { auths.push(JSON.parse(String(message).slice(2) || '{}')); ws.send('40' + JSON.stringify({ sid: 'socket-' + sockets.length })); }
    });
  });
  const signal = payload => sockets.filter(s => s.open).at(-1).ws.send('42' + JSON.stringify(['chat:message', payload]));
  // Tua đồng hồ giả từng giây và chờ thật một chút giữa các bước: polling chỉ hẹn lượt sau khi phản hồi (đi theo thời
  // gian thật) đã về, nên tua một lần dài sẽ bỏ sót các lượt sau.
  const tick = async ms => { for (let done = 0; done < ms; done += 1000) { await page.clock.runFor(1000); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const setVisible = visible => page.evaluate(state => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); document.dispatchEvent(new Event('visibilitychange')); }, visible ? 'visible' : 'hidden');

  await page.goto(base + '/login');
  await page.evaluate(() => localStorage.setItem('rf_token', 'chat-fixture-only'));
  await page.clock.install({ time: new Date('2026-11-26T03:55:00Z') });
  await page.goto(base + '/messages?c=c1');
  const log = page.getByRole('log');
  await expect(log.locator('.chat-bubble', { hasText: /Tin đầu$/ })).toBeVisible();

  // Nối socket bằng đúng token, rồi polling 5 giây của khung và 30 giây của danh sách dừng.
  await expect.poll(() => auths.length).toBe(1);
  assert.deepEqual(auths[0], { token: 'chat-fixture-only' });
  await expect.poll(openSockets).toBe(1);
  await page.clock.runFor(1000);
  const quietPolls = polls.length, quietLists = lists;
  await tick(65000);
  assert.equal(polls.length, quietPolls, 'socket đang nối thì khung chat không polling');
  assert.equal(lists, quietLists, 'socket đang nối thì danh sách không tự làm mới 30 giây');

  // Tín hiệu của khung đang mở: lấy afterSeq ngay và hiện tin; danh sách làm mới.
  messages.c1.push({ seq: 2, mine: false, text: 'Tin tức thì', createdAt: at(41) });
  signal({ conversationId: 'c1', seq: 2 });
  await expect(log.locator('.chat-bubble', { hasText: /Tin tức thì$/ })).toBeVisible();
  await expect.poll(() => lists).toBeGreaterThan(quietLists);
  // Tín hiệu của cuộc khác: chỉ làm mới danh sách, không lấy tin của khung đang mở hay của cuộc kia.
  const beforeOther = { c1: pollsOf('c1'), c2: pollsOf('c2'), lists };
  messages.c2.push({ seq: 2, mine: false, text: 'Tin mới ở cuộc hai', createdAt: at(42) });
  signal({ conversationId: 'c2', seq: 2 });
  await expect.poll(() => lists).toBeGreaterThan(beforeOther.lists);
  assert.equal(pollsOf('c1'), beforeOther.c1);
  assert.equal(pollsOf('c2'), beforeOther.c2);

  // Lấy bù sau tín hiệu bị lỗi (Render đang khởi động lại): socket vẫn nối nên không có polling, trang phải tự thử lại.
  failNextPoll = true;
  messages.c1.push({ seq: 3, mine: false, text: 'Tin sau lỗi 503', createdAt: at(42) });
  signal({ conversationId: 'c1', seq: 3 });
  await expect.poll(() => failNextPoll).toBe(false);
  await tick(6000);
  await expect(log.locator('.chat-bubble', { hasText: /Tin sau lỗi 503$/ })).toBeVisible();

  // Server chủ động ngắt (admin tắt công tắc rồi bật lại): trang về polling, không bỏ cuộc; lần làm mới danh sách kế
  // tiếp báo realtime vẫn bật thì nối lại.
  const beforeKick = auths.length;
  sockets.filter(s => s.open).at(-1).ws.send('41');
  await expect.poll(openSockets).toBe(0);
  const kickedPolls = polls.length;
  await tick(10000);
  assert.ok(polls.length >= kickedPolls + 1, 'bị server ngắt thì polling chạy lại');
  await tick(31000);
  await expect.poll(() => auths.length).toBe(beforeKick + 1);
  await expect.poll(openSockets).toBe(1);

  // Tab ẩn thì đóng socket và không polling; hiện lại thì nối lại và lấy bù tin lỡ trong lúc ẩn.
  const beforeHide = auths.length;
  await setVisible(false);
  await expect.poll(openSockets).toBe(0);
  const hiddenPolls = polls.length;
  await tick(20000);
  assert.equal(polls.length, hiddenPolls, 'tab ẩn thì không polling');
  messages.c1.push({ seq: 4, mine: false, text: 'Tin lúc tab ẩn', createdAt: at(43) });
  await setVisible(true);
  await expect.poll(() => auths.length).toBe(beforeHide + 1);
  await expect(log.locator('.chat-bubble', { hasText: /Tin lúc tab ẩn$/ })).toBeVisible();
  await page.clock.runFor(1000);
  const liveAgain = polls.length;
  await tick(20000);
  assert.equal(polls.length, liveAgain, 'nối lại xong thì polling dừng lần nữa');

  // Mất kết nối và nối lại không được: thử tối đa 5 lần (mỗi lần chờ 20 giây, cộng thời gian lùi tối đa 7,5 giây),
  // trong lúc đó polling 5 giây đã chạy lại; hết 5 lần thì thôi thử nối.
  refuse = true;
  const beforeDrop = sockets.length;
  sockets.filter(s => s.open).at(-1).ws.close();
  for (let i = 0; i < 30; i++) await page.clock.runFor(5000);
  assert.equal(sockets.length - beforeDrop, 5, 'nối lại đúng 5 lần');
  const fallback = polls.length;
  await tick(20000);
  assert.ok(polls.length >= fallback + 3, 'mất socket thì polling 5 giây chạy lại: ' + (polls.length - fallback));
  await page.clock.runFor(60000);
  assert.equal(sockets.length - beforeDrop, 5, 'đã bỏ cuộc thì không thử nối nữa');

  // Công tắc tắt (realtime: false): không mở socket, chat chạy bằng polling.
  realtime = false; refuse = false;
  const beforeOff = sockets.length;
  await page.goto(base + '/messages?c=c1');
  await expect(log.locator('.chat-bubble', { hasText: /Tin đầu$/ })).toBeVisible();
  const offPolls = polls.length;
  await tick(16000);
  assert.equal(sockets.length, beforeOff, 'realtime tắt thì không mở socket');
  assert.ok(polls.length >= offPolls + 3, 'realtime tắt thì vẫn polling');

  assert.deepEqual(errors, [], 'không có lỗi JavaScript trên trang realtime');
  console.log('checkChatUI realtime: đạt', { sockets: sockets.length, polls: polls.length, lists });
  await page.close();
}
