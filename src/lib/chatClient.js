// Hàm gọi API tin nhắn (/api/chat) và các hàm nhỏ dùng chung cho trang /messages (spec 4.3, 4.5; plan Task 13.2).
import { useEffect, useRef, useState } from 'react';
import { api } from './clientApi';
import { API_BASE_URL } from './apiUrl';

// Socket.IO nối thẳng tới máy chủ API (Render), vì Vercel không chạy được WebSocket server.
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '');
const tabVisible = () => document.visibilityState === 'visible';

/**
 * Nối Socket.IO để nhận tín hiệu "có tin mới" (P14, ADR realtime 3.9). Chỉ nối khi `enabled` (công tắc realtime bật)
 * và tab đang hiện; tab ẩn thì đóng, hiện lại thì nối lại. Thư viện socket.io-client chỉ được tải khi cần nối.
 * Bỏ cuộc, tức thôi thử nối cho tới khi `enabled` đổi, khi: nối lại 5 lần không được (mỗi lần thử là một request đánh
 * thức Render), server từ chối lúc bắt tay (token sai, chưa đủ điều kiện nhắn tin), hoặc server chủ động ngắt (admin tắt
 * công tắc, bị khóa, token hết hạn). Lúc đó trang tự quay về polling.
 * @param {{ enabled: boolean, onSignal: (payload: { conversationId: string, seq: number }) => void, onConnect: () => void }} options
 * @returns {boolean} Socket đang nối hay không; đang nối thì trang tắt polling.
 */
export function useChatSocket({ enabled, onSignal, onConnect }) {
  const [live, setLive] = useState(false);
  const handlers = useRef({ onSignal, onConnect });
  handlers.current = { onSignal, onConnect };

  useEffect(() => {
    if (!enabled) return undefined;
    let socket = null, opening = false, gaveUp = false, disposed = false;
    function close() {
      if (socket) { socket.removeAllListeners(); socket.io.removeAllListeners(); socket.close(); socket = null; }
      setLive(false);
    }
    function giveUp() { gaveUp = true; close(); }
    async function open() {
      if (socket || opening || gaveUp || disposed || !tabVisible()) return;
      const token = localStorage.getItem('rf_token');
      if (!token) return;
      opening = true;
      let io;
      try { ({ io } = await import('socket.io-client')); } catch { gaveUp = true; return; } finally { opening = false; }
      if (socket || gaveUp || disposed || !tabVisible()) return;
      const current = io(API_ORIGIN, { transports: ['websocket'], auth: { token }, reconnectionAttempts: 5 });
      socket = current;
      current.on('connect', () => { setLive(true); handlers.current.onConnect(); });
      current.on('chat:message', payload => handlers.current.onSignal(payload));
      current.on('disconnect', reason => { setLive(false); if (reason === 'io server disconnect') giveUp(); });
      // active = false nghĩa là server từ chối ở bước bắt tay, client sẽ không tự thử lại.
      current.on('connect_error', () => { setLive(false); if (!current.active) giveUp(); });
      current.io.on('reconnect_failed', giveUp);
    }
    const onVisibility = () => (tabVisible() ? open() : close());
    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; document.removeEventListener('visibilitychange', onVisibility); close(); };
  }, [enabled]);

  return live;
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const conv = id => '/chat/conversations/' + encodeURIComponent(id);

export const chatMe = () => api('/chat/me');
export const giveChatConsent = consentVersion => api('/chat/me/consent', { method: 'PUT', body: JSON.stringify({ consentVersion }) });
export const withdrawChatConsent = () => api('/chat/me/consent', { method: 'DELETE' });
export const listBlocks = () => api('/chat/blocks');
export const unblock = id => api('/chat/blocks/' + encodeURIComponent(id), { method: 'DELETE' });
// Lời mời kèm tin đầu tới chủ một hồ sơ cộng đồng (spec 4.4). 409 CHAT_CONVERSATION_EXISTS mang conversationId trong
// error.data để giao diện mở cuộc đã có.
export const sendInvite = (handle, text, clientMessageId) => post('/chat/invites', { handle, text, clientMessageId });

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

// Báo cáo vi phạm (P15): reason là SPAM | HARASSMENT | SCAM | OTHER. 201 báo cáo mới, 200 đã báo cáo tin này rồi.
export const REPORT_REASONS = [['HARASSMENT', 'Quấy rối, xúc phạm'], ['SCAM', 'Lừa đảo, đòi chuyển tiền'], ['SPAM', 'Tin rác, quảng cáo'], ['OTHER', 'Lý do khác']];
export const reportMessage = (id, seq, reason, note) => post(conv(id) + '/reports', { seq, reason, note });
// Phần của Super Admin.
export const adminReports = status => api('/chat/admin/reports?status=' + encodeURIComponent(status));
export const resolveReport = (reportId, action) => post('/chat/admin/reports/' + encodeURIComponent(reportId) + '/resolve', { action });
export const unlockMember = reportId => post('/chat/admin/members/' + encodeURIComponent(reportId) + '/unlock');
export const realtimeSetting = () => api('/chat/admin/realtime');
export const updateRealtimeSetting = realtimeEnabled => api('/chat/admin/realtime', { method: 'PUT', body: JSON.stringify({ realtimeEnabled }) });

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
