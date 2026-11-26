// Hàm gọi API tin nhắn (/api/chat) và các hàm nhỏ dùng chung cho trang /messages (spec 4.3, 4.5; plan Task 13.2).
import { api } from './clientApi';

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const conv = id => '/chat/conversations/' + encodeURIComponent(id);

export const chatMe = () => api('/chat/me');

// box: 'chats' | 'invites'. Trang sau dùng con trỏ kép before + beforeId của cuộc cuối đang hiện.
export function listConversations(box, cursor) {
  const query = new URLSearchParams({ box });
  if (cursor) { query.set('before', cursor.lastMessageAt); query.set('beforeId', cursor.id); }
  return api('/chat/conversations?' + query);
}

// Một cuộc theo id (cho liên kết /messages?c=<id>); người ngoài cuộc nhận 404.
export const getConversation = id => api(conv(id));

// Không truyền gì: trang mới nhất. afterSeq: lấy bù tin mới (polling). beforeSeq: cuộn lên xem tin cũ.
export function fetchMessages(id, { afterSeq, beforeSeq } = {}) {
  const query = new URLSearchParams();
  if (afterSeq !== undefined) query.set('afterSeq', String(afterSeq));
  if (beforeSeq !== undefined) query.set('beforeSeq', String(beforeSeq));
  const text = query.toString();
  return api(conv(id) + '/messages' + (text ? '?' + text : ''));
}

export const sendMessage = (id, text, clientMessageId) => post(conv(id) + '/messages', { text, clientMessageId });
export const accept = id => post(conv(id) + '/accept');
export const decline = id => post(conv(id) + '/decline');
export const block = id => post(conv(id) + '/block');
export const markRead = (id, upToSeq) => post(conv(id) + '/read', { upToSeq });
export const unreadCount = () => api('/chat/unread');

// Mã riêng cho mỗi lần bấm "Gửi". Gửi lại một tin lỗi phải dùng lại đúng mã này, để server nhận ra và không tạo tin trùng.
export const newClientMessageId = () => crypto.randomUUID();

// Báo cho huy hiệu "Tin nhắn" trên header làm mới ngay (đọc tin, chấp nhận, từ chối, chặn).
export const CHAT_EVENT = 'rf-chat';
export const notifyChatChanged = () => window.dispatchEvent(new Event(CHAT_EVENT));

/**
 * Gộp tin mới vào danh sách đang hiện, theo seq tăng dần.
 * - Tin đã có seq thì không thêm lần nữa: polling có thể trả lại đúng tin vừa nhận từ phản hồi khi gửi.
 * - Tin của mình có clientMessageId trùng một bong bóng tạm ("Đang gửi" hoặc "Chưa gửi được") thì thay bong bóng đó.
 * Bong bóng tạm (chưa có seq) luôn nằm cuối, theo thứ tự đã bấm gửi.
 * @param {Array<object>} current Tin đang hiện, gồm cả bong bóng tạm { pending: true, clientMessageId, text }.
 * @param {Array<object>} incoming Tin server trả về (có seq).
 * @returns {Array<object>}
 */
export function mergeMessages(current, incoming) {
  const confirmed = new Map();
  for (const message of current) if (Number.isInteger(message.seq)) confirmed.set(message.seq, message);
  for (const message of incoming) if (Number.isInteger(message.seq)) confirmed.set(message.seq, message);
  const settled = new Set([...confirmed.values()].map(message => message.clientMessageId).filter(Boolean));
  const pending = current.filter(message => !Number.isInteger(message.seq) && !settled.has(message.clientMessageId));
  return [...[...confirmed.values()].sort((a, b) => a.seq - b.seq), ...pending];
}

// Seq lớn nhất của tin đã lưu đang hiện (0 nếu chưa có), dùng cho afterSeq và đánh dấu đã đọc.
export const lastSeq = messages => messages.reduce((max, message) => (Number.isInteger(message.seq) && message.seq > max ? message.seq : max), 0);

// Giờ ngắn kiểu "06:42" trong ngày, "Hôm qua", hoặc "20/11", theo giờ Việt Nam.
export function shortTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const day = value => value.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (day(date) === day(now)) return date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
  if (day(date) === day(new Date(now.getTime() - 86400000))) return 'Hôm qua';
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });
}
