'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { api } from '../../lib/clientApi';
import './support-chat.css';

const initialPrompts = ['Làm sao để đăng ký giải?', 'Tôi đã chuyển khoản nhưng chưa có vé.', 'Cách nhận race kit?'];
const statuses = { OPEN: 'Chờ phản hồi', ANSWERED: 'Đã phản hồi', CLOSED: 'Đã đóng' };
function internalSource(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://runfurther.invalid');
    return url.origin === 'https://runfurther.invalid' ? url.pathname + url.search + url.hash : null;
  } catch { return null; }
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SupportChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [view, setView] = useState('assistant');
  const [authenticated, setAuthenticated] = useState(false), [authVersion, setAuthVersion] = useState(0);
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState('');
  const [mode, setMode] = useState('guide'), [suggestions, setSuggestions] = useState(initialPrompts);
  const [chatBusy, setChatBusy] = useState(false), [failedChat, setFailedChat] = useState(null);
  const [tickets, setTickets] = useState([]), [ticketView, setTicketView] = useState('list');
  const [selectedTicket, setSelectedTicket] = useState(null), [ticketLoading, setTicketLoading] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false), [ticketError, setTicketError] = useState('');
  const [subject, setSubject] = useState(''), [ticketDraft, setTicketDraft] = useState(''), [replyDraft, setReplyDraft] = useState('');
  const trigger = useRef(null), heading = useRef(null), transcript = useRef(null), ticketTranscript = useRef(null);
  const mounted = useRef(true), epoch = useRef(0), requests = useRef(new Set());
  const chatRequest = useRef(null), ticketMutation = useRef(null), detailRequest = useRef(null);
  const selectedId = useRef(''), lastAuth = useRef(null), syncAuth = useRef(null), nextMessageId = useRef(0);
  selectedId.current = selectedTicket?._id || '';

  const begin = useCallback(() => {
    const request = { controller: new AbortController(), epoch: epoch.current, timedOut: false };
    request.timer = window.setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 35000);
    requests.current.add(request); return request;
  }, []);
  const current = useCallback(request => mounted.current && request.epoch === epoch.current, []);
  const finish = useCallback(request => { clearTimeout(request.timer); requests.current.delete(request); }, []);
  const abortAll = useCallback(() => {
    requests.current.forEach(request => { clearTimeout(request.timer); request.controller.abort(); });
    requests.current.clear(); chatRequest.current = null; ticketMutation.current = null; detailRequest.current = null;
  }, []);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);

  useEffect(() => {
    mounted.current = true;
    const sync = event => {
      if (event?.type === 'storage' && event.key && !['rf_token', 'rf_user'].includes(event.key)) return;
      let token = null;
      try { token = localStorage.getItem('rf_token'); } catch { /* Private browsing can disable storage. */ }
      if (token !== lastAuth.current || event?.type === 'rf-auth') {
        epoch.current += 1; abortAll(); lastAuth.current = token;
        setMessages([]); setDraft(''); setMode('guide'); setSuggestions(initialPrompts); setFailedChat(null); setChatBusy(false);
        setTickets([]); setSelectedTicket(null); setTicketView('list'); setTicketError(''); setTicketBusy(false); setTicketLoading(false);
        setSubject(''); setTicketDraft(''); setReplyDraft(''); setAuthVersion(value => value + 1);
      }
      setAuthenticated(Boolean(token));
    };
    syncAuth.current = sync; sync(); window.addEventListener('rf-auth', sync); window.addEventListener('storage', sync);
    return () => { mounted.current = false; epoch.current += 1; abortAll(); syncAuth.current = null; window.removeEventListener('rf-auth', sync); window.removeEventListener('storage', sync); };
  }, [abortAll]);
  // SiteHeader also logs out by clearing storage and navigating in this tab.
  useEffect(() => { syncAuth.current?.(); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => heading.current?.focus());
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', escape); };
  }, [open, close]);
  useEffect(() => {
    if (open && view === 'assistant' && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [open, view, messages, chatBusy, failedChat]);
  useEffect(() => {
    if (open && view === 'tickets' && ticketTranscript.current) ticketTranscript.current.scrollTop = ticketTranscript.current.scrollHeight;
  }, [open, view, selectedTicket?.messages?.length]);

  async function sendChat(message, retry = null) {
    const text = message.trim();
    if (!text || text.length > 2000 || chatRequest.current) return;
    const history = retry?.history || messages.slice(-10).map(item => ({ role: item.role, content: item.content }));
    const request = begin(); chatRequest.current = request; setChatBusy(true); setFailedChat(null);
    if (!retry) { setMessages(items => [...items, { id: ++nextMessageId.current, role: 'user', content: text }]); setDraft(''); }
    try {
      const data = await api('/support/chat', { method: 'POST', body: JSON.stringify({ message: text, history, page: pathname }), signal: request.controller.signal });
      if (!current(request) || request.controller.signal.aborted) return;
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Chưa nhận được câu trả lời. Bạn thử lại nhé.');
      const replyMode = data.mode === 'ai' ? 'ai' : 'guide';
      const sources = (Array.isArray(data.sources) ? data.sources : []).slice(0, 5).map(source => ({ title: String(source?.title || 'Xem hướng dẫn'), url: internalSource(source?.url) })).filter(source => source.url);
      setMessages(items => [...items, { id: ++nextMessageId.current, role: 'assistant', content: data.reply, mode: replyMode, sources }]);
      setMode(replyMode);
      const next = (Array.isArray(data.suggestions) ? data.suggestions : []).filter(item => typeof item === 'string' && item.trim() && item.length <= 2000).slice(0, 3);
      setSuggestions(next.length ? next : initialPrompts);
    } catch (error) {
      if (current(request) && (!request.controller.signal.aborted || request.timedOut)) setFailedChat({ message: text, history, error: request.timedOut ? 'Phản hồi đang mất nhiều thời gian. Bạn có thể thử lại.' : error.message || 'Chưa kết nối được trợ lý.' });
    } finally {
      finish(request);
      if (chatRequest.current === request) { chatRequest.current = null; if (current(request)) setChatBusy(false); }
    }
  }

  const loadTickets = useCallback(async () => {
    const request = begin(); setTicketLoading(true); setTicketError('');
    try {
      const data = await api('/support/tickets', { signal: request.controller.signal });
      if (current(request) && !request.controller.signal.aborted) setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (error) {
      if (current(request) && (!request.controller.signal.aborted || request.timedOut)) setTicketError(request.timedOut ? 'Chưa tải được yêu cầu. Vui lòng thử lại.' : error.message);
    } finally { finish(request); if (current(request)) setTicketLoading(false); }
    return request;
  }, [begin, current, finish]);

  const refreshTicket = useCallback(async id => {
    if (!id || detailRequest.current || ticketMutation.current) return;
    const request = begin(); detailRequest.current = request;
    try {
      const data = await api('/support/tickets/' + encodeURIComponent(id), { signal: request.controller.signal });
      if (current(request) && !request.controller.signal.aborted && selectedId.current === id && data.ticket) { setSelectedTicket(data.ticket); setTicketError(''); }
    } catch (error) {
      if (current(request) && selectedId.current === id && (!request.controller.signal.aborted || request.timedOut)) setTicketError(request.timedOut ? 'Chưa cập nhật được phản hồi.' : error.message);
    } finally { finish(request); if (detailRequest.current === request) detailRequest.current = null; }
  }, [begin, current, finish]);

  useEffect(() => {
    if (!open || view !== 'tickets' || !authenticated || ticketView !== 'list') return;
    loadTickets();
  }, [open, view, authenticated, authVersion, ticketView, loadTickets]);
  useEffect(() => {
    if (!open || view !== 'tickets' || !authenticated || ticketView !== 'detail' || !selectedTicket?._id) return;
    const id = selectedTicket._id;
    const refresh = () => { if (!document.hidden) refreshTicket(id); };
    refresh(); const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer); document.removeEventListener('visibilitychange', refresh);
      if (detailRequest.current) { detailRequest.current.controller.abort(); finish(detailRequest.current); detailRequest.current = null; }
    };
  }, [open, view, authenticated, authVersion, ticketView, selectedTicket?._id, refreshTicket, finish]);

  async function submitTicket(event, isReply = false) {
    event.preventDefault();
    if (!authenticated || ticketMutation.current) return;
    const content = (isReply ? replyDraft : ticketDraft).trim();
    if (!content || content.length > 4000 || (!isReply && (!subject.trim() || subject.trim().length > 160))) return;
    if (detailRequest.current) { detailRequest.current.controller.abort(); finish(detailRequest.current); detailRequest.current = null; }
    const request = begin(); ticketMutation.current = request; setTicketBusy(true); setTicketError('');
    try {
      const path = isReply ? '/support/tickets/' + encodeURIComponent(selectedTicket._id) + '/messages' : '/support/tickets';
      const data = await api(path, { method: 'POST', body: JSON.stringify(isReply ? { message: content } : { subject: subject.trim(), message: content }), signal: request.controller.signal });
      if (!current(request) || request.controller.signal.aborted) return;
      if (data.ticket) { setSelectedTicket(data.ticket); setTicketView('detail'); setTickets(items => [data.ticket, ...items.filter(item => item._id !== data.ticket._id)]); }
      else setTicketView('list');
      if (isReply) setReplyDraft(''); else { setSubject(''); setTicketDraft(''); }
    } catch (error) {
      if (current(request) && (!request.controller.signal.aborted || request.timedOut)) setTicketError(request.timedOut ? 'Chưa xác nhận được yêu cầu. Hãy cập nhật danh sách trước khi gửi lại.' : error.message);
    } finally { finish(request); if (ticketMutation.current === request) { ticketMutation.current = null; if (current(request)) setTicketBusy(false); } }
  }
  function startTicket() { setTicketView('new'); setTicketError(''); }
  const lastQuestion = [...messages].reverse().find(item => item.role === 'user')?.content;

  return <div className="support-widget" data-support-widget data-open={open} onWheel={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()}>
    <button ref={trigger} className="support-launcher" type="button" aria-expanded={open} aria-controls="support-panel" aria-label={open ? 'Đóng hỗ trợ RunFurther' : 'Mở hỗ trợ RunFurther'} onClick={() => open ? close() : setOpen(true)}>
      {open ? <X size={18} aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}<span>Hỗ trợ</span>
    </button>
    {open && <section id="support-panel" className="support-panel" role="dialog" aria-labelledby="support-heading">
      <header className="support-header"><div><p>RUNFURTHER / LUÔN ĐỒNG HÀNH</p><h2 id="support-heading" ref={heading} tabIndex={-1}>Bạn cần giúp gì?</h2></div><button className="support-close" type="button" aria-label="Đóng hỗ trợ" onClick={close}><X size={19} aria-hidden="true" /></button></header>
      <nav className="support-tabs" aria-label="Hình thức hỗ trợ"><button type="button" aria-pressed={view === 'assistant'} onClick={() => setView('assistant')}>Trợ lý nhanh</button><button type="button" aria-pressed={view === 'tickets'} onClick={() => setView('tickets')}>Nhân viên hỗ trợ</button></nav>
      {view === 'assistant' ? <>
        <div className="support-mode"><span className="support-mode-dot" />{mode === 'ai' ? 'Trợ lý AI' : 'Hướng dẫn tự động'}<span>Đăng ký · Vé · Ngày chạy</span></div>
        <div className="support-transcript" ref={transcript} role="log" aria-label="Cuộc trò chuyện với trợ lý" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
          {!messages.length && <div className="support-welcome"><span>ĐỒNG HÀNH TỪ BƯỚC ĐẦU.</span><h3>Mọi câu hỏi đều có<br />một điểm bắt đầu.</h3><p>Tôi giúp bạn tìm hướng dẫn về đăng ký giải, vé, chuyển khoản và race kit.</p></div>}
          {messages.map(message => <article key={message.id} className={'support-message support-message-' + message.role}><small>{message.role === 'user' ? 'Bạn' : message.mode === 'ai' ? 'Trợ lý AI' : 'Hướng dẫn tự động'}</small><p>{message.content}</p>{message.sources?.length > 0 && <ul className="support-sources" aria-label="Nguồn tham khảo">{message.sources.map((source, index) => <li key={source.url + index}><Link href={source.url} onClick={close}>{source.title}<span aria-hidden="true"> ↗</span></Link></li>)}</ul>}</article>)}
          {chatBusy && <div className="support-typing" role="status"><span aria-hidden="true"><i /><i /><i /></span>Đang tìm câu trả lời…</div>}
          {failedChat && <div className="support-error" role="alert"><p>{failedChat.error}</p><button type="button" onClick={() => sendChat(failedChat.message, failedChat)}>Thử lại</button></div>}
          {!chatBusy && <div className="support-prompts" aria-label="Câu hỏi gợi ý">{suggestions.map((prompt, index) => <button key={index} type="button" onClick={() => sendChat(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>}
        </div>
        <form className="support-composer" onSubmit={event => { event.preventDefault(); sendChat(draft); }}><label htmlFor="support-message">Câu hỏi của bạn</label><div><textarea id="support-message" rows={2} value={draft} maxLength={2000} placeholder="Nhập điều bạn cần hỗ trợ…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!chatBusy) sendChat(draft); } }} /><button type="submit" disabled={chatBusy || !draft.trim()} aria-label="Gửi câu hỏi">Gửi <span aria-hidden="true">↑</span></button></div><p>Enter để gửi · Shift + Enter để xuống dòng</p><p>Câu hỏi có thể được xử lý bởi dịch vụ AI khi tính năng này được bật.</p></form>
      </> : !authenticated ? <div className="support-ticket-content support-ticket-guest"><span className="support-eyebrow">NHÂN VIÊN HỖ TRỢ</span><h3>Để chúng tôi tiếp tục<br />đồng hành cùng bạn.</h3><p>Đăng nhập để gửi yêu cầu và xem phản hồi từ nhân viên. Bạn vẫn có thể hỏi trợ lý mà không cần tài khoản.</p><Link className="button-dark" href={'/login?next=' + encodeURIComponent(pathname)} onClick={close}>Đăng nhập để gửi yêu cầu</Link><button className="support-text-button" type="button" onClick={() => setView('assistant')}>Tiếp tục với trợ lý</button></div> : <div className="support-ticket-content">
        <p className="support-ticket-note">Nhân viên phản hồi qua yêu cầu hỗ trợ; đây không phải cuộc trò chuyện trực tiếp.</p>
        {ticketError && <div className="support-error" role="alert"><p>{ticketError}</p></div>}
        {ticketView === 'list' && <><div className="support-ticket-toolbar"><h3>Yêu cầu của bạn</h3><button className="support-text-button" type="button" disabled={ticketLoading} onClick={loadTickets}>Cập nhật</button></div><button type="button" className="support-new-ticket" onClick={startTicket}>Gửi yêu cầu mới <span aria-hidden="true">↗</span></button>{ticketLoading && <p className="support-status" role="status">Đang tải yêu cầu…</p>}{!ticketLoading && !tickets.length && <p className="support-empty">Bạn chưa có yêu cầu hỗ trợ nào.</p>}<ul className="support-ticket-list">{tickets.map(ticket => <li key={ticket._id}><button type="button" onClick={() => { setSelectedTicket(ticket); setReplyDraft(''); setTicketError(''); setTicketView('detail'); }}><strong>{ticket.subject}</strong><span><i data-status={ticket.status}>{statuses[ticket.status] || 'Đang xử lý'}</i><time>{dateLabel(ticket.updatedAt)}</time></span></button></li>)}</ul></>}
        {ticketView === 'new' && <><button type="button" className="support-text-button" onClick={() => { setTicketView('list'); setTicketError(''); }}>← Yêu cầu của bạn</button><h3 className="support-ticket-title">Gửi nhân viên hỗ trợ</h3><p className="support-small-copy">Chỉ nội dung bạn nhập dưới đây được gửi cho nhân viên.</p>{lastQuestion && <button type="button" className="support-use-question" onClick={() => { setSubject(lastQuestion.slice(0, 160)); setTicketDraft(lastQuestion); }}>Dùng câu hỏi gần nhất</button>}<form className="support-ticket-form" onSubmit={event => submitTicket(event)}><label htmlFor="support-subject">Tiêu đề</label><input id="support-subject" required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Ví dụ: Chưa thấy vé sau chuyển khoản" /><label htmlFor="support-ticket-message">Nội dung cần hỗ trợ</label><textarea id="support-ticket-message" required rows={6} maxLength={4000} value={ticketDraft} onChange={event => setTicketDraft(event.target.value)} placeholder="Mô tả sự việc và mã đơn nếu có…" /><button className="button-dark" type="submit" disabled={ticketBusy || !subject.trim() || !ticketDraft.trim()}>{ticketBusy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></form></>}
        {ticketView === 'detail' && selectedTicket && <><div className="support-ticket-toolbar"><button className="support-text-button" type="button" onClick={() => { setTicketView('list'); setTicketError(''); }}>← Yêu cầu của bạn</button><button className="support-text-button" type="button" disabled={ticketBusy} onClick={() => refreshTicket(selectedTicket._id)}>Cập nhật</button></div><h3 className="support-ticket-title">{selectedTicket.subject}</h3><p className="support-ticket-state">{statuses[selectedTicket.status] || 'Đang xử lý'}</p><div className="support-ticket-transcript" ref={ticketTranscript} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Trao đổi với nhân viên" tabIndex={0}>{(selectedTicket.messages || []).map((message, index) => <article key={message._id || index} className={'support-message support-message-' + (message.role === 'customer' ? 'user' : 'assistant')}><small>{message.role === 'customer' ? 'Bạn' : 'Nhân viên RunFurther'}<time>{dateLabel(message.createdAt)}</time></small><p>{message.content}</p></article>)}</div>{selectedTicket.status === 'CLOSED' ? <div className="support-closed"><p>Yêu cầu đã đóng. Nếu cần thêm hỗ trợ, bạn có thể gửi yêu cầu mới.</p><button className="support-text-button" type="button" onClick={startTicket}>Gửi yêu cầu mới ↗</button></div> : <form className="support-ticket-form support-ticket-reply" onSubmit={event => submitTicket(event, true)}><label htmlFor="support-reply">Bổ sung thông tin</label><textarea id="support-reply" required rows={3} maxLength={4000} value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="Nhập nội dung bạn muốn bổ sung…" /><button className="button-dark" type="submit" disabled={ticketBusy || !replyDraft.trim()}>{ticketBusy ? 'Đang gửi…' : 'Gửi bổ sung'}</button></form>}</>}
      </div>}
    </section>}
  </div>;
}
