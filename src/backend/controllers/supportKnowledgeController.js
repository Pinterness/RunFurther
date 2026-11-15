// Super Admin routes for the support bot's knowledge articles; the rules live in supportKnowledgeAdmin.js.
const knowledge = require('../services/supportKnowledgeAdmin');
const unanswered = require('../services/unansweredService');

const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };

exports.list = handle(async (_req, res) => { res.json({ articles: await knowledge.listArticles() }); });
exports.detail = handle(async (req, res) => { res.json({ article: await knowledge.getArticle(req.params.id) }); });
exports.create = handle(async (req, res) => {
  res.status(201).json({ article: await knowledge.createArticle(req.body, req.userId, { fromQuestionId: req.body?.fromQuestionId }) });
});
// Same reply shape as the chat route, so the admin sees exactly what a user would.
exports.preview = handle(async (req, res) => { res.json(await knowledge.previewAnswer({ question: req.body.question, draft: req.body.draft })); });
exports.update = handle(async (req, res) => {
  res.json({ article: await knowledge.updateArticle(req.params.id, req.body, req.body.version, req.userId) });
});
const setStatus = status => handle(async (req, res) => {
  res.json({ article: await knowledge.setArticleStatus(req.params.id, status, req.body.version, req.userId) });
});
exports.publish = setStatus('PUBLISHED');
exports.unpublish = setStatus('DRAFT');
// Hàng chờ câu bot chưa trả lời được (spec 4.6).
exports.listUnanswered = handle(async (req, res) => { res.json({ questions: await unanswered.listUnanswered({ status: req.query.status }) }); });
const setQuestionStatus = status => handle(async (req, res) => {
  res.json({ question: await unanswered.setUnansweredStatus(req.params.id, status) });
});
exports.resolveUnanswered = setQuestionStatus('RESOLVED');
exports.ignoreUnanswered = setQuestionStatus('IGNORED');
exports.restore = handle(async (req, res) => {
  res.json({ article: await knowledge.restoreArticle(req.params.id, req.body.changedAt, req.body.version, req.userId) });
});
