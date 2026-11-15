// Các "tác vụ" của trợ lý hỗ trợ: đọc dữ liệu riêng của chính người đang hỏi (spec mục 4.7).
// Câu hỏi được chuyển tới tác vụ bằng các mẫu cố định trên câu đã bỏ dấu. Mọi lần đọc chỉ lọc theo userId
// lấy từ token (chuỗi đăng nhập mà trình duyệt gửi kèm request, server đã kiểm chữ ký). Dù người hỏi gõ
// BIB, mã đơn hay email của người khác, bot vẫn chỉ đọc dữ liệu của chủ token. Tác vụ chỉ đọc, không ghi.
const Registration = require('../models/Registration');
const Booking = require('../models/Booking');
const Wallet = require('../models/Wallet');
const PaymentRequest = require('../models/PaymentRequest');
const SupportTicket = require('../models/SupportTicket');
const RunPoints = require('../models/RunPoints');
const { vnd } = require('./topupService');
const { toActions, actionLabel } = require('../../lib/supportActions.cjs');
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
  // Không có trang nào liệt kê thời gian chạy của riêng người dùng. Trang /account hiện số giải đã hoàn thành và quãng
  // đường đã chạy, và chân trang gọi trang đó là "Vé & thành tích". Trang ví hiện số RunPoints.
  results: { label: 'kết quả chạy', action: { label: 'Vé và thành tích', url: '/account' } },
  runpoints: { label: 'điểm RunPoints', action: { label: 'Ví của tôi', url: '/account/wallet' } },
};
// Nút mở tab "Nhân viên hỗ trợ" trong khung chat, nơi có form gửi yêu cầu mới.
const SUPPORT_ACTION = { label: 'Gửi yêu cầu hỗ trợ', view: 'tickets' };

// Câu hỏi tác vụ là câu nhờ bot xem dữ liệu của chính người hỏi (spec mục 5.2). Những câu có thể chỉ là
// câu hỏi chung, như "giữ chỗ được bao lâu" hay "số bib ở đâu", phải có chữ chỉ sở hữu ("của tôi", "của mình")
// hoặc "kiểm tra giúp". Mẫu chạy trên câu đã bỏ dấu, nơi "vé"/"về", "ví"/"vì"/"vị" và "đơn"/"cô đơn"/"đơn vị"
// trông giống nhau, nên chữ "vi" hay "don" đứng một mình không bao giờ đủ để nhận là tác vụ.
const OWN = '(?:toi|minh|em|e)';
// "Kiểm tra vé" và "kiểm tra về …" bỏ dấu đều thành "kiem tra ve"; "kiểm tra đơn" và "kiểm tra đơn vị" đều bắt đầu
// bằng "kiem tra don". Vì vậy sau "kiem tra ve"/"kiem tra don" phải là hết câu, một chữ thường đi sau lời nhờ
// xem vé hay đơn ("của", "giúp", "nhé", "BIB"…), hoặc một mã có chữ số như "RUN0B1C…", "HM21K" hay "1024" (có thể
// kèm "mã", "số" phía trước). Còn "kiểm tra về việc hoàn tiền" thì có một chủ đề đi sau.
const ASK_TAIL = `(?:$| (?:cua|giup|dum|ho|nha|nhe|voi|di|bib|${OWN})\\b| (?:ma |so )?[a-z]*\\d)`;
const RESULT_WORDS = '(?:ket qua|kq|thanh tich|chip time|gun time|thoi gian (?:chay|ve dich|hoan thanh))';
const POINT_WORDS = '(?:runpoints?|run points?)';
// Mẫu được thử theo thứ tự, mẫu khớp trước thắng:
// - kết quả đứng trước vé, để "kiểm tra giúp kết quả của BIB …" là câu hỏi kết quả chứ không phải câu hỏi vé;
// - RunPoints đứng trước ví, để "ví của tôi có bao nhiêu điểm" là câu hỏi điểm.
// "Điểm" đứng một mình chỉ tính khi đứng đầu câu hoặc sau "số", "xem", "check", "kiểm tra", "tổng", vì nó còn nằm
// trong "địa điểm", "quan điểm". "Kết quả" phải đi liền "của tôi" để "kết quả xét duyệt của tôi" không bị kéo vào;
// sau "kiểm tra giúp" thì "kết quả" phải nói về giải chạy (hết câu, "chạy", "giải", "BIB", "của tôi"…), để
// "kiểm tra giúp kết quả xét duyệt" hay "kiểm tra giúp kết quả nạp tiền" cũng không bị kéo vào.
const PATTERNS = [
  ['results', new RegExp(`\\b${RESULT_WORDS}(?: chay| thi dau| giai)? cua ${OWN}\\b`
    + `|\\bkiem tra giup\\b.*\\b(?:thanh tich|chip time|gun time|(?:ket qua|kq)(?:$| (?:chay|thi dau|giai|bib|cua (?:${OWN}|bib)|nha|nhe|voi|di|${OWN})\\b))`)],
  ['tickets', new RegExp(`\\bve cua ${OWN}\\b|\\bkiem tra ve(?: da mua\\b|${ASK_TAIL})|\\btrang thai ve cua\\b|\\btoi da mua\\b|\\bbib cua ${OWN}\\b|\\bkiem tra giup\\b.*\\bbib\\b`)],
  ['holds', new RegExp(`\\bdon (?:hang |giu cho |dat cho )?cua ${OWN}\\b|\\bkiem tra don(?: (?:hang|giu cho|dat cho)\\b|${ASK_TAIL})|\\btrang thai don\\b|\\bkiem tra giup\\b.*\\bdon (?:hang|giu cho|dat cho)\\b|\\b${OWN} co don (?:nao|dang)\\b`)],
  ['runpoints', new RegExp(`\\b(?:${POINT_WORDS}|xu) cua ${OWN}\\b|\\bdiem (?:thuong|tich luy|runpoints?) cua ${OWN}\\b`
    + `|(?:^|\\b(?:so|xem|check|kiem tra|tong) )diem cua ${OWN}\\b|\\b${OWN} (?:co|con|dang co|con lai) (?:bao nhieu|may) (?:diem|xu|${POINT_WORDS})\\b`
    + `|\\b(?:check|kiem tra)(?: giup)?(?: ${OWN})? (?:diem thuong|${POINT_WORDS})\\b`)],
  ['wallet', new RegExp(`(?<!\\bdon )\\bvi cua ${OWN}\\b|\\b(?:so du|sd)(?: vi)? cua ${OWN}\\b|\\b(?:check|kiem tra) (?:so du|sd)\\b|\\blenh nap (?:tien )?cua ${OWN}\\b`)],
  ['supportTickets', new RegExp(`\\b(?:yeu cau|ticket|phieu) ho tro cua ${OWN}\\b`)],
];

// Câu chưa rõ ý nhận cùng các chữ sở hữu với mẫu tác vụ: "của tôi", "của mình", "của em", "của e".
const OWNERSHIP = new RegExp(`\\bcua ${OWN}\\b`);

// `query` là câu đã chuẩn hóa (chữ thường, bỏ dấu). Trả về { key } khi nhận ra tác vụ, { ambiguous: true }
// khi câu có chữ sở hữu ("của tôi"…) mà không nói rõ tác vụ nào, hoặc null khi đây không phải câu tác vụ.
function routeTask(query) {
  const text = typeof query === 'string' ? query : '';
  for (const [key, pattern] of PATTERNS) if (pattern.test(text)) return { key };
  return OWNERSHIP.test(text) ? { ambiguous: true } : null;
}

// Bộ câu đo chấm phần định tuyến theo dạng 'task:<key>' (spec mục 5.2).
const taskForEval = question => {
  const route = routeTask(normalizeSupportText(question));
  return route?.key ? 'task:' + route.key : null;
};

// Câu chữ theo các lần soát ngôn ngữ ngày 13-11: bot xưng "mình", gọi "bạn", câu đầu trả lời thẳng câu hỏi,
// và mỗi lời dặn "bấm …" đều gọi đúng tên một nút có thật bên dưới câu trả lời.
const guestAnswer = key => ({
  reply: `Bạn cần đăng nhập thì mình mới xem được ${TASKS[key].label} của bạn. Bạn bấm nút "Đăng nhập" bên dưới rồi hỏi lại mình nhé.`,
  actions: [{ label: 'Đăng nhập', url: '/login' }],
});

// Nút của tác vụ yêu cầu hỗ trợ đã mở đúng tab hỗ trợ, nên khi đó không thêm nút "Gửi yêu cầu hỗ trợ" trỏ cùng chỗ.
function failedAnswer(key) {
  const { label, action } = TASKS[key];
  const sameTab = action.view === SUPPORT_ACTION.view;
  return {
    reply: `Xin lỗi, mình chưa xem được ${label} của bạn lúc này. Bạn bấm "${action.label}" để xem trực tiếp${sameTab ? '' : `, hoặc bấm "${SUPPORT_ACTION.label}" nếu vẫn lỗi`} nhé.`,
    actions: sameTab ? [action] : [action, SUPPORT_ACTION],
  };
}

// Nút thứ ba mở tab trong khung chat chứ không mở trang, nên câu chỉ nói "bấm một nút"; "vé (kể cả đơn giữ chỗ)"
// là một lựa chọn vì vé và đơn giữ chỗ cùng nằm ở trang tài khoản.
function unclearAnswer() {
  const seen = new Set();
  const actions = Object.values(TASKS).map(task => task.action).filter(action => {
    const target = action.url || 'view:' + action.view;
    return !seen.has(target) && seen.add(target);
  });
  return {
    reply: 'Bạn muốn xem vé (kể cả đơn giữ chỗ), ví hay yêu cầu hỗ trợ? Bạn bấm một nút bên dưới, hoặc hỏi rõ hơn, ví dụ "số dư ví của tôi" nhé.',
    actions: toActions(actions),
  };
}

// Mỗi readers[key](userId, now) đọc dữ liệu của người hỏi rồi trả về { reply, actions }. Reader lỗi hoặc
// trả câu rỗng thì runTask ném lỗi, và supportAiService đổi lỗi đó thành câu "chưa xem được".
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
// Chữ giống tab "Nhân viên hỗ trợ" trong khung chat (SupportChat.jsx:11).
const REQUEST_LABELS = { OPEN: 'Chờ phản hồi', ANSWERED: 'Đã phản hồi', CLOSED: 'Đã đóng' };
// Chữ do người dùng gõ (ví dụ tiêu đề yêu cầu) có thể chứa xuống dòng; gộp lại để mỗi mục vẫn nằm trên một dòng.
const oneLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
// "Huế Heritage Run (Half Marathon 21K)"; giải đã bị xóa thì ghi "Giải chạy".
const nameOf = row => `${row.eventId?.name || 'Giải chạy'}${row.categoryId?.name ? ` (${row.categoryId.name})` : ''}`;
// Câu trả lời dạng danh sách: số lượng đứng đầu, nên khi chỉ hiện 3 dòng thì người đọc biết ngay còn bao nhiêu
// ("Bạn có 4 vé…, đây là 3 vé…"). Các câu trong `notes` đứng ngay sau danh sách, và dòng cuối chỉ nút để xem
// phần còn lại. Nhãn nút là động từ ("Xem đơn chờ thanh toán"), nên câu viết "bấm …" chứ không viết "xem trong …".
// Không có `button` (không trang nào liệt kê phần còn lại, như kết quả chạy) thì bỏ dòng cuối đó.
function listReply(rows, { what, first, rest, button, notes = [] }, line) {
  const heading = rows.length > LIMITS.shown ? `Bạn có ${rows.length} ${what}, đây là ${LIMITS.shown} ${first}:` : `Bạn có ${rows.length} ${what}:`;
  const more = rows.length > LIMITS.shown && button ? [`${rest} còn lại bạn bấm "${button}" để xem nhé.`] : [];
  return [heading, ...rows.slice(0, LIMITS.shown).map(line), ...notes, ...more];
}

// Kết quả chạy dùng đúng điều kiện của trang kết quả công khai (listResults trong eventController): vé còn hiệu lực
// có chip time dạng giờ:phút:giây. Trang /events/<slug>/results chỉ mở được khi giải ở trạng thái công khai và không
// bị quản trị viên ẩn hay tạm ngừng (eventPolicy.availableEvent); giải khác thì trang trả 404 nên bot không đưa nút.
const RESULT_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'];
const RESULT_TIME = '^\\d{1,3}:[0-5]\\d:[0-5]\\d$';
const PUBLIC_EVENT_STATUSES = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'COMPLETED'];
function resultsPage(event) {
  const open = event && PUBLIC_EVENT_STATUSES.includes(event.status) && !['HIDDEN', 'SUSPENDED'].includes(event.moderation?.state);
  return open && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug ?? '') ? `/events/${event.slug}/results` : null;
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
    if (!upcoming.length) return { reply: 'Bạn chưa có vé sắp chạy nào. Nếu bạn vừa chuyển khoản, vé chỉ được cấp sau khi chủ giải xác nhận đã nhận tiền. Vé của các giải đã qua vẫn xem được trong "Vé của tôi".', actions };
    // Vé chưa có BIB ghi "BIB đang cấp", cùng chữ với thẻ vé ("Đang cấp").
    const lines = listReply(upcoming, { what: 'vé sắp chạy', first: 'vé có ngày chạy gần nhất', rest: 'Vé', button: TASKS.tickets.action.label }, row => [
      '- ' + vietnamDate(row.eventId.dateInfo.raceDate), nameOf(row), row.bibNumber ? 'BIB ' + row.bibNumber : 'BIB đang cấp',
      // Khi ban tổ chức hủy giải, vé vẫn giữ trạng thái cũ, nên phải xét trạng thái của giải ở đây.
      row.eventId.status === 'CANCELLED' ? 'Giải đã bị hủy' : TICKET_LABELS[row.status],
    ].join(' · '));
    return { reply: lines.join('\n'), actions };
  },

  // Đơn quá giờ vẫn mang trạng thái HOLD cho tới khi bộ quét (expireBookings) chạy, nên chính truy vấn phải
  // đòi expiresAt > now. Không đọc mã đơn: mã này cũng là nội dung chuyển khoản, và bot không cần tới.
  //
  // Sau khi người chạy bấm "Tôi đã chuyển khoản", đơn vẫn là HOLD và có thêm một lệnh BOOKING chờ chủ giải duyệt
  // (confirmBooking). Vì vậy bot đọc thêm các lệnh BOOKING đang chờ hoặc bị từ chối của người hỏi:
  // - đơn còn trong giờ mà lệnh đang chờ: không giục thanh toán nữa;
  // - đơn còn trong giờ mà lệnh bị từ chối: dặn đừng chuyển lại, vì confirmBooking sẽ báo lỗi;
  // - lệnh đang chờ mà đơn đã hết giờ: dặn đừng đăng ký hay chuyển tiền lại, mà gửi yêu cầu hỗ trợ để được đối soát.
  //   Chủ giải không duyệt được đơn đã hết giờ (approveBookingPayment đòi đơn còn HOLD), nên người dùng cần hỗ trợ.
  async holds(userId, now) {
    const [rows, requests] = await Promise.all([
      Booking.find({ userId, status: 'HOLD', expiresAt: { $gt: now } })
        .select('eventId categoryId expiresAt')
        .populate(populated('eventId', 'name')).populate(populated('categoryId', 'name'))
        .sort({ expiresAt: 1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.find({ userId, kind: 'BOOKING', status: { $in: ['PENDING', 'REJECTED'] } })
        .select('bookingId status').sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean(),
    ]);
    const live = new Set(rows.map(row => String(row._id)));
    // Mỗi đơn có tối đa một lệnh BOOKING, vì requestKey là 'BOOKING-<mã đơn>' và không được trùng.
    const transferOf = new Map(requests.filter(request => live.has(String(request.bookingId))).map(request => [String(request.bookingId), request.status]));
    const lapsed = requests.filter(request => request.status === 'PENDING' && !live.has(String(request.bookingId))).length;
    const lapsedNote = lapsed
      ? [`Bạn có ${lapsed} đơn đã báo chuyển khoản nhưng đã hết giờ giữ chỗ. Bạn đừng đăng ký hay chuyển tiền lại; bạn bấm "${SUPPORT_ACTION.label}" để được đối soát.`]
      : [];
    if (!rows.length) {
      if (lapsed) return { reply: ['Bạn không có đơn nào còn trong giờ giữ chỗ.', ...lapsedNote].join('\n'), actions: [TASKS.tickets.action, SUPPORT_ACTION] };
      return { reply: 'Bạn không có đơn nào đang giữ chỗ. Đơn chưa thanh toán mà quá giờ thì đã hết hiệu lực, muốn giữ chỗ lại thì bạn đăng ký ở trang giải.', actions: [TASKS.tickets.action] };
    }
    // expireBookings đổi đơn quá giờ sang EXPIRED và trả chỗ đã giữ lại cho cự ly đó.
    const notes = ['Đơn chưa thanh toán mà quá giờ thì hết hiệu lực và chỗ được trả lại.', ...lapsedNote];
    const lines = listReply(rows, { what: 'đơn đang giữ chỗ', first: 'đơn sắp hết giờ nhất', rest: 'Đơn', button: TASKS.holds.action.label, notes }, row => {
      const transfer = transferOf.get(String(row._id));
      if (transfer === 'PENDING') return `- ${nameOf(row)}: bạn đã báo chuyển khoản, đơn đang chờ chủ giải đối soát, bạn không cần chuyển thêm.`;
      if (transfer === 'REJECTED') return `- ${nameOf(row)}: chủ giải đã từ chối khoản chuyển của đơn này, bạn đừng chuyển lại. Bạn bấm "${SUPPORT_ACTION.label}" để được hướng dẫn.`;
      // Giờ hết hạn vẫn đúng khi người dùng đọc lại tin nhắn sau vài phút. Giờ bị bỏ phần giây còn số phút làm tròn
      // lên (spec mục 4.7), nên câu nói "còn chưa tới N phút" để hai con số không vênh nhau.
      return `- ${nameOf(row)}: thanh toán trước ${vietnamClock(row.expiresAt)} (còn chưa tới ${Math.ceil((new Date(row.expiresAt) - now) / 60000)} phút).`;
    });
    const needsSupport = lapsed > 0 || [...transferOf.values()].includes('REJECTED');
    return { reply: lines.join('\n'), actions: needsSupport ? [TASKS.holds.action, SUPPORT_ACTION] : [TASKS.holds.action] };
  },

  // Ví được tạo khi người dùng mở một trang có gọi GET /wallet (tài khoản, ví, đăng ký giải) hoặc khi được cộng
  // tiền lần đầu (walletService); bot không bao giờ tự tạo ví. Bot báo mọi lệnh nạp PENDING, giống trang ví: lệnh
  // quá hạn vẫn được admin duyệt, còn lệnh cũ không có expiresAt thì không bao giờ hết hạn (cùng quy tắc với
  // topupService.isExpired). Lệnh đang chờ và lệnh quá hạn được đọc bằng hai truy vấn riêng: lệnh quá hạn không bị
  // dọn nên tích lại theo thời gian, và nếu đọc chung 20 dòng thì chúng đẩy lệnh đang chờ ra ngoài. Lệnh quá hạn
  // chỉ cần 3 dòng mới nhất cộng tổng số đếm bằng countDocuments.
  // Không đọc transferCode hay bankSnapshot. Hàm vnd ném lỗi khi thiếu số tiền, và lỗi đó thành câu "chưa xem được".
  async wallet(userId, now) {
    const topups = { userId, kind: 'TOPUP', status: 'PENDING' };
    // Trong MongoDB, { expiresAt: null } khớp cả lệnh không có trường expiresAt.
    const lapsedTopups = { ...topups, expiresAt: { $lte: now } };
    const [wallet, waiting, expired, expiredCount] = await Promise.all([
      Wallet.findOne({ userId }).select('balance status').maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.find({ ...topups, $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }] })
        .select('amount createdAt').sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.find(lapsedTopups).select('amount createdAt').sort({ createdAt: -1 }).limit(LIMITS.shown).maxTimeMS(LIMITS.queryMs).lean(),
      PaymentRequest.countDocuments(lapsedTopups).maxTimeMS(LIMITS.queryMs),
    ]);
    const locked = Boolean(wallet) && wallet.status !== 'ACTIVE';
    const parts = [wallet ? `Số dư ví của bạn là ${vnd(wallet.balance)}.` : 'Bạn chưa có ví. Bạn bấm "Ví của tôi" bên dưới là ví được tạo ngay.'];
    if (waiting.length) {
      parts.push(...listReply(waiting, { what: 'lệnh nạp đang chờ đối soát', first: 'lệnh mới nhất', rest: 'Lệnh', button: TASKS.wallet.action.label, notes: ['Số dư chỉ tăng khi lệnh được duyệt.'] },
        row => `- ${vnd(row.amount)}, tạo lúc ${vietnamClock(row.createdAt)} ngày ${vietnamDate(row.createdAt)}.`));
    } else if (wallet) parts.push('Bạn không có lệnh nạp nào đang chờ đối soát.');
    // Lời dặn của trang ví cho mã đã hết hạn (TransferDetails.jsx), nhưng không in mã: người dùng xem mã trong trang ví.
    if (expiredCount) {
      const amounts = expired.map(row => vnd(row.amount)).join(', ') + (expiredCount > expired.length ? ', …' : '');
      parts.push(`Bạn có ${expiredCount} lệnh nạp đã quá hạn (${amounts}), bạn đừng chuyển khoản theo ${expiredCount > 1 ? 'các lệnh' : 'lệnh'} này. `
        + `Chưa chuyển thì bạn tạo lệnh mới trong "${TASKS.wallet.action.label}". Đã chuyển rồi thì bạn bấm "${SUPPORT_ACTION.label}" và ghi kèm mã nạp hiện trong "${TASKS.wallet.action.label}".`);
    }
    // Cùng quy tắc với topupService: ví nào không ACTIVE (bị tạm khóa hay đã đóng) thì không được nạp tiền.
    if (locked) parts.push(`Ví của bạn đang bị khóa nên chưa thể nạp tiền. Bạn bấm "${SUPPORT_ACTION.label}" nếu cần mở lại nhé.`);
    return { reply: parts.join('\n'), actions: expiredCount || locked ? [TASKS.wallet.action, SUPPORT_ACTION] : [TASKS.wallet.action] };
  },

  // Bot chỉ đọc tiêu đề, trạng thái và giờ cập nhật của yêu cầu; không đọc nội dung tin nhắn (messages) bên trong.
  // Yêu cầu vừa được nhân viên trả lời có updatedAt mới nhất, nên được xếp lên đầu.
  async supportTickets(userId) {
    const rows = await SupportTicket.find({ userId }).select('subject status updatedAt')
      .sort({ updatedAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    if (!rows.length) {
      return { reply: `Bạn chưa gửi yêu cầu hỗ trợ nào. Nếu cần nhân viên giúp, bạn bấm "${SUPPORT_ACTION.label}" để gửi yêu cầu mới.`, actions: [SUPPORT_ACTION] };
    }
    const lines = listReply(rows, { what: 'yêu cầu hỗ trợ', first: 'yêu cầu mới cập nhật nhất', rest: 'Yêu cầu', button: TASKS.supportTickets.action.label }, row => [
      `- "${oneLine(row.subject)}"`, REQUEST_LABELS[row.status], `cập nhật lúc ${vietnamClock(row.updatedAt)} ngày ${vietnamDate(row.updatedAt)}`,
    ].join(' · '));
    return { reply: lines.join('\n'), actions: [TASKS.supportTickets.action] };
  },

  // Bot hiện chip time và gun time, không hiện thứ hạng: saveResult (managementController) chỉ ghi chipTime và gunTime,
  // còn hạng do trang kết quả tính lúc hiện (listResults), nên overallRank trong database luôn trống. Muốn xem hạng
  // thì người dùng bấm nút sang trang kết quả của giải.
  async results(userId) {
    const rows = await Registration.find({ userId, status: { $in: RESULT_STATUSES }, 'finishResult.chipTime': { $regex: RESULT_TIME } })
      .select('eventId categoryId finishResult.chipTime finishResult.gunTime')
      .populate(populated('eventId', 'name slug status moderation.state dateInfo.raceDate')).populate(populated('categoryId', 'name'))
      .sort({ createdAt: -1 }).limit(LIMITS.privateRows).maxTimeMS(LIMITS.queryMs).lean();
    if (!rows.length) {
      return { reply: 'Bạn chưa có kết quả chạy nào. Kết quả chỉ hiện sau khi ban tổ chức nhập thời gian về đích cho vé của bạn.', actions: [TASKS.results.action] };
    }
    // Giải chạy gần nhất đứng đầu; giải đã bị xóa (không còn ngày chạy) đứng cuối.
    const raceTime = row => new Date(row.eventId?.dateInfo?.raceDate ?? 0).getTime() || 0;
    const recent = rows.sort((x, y) => raceTime(y) - raceTime(x));
    // Mỗi giải đang hiện có trang kết quả mở được thì có một nút; Map theo url nên hai vé cùng giải chỉ ra một nút.
    const pages = new Map();
    for (const row of recent.slice(0, LIMITS.shown)) {
      const url = resultsPage(row.eventId);
      if (url) pages.set(url, { label: actionLabel('Kết quả ' + row.eventId.name), url });
    }
    const actions = toActions([...pages.values()]);
    const notes = actions.length ? ['Thứ hạng của bạn nằm ở trang kết quả của từng giải, bạn bấm nút "Kết quả" của giải đó bên dưới để xem nhé.'] : [];
    const lines = listReply(recent, { what: 'kết quả chạy', first: 'kết quả gần nhất', notes }, row => '- ' + [
      raceTime(row) ? vietnamDate(row.eventId.dateInfo.raceDate) : null, nameOf(row), 'chip time ' + row.finishResult.chipTime,
      // saveResult chỉ nhận gunTime đúng dạng giờ:phút:giây, và gunTime có thể bỏ trống.
      new RegExp(RESULT_TIME).test(row.finishResult.gunTime ?? '') ? 'gun time ' + row.finishResult.gunTime : null,
    ].filter(Boolean).join(' · '));
    return { reply: lines.join('\n'), actions: actions.length ? actions : [TASKS.results.action] };
  },

  // Chỉ đọc số điểm, không đọc lịch sử tích và dùng điểm. Người chưa có bản ghi điểm thì coi là 0 điểm: bản ghi được
  // tạo khi người dùng mở trang có gọi GET /wallet hoặc khi được cộng điểm, bot không tự tạo.
  // Luật điểm lấy từ code: mỗi 50.000đ thanh toán cho vé được 1 điểm (completeBooking trong bookingService); mỗi điểm
  // giảm 1.000đ và giảm tối đa một nửa giá trị đơn (createBookingHold trong bookingController).
  async runpoints(userId) {
    const points = await RunPoints.findOne({ userId }).select('balance').maxTimeMS(LIMITS.queryMs).lean();
    const balance = Math.floor(Number(points?.balance) || 0);
    const actions = [TASKS.runpoints.action];
    if (balance <= 0) {
      return { reply: 'Bạn chưa có RunPoints nào. Mỗi 50.000đ bạn thanh toán cho vé được cộng 1 điểm, và điểm dùng để giảm giá khi đăng ký giải sau.', actions };
    }
    return { reply: `Bạn đang có ${balance.toLocaleString('vi-VN')} RunPoints. Khi đăng ký giải, mỗi điểm giảm 1.000đ, tối đa một nửa giá trị đơn.`, actions };
  },
};

const runTask = createTaskRunner({ readers });

module.exports = { TASK_KEYS, routeTask, taskForEval, toActions, guestAnswer, failedAnswer, unclearAnswer, createTaskRunner, runTask };
