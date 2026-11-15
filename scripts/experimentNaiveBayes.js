// Thí nghiệm Naive Bayes (Task 8.8, spec D2): một bộ phân loại tự huấn luyện, so với cách tìm theo từ khóa
// (rankArticles) trên nửa kiểm của bộ câu đo. Chỉ đọc; bot vẫn dùng rankArticles. Cách chạy:
//   node scripts/experimentNaiveBayes.js --seed                                 11 bài gốc, không cần database
//   node --env-file=.env.atlas.local scripts/experimentNaiveBayes.js            bài PUBLISHED trên Atlas
// Luật thắng ghi trước khi chạy (01-11, file phiên P08): Naive Bayes thắng khi top-2 nửa kiểm cao hơn, tổng chọn sai
// không nhiều hơn, và chênh lệch theo cặp có ý nghĩa ở mức 5% theo kiểm định McNemar chính xác. Nửa kiểm chỉ in số
// tổng và số cặp, không in từng câu (spec 5.2).
const mongoose = require('mongoose');
const items = require('../tests/helpers/supportEvalSet.json');
const { normalizeSupportText, rankArticles, seedArticles } = require('../src/backend/services/supportKnowledge');
const { evaluateSupport } = require('../src/backend/services/supportEval');
const { taskForEval } = require('../src/backend/services/supportTasks');

const isArticle = expected => typeof expected === 'string' && !expected.startsWith('task:');

// Đặc trưng của một câu: các âm tiết đã bỏ dấu và các cặp âm tiết liền nhau ("giu cho").
function features(text) {
  const words = normalizeSupportText(text).split(' ').filter(Boolean);
  return [...words, ...words.slice(1).map((word, index) => words[index] + ' ' + word)];
}

// Tập huấn luyện: tiêu đề và từng từ khóa của bài, cộng câu nửa luyện có bài đúng. Không bao giờ lấy câu nửa kiểm.
function buildTrainingSet(articles, evalItems) {
  const docs = [];
  for (const article of articles) {
    docs.push({ text: article.title, label: article.key });
    for (const term of article.terms) docs.push({ text: term, label: article.key });
  }
  for (const item of evalItems) if (item.split === 'luyen' && isArticle(item.expected)) docs.push({ text: item.question, label: item.expected });
  return docs;
}

// Naive Bayes đa thức với làm trơn Laplace (`alpha`): đếm số lần mỗi đặc trưng xuất hiện trong mỗi bài.
function trainNaiveBayes(docs, { alpha = 1 } = {}) {
  const labels = new Map(), vocab = new Set();
  for (const { text, label } of docs) {
    const entry = labels.get(label) || { docs: 0, total: 0, counts: new Map() };
    entry.docs += 1;
    for (const feature of features(text)) { entry.counts.set(feature, (entry.counts.get(feature) || 0) + 1); entry.total += 1; vocab.add(feature); }
    labels.set(label, entry);
  }
  return { alpha, docTotal: docs.length, labels, vocab };
}

// Xác suất của từng bài cho một câu, giảm dần. Chỉ dùng đặc trưng đã học; câu không có đặc trưng nào thì rỗng.
function scores(model, text) {
  const known = features(text).filter(feature => model.vocab.has(feature));
  if (!known.length) return [];
  const size = model.vocab.size;
  const logs = [...model.labels].map(([label, entry]) => [label, Math.log(entry.docs / model.docTotal)
    + known.reduce((sum, feature) => sum + Math.log(((entry.counts.get(feature) || 0) + model.alpha) / (entry.total + model.alpha * size)), 0)]);
  const max = Math.max(...logs.map(([, value]) => value));
  const total = logs.reduce((sum, [, value]) => sum + Math.exp(value - max), 0);
  return logs.map(([label, value]) => ({ label, p: Math.exp(value - max) / total })).sort((a, b) => b.p - a.p);
}

// Bài có xác suất cao nhất, hoặc null khi xác suất đó dưới ngưỡng (giống bot "trượt" để câu vào hàng chờ).
function classify(model, text, { threshold = 0.5 } = {}) {
  const [best] = scores(model, text);
  return best && best.p >= threshold ? best.label : null;
}

const choose = (n, k) => { let value = 1; for (let i = 1; i <= k; i++) value = (value * (n - i + 1)) / i; return value; };
// Kiểm định McNemar chính xác hai phía: b là số câu chỉ cách thứ nhất đúng, c là số câu chỉ cách thứ hai đúng.
function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  let tail = 0;
  for (let k = 0; k <= Math.min(b, c); k++) tail += choose(n, k);
  return Math.min(1, (2 * tail) / 2 ** n);
}

// Chọn ngưỡng trên nửa luyện bằng cách bỏ ra từng câu (leave-one-out): câu đang xét không nằm trong tập huấn luyện
// của chính nó. Điểm = số câu đúng trừ số câu chọn sai; hòa điểm thì lấy ngưỡng cao hơn (an toàn hơn).
function pickThreshold(articles, evalItems) {
  const docs = buildTrainingSet(articles, evalItems);
  const cases = evalItems.filter(item => item.split === 'luyen' && !taskForEval(item.question) && (item.expected === null || isArticle(item.expected))).map(item => {
    const own = docs.findIndex(doc => doc.text === item.question && doc.label === item.expected);
    const [best] = scores(trainNaiveBayes(own === -1 ? docs : docs.filter((_, index) => index !== own)), item.question);
    return { expected: item.expected, best };
  });
  let chosen = { threshold: 0.5, score: -Infinity };
  for (let threshold = 0.2; threshold <= 0.951; threshold += 0.05) {
    let score = 0;
    for (const { expected, best } of cases) {
      const label = best && best.p >= threshold ? best.label : null;
      if (label === expected) score += 1; else if (label !== null) score -= 1;
    }
    if (score >= chosen.score) chosen = { threshold: Math.round(threshold * 100) / 100, score };
  }
  return { ...chosen, cases: cases.length };
}

async function loadArticles() {
  if (process.argv.includes('--seed')) return { articles: seedArticles(), source: 'seed (11 bài gốc)' };
  require('dotenv').config();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const { loadPublishedArticles } = require('../src/backend/services/supportKnowledgeStore');
  return { articles: await loadPublishedArticles(), source: 'database ' + mongoose.connection.db.databaseName };
}

async function main() {
  const { articles, source } = await loadArticles();
  const { threshold, score, cases } = pickThreshold(articles, items);
  const model = trainNaiveBayes(buildTrainingSet(articles, items));
  const keywordRank = question => rankArticles(articles, question);
  const bayesRank = question => { const label = classify(model, question, { threshold }); return label ? [{ key: label }] : []; };
  const keyword = await evaluateSupport(items, { rank: keywordRank, routeTask: taskForEval });
  const bayes = await evaluateSupport(items, { rank: bayesRank, routeTask: taskForEval });
  // Cặp trên các câu có bài của nửa kiểm: "đúng" là bài đúng nằm trong các bài bot đưa ra (top-2).
  let onlyKeyword = 0, onlyBayes = 0;
  for (const item of items.filter(entry => entry.split === 'kiem' && isArticle(entry.expected))) {
    const routed = Boolean(taskForEval(item.question));
    const keywordRight = !routed && keywordRank(item.question).some(article => article.key === item.expected);
    const bayesRight = !routed && bayesRank(item.question).some(article => article.key === item.expected);
    if (keywordRight && !bayesRight) onlyKeyword += 1;
    if (bayesRight && !keywordRight) onlyBayes += 1;
  }
  const p = mcnemarExact(onlyKeyword, onlyBayes);
  const row = metrics => ({ top1: `${metrics.top1}/${metrics.articleTotal}`, top2: `${metrics.top2}/${metrics.articleTotal}`, chonSaiBai: metrics.wrong, truot: metrics.miss, nullDung: `${metrics.nullCorrect}/${metrics.nullTotal}`, tacVuDung: `${metrics.taskCorrect}/${metrics.taskTotal}`, tongChonSai: metrics.wrongTotal });
  const wins = bayes.kiem.top2 > keyword.kiem.top2 && bayes.kiem.wrongTotal <= keyword.kiem.wrongTotal && onlyBayes > onlyKeyword && p < 0.05;
  console.log(`Bài: ${articles.length} (${source}). Ngưỡng Naive Bayes chọn trên nửa luyện (leave-one-out, ${cases} câu): ${threshold} (điểm ${score}).`);
  console.log('Nửa kiểm:');
  console.table({ 'Từ khóa (rankArticles)': row(keyword.kiem), 'Naive Bayes': row(bayes.kiem) });
  console.log(`Cặp trên ${keyword.kiem.articleTotal} câu có bài của nửa kiểm: chỉ từ khóa đúng ${onlyKeyword}, chỉ Naive Bayes đúng ${onlyBayes}; McNemar chính xác p = ${p.toFixed(3)}.`);
  console.log(`Kết luận theo luật ghi trước: ${wins ? 'Naive Bayes THẮNG' : 'Naive Bayes KHÔNG thắng; giữ cách tìm theo từ khóa'}.`);
  console.log('Lưu ý: nửa luyện nằm trong tập huấn luyện của Naive Bayes nên không dùng số nửa luyện để so.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

module.exports = { features, buildTrainingSet, trainNaiveBayes, classify, mcnemarExact, pickThreshold };
