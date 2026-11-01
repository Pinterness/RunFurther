// Super Admin routes for the support bot's knowledge articles; the rules live in supportKnowledgeAdmin.js.
const knowledge = require('../services/supportKnowledgeAdmin');

const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };

exports.list = handle(async (_req, res) => { res.json({ articles: await knowledge.listArticles() }); });
exports.detail = handle(async (req, res) => { res.json({ article: await knowledge.getArticle(req.params.id) }); });
exports.create = handle(async (req, res) => { res.status(201).json({ article: await knowledge.createArticle(req.body, req.userId) }); });
exports.update = handle(async (req, res) => {
  res.json({ article: await knowledge.updateArticle(req.params.id, req.body, req.body.version, req.userId) });
});
