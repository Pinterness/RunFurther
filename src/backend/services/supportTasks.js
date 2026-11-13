// Private-data tasks of the support bot (spec 4.7). A question is routed by fixed patterns on the
// normalized text, and every read is scoped to the userId of the verified token: nothing typed in
// the question (a BIB, an order code, an email) ever selects whose data is read. Reads only.
const Registration = require('../models/Registration');
const Booking = require('../models/Booking');
const Wallet = require('../models/Wallet');
const PaymentRequest = require('../models/PaymentRequest');
const { vnd, isExpired } = require('./topupService');
const { internalPath } = require('../../lib/internalPath.cjs');
const { calendarDate } = require('../../lib/runnerValidation.cjs');
const { normalizeSupportText } = require('./supportKnowledge');

const LIMITS = { privateRows: 20, queryMs: 1500, shown: 3 };

const TASK_KEYS = ['tickets', 'holds', 'wallet', 'supportTickets', 'results', 'runpoints'];
// One table for the guest prompt, the failed-read reply and the buttons of an unclear question.
// Button labels follow the pages they open: /account lists pending orders under "Đang chờ thanh toán / đối soát".
const TASKS = {
  tickets: { label: 'vé sắp chạy và số BIB', action: { label: 'Vé của tôi', url: '/account' } },
  holds: { label: 'đơn đang giữ chỗ', action: { label: 'Xem đơn chờ thanh toán', url: '/account' } },
  wallet: { label: 'số dư ví và lệnh nạp', action: { label: 'Ví của tôi', url: '/account/wallet' } },
  supportTickets: { label: 'yêu cầu hỗ trợ', action: { label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' } },
};
// Opens the "Nhân viên hỗ trợ" tab of the chat, which has the form for a new request.
const SUPPORT_ACTION = { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' };

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

// Reply wording follows the two language reviews of 13-11: "mình" to "bạn", the first sentence answers,
// and every "bấm …" names a button that is really shown under the reply.
const guestAnswer = key => ({
  reply: `Bạn cần đăng nhập thì mình mới xem được ${TASKS[key].label} của bạn. Bạn bấm nút Đăng nhập bên dưới rồi hỏi lại mình nhé.`,
  actions: [{ label: 'Đăng nhập', url: '/login' }],
});

const failedAnswer = key => ({
  reply: `Xin lỗi, mình chưa đọc được ${TASKS[key].label} của bạn lúc này. Bạn bấm "${TASKS[key].action.label}" để xem trực tiếp, hoặc bấm "${SUPPORT_ACTION.label}" nếu vẫn lỗi nhé.`,
  actions: [TASKS[key].action, SUPPORT_ACTION],
});

// The buttons open pages, so the reply does not promise that the bot itself will look.
function unclearAnswer() {
  const seen = new Set();
  const actions = Object.values(TASKS).map(task => task.action).filter(action => {
    const target = action.url || 'view:' + action.view;
    return !seen.has(target) && seen.add(target);
  });
  return {
    reply: 'Bạn muốn xem vé và đơn giữ chỗ, ví hay yêu cầu hỗ trợ? Bạn bấm nút để mở trang, hoặc hỏi rõ hơn như "số dư ví của tôi" nhé.',
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
// The words of the ticket card (TicketCard.jsx:6); PENDING_TRANSFER means the BIB is listed on the marketplace.
const TICKET_LABELS = { CONFIRMED: 'Vé đã xác nhận', CHECKED_IN: 'Đã check-in', KIT_COLLECTED: 'Đã nhận race-kit', PENDING_TRANSFER: 'Đang chuyển nhượng (đang rao bán)' };
// Dates and clock times in Vietnam time, whatever the server's time zone: "3/12/2026", "09:00".
const VIETNAM = { timeZone: 'Asia/Ho_Chi_Minh' };
const vietnamDate = value => new Date(value).toLocaleDateString('vi-VN', VIETNAM);
const vietnamClock = value => new Date(value).toLocaleTimeString('vi-VN', { ...VIETNAM, hour: '2-digit', minute: '2-digit' });
// populate runs a query of its own, which does not inherit maxTimeMS from the main query.
const populated = (path, select) => ({ path, select, options: { maxTimeMS: LIMITS.queryMs } });
const nameOf = row => `${row.eventId?.name || 'Giải chạy'}${row.categoryId?.name ? ` (${row.categoryId.name})` : ''}`;
// The count comes first, so a list cut to 3 lines says so before the lines ("Bạn có 4 vé…, đây là 3 vé…").
function listReply(rows, { what, first, rest, button }, line) {
  const heading = rows.length > LIMITS.shown ? `Bạn có ${rows.length} ${what}, đây là ${LIMITS.shown} ${first}:` : `Bạn có ${rows.length} ${what}:`;
  const more = rows.length > LIMITS.shown ? [`${rest} còn lại bạn xem trong "${button}" nhé.`] : [];
  return [heading, ...rows.slice(0, LIMITS.shown).map(line), ...more];
}

// Every reader filters by the userId of the verified token, selects only the fields it shows and is bounded.
const readers = {
  async tickets(userId, now) {
    const rows = await Registration.find({ userId, status: { $in: TICKET_STATUSES } })
      .select('eventId categoryId bibNumber status')
      .populate(populated('eventId', 'name status dateInfo.raceDate')).populate(populated('categoryId', 'name'))
      .sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    // Filter after reading, then cut to 3: tickets of past races are often newer and would crowd out upcoming ones.
    const today = calendarDate(now);
    const upcoming = rows.filter(row => row.eventId?.dateInfo?.raceDate && calendarDate(row.eventId.dateInfo.raceDate) >= today)
      .sort((x, y) => new Date(x.eventId.dateInfo.raceDate) - new Date(y.eventId.dateInfo.raceDate));
    const actions = [TASKS.tickets.action];
    // A VietQR order only becomes a ticket once the transfer is confirmed (bookingController confirmBooking).
    if (!upcoming.length) return { reply: 'Bạn chưa có vé sắp chạy nào. Nếu bạn vừa chuyển khoản, vé chỉ được cấp sau khi xác nhận tiền đã nhận. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".', actions };
    const lines = listReply(upcoming, { what: 'vé sắp chạy', first: 'vé chạy sớm nhất', rest: 'Vé', button: TASKS.tickets.action.label }, row => [
      '- ' + vietnamDate(row.eventId.dateInfo.raceDate), nameOf(row), row.bibNumber ? 'BIB ' + row.bibNumber : 'chưa có số BIB',
      // The ticket keeps its status when the organizer cancels the race, so the race status is checked here.
      row.eventId.status === 'CANCELLED' ? 'Giải đã bị hủy' : TICKET_LABELS[row.status],
    ].join(' · '));
    return { reply: lines.join('\n'), actions };
  },

  // Expired holds stay HOLD until the sweeper runs, so the query itself requires expiresAt > now.
  // The order code is not selected: it is the transfer content and the bot never needs it.
  async holds(userId, now) {
    const rows = await Booking.find({ userId, status: 'HOLD', expiresAt: { $gt: now } })
      .select('eventId categoryId expiresAt')
      .populate(populated('eventId', 'name')).populate(populated('categoryId', 'name'))
      .sort({ expiresAt: 1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    if (!rows.length) {
      return { reply: 'Bạn không có đơn nào đang giữ chỗ. Đơn quá giờ giữ chỗ mà chưa thanh toán đã hết hiệu lực, bạn cần đăng ký lại ở trang giải.', actions: [TASKS.tickets.action] };
    }
    // After "Tôi đã chuyển khoản" the booking stays HOLD and a BOOKING request waits for review: do not ask for payment again.
    const reported = await PaymentRequest.find({ userId, kind: 'BOOKING', status: 'PENDING', bookingId: { $in: rows.map(row => row._id) } })
      .select('bookingId').limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    const waiting = new Set(reported.map(request => String(request.bookingId)));
    const lines = listReply(rows, { what: 'đơn đang giữ chỗ', first: 'đơn sắp hết giờ nhất', rest: 'Đơn', button: TASKS.holds.action.label }, row => (waiting.has(String(row._id))
      ? `- ${nameOf(row)}: bạn đã báo chuyển khoản, đơn đang chờ đối soát nên bạn đừng chuyển thêm.`
      // The clock time stays true when the reply is read again later; the minutes are rounded up (spec 4.7).
      : `- ${nameOf(row)}: thanh toán trước ${vietnamClock(row.expiresAt)} (còn khoảng ${Math.ceil((new Date(row.expiresAt) - now) / 60000)} phút).`));
    // expireBookings sets EXPIRED and gives the held slot back to the category.
    lines.push('Quá giờ mà chưa thanh toán thì đơn hết hiệu lực và chỗ được trả lại.');
    return { reply: lines.join('\n'), actions: [TASKS.holds.action] };
  },

  // A wallet exists only once /account or /account/wallet was opened (walletController upserts it); the bot never creates one.
  // All PENDING top-ups are read, as the wallet page lists them: expired ones (topupService.isExpired) can still be
  // approved by an admin, and legacy ones without expiresAt never expire. Neither transferCode nor bankSnapshot is
  // selected. vnd throws on a missing number, which becomes a failed read.
  async wallet(userId, now) {
    const [wallet, pending] = await Promise.all([
      Wallet.findOne({ userId }).select('balance status').maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.find({ userId, kind: 'TOPUP', status: 'PENDING' })
        .select('amount createdAt expiresAt').sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean(),
    ]);
    const expired = pending.filter(row => isExpired(row, now));
    const waiting = pending.filter(row => !isExpired(row, now));
    const locked = Boolean(wallet) && wallet.status !== 'ACTIVE';
    const parts = [wallet ? `Số dư ví của bạn là ${vnd(wallet.balance)}.` : 'Bạn chưa có ví. Bạn bấm "Ví của tôi" bên dưới là ví được tạo ngay.'];
    if (waiting.length) {
      parts.push(...listReply(waiting, { what: 'lệnh nạp đang chờ đối soát', first: 'lệnh mới nhất', rest: 'Lệnh', button: TASKS.wallet.action.label },
        row => `- ${vnd(row.amount)}, tạo lúc ${vietnamClock(row.createdAt)} ngày ${vietnamDate(row.createdAt)}.`), 'Số dư chỉ tăng khi lệnh được duyệt.');
    } else if (wallet) parts.push('Bạn không có lệnh nạp nào đang chờ đối soát.');
    // The advice of the wallet page for an expired code (TransferDetails.jsx), without the code itself.
    if (expired.length) {
      parts.push(`Bạn có ${expired.length} lệnh nạp đã quá hạn (${expired.slice(0, LIMITS.shown).map(row => vnd(row.amount)).join(', ')}). Bạn đừng chuyển khoản theo lệnh đã quá hạn nữa. Nếu đã chuyển tiền, bạn bấm "${SUPPORT_ACTION.label}" để được đối soát.`);
    }
    // The same rule as topupService, which refuses a top-up for any wallet that is not ACTIVE.
    if (locked) parts.push(`Ví của bạn đang bị tạm khóa nên chưa thể nạp tiền. Bạn bấm "${SUPPORT_ACTION.label}" nếu cần mở lại nhé.`);
    return { reply: parts.join('\n'), actions: expired.length || locked ? [TASKS.wallet.action, SUPPORT_ACTION] : [TASKS.wallet.action] };
  },
};

const runTask = createTaskRunner({ readers });

module.exports = { TASK_KEYS, routeTask, taskForEval, toActions, guestAnswer, failedAnswer, unclearAnswer, createTaskRunner, runTask };
