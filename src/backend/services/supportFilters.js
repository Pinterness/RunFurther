// Bộ lọc câu nhạy cảm của trợ lý. Câu bị bắt thì không gửi cho AI và không lưu vào hàng chờ câu chưa trả lời,
// nhưng bot vẫn trả lời bằng bài soạn sẵn như mọi câu khác. Hàm nằm ở file riêng để cổng AI (P08) dùng được mà không
// phải require supportAiService.js: file đó tạo responder ngay lúc nạp, nên hai file require lẫn nhau thì một bên
// sẽ nhận undefined.
const { normalizeSupportText } = require('./supportKnowledge');

// Mã nạp tiền (NAP + 8 ký tự, CODE_PATTERN của topupService) cũng riêng tư như mã đơn (RUN…). Sao kê ngân hàng có
// thể in mã có khoảng trắng hay gạch nối ("NAP K7M2-Q9XA"), và người dùng chép nguyên như vậy, nên mẫu chấp nhận cả hai.
// Cái giá: vài câu không dấu như "nap ngay sang vi" cũng khớp mẫu và chỉ nhận câu soạn sẵn thay vì câu của AI. Chặn nhầm
// như vậy vẫn hơn để lọt mã riêng tư ra ngoài.
const PRIVATE_CODE = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:\+?\d[\s.-]?){9,}\b|\b(?:sk-|RF-|RUN[0-9a-f]{8}|eyJ)[a-z0-9_-]+|\bNAP[\s-]?[2-9A-HJ-NP-Z]{4}[\s-]?[2-9A-HJ-NP-Z]{4}\b/i;
const PRIVATE_TOPIC = /mat khau|otp|cccd|cmnd|so tai khoan|ma don|qr token|qr ve|the ngan hang/;

// Luật T7: câu tự giới thiệu kiểu "Tôi là Trần Thị B" hay "em tên Hoa" là cách lộ họ tên hay gặp nhất. Mẫu cần
// một đại từ, rồi "là" / "tên là" / "tên", rồi một chữ cái viết hoa. Vì phải nhìn chữ hoa nên luật chạy trên câu
// gốc (đã gộp dấu về dạng NFC), không chạy trên câu đã bỏ dấu. Ranh giới đứng trước đại từ giúp "xem là …" không
// bị đọc thành "em là …". Bắt nhầm như "Mình là BTC" chỉ làm câu đó không đi qua AI, chấp nhận được.
const SELF_INTRODUCTION = /(?<![\p{L}\p{N}])(?:[Tt]ôi|[Mm]ình|[Ee]m|[Aa]nh|[Cc]hị|[Cc]on|[Cc]háu)\s+(?:tên\s+là|là|tên)\s+\p{Lu}/u;

// Luật T16: tình trạng sức khỏe là dữ liệu nhạy cảm theo luật Việt Nam, và điều khoản Gemini cấm dùng để tư vấn y tế.
// Khớp nguyên cụm trên câu đã bỏ dấu. Không dùng chữ "thuoc" đứng một mình, vì sau khi bỏ dấu thì "thuốc" và "thuộc"
// giống hệt nhau ("vé này thuộc giải nào" sẽ bị chặn oan).
const HEALTH = /(?:^| )(?:benh|tim mach|huyet ap|hen suyen|tieu duong|dong kinh|mang thai|co thai|uong thuoc|don thuoc|phau thuat|chan thuong)(?= |$)/;

function sensitiveQuestion(message) {
  const text = typeof message === 'string' ? message : '';
  const normalized = normalizeSupportText(text);
  return PRIVATE_CODE.test(text) || PRIVATE_TOPIC.test(normalized)
    || SELF_INTRODUCTION.test(text.normalize('NFC')) || HEALTH.test(normalized);
}

module.exports = { sensitiveQuestion };
