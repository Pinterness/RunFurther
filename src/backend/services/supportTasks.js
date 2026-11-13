// Các "tác vụ" của trợ lý hỗ trợ: đọc dữ liệu riêng của chính người đang hỏi (spec mục 4.7).
// Câu hỏi được chuyển tới tác vụ bằng các mẫu cố định trên câu đã bỏ dấu. Mọi lần đọc chỉ lọc theo userId
// lấy từ token (chuỗi đăng nhập mà trình duyệt gửi kèm request, server đã kiểm chữ ký). Dù người hỏi gõ
// BIB, mã đơn hay email của người khác, bot vẫn chỉ đọc dữ liệu của chủ token. Tác vụ chỉ đọc, không ghi.
const Registration = require('../models/Registration');
const Booking = require('../models/Booking');
const Wallet = require('../models/Wallet');
const PaymentRequest = require('../models/PaymentRequest');
const { vnd, isExpired } = require('./topupService');
const { internalPath } = require('../../lib/internalPath.cjs');
const { calendarDate } = require('../../lib/runnerValidation.cjs');
const { normalizeSupportText } = require('./supportKnowledge');

// privateRows: số dòng tối đa một truy vấn được đọc; queryMs: thời gian tối đa của một truy vấn (maxTimeMS);
// shown: số dòng tối đa hiện trong câu trả lời.
const LIMITS = { privateRows: 20, queryMs: 1500, shown: 3 };

const TASK_KEYS = ['tickets', 'holds', 'wallet', 'supportTickets', 'results', 'runpoints'];
// Một bảng dùng chung cho câu mời đăng nhập, câu báo đọc lỗi và các nút của câu hỏi chưa rõ ý.
// Nhãn nút theo đúng trang mà nút mở ra: trang /account liệt kê đơn chưa trả tiền ở mục "Đang chờ thanh toán / đối soát".
const TASKS = {
  tickets: { label: 'vé sắp chạy và số BIB', action: { label: 'Vé của tôi', url: '/account' } },
  holds: { label: 'đơn đang giữ chỗ', action: { label: 'Xem đơn chờ thanh toán', url: '/account' } },
  wallet: { label: 'số dư ví và lệnh nạp', action: { label: 'Ví của tôi', url: '/account/wallet' } },
  supportTickets: { label: 'yêu cầu hỗ trợ', action: { label: 'Yêu cầu hỗ trợ của tôi', view: 'tickets' } },
};
// Nút mở tab "Nhân viên hỗ trợ" trong khung chat, nơi có form gửi yêu cầu mới.
const SUPPORT_ACTION = { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' };

// Câu hỏi tác vụ là câu nhờ bot xem dữ liệu của chính người hỏi (spec mục 5.2). Những câu có thể chỉ là
// câu hỏi chung, như "giữ chỗ được bao lâu" hay "số bib ở đâu", phải có chữ chỉ sở hữu ("của tôi", "của mình")
// hoặc "kiểm tra giúp". Mẫu chạy trên câu đã bỏ dấu, nơi "vé"/"về", "ví"/"vì"/"vị" và "đơn"/"cô đơn"/"đơn vị"
// trông giống nhau, nên chữ "vi" hay "don" đứng một mình không bao giờ đủ để nhận là tác vụ.
const OWN = '(?:toi|minh|em|e)';
const PATTERNS = [
  ['tickets', new RegExp(`\\bve cua ${OWN}\\b|\\bkiem tra ve\\b|\\btrang thai ve cua\\b|\\btoi da mua\\b|\\bbib cua ${OWN}\\b|\\bkiem tra giup\\b.*\\bbib\\b`)],
  ['holds', new RegExp(`\\bdon (?:hang |giu cho |dat cho )?cua ${OWN}\\b|\\bkiem tra don\\b|\\btrang thai don\\b|\\bkiem tra giup\\b.*\\bdon (?:hang|giu cho|dat cho)\\b|\\b${OWN} co don (?:nao|dang)\\b`)],
  ['wallet', new RegExp(`(?<!\\bdon )\\bvi cua ${OWN}\\b|\\b(?:so du|sd)(?: vi)? cua ${OWN}\\b|\\b(?:check|kiem tra) (?:so du|sd)\\b|\\blenh nap (?:tien )?cua ${OWN}\\b`)],
  ['supportTickets', new RegExp(`\\b(?:yeu cau|ticket|phieu) ho tro cua ${OWN}\\b`)],
];

// `query` là câu đã chuẩn hóa (chữ thường, bỏ dấu). Trả về { key } khi nhận ra tác vụ, { ambiguous: true }
// khi câu có "của tôi" mà không nói rõ tác vụ nào, hoặc null khi đây không phải câu tác vụ.
function routeTask(query) {
  const text = typeof query === 'string' ? query : '';
  for (const [key, pattern] of PATTERNS) if (pattern.test(text)) return { key };
  return /\bcua (?:toi|minh)\b/.test(text) ? { ambiguous: true } : null;
}

// Bộ câu đo chấm phần định tuyến theo dạng 'task:<key>' (spec mục 5.2).
const taskForEval = question => {
  const route = routeTask(normalizeSupportText(question));
  return route?.key ? 'task:' + route.key : null;
};

// Lọc nút trước khi gửi cho giao diện: tối đa 3 nút, mỗi nút là { label, url } với url nội bộ, hoặc
// { label, view: 'tickets' } để mở tab hỗ trợ trong khung chat. Nút khác dạng này thì bị bỏ.
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

// Câu chữ theo hai lần soát ngôn ngữ ngày 13-11: bot xưng "mình", gọi "bạn", câu đầu trả lời thẳng câu hỏi,
// và mỗi lời dặn "bấm …" đều gọi đúng tên một nút có thật bên dưới câu trả lời.
const guestAnswer = key => ({
  reply: `Bạn cần đăng nhập thì mình mới xem được ${TASKS[key].label} của bạn. Bạn bấm nút Đăng nhập bên dưới rồi hỏi lại mình nhé.`,
  actions: [{ label: 'Đăng nhập', url: '/login' }],
});

const failedAnswer = key => ({
  reply: `Xin lỗi, mình chưa đọc được ${TASKS[key].label} của bạn lúc này. Bạn bấm "${TASKS[key].action.label}" để xem trực tiếp, hoặc bấm "${SUPPORT_ACTION.label}" nếu vẫn lỗi nhé.`,
  actions: [TASKS[key].action, SUPPORT_ACTION],
});

// Các nút chỉ mở trang, nên câu trả lời không hứa là bot sẽ tự xem giúp.
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

// Mỗi readers[key](userId, now) đọc dữ liệu của người hỏi rồi trả về { reply, actions }. Reader lỗi hoặc
// trả câu rỗng thì runTask ném lỗi, và supportAiService đổi lỗi đó thành câu "chưa đọc được".
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
// Chữ giống thẻ vé (TicketCard.jsx:6). PENDING_TRANSFER nghĩa là BIB đang được rao bán trên chợ chuyển nhượng.
const TICKET_LABELS = { CONFIRMED: 'Vé đã xác nhận', CHECKED_IN: 'Đã check-in', KIT_COLLECTED: 'Đã nhận race-kit', PENDING_TRANSFER: 'Đang chuyển nhượng (đang rao bán)' };
// Ngày và giờ luôn theo giờ Việt Nam, dù máy chủ đặt múi giờ nào: "3/12/2026", "09:00".
const VIETNAM = { timeZone: 'Asia/Ho_Chi_Minh' };
const vietnamDate = value => new Date(value).toLocaleDateString('vi-VN', VIETNAM);
const vietnamClock = value => new Date(value).toLocaleTimeString('vi-VN', { ...VIETNAM, hour: '2-digit', minute: '2-digit' });
// populate là bước Mongoose chạy thêm một truy vấn để lấy bản ghi mà eventId hay categoryId trỏ tới (tên giải,
// tên cự ly). Truy vấn phụ này không tự nhận giới hạn thời gian của truy vấn chính, nên phải đặt lại maxTimeMS.
const populated = (path, select) => ({ path, select, options: { maxTimeMS: LIMITS.queryMs } });
// "Huế Heritage Run (Half Marathon 21K)"; giải đã bị xóa thì ghi "Giải chạy".
const nameOf = row => `${row.eventId?.name || 'Giải chạy'}${row.categoryId?.name ? ` (${row.categoryId.name})` : ''}`;
// Câu trả lời dạng danh sách: số lượng đứng đầu, nên khi chỉ hiện 3 dòng thì người đọc biết ngay còn bao nhiêu
// ("Bạn có 4 vé…, đây là 3 vé…"), và dòng cuối chỉ nút để xem phần còn lại.
function listReply(rows, { what, first, rest, button }, line) {
  const heading = rows.length > LIMITS.shown ? `Bạn có ${rows.length} ${what}, đây là ${LIMITS.shown} ${first}:` : `Bạn có ${rows.length} ${what}:`;
  const more = rows.length > LIMITS.shown ? [`${rest} còn lại bạn xem trong "${button}" nhé.`] : [];
  return [heading, ...rows.slice(0, LIMITS.shown).map(line), ...more];
}

// Reader nào cũng lọc theo userId của token, chỉ chọn những trường nó hiện ra, và có giới hạn số dòng lẫn thời gian.
const readers = {
  async tickets(userId, now) {
    const rows = await Registration.find({ userId, status: { $in: TICKET_STATUSES } })
      .select('eventId categoryId bibNumber status')
      .populate(populated('eventId', 'name status dateInfo.raceDate')).populate(populated('categoryId', 'name'))
      .sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    // Đọc xong mới lọc giải sắp chạy rồi cắt còn 3: vé của giải đã qua thường được tạo sau, nên nếu cắt ngay
    // trong truy vấn thì chúng chiếm hết chỗ của vé sắp chạy.
    const today = calendarDate(now);
    const upcoming = rows.filter(row => row.eventId?.dateInfo?.raceDate && calendarDate(row.eventId.dateInfo.raceDate) >= today)
      .sort((x, y) => new Date(x.eventId.dateInfo.raceDate) - new Date(y.eventId.dateInfo.raceDate));
    const actions = [TASKS.tickets.action];
    // Đơn chuyển khoản VietQR chỉ thành vé khi chủ giải duyệt khoản chuyển (approveBookingPayment trong
    // paymentController gọi completeBooking).
    if (!upcoming.length) return { reply: 'Bạn chưa có vé sắp chạy nào. Nếu bạn vừa chuyển khoản, vé chỉ được cấp sau khi xác nhận tiền đã nhận. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".', actions };
    const lines = listReply(upcoming, { what: 'vé sắp chạy', first: 'vé chạy sớm nhất', rest: 'Vé', button: TASKS.tickets.action.label }, row => [
      '- ' + vietnamDate(row.eventId.dateInfo.raceDate), nameOf(row), row.bibNumber ? 'BIB ' + row.bibNumber : 'chưa có số BIB',
      // Khi ban tổ chức hủy giải, vé vẫn giữ trạng thái cũ, nên phải xét trạng thái của giải ở đây.
      row.eventId.status === 'CANCELLED' ? 'Giải đã bị hủy' : TICKET_LABELS[row.status],
    ].join(' · '));
    return { reply: lines.join('\n'), actions };
  },

  // Đơn quá giờ vẫn mang trạng thái HOLD cho tới khi bộ quét (expireBookings) chạy, nên chính truy vấn phải
  // đòi expiresAt > now. Không đọc mã đơn: mã này cũng là nội dung chuyển khoản, và bot không cần tới.
  async holds(userId, now) {
    const rows = await Booking.find({ userId, status: 'HOLD', expiresAt: { $gt: now } })
      .select('eventId categoryId expiresAt')
      .populate(populated('eventId', 'name')).populate(populated('categoryId', 'name'))
      .sort({ expiresAt: 1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    if (!rows.length) {
      return { reply: 'Bạn không có đơn nào đang giữ chỗ. Đơn quá giờ giữ chỗ mà chưa thanh toán đã hết hiệu lực, bạn cần đăng ký lại ở trang giải.', actions: [TASKS.tickets.action] };
    }
    // Sau khi người chạy bấm "Tôi đã chuyển khoản", đơn vẫn là HOLD và có thêm một lệnh BOOKING chờ duyệt.
    // Đơn như vậy thì bot không giục thanh toán nữa.
    const reported = await PaymentRequest.find({ userId, kind: 'BOOKING', status: 'PENDING', bookingId: { $in: rows.map(row => row._id) } })
      .select('bookingId').limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    const waiting = new Set(reported.map(request => String(request.bookingId)));
    const lines = listReply(rows, { what: 'đơn đang giữ chỗ', first: 'đơn sắp hết giờ nhất', rest: 'Đơn', button: TASKS.holds.action.label }, row => (waiting.has(String(row._id))
      ? `- ${nameOf(row)}: bạn đã báo chuyển khoản, đơn đang chờ đối soát nên bạn đừng chuyển thêm.`
      // Giờ hết hạn vẫn đúng khi người dùng đọc lại tin nhắn sau vài phút; số phút làm tròn lên (spec mục 4.7).
      : `- ${nameOf(row)}: thanh toán trước ${vietnamClock(row.expiresAt)} (còn khoảng ${Math.ceil((new Date(row.expiresAt) - now) / 60000)} phút).`));
    // expireBookings đổi đơn quá giờ sang EXPIRED và trả chỗ đã giữ lại cho cự ly đó.
    lines.push('Quá giờ mà chưa thanh toán thì đơn hết hiệu lực và chỗ được trả lại.');
    return { reply: lines.join('\n'), actions: [TASKS.holds.action] };
  },

  // Ví được tạo khi người dùng mở một trang có gọi GET /wallet (tài khoản, ví, đăng ký giải) hoặc khi được cộng
  // tiền lần đầu (walletService); bot không bao giờ tự tạo ví. Bot đọc mọi lệnh nạp PENDING, giống trang ví: lệnh
  // quá hạn (theo topupService.isExpired) vẫn được admin duyệt, còn lệnh cũ không có expiresAt thì không bao giờ
  // hết hạn. Không đọc transferCode hay bankSnapshot. Hàm vnd ném lỗi khi thiếu số tiền, và lỗi đó thành câu "chưa đọc được".
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
    // Lời dặn của trang ví cho mã đã hết hạn (TransferDetails.jsx), nhưng không kèm mã.
    if (expired.length) {
      parts.push(`Bạn có ${expired.length} lệnh nạp đã quá hạn (${expired.slice(0, LIMITS.shown).map(row => vnd(row.amount)).join(', ')}). Bạn đừng chuyển khoản theo lệnh đã quá hạn nữa. Nếu đã chuyển tiền, bạn bấm "${SUPPORT_ACTION.label}" để được đối soát.`);
    }
    // Cùng quy tắc với topupService: ví nào không ACTIVE thì không được nạp tiền.
    if (locked) parts.push(`Ví của bạn đang bị tạm khóa nên chưa thể nạp tiền. Bạn bấm "${SUPPORT_ACTION.label}" nếu cần mở lại nhé.`);
    return { reply: parts.join('\n'), actions: expired.length || locked ? [TASKS.wallet.action, SUPPORT_ACTION] : [TASKS.wallet.action] };
  },
};

const runTask = createTaskRunner({ readers });

module.exports = { TASK_KEYS, routeTask, taskForEval, toActions, guestAnswer, failedAnswer, unclearAnswer, createTaskRunner, runTask };
