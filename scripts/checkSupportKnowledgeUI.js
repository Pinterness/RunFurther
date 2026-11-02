const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { seedArticles } = require('../src/backend/services/supportKnowledge');
const base = process.env.WEB_TEST_URL || 'http://localhost:3000';

// The "Tri thức trợ lý" tab against a fake API that answers in the JSON shapes of the knowledge routes
// (Task 5.1–5.3) and, like the server, refuses a write that does not name the article's current version.
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Ho_Chi_Minh' });
    const errors = [], dialogs = [], writes = [], previews = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
    let role = 'SUPER_ADMIN', holdWrites = false, releaseWrite = null, holdReads = false, releaseRead = null, clock = Date.parse('2026-11-02T03:00:00.000Z');
    const now = () => new Date(clock += 60000).toISOString();
    const admin = { fullName: 'Quản trị kiểm thử' }, seededAt = '2026-11-01T02:12:00.000Z';
    const CONTENT = ['title', 'terms', 'answer', 'sources', 'suggestions', 'priority'];
    const articles = seedArticles().map((item, index) => ({ _id: 'article-' + (index + 1), ...item, status: 'PUBLISHED', version: 0, createdAt: seededAt, updatedAt: seededAt, updatedBy: null, history: [] }));
    // Same rule as writeArticle: the content before a write goes to history, signed by whoever saved that content.
    function save(article, fields, by, at) {
      article.history.push({ ...Object.fromEntries(CONTENT.map(field => [field, article[field]])), status: article.status, changedBy: article.updatedBy, changedAt: article.updatedAt });
      Object.assign(article, fields, { version: article.version + 1, updatedBy: by, updatedAt: at });
    }
    const present = ({ history, ...article }) => ({ ...article, history: [...history].reverse() });
    const listRow = ({ _id, key, title, status, priority, version, updatedAt, updatedBy }) => ({ _id, key, title, status, priority, version, updatedAt, updatedBy });
    const hold = articles.find(article => article.key === 'hold'), seedHoldAnswer = hold.answer;
    save(hold, { answer: 'Giữ chỗ 12 phút.' }, { fullName: 'Quản trị A' }, '2026-11-01T07:05:00.000Z');
    save(hold, { answer: 'Giữ chỗ 15 phút.' }, { fullName: 'Quản trị B' }, '2026-11-01T08:30:00.000Z');

    await page.addInitScript(() => {
      localStorage.setItem('rf_token', 'knowledge-fixture-only');
      localStorage.setItem('rf_user', JSON.stringify({ id: 'admin', fullName: 'Quản trị kiểm thử', systemRole: 'SUPER_ADMIN' }));
    });
    const KNOWLEDGE = '/support/admin/knowledge';
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, ''), method = request.method();
      const reply = (data, status = 200) => route.fulfill({ status, json: data });
      const fail = (status, message, code) => reply({ message, code }, status);
      if (path === '/auth/me') return reply({ user: { id: 'admin', fullName: 'Quản trị kiểm thử', systemRole: role } });
      if (path === '/notifications') return reply({ notifications: [] });
      if (path === '/admin/platform/applications') return reply({ applications: [] });
      if (path === '/support/tickets') return reply({ tickets: [], total: 0, page: 1, totalPages: 0 });
      if (path === KNOWLEDGE || path.startsWith(KNOWLEDGE + '/')) {
        assert.equal(request.headers().authorization, 'Bearer knowledge-fixture-only');
        const body = method === 'GET' ? undefined : request.postDataJSON();
        if (path === KNOWLEDGE + '/preview' && method === 'POST') {
          previews.push(body);
          const draft = body.draft;
          return reply({ reply: draft ? draft.answer : 'Mình chưa có thông tin đã xác thực để trả lời câu hỏi này.', mode: 'guide', sources: draft?.sources || [], suggestions: draft?.suggestions || [] });
        }
        if (path === KNOWLEDGE) {
          if (method === 'GET') return reply({ articles: articles.map(listRow) });
          writes.push({ method, path, body });
          if (articles.some(article => article.key === body.key)) return fail(409, 'Mã bài đã tồn tại.', 'KNOWLEDGE_KEY_TAKEN');
          const at = now(), article = { _id: 'article-' + (articles.length + 1), key: body.key, ...Object.fromEntries(CONTENT.map(field => [field, body[field]])), status: 'DRAFT', version: 0, createdAt: at, updatedAt: at, updatedBy: admin, history: [] };
          articles.push(article);
          return reply({ article: present(article) }, 201);
        }
        const [, id, action] = path.slice(KNOWLEDGE.length).split('/'), article = articles.find(item => item._id === id);
        if (!article) return fail(404, 'Không tìm thấy bài tri thức.', 'KNOWLEDGE_NOT_FOUND');
        if (method === 'GET' && !action) {
          const view = present(article); // the article as it was when the read arrived
          if (holdReads) await new Promise(resolve => { releaseRead = resolve; });
          return reply({ article: view });
        }
        writes.push({ method, path, body });
        if (holdWrites) await new Promise(resolve => { releaseWrite = resolve; });
        if (!Number.isInteger(body?.version) || body.version < 0) return fail(400, 'Phiên bản bài không hợp lệ, hãy tải lại.', 'KNOWLEDGE_INVALID');
        if (body.version !== article.version) return fail(409, 'Bài đã được người khác sửa, hãy tải lại.', 'KNOWLEDGE_VERSION_CONFLICT');
        let fields = null;
        if (method === 'PUT' && !action) fields = Object.fromEntries(CONTENT.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
        if (method === 'POST' && action === 'publish') fields = { status: 'PUBLISHED' };
        if (method === 'POST' && action === 'unpublish') fields = { status: 'DRAFT' };
        if (method === 'POST' && action === 'restore') {
          const snapshot = article.history.findLast(item => item.changedAt === body.changedAt);
          if (!snapshot) return fail(404, 'Không tìm thấy bản cũ này.', 'KNOWLEDGE_SNAPSHOT_NOT_FOUND');
          fields = Object.fromEntries(CONTENT.map(field => [field, snapshot[field]]));
        }
        if (!fields) return fail(404, 'Route not found');
        save(article, fields, admin, now());
        return reply({ article: present(article) });
      }
      return route.fulfill({ status: 404, json: { message: 'Fixture does not implement ' + path } });
    });

    await page.goto(base + '/admin', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Tri thức trợ lý', exact: true }).click();
    const tab = page.locator('.knowledge-admin'), rows = tab.locator('.knowledge-row'), editor = tab.locator('.knowledge-editor');
    const status = editor.locator('.knowledge-write-status'), answer = editor.getByLabel('Câu trả lời', { exact: true });
    const saveButton = editor.getByRole('button', { name: 'Lưu', exact: true }), previewReply = editor.locator('.knowledge-preview-reply');

    // 1. The list shows the 11 seeded articles, who saved each one last ("Script nạp" when no admin has) and its status.
    await expect(rows).toHaveCount(11);
    await expect(rows.filter({ hasText: 'Đăng ký và đăng nhập' })).toContainText('Script nạp');
    await expect(rows.filter({ hasText: 'Giữ chỗ và đơn hết hạn' })).toContainText('Quản trị B');
    await expect(rows.filter({ hasText: 'Giữ chỗ và đơn hết hạn' })).toContainText('Đã xuất bản');

    // 2–3. A new article answers in "Xem thử" before it is saved; with no key yet the preview uses a temporary one.
    await tab.getByRole('button', { name: 'Thêm bài', exact: true }).click();
    await expect(editor.getByLabel('Tiêu đề')).toHaveAttribute('maxlength', '120');
    await expect(answer).toHaveAttribute('maxlength', '2000');
    await editor.getByLabel('Tiêu đề').fill('Đổi cỡ áo');
    await editor.getByLabel('Từ khóa').fill('đổi size áo\nđổi size');
    await answer.fill('Đổi cỡ áo tại quầy nhận kit.');
    await editor.getByLabel('Câu hỏi xem thử').fill('đổi size áo được không');
    await editor.getByRole('button', { name: 'Xem thử', exact: true }).click();
    await expect(previewReply).toHaveText('Đổi cỡ áo tại quầy nhận kit.');
    assert.deepEqual(previews.at(-1), { question: 'đổi size áo được không', draft: { key: 'ban-nhap', title: 'Đổi cỡ áo', terms: ['đổi size áo', 'đổi size'], answer: 'Đổi cỡ áo tại quầy nhận kit.', sources: [], suggestions: [], priority: 0 } });
    assert.equal(writes.length, 0, 'Xem thử saves nothing');
    // A key another article uses could never be saved, so "Xem thử" refuses it instead of answering for it.
    const previewCount = previews.length;
    await editor.getByLabel('Mã bài').fill('hold');
    await editor.getByRole('button', { name: 'Xem thử', exact: true }).click();
    await expect(editor.locator('.knowledge-preview').getByRole('alert')).toHaveText('Mã bài “hold” đã có bài khác dùng. Hãy đổi mã rồi xem thử lại.');
    await expect(previewReply).toHaveCount(0);
    assert.equal(previews.length, previewCount);
    await editor.getByLabel('Mã bài').fill('doi-co-ao');
    await editor.getByRole('button', { name: 'Xem thử', exact: true }).click();
    await expect(previewReply).toHaveText('Đổi cỡ áo tại quầy nhận kit.');
    assert.equal(previews.at(-1).draft.key, 'doi-co-ao');
    holdReads = true; // a read of the new article that answers after "Xuất bản" must not put version 0 back
    await saveButton.click();
    const shirtRow = rows.filter({ hasText: 'Đổi cỡ áo' });
    await expect(shirtRow).toContainText('Nháp');
    await expect(editor.locator('.knowledge-status')).toHaveText('Nháp');
    assert.deepEqual(writes.at(-1), { method: 'POST', path: KNOWLEDGE, body: { key: 'doi-co-ao', title: 'Đổi cỡ áo', terms: ['đổi size áo', 'đổi size'], answer: 'Đổi cỡ áo tại quầy nhận kit.', sources: [], suggestions: [], priority: 0 } });
    await expect(editor.getByLabel('Mã bài')).not.toBeEditable();

    // 4. Publishing names the version the page holds and flips the label in the editor and in the list.
    await editor.getByRole('button', { name: 'Xuất bản', exact: true }).click();
    await expect(editor.locator('.knowledge-status')).toHaveText('Đã xuất bản');
    await expect(shirtRow).toContainText('Đã xuất bản');
    assert.deepEqual(writes.at(-1).body, { version: 0 });
    holdReads = false; releaseRead?.();

    // 5. Another admin saves first: the page shows the server's 409 message, and "Tải lại bài" brings their version.
    const shirt = articles.find(article => article.key === 'doi-co-ao');
    save(shirt, { answer: 'Đổi cỡ áo tại quầy nhận kit, trước giờ chạy một tiếng.' }, { fullName: 'Quản trị khác' }, now());
    await answer.fill('Bản sửa của tôi.');
    await saveButton.click();
    await expect(editor.getByRole('alert')).toContainText('Bài đã được người khác sửa, hãy tải lại.');
    assert.equal(writes.at(-1).body.version, 1);
    await editor.getByRole('button', { name: 'Tải lại bài', exact: true }).click();
    await expect(answer).toHaveValue('Đổi cỡ áo tại quầy nhận kit, trước giờ chạy một tiếng.');
    await expect(editor.getByRole('alert')).toHaveCount(0);

    // While a save is on its way, nothing else can write.
    holdWrites = true;
    const payload = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    await answer.fill(payload);
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Gỡ xuất bản', exact: true })).toBeDisabled();
    await expect(tab.getByRole('button', { name: 'Thêm bài', exact: true })).toBeDisabled();
    await expect.poll(() => typeof releaseWrite).toBe('function');
    holdWrites = false; releaseWrite();
    await expect(status).toHaveText('Đã lưu.');
    assert.deepEqual(writes.at(-1).body, { title: 'Đổi cỡ áo', terms: ['đổi size áo', 'đổi size'], answer: payload, sources: [], suggestions: [], priority: 0, version: 2 });

    // 6. An answer with markup is shown as the same text: no element is created and no dialog opens.
    await editor.getByRole('button', { name: 'Xem thử', exact: true }).click();
    await expect(previewReply).toHaveText(payload);
    await expect(previewReply.locator('script, img')).toHaveCount(0);
    assert.equal(previews.at(-1).draft.key, 'doi-co-ao');

    // Unsaved edits are not dropped by opening another article.
    await editor.getByLabel('Tiêu đề').fill('Đổi cỡ áo (sửa dở)');
    await rows.filter({ hasText: 'Giữ chỗ và đơn hết hạn' }).click();
    await expect(tab.getByRole('status').filter({ hasText: 'chưa lưu' })).toBeVisible();
    await expect(editor.getByLabel('Tiêu đề')).toHaveValue('Đổi cỡ áo (sửa dở)');
    await editor.getByRole('button', { name: 'Hủy thay đổi', exact: true }).click();
    await expect(editor.getByLabel('Tiêu đề')).toHaveValue('Đổi cỡ áo');

    // 7. "Lịch sử" lists the older versions newest first; "Khôi phục" sends the chosen version's changedAt.
    await rows.filter({ hasText: 'Giữ chỗ và đơn hết hạn' }).click();
    await expect(answer).toHaveValue('Giữ chỗ 15 phút.');
    await editor.getByRole('button', { name: 'Lịch sử', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Lịch sử: Giữ chỗ và đơn hết hạn' }), snapshots = history.locator('.knowledge-snapshot');
    await expect(history).toContainText('Bản đang dùng: do Quản trị B lưu lúc 15:30 01/11/2026');
    await expect(snapshots).toHaveCount(2);
    await expect(snapshots.nth(0)).toContainText('Bản do Quản trị A lưu lúc 14:05 01/11/2026');
    await expect(snapshots.nth(1)).toContainText('Bản do Script nạp lưu lúc 09:12 01/11/2026');
    await snapshots.nth(1).getByRole('button', { name: 'Khôi phục', exact: true }).click();
    await expect(history).toContainText(seedHoldAnswer);
    const writesBeforeRestore = writes.length;
    await history.getByRole('button', { name: 'Xác nhận khôi phục', exact: true }).click();
    await expect(status).toHaveText('Đã khôi phục bản cũ.');
    await expect(answer).toHaveValue(seedHoldAnswer);
    await expect(history).toHaveCount(0);
    assert.equal(writes.length, writesBeforeRestore + 1);
    assert.deepEqual(writes.at(-1), { method: 'POST', path: KNOWLEDGE + '/' + hold._id + '/restore', body: { version: 2, changedAt: seededAt } });

    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/support-knowledge-desktop.png', fullPage: true });
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Knowledge tab overflow at ' + width);
    }
    await page.screenshot({ path: 'artifacts/support-knowledge-mobile.png', fullPage: true });
    role = 'RUNNER';
    await page.goto(base + '/admin', { waitUntil: 'networkidle' });
    await expect(page.locator('.organizer-page').getByRole('alert')).toContainText('chỉ dành cho Super Admin');
    await expect(page.getByRole('button', { name: 'Tri thức trợ lý', exact: true })).toHaveCount(0);
    // 8. No dialog and no uncaught error anywhere in the run.
    assert.deepEqual(dialogs, []);
    assert.deepEqual(errors, []);
    console.log('PASS: knowledge tab list, create as draft, preview before saving (a taken key refused), publish, 409 with reload, busy guard, markup as plain text, unsaved-edit guard, history and restore by changedAt, mobile layout and role gate (API fixtures only).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
