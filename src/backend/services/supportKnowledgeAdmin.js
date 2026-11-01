const mongoose = require('mongoose');
const SupportArticle = require('../models/SupportArticle');
const { clearKnowledgeCache } = require('./supportKnowledgeStore');
const { httpError } = require('../lib/errors');
const errorCodes = require('../lib/errorCodes');

// Super Admin edits of the support bot's knowledge (spec 4.5). Every write names the version it started
// from, so a save based on an older version gets 409 instead of overwriting another admin's change.
// The content as it was before each write is kept in `history`, newest 20 only.
const ARTICLE_HISTORY_LIMIT = 20;
const CONTENT_FIELDS = ['title', 'terms', 'answer', 'sources', 'suggestions', 'priority'];

const notFound = () => httpError(404, 'Không tìm thấy bài tri thức.', errorCodes.KNOWLEDGE_NOT_FOUND);
const conflict = () => httpError(409, 'Bài đã được người khác sửa, hãy tải lại.', errorCodes.KNOWLEDGE_VERSION_CONFLICT);
const invalid = message => httpError(400, message, errorCodes.KNOWLEDGE_INVALID);

// A form sets content only: key, status, version and history never come from the request body.
function pickContent(input) {
  const body = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(CONTENT_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
}

// The model's first Vietnamese message becomes a 400 the admin can act on.
const asHttpError = error => (error?.name === 'ValidationError' ? invalid(Object.values(error.errors)[0].message) : error);

const person = user => (user ? { fullName: user.fullName } : null);

// The admin view of an article: author names instead of user ids, history newest first.
function present({ __v, updatedBy, history, ...article }) {
  const view = { ...article, updatedBy: person(updatedBy) };
  if (history) view.history = history.map(snapshot => ({ ...snapshot, changedBy: person(snapshot.changedBy) })).reverse();
  return view;
}

const withNames = query => query.populate('updatedBy', 'fullName').populate('history.changedBy', 'fullName').lean();

async function listArticles() {
  const rows = await SupportArticle.find().select('key title status priority version updatedAt updatedBy')
    .sort({ createdAt: 1, _id: 1 }).populate('updatedBy', 'fullName').lean();
  return rows.map(present);
}

async function getArticle(id) {
  const article = mongoose.isObjectIdOrHexString(id) && await withNames(SupportArticle.findById(id));
  if (!article) throw notFound();
  return present(article);
}

async function createArticle(input, actorId) {
  let created;
  try {
    created = await SupportArticle.create({ ...pickContent(input), key: input?.key, status: 'DRAFT', updatedBy: actorId });
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'Mã bài đã tồn tại.', errorCodes.KNOWLEDGE_KEY_TAKEN);
    throw asHttpError(error);
  }
  return getArticle(created._id);
}

// Applies `fields` only while the article is still at `version`. The content before the write goes to
// history, signed with who saved that content and when, so the list reads "bản do X lưu lúc T".
async function writeArticle(id, version, actorId, fields) {
  if (!Number.isInteger(version) || version < 0) throw invalid('Phiên bản bài không hợp lệ, hãy tải lại.');
  const current = mongoose.isObjectIdOrHexString(id) && await SupportArticle.findById(id).lean();
  if (!current) throw notFound();
  const { title, terms, answer, sources, suggestions, priority, status } = current;
  const snapshot = { title, terms, answer, sources, suggestions, priority, status, changedBy: current.updatedBy ?? null, changedAt: current.updatedAt };
  let saved;
  try {
    saved = await withNames(SupportArticle.findOneAndUpdate(
      { _id: current._id, version },
      { $set: { ...fields, updatedBy: actorId }, $inc: { version: 1 }, $push: { history: { $each: [snapshot], $slice: -ARTICLE_HISTORY_LIMIT } } },
      { new: true, runValidators: true },
    ));
  } catch (error) {
    throw asHttpError(error);
  }
  if (!saved) throw conflict(); // the article is no longer at `version`: someone else saved first
  clearKnowledgeCache();
  return present(saved);
}

const updateArticle = (id, input, version, actorId) => writeArticle(id, version, actorId, pickContent(input));

module.exports = { ARTICLE_HISTORY_LIMIT, listArticles, getArticle, createArticle, updateArticle };
