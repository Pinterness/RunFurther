// Measures how well the support bot picks articles on the 60-question eval set (spec 5.2, 5.3). Read-only.
// Usage: node scripts/evalSupport.js --seed   the 11 original articles, no database
//        node scripts/evalSupport.js          PUBLISHED articles in MONGODB_URI (dev)
//        node --env-file=.env.atlas.local scripts/evalSupport.js   the same on Atlas
// The luyen half lists every failure; the kiem half prints totals only (spec 5.2: never tune terms on it).
//
// Chấm câu trả lời AI (spec 5.4, T13), chỉ đọc DB, mỗi câu tốn một lượt Gemini của project chấm:
//   node --env-file=.env.atlas.local --env-file=.env.ai.local scripts/evalSupport.js --ai --limit 20
// .env.ai.local (bị .gitignore chặn) chứa SUPPORT_AI_PROVIDER=gemini, SUPPORT_AI_MODEL và GEMINI_API_KEY của một
// project Google riêng cho việc chấm, không gắn tài khoản thanh toán. Mỗi câu được gửi kèm đúng bài `expected` của
// nó; câu hỏi, bài và câu trả lời được ghi ra docs/ke-hoach/cham-ai-P08.md để chấm tay. Khóa không bao giờ được in.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const items = require('../tests/helpers/supportEvalSet.json');
const { rankArticles, seedArticles } = require('../src/backend/services/supportKnowledge');
const { loadPublishedArticles } = require('../src/backend/services/supportKnowledgeStore');
const { evaluateSupport, selectAiItems } = require('../src/backend/services/supportEval');
const { describeTarget } = require('./seedSupportKnowledge');
const { taskForEval } = require('../src/backend/services/supportTasks');
const { createChatAdapter, retrievePublicEvents } = require('../src/backend/services/supportAiService');
const { readAiConfig } = require('../src/backend/services/supportAiConfig');

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? NaN : Number(process.argv[index + 1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = text => String(text ?? '').split('\n').map(line => '> ' + line).join('\n');
const vnTime = date => date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

async function connect() {
  require('dotenv').config();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  return describeTarget(process.env.MONGODB_URI, mongoose.connection.db.databaseName);
}

async function runAiEval() {
  const config = readAiConfig(process.env);
  if (!config) throw new Error('Thiếu SUPPORT_AI_PROVIDER=gemini, GEMINI_API_KEY hoặc SUPPORT_AI_MODEL (đặt trong .env.ai.local).');
  const limit = argValue('--limit', 20), delayMs = argValue('--delay-ms', 4000);
  const target = await connect();
  const byKey = new Map((await loadPublishedArticles()).map(article => [article.key, article]));
  const redact = text => String(text ?? '').split(config.key).join('[khóa]');
  // Ghi lại mã HTTP, finish_reason và số token của lần gọi gần nhất, để biết vì sao một câu trả về null
  // (429 hết lượt, bị cắt vì hết token, tham số bị từ chối...). Không ghi header nên khóa không lọt vào đây.
  let last = null;
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    last = { status: response.status };
    try {
      const data = await response.clone().json();
      const body = Array.isArray(data) ? data[0] : data;
      last.finish = body?.choices?.[0]?.finish_reason ?? null;
      last.usage = body?.usage ?? null;
      if (body?.error) last.error = redact(body.error.message || JSON.stringify(body.error)).slice(0, 300);
    } catch { /* body không phải JSON: adapter cũng sẽ trả null */ }
    return response;
  };
  const adapter = createChatAdapter({ env: process.env, fetchImpl });
  const picked = selectAiItems(items, limit), rows = [];
  let calls = 0;
  for (const item of picked) {
    const article = byKey.get(item.expected);
    if (!article) { rows.push({ item, note: 'Không có bài PUBLISHED với key này trong database, không gọi AI.' }); continue; }
    if (calls) await sleep(delayMs);
    const events = item.expected === 'events' ? await retrievePublicEvents({ message: item.question, page: '/' }).catch(() => []) : [];
    last = null;
    const reply = await adapter({ question: item.question, articles: [article], events });
    if (last) calls += 1;
    rows.push({ item, article, reply, call: last, events: events.length });
    console.log(`${item.id}: ${reply ? 'có câu trả lời' : 'null'}${last ? ` (HTTP ${last.status}${last.finish ? ', ' + last.finish : ''})` : ' (không gọi)'}`);
  }

  const ranAt = new Date();
  const lines = [
    '# Chấm câu trả lời AI · P08', '',
    `- Ngày chạy: ${vnTime(ranAt)} (giờ Việt Nam). Model: \`${config.model}\`. Database bài: \`${target.database}\`.`,
    `- Số lần gọi Gemini: ${calls} (project chấm riêng). Số câu nhận \`null\` (bot sẽ dùng guide): ${rows.filter(row => row.article && !row.reply).length}.`,
    '- Bộ câu: các câu đầu tiên (theo id) có bài của nửa kiểm; mỗi câu gửi kèm đúng bài `expected` (spec T13). Không dùng các câu này để chỉnh từ khóa.',
    '- Thang chấm (spec 5.4): **Đ** đúng theo bài · **T** thiếu ý · **S** sai hoặc bịa · **L** có link hay nội dung lạ. Mức đạt: ít nhất 16/20 Đ và không câu nào S hay L.', '',
    '| # | id | Bài | Claude chấm | Bạn chốt |', '| --- | --- | --- | --- | --- |',
    ...rows.map((row, index) => `| ${index + 1} | ${row.item.id} | ${row.item.expected} |  |  |`), '',
  ];
  for (const [index, row] of rows.entries()) {
    lines.push(`## ${index + 1}. ${row.item.id}: ${row.item.question}`, '');
    if (!row.article) { lines.push(`- ${row.note}`, ''); continue; }
    const call = row.call ? `HTTP ${row.call.status}, finish_reason \`${row.call.finish ?? 'không có'}\`${row.call.usage ? `, token vào/ra ${row.call.usage.prompt_tokens}/${row.call.usage.completion_tokens}` : ''}${row.call.error ? `, lỗi: ${row.call.error}` : ''}` : 'không gọi (câu bị bộ lọc nhạy cảm chặn hoặc adapter đang bận)';
    lines.push(`- Bài: \`${row.article.key}\` · ${row.article.title}${row.events ? ` · kèm ${row.events} giải công khai` : ''}`, `- Lần gọi: ${call}`, '', '**Câu trả lời AI:**', '', row.reply ? quote(redact(row.reply)) : '> (null: bot dùng câu trả lời soạn sẵn)', '', '**Bài gốc để đối chiếu:**', '', quote(row.article.answer), '', '- Claude chấm: ', '- Bạn chốt: ', '');
  }
  const dir = path.join(__dirname, '..', 'docs', 'ke-hoach');
  fs.mkdirSync(dir, { recursive: true });
  // Không ghi đè bản đã chấm: lần chạy sau ghi sang file có thêm thời điểm.
  let file = path.join(dir, 'cham-ai-P08.md');
  if (fs.existsSync(file)) file = path.join(dir, `cham-ai-P08-${ranAt.toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`Đã ghi ${rows.length} câu vào ${path.relative(process.cwd(), file)}; số lần gọi Gemini: ${calls}.`);
}

async function runRanking() {
  let articles, target;
  if (process.argv.includes('--seed')) {
    articles = seedArticles();
    target = { source: 'seed' };
  } else {
    target = { source: 'database', ...(await connect()) };
    articles = await loadPublishedArticles();
  }
  const metrics = await evaluateSupport(items, { rank: question => rankArticles(articles, question), routeTask: taskForEval });
  console.log(JSON.stringify({ ...target, articles: articles.length, ...metrics }, null, 2));
}

(process.argv.includes('--ai') ? runAiEval() : runRanking())
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
