const mongoose = require('mongoose');
const SupportArticle = require('../models/SupportArticle');
const { SUPPORT_MESSAGE_LIMIT } = require('./supportKnowledge');
const { loadPublishedArticles, clearKnowledgeCache } = require('./supportKnowledgeStore');
const { createSupportResponder } = require('./supportAiService');
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

// The content fields of a request body, an article or a snapshot. A form never sets key, status,
// version or history directly.
function contentOf(source) {
  const body = source && typeof source === 'object' ? source : {};
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
    created = await SupportArticle.create({ ...contentOf(input), key: input?.key, status: 'DRAFT', updatedBy: actorId });
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'Mã bài đã tồn tại.', errorCodes.KNOWLEDGE_KEY_TAKEN);
    throw asHttpError(error);
  }
  return getArticle(created._id);
}

// Applies change(current) only while the article is still at `version`. The content before the write
// goes to history, signed with who saved that content and when, so the list reads "bản do X lưu lúc T".
async function writeArticle(id, version, actorId, change) {
  if (!Number.isInteger(version) || version < 0) throw invalid('Phiên bản bài không hợp lệ, hãy tải lại.');
  const current = mongoose.isObjectIdOrHexString(id) && await SupportArticle.findById(id).lean();
  if (!current) throw notFound();
  const fields = change(current);
  const snapshot = { ...contentOf(current), status: current.status, changedBy: current.updatedBy ?? null, changedAt: current.updatedAt };
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

const updateArticle = (id, input, version, actorId) => writeArticle(id, version, actorId, () => contentOf(input));

// Publishing and unpublishing are versioned writes like any other, so they leave a snapshot too.
const setArticleStatus = (id, status, version, actorId) => writeArticle(id, version, actorId, () => ({ status }));

// Copies an older content back and keeps the current status. The content it replaces goes to history,
// so a restore can itself be undone. A snapshot is identified by the time its content was saved.
function restoreArticle(id, changedAt, version, actorId) {
  return writeArticle(id, version, actorId, current => {
    const at = new Date(changedAt).getTime();
    const snapshot = current.history?.findLast(item => item.changedAt?.getTime() === at);
    if (!snapshot) throw httpError(404, 'Không tìm thấy bản cũ này.', errorCodes.KNOWLEDGE_SNAPSHOT_NOT_FOUND);
    return contentOf(snapshot);
  });
}

// "Xem thử": how the bot would answer if `draft` were published. The draft stands in for the PUBLISHED
// article with its key, for this answer only: nothing is saved, and the AI is never called (spec T6).
async function previewAnswer({ question, draft } = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > SUPPORT_MESSAGE_LIMIT) {
    throw invalid(`Câu hỏi xem thử phải có từ 1 đến ${SUPPORT_MESSAGE_LIMIT} ký tự.`);
  }
  let articles = await loadPublishedArticles();
  if (draft !== undefined && draft !== null) {
    const candidate = new SupportArticle({ ...contentOf(draft), key: draft.key, status: 'PUBLISHED' });
    try {
      await candidate.validate();
    } catch (error) {
      throw asHttpError(error);
    }
    const { key, title, terms, answer, sources, suggestions, priority } = candidate.toObject();
    // A new array: the cached list the live chat reads must never see the draft.
    articles = [...articles.filter(article => article.key !== key), { key, title, terms, answer, sources, suggestions, priority }];
  }
  return createSupportResponder({ findArticles: async () => articles, generateReply: null })({ message: question });
}

module.exports = { ARTICLE_HISTORY_LIMIT, listArticles, getArticle, createArticle, updateArticle, setArticleStatus, restoreArticle, previewAnswer };
