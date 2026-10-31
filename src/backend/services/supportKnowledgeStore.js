const SupportArticle = require('../models/SupportArticle');

// Keeps the PUBLISHED articles in memory for a short time so each chat question does not read MongoDB.
// Sized for the knowledge base this project expects (up to about 200 articles, all loaded at once).
// The cache lives in one process: Render Free runs a single instance, so clear() after an edit is enough.
function createKnowledgeStore({ find, ttlMs = 60000, now = Date.now }) {
  let cache = null;
  let generation = 0;
  return {
    async load() {
      if (cache && now() - cache.at < ttlMs) return cache.articles;
      const started = generation;
      const at = now();
      const articles = await find(); // A failed read throws and is never cached.
      // clear() during this read means an article was just saved; this older result must not stay.
      if (started === generation) cache = { articles, at };
      return articles;
    },
    clear() {
      generation += 1;
      cache = null;
    },
  };
}

const store = createKnowledgeStore({
  find: () => SupportArticle.find({ status: 'PUBLISHED' })
    .select('key title terms answer sources suggestions priority')
    .sort({ createdAt: 1, _id: 1 }).maxTimeMS(1500).lean(),
});

const loadPublishedArticles = () => store.load();
const clearKnowledgeCache = () => store.clear();

module.exports = { createKnowledgeStore, loadPublishedArticles, clearKnowledgeCache };
