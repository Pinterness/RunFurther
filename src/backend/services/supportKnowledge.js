// Answers are curated against the local controllers, not generated policies.
// Keep links within existing application routes; no claims of automatic refunds.
const SUPPORT_MESSAGE_LIMIT = 2000;
const SUPPORT_KNOWLEDGE = [
  {
    id: 'account', title: 'Đăng ký và đăng nhập',
    terms: ['đăng ký tài khoản', 'tạo tài khoản', 'đăng nhập', 'mật khẩu', 'email trùng'],
    answer: 'Mở Đăng ký, nhập họ tên, email và mật khẩu ít nhất 8 ký tự. Bạn có thể điền thêm hồ sơ người chạy để mua vé nhanh hơn. Nếu email đã được sử dụng, đăng nhập bằng tài khoản đó. Trợ lý không đọc hoặc cung cấp mật khẩu; nếu không đăng nhập được, hãy gửi yêu cầu hỗ trợ.',
    sources: [{ title: 'Đăng ký', url: '/register' }, { title: 'Đăng nhập', url: '/login' }],
    suggestions: ['Làm sao mua vé giải chạy?', 'Cập nhật hồ sơ người chạy ở đâu?'],
  },
  {
    id: 'registration', title: 'Mua vé giải chạy',
    terms: ['mua vé', 'đặt vé', 'đăng ký giải', 'đăng ký chạy', 'đăng ký cự ly', 'đăng ký'],
    answer: 'Đăng nhập, mở danh sách giải, chọn giải và cự ly rồi điền thông tin người chạy. Giải phải đang trong thời gian mở đăng ký, cự ly còn chỗ và đáp ứng tuổi tối thiểu nếu có. Sau khi giữ chỗ, bạn có 10 phút để hoàn tất thanh toán. Thanh toán bằng ví hoặc chuyển khoản theo hướng dẫn của đơn; vé xuất hiện tại Vé của tôi khi đơn được xác nhận.',
    sources: [{ title: 'Khám phá giải chạy', url: '/events' }, { title: 'Vé của tôi', url: '/account' }],
    suggestions: ['Giữ chỗ trong bao lâu?', 'Chuyển khoản rồi sao chưa có vé?'],
  },
  {
    id: 'hold', title: 'Giữ chỗ và đơn hết hạn',
    terms: ['giữ chỗ', 'hết hạn', '10 phút', 'hết giờ', 'đơn expired', 'hết thời gian'],
    answer: 'Mỗi đơn giữ chỗ có thời hạn 10 phút. Khi hết hạn, chỗ được trả lại và đơn cũ không tự mở lại; bạn cần tạo đơn mới nếu cự ly còn chỗ. Nếu đã chuyển khoản nhưng đơn hết hạn, hãy gửi yêu cầu hỗ trợ để được hướng dẫn liên hệ chủ giải đối soát. Hệ thống chưa tự hoàn tiền và không tự cấp vé cho đơn hết hạn.',
    sources: [{ title: 'Đơn và vé của tôi', url: '/account' }, { title: 'Chọn giải', url: '/events' }],
    suggestions: ['Chuyển khoản rồi sao chưa có vé?', 'Kiểm tra vé của tôi'],
  },
  {
    id: 'payment', title: 'Đối soát tiền vé',
    terms: ['chuyển khoản', 'thanh toán', 'chưa có vé', 'chưa nhận vé', 'vietqr', 'qr thanh toán', 'tiền vé', 'hoàn tiền', 'duyệt tiền'],
    answer: 'Với chuyển khoản/VietQR, thao tác báo đã thanh toán chỉ tạo yêu cầu chờ đối soát; vé chưa được cấp ngay. EVENT_ADMIN là chủ giải kiểm tra và duyệt tiền vé của giải mình, còn SUPER_ADMIN không duyệt tiền vé. Hãy kiểm tra đơn tại Vé của tôi. Nếu đơn hết hạn hoặc bạn đã chuyển tiền nhưng chưa có vé, gửi yêu cầu hỗ trợ để được hướng dẫn đối soát với chủ giải; hiện chưa có hoàn tiền tự động. Số tiền, tài khoản nhận và nội dung chuyển khoản cần lấy trực tiếp từ đơn còn hiệu lực.',
    sources: [{ title: 'Kiểm tra đơn và vé', url: '/account' }],
    suggestions: ['Giữ chỗ trong bao lâu?', 'Kiểm tra vé của tôi', 'Nạp ví do ai duyệt?'],
  },
  {
    id: 'wallet', title: 'Ví và nạp tiền',
    terms: ['nạp ví', 'nạp tiền', 'số dư', 'ví chưa cộng', 'ví của tôi', 'runpoints', 'điểm thưởng'],
    answer: 'Mở Ví để xem số dư, lịch sử và yêu cầu nạp tiền. Gửi yêu cầu nạp ví chỉ tạo trạng thái chờ đối soát; SUPER_ADMIN duyệt nạp ví sau khi xác minh, lúc đó số dư mới được cộng. Tiền vé chuyển khoản được chủ giải duyệt riêng. Khi mua vé bằng ví, hệ thống kiểm tra số dư rồi trừ tiền và cấp vé trong cùng giao dịch. RunPoints có thể được dùng khi tạo đơn theo mức giảm hiển thị trên trang thanh toán.',
    sources: [{ title: 'Ví của tôi', url: '/account/wallet' }],
    suggestions: ['Chuyển khoản rồi sao chưa có vé?', 'Mua BIB trên Marketplace thế nào?'],
  },
  {
    id: 'marketplace', title: 'Marketplace và chuyển nhượng BIB',
    terms: ['marketplace', 'chuyển nhượng', 'mua bib', 'bán bib', 'đăng tin', 'đồ chạy', 'đồ dùng', '110 phần trăm'],
    answer: 'Bạn cần đăng nhập trước khi đăng tin hoặc mua trên Marketplace. BIB phải thuộc người bán, đã xác nhận, chưa check-in/nhận race kit và giải chưa diễn ra; giá không vượt 110% số tiền vé gốc đã trả. Người mua thanh toán bằng ví và điền thông tin người chạy mới. Giao dịch thành công tự chuyển quyền sở hữu BIB và đổi QR; không có bước chủ giải duyệt chuyển nhượng BIB. Đồ dùng hiện chưa có tích hợp vận chuyển, ký quỹ hay xử lý tranh chấp tự động.',
    sources: [{ title: 'Marketplace', url: '/marketplace' }, { title: 'Vé của tôi', url: '/account' }],
    suggestions: ['Nạp ví do ai duyệt?', 'Vé đã nhận kit có chuyển nhượng được không?'],
  },
  {
    id: 'profile', title: 'Hồ sơ người chạy và avatar',
    terms: ['hồ sơ', 'avatar', 'size áo', 'ngày sinh', 'liên hệ khẩn cấp', 'đổi tên', 'thông tin người chạy'],
    answer: 'Mở Tài khoản, chọn Hồ sơ người chạy để lưu họ tên, điện thoại, ngày sinh, size áo, câu lạc bộ và liên hệ khẩn cấp; avatar hiện được tạo từ tên và màu bạn chọn. Hồ sơ được dùng để điền sẵn cho lần mua vé mới. Cập nhật hồ sơ không tự đổi thông tin trên vé đã cấp; nếu vé có sai sót, hãy gửi yêu cầu hỗ trợ để được hướng dẫn liên hệ chủ giải kiểm tra.',
    sources: [{ title: 'Hồ sơ người chạy', url: '/account' }],
    suggestions: ['Làm sao mua vé giải chạy?', 'Kiểm tra vé của tôi'],
  },
  {
    id: 'tickets', title: 'Vé, check-in và race kit',
    terms: ['vé của tôi', 'đơn của tôi', 'đơn hàng của tôi', 'kiểm tra vé', 'trạng thái vé', 'xem vé', 'mã qr vé', 'check in', 'race kit', 'nhận kit', 'tra cứu bib'],
    answer: 'Đăng nhập và mở Vé của tôi để xem vé đã cấp, đơn giữ chỗ và mã QR của bạn. Vé chỉ được cấp sau khi thanh toán được xác nhận. Khi đến giải, dùng mã QR theo hướng dẫn check-in/nhận race kit của ban tổ chức. Bạn có thể tra cứu đăng ký tại trang Tra cứu; trợ lý chỉ tóm tắt trạng thái, không gửi lại QR, thông tin cá nhân hoặc thông tin chuyển khoản trong câu trả lời.',
    sources: [{ title: 'Vé của tôi', url: '/account' }, { title: 'Tra cứu đăng ký', url: '/lookup' }],
    suggestions: ['Kiểm tra vé của tôi', 'Chuyển khoản rồi sao chưa có vé?'],
  },
  {
    id: 'organizer', title: 'Quyền tổ chức và chủ giải',
    terms: ['ban tổ chức', 'tạo giải', 'event admin', 'event_admin', 'quyền tổ chức', 'phân quyền', 'super admin', 'super_admin', 'quản lý giải', 'tạo sự kiện'],
    answer: 'Đăng nhập tài khoản cá nhân, mở Khu vực ban tổ chức và gửi đơn xin quyền tổ chức. Chỉ sau khi SUPER_ADMIN duyệt, bạn mới tạo đơn vị và giải. Người tạo là EVENT_ADMIN của chính giải đó; nhân sự cũng chỉ làm việc trong giải được phân công. SUPER_ADMIN duyệt quyền tổ chức, ẩn/ngừng/khôi phục giải kèm lý do và duyệt nạp ví, không sửa nghiệp vụ từng giải hoặc xóa hẳn giải.',
    sources: [{ title: 'Khu vực ban tổ chức', url: '/organizer' }],
    suggestions: ['Tiền vé do ai duyệt?', 'Làm sao mua vé giải chạy?'],
  },
  {
    id: 'events', title: 'Lịch và thông tin giải',
    terms: ['lịch giải', 'tìm giải', 'giải nào', 'giải sắp', 'giải đang mở', 'giải ở', 'giải tại', 'giá vé', 'giá cự ly', 'ngày chạy', 'ngày thi đấu', 'cự ly nào'],
    answer: 'Mở danh sách giải để xem địa điểm, ngày chạy, cự ly và giá được công bố. Chỉ giải công khai, không bị ẩn hoặc tạm ngừng mới xuất hiện. Giá và tình trạng chỗ cần kiểm tra lại trên trang giải khi đăng ký.',
    sources: [{ title: 'Danh sách giải', url: '/events' }],
    suggestions: ['Có giải nào sắp diễn ra?', 'Làm sao mua vé giải chạy?'],
  },
  {
    id: 'results', title: 'Kết quả thi đấu',
    terms: ['kết quả', 'bảng xếp hạng', 'thành tích', 'chip time', 'gun time', 'huy chương'],
    answer: 'Mở trang giải rồi vào Kết quả để xem bảng xếp hạng khi ban tổ chức đã nhập thời gian hợp lệ. Thành tích cá nhân trong Tài khoản chỉ tính các vé có kết quả chip time hợp lệ; việc mua vé không tự tạo thành tích. Thông tin huy chương/race kit thực tế phải theo công bố của từng giải, không theo mô hình minh họa trên landing.',
    sources: [{ title: 'Chọn giải để xem kết quả', url: '/events' }, { title: 'Tài khoản', url: '/account' }],
    suggestions: ['Có giải nào sắp diễn ra?', 'Kiểm tra vé của tôi'],
  },
];

function normalizeSupportText(value) {
  return (typeof value === 'string' ? value : '').slice(0, SUPPORT_MESSAGE_LIMIT).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findSupportKnowledge(message, history = []) {
  const query = normalizeSupportText(message);
  // Prefer a specific transaction stage over the generic purchasing guide
  // when both score equally (for example: "chuyển khoản mua vé, ai duyệt?").
  const stagePriority = { payment: 2, wallet: 2, marketplace: 2, hold: 2, tickets: 1 };
  const rank = text => SUPPORT_KNOWLEDGE.map(entry => ({ entry, score: entry.terms.reduce((total, term) => {
    const normalized = normalizeSupportText(term);
    return total + ((' ' + text + ' ').includes(' ' + normalized + ' ') ? Math.min(5, Math.max(2.8, normalized.split(' ').length * 1.4)) : 0);
  }, 0) })).filter(item => item.score >= 2.5).sort((a, b) => b.score - a.score || (stagePriority[b.entry.id] || 0) - (stagePriority[a.entry.id] || 0));
  let ranked = rank(query);
  // Only genuine short follow-ups borrow the last user question. Assistant
  // messages supplied by clients are never treated as trusted knowledge.
  if (!ranked.length && query.length < 80 && /^(con|vay|the|sau do|tai sao|bao lau|ai duyet|duoc khong|roi sao|lam sao)( |$)/.test(query)) {
    const previous = Array.isArray(history) ? history.slice(-6).reverse().find(item => item?.role === 'user' && typeof item.content === 'string') : null;
    if (previous) ranked = rank(normalizeSupportText(previous.content) + ' ' + query);
  }
  return ranked.slice(0, 2).map(item => item.entry);
}

module.exports = { SUPPORT_MESSAGE_LIMIT, SUPPORT_KNOWLEDGE, normalizeSupportText, findSupportKnowledge };
