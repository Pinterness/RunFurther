// Cấu hình AI của trợ lý đọc từ biến môi trường. File riêng, không require service nào, để adapter
// (supportAiService.js), cổng AI và công tắc admin cùng dùng mà không tạo vòng require: supportAiService.js tạo
// responder ngay lúc nạp, nên hai file require lẫn nhau thì một bên sẽ nhận undefined.

// Nhà cung cấp duy nhất là Gemini gói Free, gọi qua cổng tương thích chuẩn Chat Completions tại một địa chỉ cố định.
// Không dùng OpenAI vì là API trả phí (ràng buộc 0 đồng).
// `reasoning_effort: 'minimal'` là mức suy nghĩ thấp nhất mà dòng Gemini 3.x Flash-Lite nhận (dòng 3.x không tắt hẳn
// được). Token suy nghĩ tính chung vào `max_tokens`, nên để thấp thì còn chỗ cho câu trả lời.
const GEMINI = Object.freeze({
  name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  keyEnv: 'GEMINI_API_KEY', extraBody: Object.freeze({ reasoning_effort: 'minimal' }),
});

const envText = (env, name) => (typeof env[name] === 'string' ? env[name].trim() : '');

// SUPPORT_AI_PROVIDER phải đúng là "gemini", và phải có cả khóa lẫn model. Thiếu một thứ thì trả null, tức bot dùng
// câu trả lời soạn sẵn. Khóa chỉ nằm trong object trả về cho adapter, không bao giờ được gửi về trình duyệt.
function readAiConfig(env = process.env) {
  if (envText(env, 'SUPPORT_AI_PROVIDER') !== GEMINI.name) return null;
  const key = envText(env, GEMINI.keyEnv);
  const model = envText(env, 'SUPPORT_AI_MODEL');
  return key && model ? { provider: GEMINI.name, key, model } : null;
}

module.exports = { GEMINI, readAiConfig, envText };
