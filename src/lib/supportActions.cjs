// Luật lọc nút bấm dưới câu trả lời của trợ lý. Server (supportTasks.js, supportAiService.js) và khung chat
// (SupportChat.jsx) dùng chung file này, nên hai phía luôn nhận cùng một kiểu nút.
const { internalPath } = require('./internalPath.cjs');

// Tối đa 3 nút, nhãn mỗi nút tối đa 40 ký tự.
const ACTION_LIMITS = { count: 3, label: 40 };
// Những màn trong tab "Nhân viên hỗ trợ" mà nút được mở: 'tickets' là danh sách yêu cầu, 'new-ticket' là form gửi yêu cầu mới.
const CHAT_VIEWS = ['tickets', 'new-ticket'];

// Giữ tối đa 3 nút. Mỗi nút có một trong hai dạng: { label, url } với url là link nội bộ (qua internalPath),
// hoặc { label, view } với view thuộc CHAT_VIEWS để mở tab "Nhân viên hỗ trợ" trong khung chat. Nút có nhãn rỗng,
// nhãn dài quá 40 ký tự, hay không thuộc hai dạng trên thì bị bỏ, và trường lạ đi kèm cũng bị bỏ.
function toActions(list) {
  if (!Array.isArray(list)) return [];
  const actions = [];
  for (const item of list) {
    if (actions.length === ACTION_LIMITS.count) break;
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > ACTION_LIMITS.label) continue;
    if (CHAT_VIEWS.includes(item.view)) { actions.push({ label, view: item.view }); continue; }
    const url = internalPath(item.url);
    if (url !== null) actions.push({ label, url });
  }
  return actions;
}

// Cắt một tên dài, ví dụ tên giải, cho vừa nhãn nút: giữ 39 ký tự đầu, bỏ khoảng trắng ở cuối rồi thêm "…".
// Nếu chỗ cắt rơi vào giữa một emoji (emoji chiếm 2 ký tự trong chuỗi JavaScript) thì bỏ luôn nửa emoji còn sót.
function actionLabel(text) {
  const label = typeof text === 'string' ? text.trim() : '';
  if (label.length <= ACTION_LIMITS.label) return label;
  return label.slice(0, ACTION_LIMITS.label - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd() + '…';
}

module.exports = { ACTION_LIMITS, toActions, actionLabel };
