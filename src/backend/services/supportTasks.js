// Private-data tasks of the support bot (spec 4.7). A question is routed by fixed patterns on the
// normalized text, and every read is scoped to the userId of the verified token: nothing typed in
// the question (a BIB, an order code, an email) ever selects whose data is read. Reads only.
const Registration = require('../models/Registration');
const Booking = require('../models/Booking');
const Wallet = require('../models/Wallet');
const PaymentRequest = require('../models/PaymentRequest');
const { vnd } = require('./topupService');
const { internalPath } = require('../../lib/internalPath.cjs');
const { calendarDate } = require('../../lib/runnerValidation.cjs');
const { normalizeSupportText } = require('./supportKnowledge');

const LIMITS = { privateRows: 20, queryMs: 1500, shown: 3 };

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

const TICKET_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED', 'PENDING_TRANSFER'];
// The same words as the ticket card (TicketCard.jsx:6); PENDING_TRANSFER means the BIB is listed on the marketplace.
const TICKET_LABELS = { CONFIRMED: 'Vé đã xác nhận', CHECKED_IN: 'Đã check-in', KIT_COLLECTED: 'Đã nhận race-kit', PENDING_TRANSFER: 'Đang chuyển nhượng' };
const vietnamDate = value => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
// "10:05 13/11/2026" in Vietnam time, whatever the server's time zone.
const vietnamTime = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

// Every reader filters by the userId of the verified token, selects only the fields it shows and is bounded.
const readers = {
  async tickets(userId, now) {
    const rows = await Registration.find({ userId, status: { $in: TICKET_STATUSES } })
      .select('eventId categoryId bibNumber status')
      .populate('eventId', 'name dateInfo.raceDate').populate('categoryId', 'name')
      .sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    // Filter after reading, then cut to 3: tickets of past races are often newer and would crowd out upcoming ones.
    const today = calendarDate(now);
    const upcoming = rows.filter(row => row.eventId?.dateInfo?.raceDate && calendarDate(row.eventId.dateInfo.raceDate) >= today)
      .sort((x, y) => new Date(x.eventId.dateInfo.raceDate) - new Date(y.eventId.dateInfo.raceDate));
    const actions = [TASKS.tickets.action];
    if (!upcoming.length) return { reply: 'Bạn chưa có vé sắp chạy nào trong tài khoản này. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".', actions };
    const lines = upcoming.slice(0, LIMITS.shown).map(row => `- ${row.eventId.name}${row.categoryId?.name ? ` (${row.categoryId.name})` : ''}, ngày ${vietnamDate(row.eventId.dateInfo.raceDate)}: BIB ${row.bibNumber || 'chưa cấp'}, ${TICKET_LABELS[row.status]}.`);
    const more = upcoming.length > LIMITS.shown ? `\nMình hiện ${LIMITS.shown} vé gần nhất, bạn xem đủ trong "Vé của tôi".` : '';
    return { reply: `Bạn có ${upcoming.length} vé sắp chạy:\n${lines.join('\n')}${more}`, actions };
  },

  // Expired holds stay HOLD until the sweeper runs, so the query itself requires expiresAt > now.
  // The order code is not selected: it is the transfer content and the bot never needs it.
  async holds(userId, now) {
    const rows = await Booking.find({ userId, status: 'HOLD', expiresAt: { $gt: now } })
      .select('eventId categoryId expiresAt')
      .populate('eventId', 'name').populate('categoryId', 'name')
      .sort({ expiresAt: 1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    const actions = [TASKS.holds.action];
    if (!rows.length) return { reply: 'Bạn không có đơn nào đang giữ chỗ. Đơn quá giờ giữ chỗ sẽ hết hiệu lực và không còn hiện ở đây.', actions };
    const lines = rows.slice(0, LIMITS.shown).map(row => `- ${row.eventId?.name || 'Giải chạy'}${row.categoryId?.name ? ` (${row.categoryId.name})` : ''}: còn ${Math.ceil((new Date(row.expiresAt) - now) / 60000)} phút để thanh toán.`);
    const more = rows.length > LIMITS.shown ? `\nMình hiện ${LIMITS.shown} đơn sắp hết giờ nhất, bạn xem đủ trong "Xem đơn đang giữ".` : '';
    return { reply: `Bạn có ${rows.length} đơn đang giữ chỗ:\n${lines.join('\n')}${more}\nQuá giờ mà chưa thanh toán thì đơn hết hiệu lực.`, actions };
  },

  // A wallet exists only after the wallet page was opened once (walletController upserts it); the bot never creates one.
  // Expired top-ups stay PENDING forever, so the query requires expiresAt > now, as topupService does.
  // Neither transferCode nor bankSnapshot is selected. vnd throws on a missing number, which becomes a failed read.
  async wallet(userId, now) {
    const [wallet, pending] = await Promise.all([
      Wallet.findOne({ userId }).select('balance status').maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.find({ userId, kind: 'TOPUP', status: 'PENDING', expiresAt: { $gt: now } })
        .select('amount createdAt').sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean(),
    ]);
    const parts = [wallet ? `Số dư ví của bạn là ${vnd(wallet.balance)}.` : 'Bạn chưa có ví. Ví được tạo khi bạn mở trang "Ví của tôi" lần đầu.'];
    // The same wording as topupService when it refuses a top-up for a wallet that is not ACTIVE.
    if (wallet && wallet.status !== 'ACTIVE') parts.push('Ví của bạn đang bị tạm khóa nên chưa thể nạp tiền. Bạn gửi yêu cầu hỗ trợ nếu cần mở lại nhé.');
    if (!pending.length) parts.push('Bạn không có lệnh nạp nào đang chờ đối soát.');
    else {
      const lines = pending.slice(0, LIMITS.shown).map(row => `- ${vnd(row.amount)}, tạo lúc ${vietnamTime(row.createdAt)}.`);
      const more = pending.length > LIMITS.shown ? `\nMình hiện ${LIMITS.shown} lệnh mới nhất, bạn xem đủ trong "Ví của tôi".` : '';
      parts.push(`Bạn có ${pending.length} lệnh nạp đang chờ đối soát:\n${lines.join('\n')}${more}\nSố dư chỉ tăng khi lệnh được duyệt.`);
    }
    return { reply: parts.join('\n'), actions: [TASKS.wallet.action] };
  },
};

const runTask = createTaskRunner({ readers });

module.exports = { TASK_KEYS, routeTask, taskForEval, toActions, guestAnswer, failedAnswer, unclearAnswer, createTaskRunner, runTask };
