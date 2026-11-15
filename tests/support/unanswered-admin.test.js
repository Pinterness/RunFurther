// Hàng chờ câu chưa trả lời dành cho Super Admin (spec 4.6): xem danh sách, "Tạo bài từ câu này", "Bỏ qua".
// Chạy trên MongoDB replica set trong bộ nhớ (tests/helpers). Kho tri thức để trống, nên mọi câu hỏi chung đều nhận
// câu FALLBACK và vào hàng chờ. Rate limit đếm theo IP: cả file dùng dưới 12 lần chat và dưới 30 lần ghi admin.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'isolated-support-unanswered-admin-test-secret';

const { app } = require('../../src/backend/server');
const SupportArticle = require('../../src/backend/models/SupportArticle');
const UnansweredQuestion = require('../../src/backend/models/UnansweredQuestion');
const { clearKnowledgeCache } = require('../../src/backend/services/supportKnowledgeStore');
const { createBackendHarness } = require('../helpers/backendHarness');

const harness = createBackendHarness({ app, dbName: 'runfurther_support_unanswered_admin' });
const { request } = harness;
const QUEUE = '/support/admin/unanswered';
const KNOWLEDGE = '/support/admin/knowledge';
let admin, runner;

before(async () => {
  await harness.start();
  clearKnowledgeCache();
  admin = await harness.createUser({ role: 'SUPER_ADMIN' });
  runner = await harness.createUser();
});
after(harness.stop);
beforeEach(() => UnansweredQuestion.deleteMany({}));

const at = minutes => new Date(Date.UTC(2026, 10, 15, 3, minutes));
const row = (normalized, count, minutes, status = 'OPEN') => ({ kind: 'NO_ANSWER', normalized, sample: normalized, count, status, articleKeys: [], firstAskedAt: at(0), lastAskedAt: at(minutes) });

test('khách bị 401, RUNNER bị 403 ở mọi route hàng chờ', async () => {
  const [question] = await UnansweredQuestion.insertMany([row('cau mot', 1, 1)]);
  const routes = [['GET', QUEUE], ['POST', `${QUEUE}/${question._id}/resolve`], ['POST', `${QUEUE}/${question._id}/ignore`]];
  for (const [method, path] of routes) {
    assert.equal((await request(path, { method })).status, 401, `khách ${method} ${path}`);
    assert.equal((await request(path, { method, as: runner })).status, 403, `RUNNER ${method} ${path}`);
  }
  assert.equal((await UnansweredQuestion.findById(question._id).lean()).status, 'OPEN');
});

test('SUPER_ADMIN thấy { questions }: chỉ câu OPEN, sắp theo count rồi lần hỏi cuối, tối đa 100 dòng', async () => {
  await UnansweredQuestion.insertMany([
    row('hoi it', 1, 50), row('hoi nhieu', 9, 1), row('hoi nhieu moi hon', 9, 2), row('da xu ly', 20, 3, 'RESOLVED'), row('bo qua', 30, 4, 'IGNORED'),
    ...Array.from({ length: 100 }, (_, i) => row('cau them ' + i, 1, 0)),
  ]);
  const list = await request(QUEUE, { as: admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.questions.length, 100);
  assert.deepEqual(list.body.questions.slice(0, 3).map(q => q.sample), ['hoi nhieu moi hon', 'hoi nhieu', 'hoi it']);
  assert.ok(list.body.questions.every(q => q.status === 'OPEN'));
  // Vỏ JSON mà giao diện (Task 6.4) dựa vào; không trả `normalized` hay `__v`.
  assert.deepEqual(Object.keys(list.body.questions[0]).sort(), ['_id', 'articleKeys', 'count', 'firstAskedAt', 'kind', 'lastAskedAt', 'sample', 'status']);
  const ignored = await request(`${QUEUE}?status=IGNORED`, { as: admin });
  assert.deepEqual(ignored.body.questions.map(q => q.sample), ['bo qua']);
  for (const bad of ['abc', '%24ne']) {
    const invalid = await request(`${QUEUE}?status=${bad}`, { as: admin });
    assert.deepEqual([invalid.status, invalid.body.code], [400, 'UNANSWERED_INVALID'], bad);
  }
  assert.equal((await request(`${QUEUE}?status[$ne]=OPEN`, { as: admin })).status, 400);
});

test('tạo bài từ một câu thì câu đó thành RESOLVED; xuất bản bài xong, hỏi lại thì bot trả lời được', async () => {
  const question = 'đổi size áo sau khi đăng ký được không';
  const before = await request('/support/chat', { method: 'POST', body: { message: question } });
  assert.match(before.body.reply, /chưa có thông tin đã xác thực/);
  const [queued] = (await request(QUEUE, { as: admin })).body.questions;
  assert.deepEqual([queued.sample, queued.count], [question, 1]);

  const answer = 'Bạn đổi size áo trong mục hồ sơ người chạy trước ngày đóng đăng ký.';
  const created = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { key: 'doi-size-ao', title: queued.sample, terms: ['đổi size áo'], answer, fromQuestionId: queued._id } });
  assert.equal(created.status, 201); assert.equal(created.body.article.status, 'DRAFT');
  assert.equal(created.body.article.fromQuestionId, undefined);
  assert.equal((await UnansweredQuestion.findById(queued._id).lean()).status, 'RESOLVED');
  assert.deepEqual((await request(QUEUE, { as: admin })).body.questions, []);

  const published = await request(`${KNOWLEDGE}/${created.body.article._id}/publish`, { method: 'POST', as: admin, body: { version: created.body.article.version } });
  assert.equal(published.status, 200);
  const after = await request('/support/chat', { method: 'POST', body: { message: question } });
  assert.equal(after.body.reply, answer);
  // Bot đã trả lời được, nên câu không bị mở lại và không bị đếm thêm.
  const resolved = await UnansweredQuestion.findById(queued._id).lean();
  assert.deepEqual([resolved.status, resolved.count], ['RESOLVED', 1]);
});

test('"Bỏ qua" đưa câu ra khỏi danh sách OPEN; "Đã xử lý" trả { question }; mã lạ bị 404', async () => {
  const [first, second] = await UnansweredQuestion.insertMany([row('cau bo qua', 2, 1), row('cau da xu ly', 1, 2)]);
  const ignored = await request(`${QUEUE}/${first._id}/ignore`, { method: 'POST', as: admin });
  assert.equal(ignored.status, 200);
  assert.deepEqual([ignored.body.question._id, ignored.body.question.status, ignored.body.question.normalized], [String(first._id), 'IGNORED', undefined]);
  const resolved = await request(`${QUEUE}/${second._id}/resolve`, { method: 'POST', as: admin });
  assert.deepEqual([resolved.status, resolved.body.question.status], [200, 'RESOLVED']);
  assert.deepEqual((await request(QUEUE, { as: admin })).body.questions, []);
  for (const id of ['000000000000000000000000', 'khong-phai-ma']) {
    const missing = await request(`${QUEUE}/${id}/ignore`, { method: 'POST', as: admin });
    assert.deepEqual([missing.status, missing.body.code], [404, 'UNANSWERED_NOT_FOUND'], id);
  }
});

test('fromQuestionId sai định dạng thì 400 và không tạo bài; câu đã tự xóa thì bài vẫn được tạo', async () => {
  const bad = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { key: 'tu-cau-sai', title: 'Câu sai', terms: ['câu sai'], answer: 'Không được lưu.', fromQuestionId: { $ne: null } } });
  assert.deepEqual([bad.status, bad.body.code], [400, 'KNOWLEDGE_INVALID']);
  assert.equal(await SupportArticle.countDocuments({ key: 'tu-cau-sai' }), 0);
  const gone = await request(KNOWLEDGE, { method: 'POST', as: admin, body: { key: 'tu-cau-da-xoa', title: 'Câu đã xóa', terms: ['câu đã xóa'], answer: 'Vẫn lưu.', fromQuestionId: '000000000000000000000000' } });
  assert.equal(gone.status, 201);
});
