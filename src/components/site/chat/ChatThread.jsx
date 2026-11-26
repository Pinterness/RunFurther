'use client';
// Khung chat của một cuộc trò chuyện (/messages): tin theo seq, lấy bù bằng polling, gửi có bong bóng tạm, gửi lại
// đúng clientMessageId, đánh dấu đã đọc. Spec 4.3–4.5, plan Task 13.2; sửa theo phản biện 26-11.
import { useEffect, useRef, useState } from 'react';
import InviteCard from './InviteCard';
import ReportForm from './ReportForm';
import * as chat from '../../../lib/chatClient';

const POLL_MS = 5000;
const POLL_MAX_MS = 60000;
const TEXT_MAX = 1000; // TEXT_MAX của model Message
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
// Chữ chỉ dành cho trình đọc màn hình.
const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

export default function ChatThread({ conversation, onChanged, onBack, onExpired, focusOnOpen }) {
  const id = conversation.id;
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState(''), [sendError, setSendError] = useState(''), [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  // seq của tin đang mở hộp báo cáo (P15.2); chỉ tin của người kia mới có nút báo cáo.
  const [reporting, setReporting] = useState(null);
  // Bản mới nhất của danh sách tin cho polling và các hàm bất đồng bộ (closure của lần render cũ không thấy state mới).
  const messagesRef = useRef([]);
  const sendingRef = useRef(false), alive = useRef(true), markedRef = useRef(0);
  const logRef = useRef(null), headingRef = useRef(null), inputRef = useRef(null), confirmRef = useRef(null), keepScroll = useRef(null);

  // Người nhận trả lời bằng thẻ lời mời, kể cả khi đã từ chối trước đó (đổi ý thì vẫn chấp nhận được, spec T14).
  const isInvite = !conversation.isRequester && (conversation.status === 'REQUEST' || conversation.status === 'DECLINED');
  // Người mời chỉ thấy "đang chờ" (API đã che DECLINED thành REQUEST với họ).
  const waiting = conversation.isRequester && conversation.status !== 'ACTIVE';
  const canWrite = conversation.status === 'ACTIVE';
  const name = conversation.other.displayName;

  function apply(next) { messagesRef.current = next; setMessages(next); }
  function expired(error) {
    if (error?.status === 401) { alive.current = false; onExpired(); return true; }
    return false;
  }

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Mở cuộc từ danh sách: đưa focus tới tên cuộc, để bàn phím và trình đọc màn hình bắt đầu từ khung chat.
  useEffect(() => { if (focusOnOpen) headingRef.current?.focus(); }, [id]);

  // Tải trang tin mới nhất. Gộp với tin đang hiện (không ghi đè), để bong bóng "Chưa gửi được" của một lần gửi sớm
  // không bị xóa. Lỗi thì hiện nút "Thử lại" (attempt tăng sẽ tải lại).
  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setLoadError('');
    chat.fetchMessages(id).then(data => {
      if (cancelled || !alive.current) return;
      apply(chat.mergeMessages(messagesRef.current, data.messages)); setHasOlder(data.hasMore); setLoaded(true);
    }).catch(error => { if (!cancelled && alive.current && !expired(error)) setLoadError(error.message); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  // Polling lấy bù tin mới, chỉ sau khi lần tải đầu xong (trước đó lastSeq = 0 sẽ kéo về tin cũ nhất).
  // Luôn chỉ có một chuỗi: inFlight chặn lần gọi thứ hai khi tab hiện lại đúng lúc một lần hỏi đang chờ.
  // 404 (cuộc không còn) thì dừng hẳn; 429 hay lỗi máy chủ thì giãn nhịp 5 → 10 → 20 → 40 → 60 giây.
  useEffect(() => {
    if (!loaded) return undefined;
    let timer = null, stopped = false, inFlight = false, delay = POLL_MS;
    const schedule = () => { if (!stopped && visible() && !timer && !inFlight) timer = setTimeout(poll, delay); };
    async function poll() {
      timer = null;
      if (stopped || inFlight || !visible()) return;
      inFlight = true;
      try {
        const data = await chat.fetchMessages(id, { afterSeq: chat.lastSeq(messagesRef.current) });
        delay = POLL_MS;
        if (!stopped && data.messages.length) apply(chat.mergeMessages(messagesRef.current, data.messages));
      } catch (error) {
        if (expired(error) || error.status === 404) { stopped = true; return; }
        delay = Math.min(delay * 2, POLL_MAX_MS);
      } finally { inFlight = false; }
      schedule();
    }
    function onVisibility() {
      if (!visible()) { if (timer) { clearTimeout(timer); timer = null; } return; }
      if (!timer && !inFlight && !stopped) poll();
    }
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [id, loaded]);

  // Đánh dấu đã đọc tới seq lớn nhất đang hiện, khi khung đang mở và tab đang hiện; tin tới lúc tab ẩn thì đánh dấu khi
  // người dùng quay lại tab.
  function markIfVisible() {
    const seq = chat.lastSeq(messagesRef.current);
    if (!seq || seq <= markedRef.current || !visible()) return;
    markedRef.current = seq;
    chat.markRead(id, seq).then(() => chat.notifyChatChanged()).catch(error => { expired(error); });
  }
  useEffect(markIfVisible, [messages, id]);
  useEffect(() => {
    const onVisibility = () => { if (visible()) markIfVisible(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [id]);

  // Cuộn: tin mới ở cuối thì xuống đáy; chèn tin cũ lên trên thì giữ nguyên chỗ đang xem.
  const lastKey = messages.length ? (messages[messages.length - 1].seq ?? messages[messages.length - 1].clientMessageId) : null;
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (keepScroll.current !== null) { log.scrollTop = log.scrollHeight - keepScroll.current; keepScroll.current = null; return; }
    log.scrollTop = log.scrollHeight;
  }, [lastKey, messages.length]);

  async function deliver(text, clientMessageId) {
    sendingRef.current = true; setBusy(true); setSendError('');
    try {
      const data = await chat.sendMessage(id, text, clientMessageId);
      if (alive.current) apply(chat.mergeMessages(messagesRef.current, [data.message]));
      chat.notifyChatChanged();
    } catch (error) {
      if (!alive.current || expired(error)) return;
      if (!error.status) {
        // Không tới được server (mất mạng): giữ bong bóng để gửi lại đúng mã này.
        apply(messagesRef.current.map(message => (message.clientMessageId === clientMessageId && !Number.isInteger(message.seq) ? { ...message, pending: false, failed: true } : message)));
      } else {
        // Server đã từ chối: bỏ bong bóng, trả chữ về ô nhập. 403 chỉ nói "Không gửi được tin." (không nhắc chuyện chặn).
        apply(messagesRef.current.filter(message => message.clientMessageId !== clientMessageId || Number.isInteger(message.seq)));
        setDraft(current => current || text);
        setSendError(error.code === 'CHAT_UNAVAILABLE' ? 'Không gửi được tin.' : error.code === 'CHAT_NOT_ACTIVE' ? 'Cuộc trò chuyện này không còn nhận tin.' : error.message);
      }
    } finally {
      sendingRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    // sendingRef là lớp chặn thứ hai cho bấm đúp (lớp đầu: nút bị khóa ngay khi ô nhập rỗng hay đang gửi).
    if (!text || text.length > TEXT_MAX || sendingRef.current || !canWrite) return;
    const clientMessageId = chat.newClientMessageId();
    apply([...messagesRef.current, { clientMessageId, text, mine: true, pending: true }]);
    setDraft('');
    deliver(text, clientMessageId);
  }

  function retry(message) {
    if (sendingRef.current) return;
    apply(messagesRef.current.map(item => (item === message ? { ...item, failed: false, pending: true } : item)));
    deliver(message.text, message.clientMessageId);
  }

  async function loadOlder() {
    const first = messagesRef.current.find(message => Number.isInteger(message.seq));
    if (!first) return;
    try {
      const data = await chat.fetchMessages(id, { beforeSeq: first.seq });
      if (!alive.current) return;
      const log = logRef.current;
      keepScroll.current = log ? log.scrollHeight - log.scrollTop : null;
      apply(chat.mergeMessages(messagesRef.current, data.messages)); setHasOlder(data.hasMore);
    } catch (error) { if (!expired(error)) setLoadError(error.message); }
  }

  async function act(run, focusAfter) {
    setBusy(true); setSendError('');
    try {
      const result = await run();
      chat.notifyChatChanged();
      onChanged(result);
      if (focusAfter) requestAnimationFrame(focusAfter);
    } catch (error) { if (!expired(error)) setSendError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }

  function askBlock() { setConfirmBlock(true); requestAnimationFrame(() => confirmRef.current?.focus()); }
  function cancelBlock() { setConfirmBlock(false); requestAnimationFrame(() => headingRef.current?.focus()); }
  // Đóng hộp báo cáo: focus quay về đúng nút "Báo cáo" của tin đó, để người dùng bàn phím không bị đẩy về đầu trang.
  function closeReport(seq) {
    setReporting(null);
    requestAnimationFrame(() => logRef.current?.querySelector(`[data-report-seq="${seq}"]`)?.focus());
  }

  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  const remaining = TEXT_MAX - draft.length;

  return <section className="chat-panel chat-thread" aria-labelledby="chat-thread-title">
    <header className="chat-thread-head">
      <button type="button" className="chat-back" onClick={onBack}>← Danh sách</button>
      <h2 id="chat-thread-title" ref={headingRef} tabIndex={-1}>{name}</h2>
      {canWrite && !confirmBlock && <button type="button" className="chat-block" onClick={askBlock}>Chặn</button>}
    </header>
    {confirmBlock && <div className="chat-confirm chat-confirm-thread" role="group" aria-labelledby="chat-block-question" tabIndex={-1} ref={confirmRef}>
      <p id="chat-block-question">Chặn {name}? Hai bạn sẽ không nhắn tin cho nhau được nữa. Người này không nhận được thông báo nào.</p>
      <div className="chat-invite-actions">
        <button type="button" className="chat-button-danger" disabled={busy} onClick={() => act(async () => { await chat.block(id); return null; })}>Xác nhận chặn</button>
        <button type="button" className="chat-button-ghost" onClick={cancelBlock}>Không chặn</button>
      </div>
    </div>}

    {isInvite
      ? <InviteCard conversation={conversation} firstText={messages[0]?.text} busy={busy} declined={conversation.status === 'DECLINED'}
        onAccept={() => act(async () => (await chat.accept(id)).conversation, () => inputRef.current?.focus())}
        onDecline={() => act(async () => (await chat.decline(id)).conversation)}
        onBlock={() => act(async () => { await chat.block(id); return null; })} />
      : <div className="chat-log" ref={logRef} role="log" aria-label={'Tin nhắn với ' + name} aria-live={loaded ? 'polite' : 'off'}>
        {!loaded && !loadError && <p className="chat-meta" role="status">Đang tải tin nhắn…</p>}
        {loadError && <div className="chat-error" role="alert">{loadError}<button type="button" className="chat-link-button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
        {hasOlder && <button type="button" className="chat-link-button chat-older" onClick={loadOlder}>Xem tin cũ hơn</button>}
        {messages.map(message => {
          const side = message.mine ? 'is-mine' : 'is-other';
          return <div key={message.seq ?? message.clientMessageId} className="chat-item">
            {/* Chữ tin nhắn luôn là text của React, tự thoát HTML; không bao giờ chèn HTML thô. */}
            <div className={`chat-bubble ${side}${message.pending ? ' is-pending' : ''}`} aria-busy={message.pending ? 'true' : undefined}>
              <span style={SR_ONLY}>{message.mine ? 'Bạn: ' : name + ': '}</span>{message.text}
            </div>
            {message.pending && <div className="chat-meta is-mine" aria-hidden="true">Đang gửi</div>}
            {message.failed && <div className="chat-meta is-mine is-failed">Chưa gửi được<button type="button" className="chat-link-button" onClick={() => retry(message)}>Gửi lại</button></div>}
            {Number.isInteger(message.seq) && <div className={'chat-meta ' + side}>{chat.shortTime(message.createdAt)}
              {!message.mine && reporting !== message.seq && <button type="button" className="chat-link-button" data-report-seq={message.seq} aria-label={`Báo cáo tin lúc ${chat.shortTime(message.createdAt)}: ${message.text.slice(0, 40)}`} onClick={() => setReporting(message.seq)}>Báo cáo</button>}
            </div>}
            {!message.mine && reporting === message.seq && <ReportForm conversationId={id} message={message} name={name} onClose={() => closeReport(message.seq)} onExpired={onExpired} />}
          </div>;
        })}
      </div>}

    {/* Người nhận lời mời trả lời bằng thẻ lời mời, nên không có ô soạn. */}
    {!isInvite && <form className="chat-compose" onSubmit={submit}>
      {waiting && <p className="chat-locked" role="status">Đang chờ chấp nhận. Bạn nhắn tiếp được sau khi {name} chấp nhận lời mời.</p>}
      <div className="chat-compose-row">
        <label htmlFor="chat-input" style={SR_ONLY}>Nội dung tin nhắn</label>
        <textarea id="chat-input" ref={inputRef} rows={1} maxLength={TEXT_MAX} placeholder={canWrite ? 'Nhập tin nhắn…' : ''} value={draft} disabled={!canWrite}
          onChange={event => setDraft(event.target.value)} onKeyDown={onKey} />
        <button type="submit" className="button-primary" disabled={!canWrite || busy || !draft.trim()}>Gửi</button>
      </div>
      {sendError && <p className="chat-error" role="alert">{sendError}</p>}
      {canWrite && <div className="chat-compose-hint"><span className="chat-keys">Enter để gửi · Shift + Enter để xuống dòng</span>{remaining < 100 && <span>còn {remaining} ký tự</span>}</div>}
    </form>}
  </section>;
}
