// Super Admin teaches the support bot: list, create and edit knowledge articles. Every save names the
// version it started from, so two admins never silently overwrite each other.
// Runs against an in-memory MongoDB replica set (tests/helpers).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-admin-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const { seedSupportKnowledge } = require('../../scripts/seedSupportKnowledge');
const { loadPublishedArticles, clearKnowledgeCache } = require('../../src/backend/services/supportKnowledgeStore');
const { createSupportResponder } = require('../../src/backend/services/supportAiService');
const { createArticle, updateArticle, setArticleStatus, restoreArticle, previewAnswer } = require('../../src/backend/services/supportKnowledgeAdmin');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_admin' });
const { request } = harness;
const KNOWLEDGE = '/support/admin/knowledge';
const article = key => SupportArticle.findOne({ key }).lean();
let admin, runner;

before(async () => {
  await harness.start();
  await seedSupportKnowledge({ apply: true });
  clearKnowledgeCache();
  admin = await harness.createUser({ role: 'SUPER_ADMIN' });
  runner = await harness.createUser();
});
after(harness.stop);

// The two tests below count the 11 seed articles, so they run before any test creates one.
test('RUNNER gets 403 on knowledge admin routes, and there is no delete route', async () => {
  const hold = await article('hold');
  const routes = [['GET', KNOWLEDGE], ['POST', KNOWLEDGE], ['POST', `${KNOWLEDGE}/preview`], ['GET', `${KNOWLEDGE}/${hold._id}`], ['PUT', `${KNOWLEDGE}/${hold._id}`],
    ...['publish', 'unpublish', 'restore'].map(action => ['POST', `${KNOWLEDGE}/${hold._id}/${action}`])];
  for (const [method, path] of routes) {
    const body = method === 'GET' ? undefined : { key: 'cua-runner', title: 'Runner', terms: ['runner'], answer: 'Không được lưu.', version: hold.version };
    assert.equal((await request(path, { method, as: runner, body })).status, 403, `${method} ${path}`);
  }
  assert.equal((await request(`${KNOWLEDGE}/${hold._id}`, { method: 'DELETE', as: admin })).status, 404);
  assert.equal(await SupportArticle.countDocuments(), 11);
  assert.deepEqual(await article('hold'), hold);
});

test('GET /admin/knowledge returns { articles } of 11 rows without history; GET /:id returns { article }', async () => {
  const list = await request(KNOWLEDGE, { as: admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.articles.length, 11);
  const row = list.body.articles.find(item => item.key === 'hold');
  assert.deepEqual(Object.keys(row).sort(), ['_id', 'key', 'priority', 'status', 'title', 'updatedAt', 'updatedBy', 'version']);
  assert.deepEqual([row.status, row.priority, row.version, row.updatedBy], ['PUBLISHED', 2, 0, null]);
  const hold = await article('hold');
  const detail = await request(`${KNOWLEDGE}/${row._id}`, { as: admin });
  assert.equal(detail.status, 200);
  assert.deepEqual([detail.body.article.answer, detail.body.article.terms, detail.body.article.history], [hold.answer, hold.terms, []]);
  for (const id of ['000000000000000000000000', 'khong-phai-ma']) {
    const missing = await request(`${KNOWLEDGE}/${id}`, { as: admin });
    assert.deepEqual([missing.status, missing.body], [404, { message: 'Không tìm thấy bài tri thức.', code: 'KNOWLEDGE_NOT_FOUND' }], id);
  }
});

test('create returns 201 { article } as DRAFT; a duplicate key is 409 KNOWLEDGE_KEY_TAKEN; an external source is 400 KNOWLEDGE_INVALID', async () => {
  // status and version in the body are ignored: a new article always starts as an unpublished draft.
  const input = { key: 'tao-thu', title: 'Tạo thử', terms: ['tạo thử'], answer: 'Bài tạo thử.', sources: [{ title: 'Vé của tôi', url: '/account' }], suggestions: ['Xem vé'], priority: 1, status: 'PUBLISHED', version: 7 };
  const created = await request(KNOWLEDGE, { method: 'POST', as: admin, body: input });
  assert.equal(created.status, 201);
  const saved = created.body.article;
  assert.deepEqual([saved.key, saved.status, saved.version, saved.priority, saved.updatedBy, saved.history], ['tao-thu', 'DRAFT', 0, 1, { fullName: admin.fullName }, []]);
  const duplicate = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { ...input, title: 'Trùng mã' } });
  assert.deepEqual([duplicate.status, duplicate.body], [409, { message: 'Mã bài đã tồn tại.', code: 'KNOWLEDGE_KEY_TAKEN' }]);
  const external = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { ...input, key: 'tao-thu-2', sources: [{ title: 'Ngoài', url: 'https://evil.example/x' }] } });
  assert.deepEqual([external.status, external.body], [400, { message: 'Liên kết nguồn phải là đường dẫn nội bộ.', code: 'KNOWLEDGE_INVALID' }]);
  assert.deepEqual((await SupportArticle.find({ key: /^tao-thu/ }).lean()).map(item => [item.key, item.title, item.status]), [['tao-thu', 'Tạo thử', 'DRAFT']]);
});

test('an update with the current version snapshots the old content and the bot uses the new answer at once', async () => {
  await loadPublishedArticles(); // warm the chat cache: the new answer must still show without waiting 60 s
  const hold = await article('hold');
  const saved = await updateArticle(hold._id, { ...hold, answer: 'Giữ chỗ 15 phút.' }, hold.version, admin.id);
  assert.equal(saved.version, hold.version + 1); assert.equal(saved.history.at(-1).answer, hold.answer);
  assert.equal(+saved.history.at(-1).changedAt, +hold.updatedAt); assert.equal(saved.history.at(-1).changedBy ?? null, null);
  assert.deepEqual(saved.updatedBy, { fullName: admin.fullName });
  assert.match((await createSupportResponder({ generateReply: null })({ message: 'giữ chỗ được bao lâu' })).reply, /Giữ chỗ 15 phút/);
});

test('two saves from the same old version: one wins, the other is 409 KNOWLEDGE_VERSION_CONFLICT and changes nothing', async () => {
  const wallet = await article('wallet');
  // Both read version N before either writes, so only the conditional write can tell them apart.
  const results = await Promise.allSettled(['Bản của admin A.', 'Bản của admin B.'].map(answer => updateArticle(wallet._id, { ...wallet, answer }, wallet.version, admin.id)));
  const won = results.filter(result => result.status === 'fulfilled'), lost = results.filter(result => result.status === 'rejected');
  assert.deepEqual([won.length, lost.length], [1, 1]);
  assert.deepEqual([lost[0].reason.statusCode, lost[0].reason.code, lost[0].reason.message], [409, 'KNOWLEDGE_VERSION_CONFLICT', 'Bài đã được người khác sửa, hãy tải lại.']);
  const saved = await article('wallet');
  assert.deepEqual([saved.answer, saved.version, saved.history.length], [won[0].value.answer, wallet.version + 1, 1]);
});

test('PUT /admin/knowledge/:id returns { article }; an old version is 409 and a missing version is 400, neither changing anything', async () => {
  const results = await article('results');
  const fields = { title: results.title, terms: results.terms, answer: 'Kết quả có sau khi ban tổ chức công bố.', sources: results.sources, suggestions: results.suggestions, priority: results.priority };
  const first = await request(`${KNOWLEDGE}/${results._id}`, { method: 'PUT', as: admin, body: { ...fields, version: results.version } });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.article.answer, first.body.article.version, first.body.article.history.length], [fields.answer, results.version + 1, 1]);
  const saved = await article('results');
  const stale = await request(`${KNOWLEDGE}/${results._id}`, { method: 'PUT', as: admin, body: { ...fields, answer: 'Bản cũ ghi đè.', version: results.version } });
  assert.deepEqual([stale.status, stale.body], [409, { message: 'Bài đã được người khác sửa, hãy tải lại.', code: 'KNOWLEDGE_VERSION_CONFLICT' }]);
  const missing = await request(`${KNOWLEDGE}/${results._id}`, { method: 'PUT', as: admin, body: { ...fields, answer: 'Không kèm phiên bản.' } });
  assert.deepEqual([missing.status, missing.body.code], [400, 'KNOWLEDGE_INVALID']);
  assert.deepEqual(await article('results'), saved);
});

test('update cannot change the key', async () => {
  const account = await article('account');
  const saved = await updateArticle(account._id, { ...account, key: 'doi-ma', title: 'Tài khoản đã sửa' }, account.version, admin.id);
  assert.deepEqual([saved.key, saved.title], ['account', 'Tài khoản đã sửa']);
  assert.equal(await SupportArticle.countDocuments({ key: 'doi-ma' }), 0);
});

test('history keeps only the 20 newest snapshots', async () => {
  let current = await createArticle({ key: 'lich-su', title: 'Lịch sử', terms: ['lịch sử'], answer: 'Bản 0', sources: [], suggestions: [] }, admin.id);
  for (let i = 1; i <= 21; i++) current = await updateArticle(current._id, { ...current, answer: `Bản ${i}` }, current.version, admin.id);
  // 21 saves pushed 21 snapshots (Bản 0 … Bản 20); the oldest one, Bản 0, is gone.
  assert.equal(current.answer, 'Bản 21');
  assert.equal(current.history.length, 20);
  assert.deepEqual([current.history[0].answer, current.history.at(-1).answer], ['Bản 20', 'Bản 1']);
});

test('an answer containing <script> is stored and returned as the same plain string', async () => {
  const answer = 'Mở <script>alert(1)</script> & "Vé của tôi".';
  const created = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { key: 'co-the-script', title: '<b>Thẻ HTML</b>', terms: ['thẻ html'], answer, sources: [], suggestions: [] } });
  assert.equal(created.status, 201);
  const detail = await request(`${KNOWLEDGE}/${created.body.article._id}`, { as: admin });
  assert.deepEqual([detail.body.article.title, detail.body.article.answer], ['<b>Thẻ HTML</b>', answer]);
  assert.equal((await article('co-the-script')).answer, answer);
});

test('an update that breaks an article rule is 400 KNOWLEDGE_INVALID and changes nothing', async () => {
  const registration = await article('registration');
  for (const [patch, message] of [
    [{ sources: [{ title: 'Ngoài', url: 'https://evil.example/x' }] }, 'Liên kết nguồn phải là đường dẫn nội bộ.'],
    [{ sources: [{ title: 'Ngoài', url: '/\\evil.example' }] }, 'Liên kết nguồn phải là đường dẫn nội bộ.'],
    [{ terms: ['🙂'] }, 'Từ khóa phải có chữ hoặc số.'],
    [{ terms: [] }, 'Bài phải có từ 1 đến 30 từ khóa.'],
    [{ answer: 'x'.repeat(2001) }, 'Câu trả lời tối đa 2000 ký tự.'],
    [{ priority: 10 }, 'Độ ưu tiên từ 0 đến 9.'],
    [{ suggestions: ['a', 'b', 'c', 'd'] }, 'Câu gợi ý tối đa 3 mục.'],
  ]) await assert.rejects(updateArticle(registration._id, { ...registration, ...patch }, registration.version, admin.id), { statusCode: 400, code: 'KNOWLEDGE_INVALID', message }, JSON.stringify(patch));
  assert.deepEqual(await article('registration'), registration);
});

test('publish makes the bot answer with the article at once; unpublish takes it away', async () => {
  const ask = async () => (await createSupportResponder({ generateReply: null })({ message: 'mang thú cưng vào đường chạy được không' })).reply;
  const draft = await createArticle({ key: 'thu-cung', title: 'Thú cưng', terms: ['thú cưng'], answer: 'Không mang thú cưng vào đường chạy.', sources: [], suggestions: [] }, admin.id);
  await loadPublishedArticles(); // warm the chat cache before each change below
  assert.doesNotMatch(await ask(), /Không mang thú cưng/);
  const published = await setArticleStatus(draft._id, 'PUBLISHED', draft.version, admin.id);
  assert.deepEqual([published.status, published.version, published.history[0].status], ['PUBLISHED', 1, 'DRAFT']);
  assert.match(await ask(), /Không mang thú cưng/);
  const hidden = await setArticleStatus(draft._id, 'DRAFT', published.version, admin.id);
  assert.deepEqual([hidden.status, hidden.version, hidden.history[0].status], ['DRAFT', 2, 'PUBLISHED']);
  assert.doesNotMatch(await ask(), /Không mang thú cưng/);
});

test('the "Đổi cỡ áo" article with "đổi size áo" and "đổi size" comes first for "đổi size áo được không"', async () => {
  const draft = await createArticle({ key: 'doi-co-ao', title: 'Đổi cỡ áo', terms: ['đổi size áo', 'đổi size'], answer: 'Đổi cỡ áo tại quầy nhận kit.', sources: [], suggestions: [] }, admin.id);
  await setArticleStatus(draft._id, 'PUBLISHED', draft.version, admin.id);
  const result = await createSupportResponder({ generateReply: null })({ message: 'đổi size áo được không' });
  assert.ok(result.reply.startsWith('Đổi cỡ áo tại quầy nhận kit.'), result.reply);
});

test('restore copies a snapshot back, keeps the status and pushes the current content to history', async () => {
  const content = (name, extra) => ({ title: `Bản ${name}`, terms: ['khôi phục thử'], answer: `Câu trả lời bản ${name}.`, sources: [], suggestions: [], ...extra });
  const zero = await createArticle({ key: 'khoi-phuc', ...content('không') }, admin.id);
  const one = await updateArticle(zero._id, content('một', { sources: [{ title: 'Vé của tôi', url: '/account' }], suggestions: ['Gợi ý một'], priority: 3 }), zero.version, admin.id);
  const two = await updateArticle(zero._id, content('hai', { terms: ['khôi phục thử', 'bản hai'], priority: 5 }), one.version, admin.id);
  const live = await setArticleStatus(zero._id, 'PUBLISHED', two.version, admin.id);
  // History, newest first: [Bản hai DRAFT, Bản một DRAFT, Bản không DRAFT]. The chosen one sits in the
  // middle with content of its own, so picking the newest or the oldest snapshot instead cannot pass.
  const chosen = live.history[1];
  assert.deepEqual([chosen.title, chosen.status, live.status], ['Bản một', 'DRAFT', 'PUBLISHED']);
  await loadPublishedArticles(); // the chat cache now holds "Bản hai"
  const restored = await restoreArticle(zero._id, chosen.changedAt.toISOString(), live.version, admin.id);
  assert.deepEqual(
    [restored.title, restored.terms, restored.answer, restored.sources, restored.suggestions, restored.priority, restored.status, restored.version],
    ['Bản một', ['khôi phục thử'], 'Câu trả lời bản một.', [{ title: 'Vé của tôi', url: '/account' }], ['Gợi ý một'], 3, 'PUBLISHED', live.version + 1],
  );
  assert.deepEqual([restored.history.length, restored.history[0].title, restored.history[0].status], [4, 'Bản hai', 'PUBLISHED']);
  assert.match((await createSupportResponder({ generateReply: null })({ message: 'khôi phục thử' })).reply, /Câu trả lời bản một/);
});

test('restore with an unknown changedAt is 404; with a stale version is 409', async () => {
  const first = await createArticle({ key: 'khoi-phuc-loi', title: 'Khôi phục lỗi', terms: ['khôi phục lỗi'], answer: 'Bản một.', sources: [], suggestions: [] }, admin.id);
  const edited = await updateArticle(first._id, { ...first, answer: 'Bản hai.' }, first.version, admin.id);
  const before = await article('khoi-phuc-loi');
  for (const changedAt of ['2001-01-01T00:00:00.000Z', 'không phải ngày', undefined]) {
    await assert.rejects(restoreArticle(first._id, changedAt, edited.version, admin.id), { statusCode: 404, code: 'KNOWLEDGE_SNAPSHOT_NOT_FOUND', message: 'Không tìm thấy bản cũ này.' }, String(changedAt));
  }
  await assert.rejects(restoreArticle(first._id, edited.history[0].changedAt.toISOString(), first.version, admin.id), { statusCode: 409, code: 'KNOWLEDGE_VERSION_CONFLICT' });
  assert.deepEqual(await article('khoi-phuc-loi'), before);
});

test('POST /:id/publish, /:id/unpublish and /:id/restore return { article }; an unknown snapshot is 404 { message, code }', async () => {
  const draft = await createArticle({ key: 'qua-http', title: 'Qua HTTP', terms: ['qua http'], answer: 'Bản đầu qua HTTP.', sources: [], suggestions: [] }, admin.id);
  const path = `${KNOWLEDGE}/${draft._id}`;
  const published = await request(`${path}/publish`, { method: 'POST', as: admin, body: { version: 0 } });
  assert.deepEqual([published.status, published.body.article.status, published.body.article.version], [200, 'PUBLISHED', 1]);
  const edited = await request(path, { method: 'PUT', as: admin, body: { ...draft, answer: 'Bản hai qua HTTP.', version: 1 } });
  const hidden = await request(`${path}/unpublish`, { method: 'POST', as: admin, body: { version: edited.body.article.version } });
  assert.deepEqual([hidden.status, hidden.body.article.status, hidden.body.article.version], [200, 'DRAFT', 3]);
  // The admin page sends back changedAt exactly as it received it in JSON.
  const firstContent = hidden.body.article.history.find(snapshot => snapshot.answer === 'Bản đầu qua HTTP.' && snapshot.status === 'PUBLISHED');
  const restored = await request(`${path}/restore`, { method: 'POST', as: admin, body: { version: 3, changedAt: firstContent.changedAt } });
  assert.deepEqual([restored.status, restored.body.article.answer, restored.body.article.status, restored.body.article.version], [200, 'Bản đầu qua HTTP.', 'DRAFT', 4]);
  const missing = await request(`${path}/restore`, { method: 'POST', as: admin, body: { version: 4, changedAt: '2001-01-01T00:00:00.000Z' } });
  assert.deepEqual([missing.status, missing.body], [404, { message: 'Không tìm thấy bản cũ này.', code: 'KNOWLEDGE_SNAPSHOT_NOT_FOUND' }]);
});

test('preview answers with an unsaved draft in the chat reply shape, and the live chat never sees the draft', async () => {
  const draft = { key: 'gui-xe', title: 'Gửi xe', terms: ['gửi xe'], answer: 'Bãi gửi xe ở cổng B.', sources: [{ title: 'Trang giải', url: '/events' }], suggestions: ['Giờ mở bãi xe?'] };
  const { status, body } = await request(`${KNOWLEDGE}/preview`, { method: 'POST', as: admin, body: { question: 'cho mình gửi xe ở đâu', draft } });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['mode', 'reply', 'sources', 'suggestions']);
  assert.deepEqual([body.mode, body.reply, body.sources, body.suggestions], ['guide', 'Bãi gửi xe ở cổng B.', [{ title: 'Trang giải', url: '/events' }], ['Giờ mở bãi xe?']]);
  const live = await createSupportResponder({ generateReply: null })({ message: 'cho mình gửi xe ở đâu' });
  assert.doesNotMatch(live.reply, /Bãi gửi xe/);
  assert.equal(await SupportArticle.countDocuments({ key: 'gui-xe' }), 0);
});

test('preview writes nothing and never calls the AI, even with the AI switched on', async t => {
  // Switch the current AI adapter fully on and fake its provider: an answer that reached it would come back in 'ai' mode.
  const realFetch = global.fetch, aiCalls = [];
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return realFetch(url, options);
    aiCalls.push(String(url));
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Câu trả lời do AI viết.' }] }] });
  };
  const keys = ['SUPPORT_AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL'];
  const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SUPPORT_AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' });
  t.after(() => {
    global.fetch = realFetch;
    for (const key of keys) if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  });
  // Control: the ordinary chat does reach the fake provider, so the "no AI call" check below can fail.
  const control = await createSupportResponder()({ message: 'giữ chỗ được bao lâu' });
  assert.deepEqual([control.mode, aiCalls.length], ['ai', 1]);
  const articlesBefore = await SupportArticle.find().sort({ _id: 1 }).lean();
  const draft = { key: 'giu-cho-thu', title: 'Giữ chỗ thử', terms: ['giữ chỗ'], answer: 'Bản nháp về giữ chỗ.', sources: [], suggestions: [] };
  const result = await previewAnswer({ question: 'giữ chỗ được bao lâu', draft });
  assert.deepEqual([result.mode, aiCalls.length], ['guide', 1]);
  assert.deepEqual(await SupportArticle.find().sort({ _id: 1 }).lean(), articlesBefore);
});

test('preview without a draft answers from the published articles; a draft with a published key stands in for it in the preview only', async () => {
  const hold = await article('hold');
  assert.ok((await previewAnswer({ question: 'giữ chỗ được bao lâu' })).reply.startsWith(hold.answer));
  // The admin page sends the whole article it is editing; only the content and the key count.
  const result = await previewAnswer({ question: 'giữ chỗ được bao lâu', draft: { ...hold, answer: 'Giữ chỗ thử 99 phút.' } });
  assert.ok(result.reply.startsWith('Giữ chỗ thử 99 phút.'), result.reply);
  assert.ok(!result.reply.includes(hold.answer), 'the published hold answer is replaced, not repeated');
  assert.deepEqual(await article('hold'), hold);
});

test('an invalid draft or question is 400 KNOWLEDGE_INVALID', async () => {
  const draft = { key: 'nhap-sai', title: 'Nháp sai', terms: ['nháp sai'], answer: 'Nháp.', sources: [], suggestions: [] };
  for (const [body, message] of [
    [{ question: 'nháp sai', draft: { ...draft, sources: [{ title: 'Ngoài', url: '//evil.example/x' }] } }, 'Liên kết nguồn phải là đường dẫn nội bộ.'],
    [{ question: 'nháp sai', draft: { ...draft, terms: ['🙂'] } }, 'Từ khóa phải có chữ hoặc số.'],
    [{ question: '   ', draft }, 'Câu hỏi xem thử phải có từ 1 đến 2000 ký tự.'],
    [{ question: 'x'.repeat(2001) }, 'Câu hỏi xem thử phải có từ 1 đến 2000 ký tự.'],
  ]) {
    const response = await request(`${KNOWLEDGE}/preview`, { method: 'POST', as: admin, body });
    assert.deepEqual([response.status, response.body], [400, { message, code: 'KNOWLEDGE_INVALID' }], JSON.stringify(body).slice(0, 80));
  }
});
