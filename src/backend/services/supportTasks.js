// Private-data tasks of the support bot (spec 4.7). A question is routed by fixed patterns on the
// normalized text, and every read is scoped to the userId of the verified token: nothing typed in
// the question (a BIB, an order code, an email) ever selects whose data is read. Reads only.
const { internalPath } = require('../../lib/internalPath.cjs');
const { normalizeSupportText } = require('./supportKnowledge');

const TASK_KEYS = ['tickets', 'holds', 'wallet', 'supportTickets', 'results', 'runpoints'];
// One table for the guest prompt, the failed-read reply and the buttons of an unclear question.
const TASKS = {
  tickets: { label: 'vé sắp chạy và số BIB', action: { label: 'Vé của tôi', url: '/account' } },
  holds: { label: 'đơn đang giữ chỗ', action: { label: 'Xem đơn đang giữ', url: '/account' } },
  wallet: { label: 'số dư ví và lệnh nạp', action: { label: 'Ví của tôi', url: '/account/wallet' } },
  supportTickets: { label: 'yêu cầu hỗ trợ', action: { label: 'Mở yêu cầu hỗ trợ', view: 'tickets' } },
};

// A task question asks the bot to look at the asker's own data (spec 5.2). Questions that could be
// general, such as "giữ chỗ được bao lâu" or "số bib ở đâu", need an ownership word or "kiểm tra giúp".
// Patterns run on text without accents, where "vé"/"về", "ví"/"vì"/"vị" and "đơn"/"cô đơn"/"đơn vị"
// look alike, so a bare "vi" or "don" is never enough on its own.
const OWN = '(?:toi|minh|em|e)';
const PATTERNS = [
  ['tickets', new RegExp(`\\bve cua ${OWN}\\b|\\bkiem tra ve\\b|\\btrang thai ve cua\\b|\\btoi da mua\\b|\\bbib cua ${OWN}\\b|\\bkiem tra giup\\b.*\\bbib\\b`)],
  ['holds', new RegExp(`\\bdon (?:hang |giu cho |dat cho )?cua ${OWN}\\b|\\bkiem tra don\\b|\\btrang thai don\\b|\\bkiem tra giup\\b.*\\bdon (?:hang|giu cho|dat cho)\\b|\\b${OWN} co don (?:nao|dang)\\b`)],
  ['wallet', new RegExp(`(?<!\\bdon )\\bvi cua ${OWN}\\b|\\b(?:so du|sd)(?: vi)? cua ${OWN}\\b|\\b(?:check|kiem tra) (?:so du|sd)\\b|\\blenh nap (?:tien )?cua ${OWN}\\b`)],
  ['supportTickets', new RegExp(`\\b(?:yeu cau|ticket|phieu) ho tro cua ${OWN}\\b`)],
];

// `query` is already normalized. Returns { key }, { ambiguous: true } for a personal question that
// names no task, or null.
function routeTask(query) {
  const text = typeof query === 'string' ? query : '';
  for (const [key, pattern] of PATTERNS) if (pattern.test(text)) return { key };
  return /\bcua (?:toi|minh)\b/.test(text) ? { ambiguous: true } : null;
}

// The eval set scores routing as 'task:<key>' (spec 5.2).
const taskForEval = question => {
  const route = routeTask(normalizeSupportText(question));
  return route?.key ? 'task:' + route.key : null;
};

// At most 3 buttons: { label, url } with an internal url, or { label, view: 'tickets' }. Anything else is dropped.
function toActions(list) {
  if (!Array.isArray(list)) return [];
  const actions = [];
  for (const item of list) {
    if (actions.length === 3) break;
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > 40) continue;
    if (item.view === 'tickets') { actions.push({ label, view: 'tickets' }); continue; }
    const url = internalPath(item.url);
    if (url !== null) actions.push({ label, url });
  }
  return actions;
}

// Reply wording follows the language review of 13-11: "mình" to "bạn", the first sentence answers.
const guestAnswer = key => ({
  reply: `Bạn cần đăng nhập thì mình mới xem được ${TASKS[key].label} của bạn. Bạn bấm nút Đăng nhập bên dưới nhé.`,
  actions: [{ label: 'Đăng nhập', url: '/login' }],
});

const failedAnswer = key => ({
  reply: `Xin lỗi, mình chưa đọc được ${TASKS[key].label} của bạn lúc này. Bạn thử mở "${TASKS[key].action.label}" bên dưới để xem trực tiếp, hoặc gửi yêu cầu hỗ trợ nếu vẫn lỗi nhé.`,
  actions: [TASKS[key].action],
});

function unclearAnswer() {
  const seen = new Set();
  const actions = Object.values(TASKS).map(task => task.action).filter(action => {
    const target = action.url || 'view:' + action.view;
    return !seen.has(target) && seen.add(target);
  });
  return {
    reply: 'Bạn muốn mình xem mục nào của tài khoản: vé và đơn giữ chỗ, ví hay yêu cầu hỗ trợ? Bạn bấm nút bên dưới hoặc nói rõ hơn giúp mình nhé.',
    actions: toActions(actions),
  };
}

// readers[key](userId, now) reads the asker's rows and returns { reply, actions }.
function createTaskRunner({ readers = {} } = {}) {
  return async function runTask(key, userId, { now = new Date() } = {}) {
    const read = readers[key];
    if (typeof read !== 'function') throw new Error(`No reader for task "${key}".`);
    const answer = await read(userId, now);
    if (typeof answer?.reply !== 'string' || !answer.reply.trim()) throw new Error(`Task "${key}" returned no reply.`);
    return { reply: answer.reply, actions: toActions(answer.actions), sources: [] };
  };
}

const runTask = createTaskRunner();

module.exports = { TASK_KEYS, routeTask, taskForEval, toActions, guestAnswer, failedAnswer, unclearAnswer, createTaskRunner, runTask };
