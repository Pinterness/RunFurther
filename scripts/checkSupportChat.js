const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = [], chatBodies = [], ticketWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    let failChat = true, longReply = false, holdChat = false, releaseChat, ticket = null, failCreate = true, detailReads = 0, chatActions = null;
    // Nút "Chưa đúng" (Task 6.5): key bài server gửi kèm câu trả lời, và câu trả lời giả của POST /support/feedback.
    let chatArticleKeys = null, failFeedback = false, feedbackRecorded = true;
    const feedbackBodies = [];
    const now = '2030-06-01T09:30:00.000Z';
    const unsafeReply = 'Bạn có thể tra cứu BIB. <img src=x onerror="window.chatInjected=true">';
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ''), method = request.method();
      const reply = data => route.fulfill({ json: data });
      if (path === '/auth/me') return reply({ user: { id: 'runner', fullName: 'Người chạy thử', systemRole: 'RUNNER' } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/events') return reply({ events: [] });
      if (path === '/support/chat') {
        const body = request.postDataJSON(); chatBodies.push(body);
        assert.ok(body.history.length <= 10, 'Chat sends at most ten prior messages');
        assert.ok(body.history.every(item => ['user', 'assistant'].includes(item.role) && item.content.length <= 4000), 'History entries fit the backend schema');
        assert.ok(body.history.reduce((sum, item) => sum + item.content.length, 0) <= 16000, 'Long conversations remain inside the backend history budget');
        if (failChat) return route.fulfill({ status: 503, json: { message: 'Trợ lý đang bận. Bạn thử lại nhé.' } });
        if (holdChat) await new Promise(resolve => { releaseChat = resolve; });
        return reply({ reply: holdChat ? 'PHẢN HỒI RIÊNG TƯ CŨ' : longReply ? 'Hướng dẫn ' + chatBodies.length + '. ' + 'Thông tin mẫu. '.repeat(240) : unsafeReply, mode: 'guide', suggestions: ['Tìm cự ly phù hợp'], ...(chatActions ? { actions: chatActions } : {}), ...(chatArticleKeys ? { articleKeys: chatArticleKeys } : {}), sources: [
          { title: 'Tra cứu BIB', url: '/lookup' }, { title: 'External', url: 'https://outside.example.test' },
          { title: 'Protocol relative', url: '//outside.example.test' }, { title: 'Script', url: 'javascript:alert(1)' },
          { title: 'Backslash', url: '/\\outside.example.test' },
        ] });
      }
      if (path === '/support/feedback' && method === 'POST') {
        feedbackBodies.push(request.postDataJSON());
        if (failFeedback) return route.fulfill({ status: 503, json: { message: 'Chưa gửi được phản hồi. Bạn thử lại nhé.' } });
        return reply({ recorded: feedbackRecorded });
      }
      if (path === '/support/tickets' && method === 'GET') return reply({ tickets: ticket ? [{ ...ticket, messages: ticket.messages.slice(-1) }] : [], total: ticket ? 1 : 0, page: 1, totalPages: ticket ? 1 : 0 });
      if (path === '/support/tickets' && method === 'POST') {
        assert.equal(request.headers().authorization, 'Bearer chat-fixture-only');
        const body = request.postDataJSON(); ticketWrites.push({ path, body });
        if (failCreate) return route.fulfill({ status: 503, json: { message: 'Chưa gửi được yêu cầu. Hãy thử lại.' } });
        ticket = { _id: 'ticket-chat', subject: body.subject, status: 'OPEN', createdAt: now, updatedAt: now, messages: [{ role: 'customer', content: body.message, createdAt: now }] };
        return route.fulfill({ status: 201, json: { ticket } });
      }
      if (path === '/support/tickets/ticket-chat' && method === 'GET') { detailReads++; return reply({ ticket }); }
      if (path === '/support/tickets/ticket-chat/messages' && method === 'POST') {
        assert.equal(request.headers().authorization, 'Bearer chat-fixture-only');
        const body = request.postDataJSON(); ticketWrites.push({ path, body });
        ticket.messages.push({ role: 'customer', content: body.message, createdAt: now }); ticket.status = 'OPEN';
        return reply({ ticket });
      }
      return route.fulfill({ status: 404, json: { message: 'Fixture does not implement ' + path } });
    });

    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    const widget = page.locator('.support-widget'), panel = widget.locator('.support-panel');
    const launcher = widget.locator('.support-launcher'), question = widget.getByLabel('Câu hỏi của bạn');
    await launcher.click();
    await expect(panel).toBeVisible();
    await expect(widget.locator('#support-heading')).toBeFocused();
    await expect(widget.getByRole('button', { name: 'Gửi câu hỏi', exact: true })).toBeDisabled();
    // Dòng báo hàng chờ (Global Constraints của plan; Task 6.5 thay câu của Task 6.4 vì có thêm nút "Chưa đúng").
    await expect(widget.locator('.support-composer').getByText('Câu trợ lý chưa trả lời được, hoặc câu bạn báo “Chưa đúng”, sẽ được lưu không kèm tài khoản, đã che các dãy số, và tự xóa sau 30 ngày không có ai hỏi lại.', { exact: true })).toBeVisible();
    // Dòng báo AI (P08, Global Constraints): nói rõ ai được dùng AI, câu gì được gửi tới Google Gemini và Google được làm gì với nó.
    await expect(widget.locator('.support-composer').getByText('Khi bạn đã đăng nhập và hồ sơ cho thấy đủ 18 tuổi, câu hỏi chung (không gồm dữ liệu vé, ví, đơn) được gửi tới Google Gemini để viết câu trả lời. Google có thể dùng nội dung này để cải thiện sản phẩm, và người của Google có thể đọc. Đừng nhập họ tên, số điện thoại, thông tin sức khỏe hay thông tin cá nhân khác vào câu hỏi.', { exact: true })).toBeVisible();
    await expect(widget).not.toContainText('Câu hỏi có thể được xử lý bởi dịch vụ AI khi tính năng này được bật.');
    await question.fill('Tôi cần tìm BIB của mình');
    await question.press('Enter');
    await expect(widget.getByRole('alert')).toContainText('Trợ lý đang bận');
    await expect(widget.locator('.support-message-user')).toHaveCount(1);
    failChat = false;
    await widget.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(widget.locator('.support-message-assistant')).toHaveCount(1);
    await expect(widget.locator('.support-message-user')).toHaveCount(1);
    assert.deepEqual(chatBodies[0], chatBodies[1], 'Retry keeps the original prompt/history without duplicating the user message');
    await expect(widget.locator('.support-message-assistant')).toContainText(unsafeReply);
    await expect(widget.locator('.support-message-assistant img')).toHaveCount(0);
    assert.equal(await page.evaluate(() => Boolean(window.chatInjected)), false);
    await expect(widget.locator('.support-sources a')).toHaveCount(1);
    await expect(widget.locator('.support-sources a')).toHaveAttribute('href', '/lookup');
    await widget.locator('.support-sources a').click();
    await expect(page).toHaveURL(/\/lookup$/);
    await expect(panel).toHaveCount(0);
    await launcher.click();

    // Large answers remain usable across a longer conversation without sending oversized history.
    longReply = true;
    for (let index = 0; index < 6; index++) {
      await question.fill('Giải thích bước tiếp theo ' + index);
      await question.press('Enter');
      await expect(widget.locator('.support-message-assistant')).toHaveCount(index + 2);
    }
    assert.ok(chatBodies.at(-1).history.reduce((sum, item) => sum + item.content.length, 0) <= 16000);

    // Nút "Chưa đúng" chỉ hiện dưới câu trả lời có dùng bài (server gửi articleKeys). Bấm thì gửi lại đúng câu hỏi đã
    // tạo ra câu trả lời đó, cùng tối đa 2 key đúng dạng. Lỗi thì báo để thử lại; gửi xong thì nút đổi thành lời cảm ơn.
    await expect(widget.getByRole('button', { name: 'Chưa đúng', exact: true })).toHaveCount(0);
    chatArticleKeys = ['hold', 'Bad Key', 'payment', 'wallet'];
    await question.fill('Giữ chỗ được bao lâu?');
    await question.press('Enter');
    await expect(widget.locator('.support-message-assistant')).toHaveCount(8);
    // Locator của Playwright được tính lại mỗi lần dùng, nên chỉ đúng vị trí thay vì .last().
    const rated = widget.locator('.support-message-assistant').nth(7);
    failFeedback = true;
    await rated.getByRole('button', { name: 'Chưa đúng', exact: true }).click();
    await expect(rated.getByRole('alert')).toHaveText('Chưa gửi được phản hồi. Bạn thử lại nhé.');
    failFeedback = false;
    await rated.getByRole('button', { name: 'Chưa đúng', exact: true }).click();
    await expect(rated.getByRole('status')).toHaveText('Cảm ơn bạn. Admin sẽ xem lại câu trả lời này.');
    await expect(rated.getByRole('button', { name: 'Chưa đúng', exact: true })).toHaveCount(0);
    await expect(rated.getByRole('alert')).toHaveCount(0);
    const expectedFeedback = { question: 'Giữ chỗ được bao lâu?', articleKeys: ['hold', 'payment'] };
    assert.deepEqual(feedbackBodies, [expectedFeedback, expectedFeedback]);
    // Server không lưu câu (câu nhạy cảm, quá ngắn, hay hàng chờ đã đầy) thì khung chat nói đúng như vậy thay vì cảm ơn.
    // Server chỉ trả recorded: false mà không nói lý do, nên khung chat không được đoán là vì thông tin riêng tư.
    feedbackRecorded = false;
    await question.fill('Email tôi là a@b.test, giữ chỗ bao lâu?');
    await question.press('Enter');
    await expect(widget.locator('.support-message-assistant')).toHaveCount(9);
    const unrecorded = widget.locator('.support-message-assistant').nth(8);
    await unrecorded.getByRole('button', { name: 'Chưa đúng', exact: true }).click();
    await expect(unrecorded.getByRole('status')).toContainText('không được lưu');
    await expect(unrecorded.getByRole('status')).not.toContainText('riêng tư');
    // Câu trả lời trước vẫn giữ lời cảm ơn của nó.
    await expect(rated.getByRole('status')).toHaveText('Cảm ơn bạn. Admin sẽ xem lại câu trả lời này.');
    fs.mkdirSync('artifacts', { recursive: true });
    await panel.screenshot({ path: 'artifacts/support-chat-feedback.png' });
    chatArticleKeys = null; feedbackRecorded = true;

    // Nút của câu trả lời: chỉ hiện nút trỏ vào trang nội bộ hoặc vào tab hỗ trợ; bấm nút tab thì chuyển sang "Nhân viên hỗ trợ".
    chatActions = [{ label: 'Ví của tôi', url: '/account/wallet' }, { label: 'Lạ', url: 'https://x.example' }, { label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }];
    await question.fill('Ví của tôi còn bao nhiêu?');
    await question.press('Enter');
    await expect(widget.locator('.support-message-assistant')).toHaveCount(10);
    const firstActions = widget.locator('.support-message-assistant').last().locator('.support-actions');
    await expect(firstActions.locator('a, button')).toHaveCount(2);
    await expect(firstActions.getByRole('link', { name: 'Ví của tôi' })).toHaveAttribute('href', '/account/wallet');
    await expect(firstActions.getByText('Lạ', { exact: true })).toHaveCount(0);
    await expect(widget.locator('a[href^="https://x.example"]')).toHaveCount(0);
    await firstActions.getByRole('button', { name: 'Yêu cầu hỗ trợ của tôi' }).click();
    await expect(widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true })).toBeFocused();
    await expect(widget.locator('.support-ticket-guest')).toBeVisible();
    chatActions = null;

    await widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true }).click();
    await expect(widget.locator('.support-ticket-guest')).toBeVisible();
    await expect(widget.getByRole('link', { name: 'Đăng nhập để gửi yêu cầu' })).toHaveAttribute('href', '/login?next=%2Flookup');
    assert.equal(ticketWrites.length, 0, 'Guest opens the login prompt before any human-support submission');
    await page.evaluate(() => {
      localStorage.setItem('rf_token', 'chat-fixture-only');
      localStorage.setItem('rf_user', JSON.stringify({ id: 'runner', fullName: 'Người chạy thử', systemRole: 'RUNNER' }));
      window.dispatchEvent(new Event('rf-auth'));
    });
    await expect(widget.locator('.support-empty')).toBeVisible();
    await widget.getByRole('button', { name: 'Trợ lý nhanh', exact: true }).click();
    await expect(widget.locator('.support-message')).toHaveCount(0);
    await expect(question).toHaveValue('');
    await widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true }).click();
    await widget.locator('.support-new-ticket').click();
    await widget.getByLabel('Tiêu đề', { exact: true }).fill('Chưa thấy vé trong tài khoản');
    await widget.getByLabel('Nội dung cần hỗ trợ').fill('Nhờ kiểm tra đơn RF-TEST. <b>Thông tin dưới dạng văn bản.</b>');
    await widget.locator('.support-ticket-form button[type="submit"]').click();
    await expect(widget.getByRole('alert')).toContainText('Chưa gửi được yêu cầu');
    await expect(widget.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Chưa thấy vé trong tài khoản');
    failCreate = false;
    await widget.locator('.support-ticket-form button[type="submit"]').click();
    await expect(widget.locator('.support-ticket-title')).toHaveText('Chưa thấy vé trong tài khoản');
    await expect.poll(() => detailReads).toBeGreaterThan(0);
    await expect(widget.locator('.support-ticket-transcript')).toContainText('<b>Thông tin dưới dạng văn bản.</b>');
    await expect(widget.locator('.support-ticket-transcript b')).toHaveCount(0);
    ticket.messages.push({ role: 'support', content: 'Nhân viên đã kiểm tra và đang hỗ trợ bạn.', createdAt: now }); ticket.status = 'ANSWERED';
    await widget.getByRole('button', { name: 'Cập nhật', exact: true }).click();
    await expect(widget.locator('.support-ticket-transcript')).toContainText('Nhân viên đã kiểm tra');
    await widget.getByLabel('Bổ sung thông tin').fill('Tôi đã kiểm tra lại email.');
    await widget.getByRole('button', { name: 'Gửi bổ sung', exact: true }).click();
    await expect(widget.locator('.support-ticket-transcript')).toContainText('Tôi đã kiểm tra lại email.');
    await expect(widget.getByLabel('Bổ sung thông tin')).toHaveValue('');
    assert.equal(ticketWrites.filter(item => item.path.endsWith('/messages')).length, 1);
    await widget.getByRole('button', { name: '← Yêu cầu của bạn', exact: true }).click();
    await widget.locator('.support-ticket-list button').first().click();
    await expect(widget.locator('.support-ticket-transcript .support-message')).toHaveCount(3);
    ticket.status = 'CLOSED';
    await widget.getByRole('button', { name: 'Cập nhật', exact: true }).click();
    await expect(widget.locator('.support-closed')).toBeVisible();
    await expect(widget.getByLabel('Bổ sung thông tin')).toHaveCount(0);

    // Đang xem chi tiết một yêu cầu mà bấm nút tab hỗ trợ trong câu trả lời thì về danh sách yêu cầu, không kẹt ở chi tiết cũ.
    await widget.getByRole('button', { name: 'Trợ lý nhanh', exact: true }).click();
    chatActions = [{ label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' }];
    await question.fill('Yêu cầu hỗ trợ của tôi');
    await question.press('Enter');
    await widget.locator('.support-message-assistant').last().getByRole('button', { name: 'Yêu cầu hỗ trợ của tôi' }).click();
    await expect(widget.locator('.support-ticket-list')).toBeVisible();
    await expect(widget.locator('.support-ticket-title')).toHaveCount(0);

    // Nút "Gửi yêu cầu hỗ trợ" mở thẳng form gửi yêu cầu mới, đúng như tên nút, và form gợi ý dùng câu hỏi vừa hỏi bot.
    await widget.getByRole('button', { name: 'Trợ lý nhanh', exact: true }).click();
    chatActions = [{ label: 'Gửi yêu cầu hỗ trợ', view: 'new-ticket' }];
    await question.fill('Ví của tôi bị khóa thì làm sao');
    await question.press('Enter');
    await widget.locator('.support-message-assistant').last().getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }).click();
    await expect(widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true })).toBeFocused();
    await expect(widget.getByLabel('Tiêu đề', { exact: true })).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Dùng câu hỏi gần nhất' })).toBeVisible();
    await expect(widget.locator('.support-ticket-list')).toHaveCount(0);
    chatActions = null;

    // Authentication changes abort old requests and erase private conversation state.
    await widget.getByRole('button', { name: 'Trợ lý nhanh', exact: true }).click();
    holdChat = true;
    await question.fill('Câu hỏi riêng tư trước khi đăng xuất');
    await question.press('Enter');
    await expect(widget.locator('.support-typing')).toBeVisible();
    await expect.poll(() => typeof releaseChat).toBe('function');
    await page.evaluate(() => { localStorage.removeItem('rf_token'); localStorage.removeItem('rf_user'); window.dispatchEvent(new Event('rf-auth')); });
    releaseChat();
    await expect(widget.locator('.support-message')).toHaveCount(0);
    await expect(widget.locator('.support-typing')).toHaveCount(0);
    await page.waitForTimeout(250);
    await expect(widget).not.toContainText('PHẢN HỒI RIÊNG TƯ CŨ');
    await widget.getByRole('button', { name: 'Nhân viên hỗ trợ', exact: true }).click();
    await expect(widget.locator('.support-ticket-guest')).toBeVisible();
    await expect(widget.locator('.support-ticket-title')).toHaveCount(0);

    holdChat = false; longReply = true;
    await widget.getByRole('button', { name: 'Trợ lý nhanh', exact: true }).click();
    await question.fill('Cho tôi một hướng dẫn dài để đọc');
    await question.press('Enter');
    await expect(widget.locator('.support-message-assistant')).toHaveCount(1);
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width <= 390 ? 667 : 950 });
      const box = await panel.boundingBox(), viewport = page.viewportSize();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'Widget stays inside the viewport at ' + width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal page overflow at ' + width);
      const composer = await widget.locator('.support-composer').boundingBox();
      assert.ok(composer.y >= box.y && composer.y + composer.height <= box.y + box.height + 1, 'Composer remains inside the panel at ' + width);
      const gap = await widget.locator('.support-composer textarea').evaluate(node => node.nextElementSibling.getBoundingClientRect().left - node.getBoundingClientRect().right);
      assert.ok(gap >= 8, 'Send button is separated from the textarea at ' + width);
    }
    const transcript = widget.locator('.support-transcript');
    await transcript.evaluate(node => { node.scrollTop = 0; });
    const beforeScroll = await page.evaluate(() => scrollY);
    const transcriptBox = await transcript.boundingBox();
    await page.mouse.move(transcriptBox.x + transcriptBox.width / 2, transcriptBox.y + transcriptBox.height / 2);
    await page.mouse.wheel(0, 280);
    await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBeGreaterThan(10);
    assert.equal(await page.evaluate(() => scrollY), beforeScroll, 'Scrolling chat history does not move the page');
    await transcript.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => scrollY), beforeScroll, 'Overscrolling chat history does not leak to the page');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(launcher).toBeFocused();
    fs.mkdirSync('artifacts', { recursive: true });
    await launcher.click();
    await page.screenshot({ path: 'artifacts/support-chat-mobile.png' });

    // Nguồn trùng địa chỉ với một nút thì không hiện lại; bấm nút dẫn trang thì sang đúng trang đó và khung chat đóng lại.
    chatActions = [{ label: 'Tra cứu BIB', url: '/lookup' }, { label: 'Ví của tôi', url: '/account/wallet' }];
    await question.fill('Ví của tôi còn bao nhiêu?');
    await question.press('Enter');
    await expect(widget.locator('.support-message-assistant')).toHaveCount(2);
    const lastAnswer = widget.locator('.support-message-assistant').last();
    await expect(lastAnswer.locator('.support-actions a')).toHaveCount(2);
    await expect(lastAnswer.locator('.support-sources')).toHaveCount(0);
    await lastAnswer.getByRole('link', { name: 'Ví của tôi' }).click();
    await expect(page).toHaveURL(/\/account\/wallet$/);
    await expect(panel).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS: unanswered-queue notice, "Chưa đúng" feedback (only on article answers, question and valid keys sent, retry on error, thanks or not-saved status), guest chat/retry, bounded history, text-only answers/internal links, action buttons (internal links, support list and new-request form, duplicate sources hidden), auth reset/stale response guard, human ticket create/detail/reply/closed, mobile fit, isolated wheel and Escape focus (API fixtures only).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
