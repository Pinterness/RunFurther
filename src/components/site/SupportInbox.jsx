'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/clientApi';
import './support-inbox.css';

const statuses = { OPEN: 'Cần phản hồi', ANSWERED: 'Đã phản hồi', CLOSED: 'Đã đóng' };
const endpoint = '/support/admin/tickets';
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SupportInbox() {
  const [status, setStatus] = useState('OPEN'), [page, setPage] = useState(1);
  const [list, setList] = useState({ tickets: [], total: 0, totalPages: 1 });
  const [listLoading, setListLoading] = useState(true), [listError, setListError] = useState(''), [listVersion, refreshList] = useState(0);
  const [selectedId, setSelectedId] = useState(null), [ticket, setTicket] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [detailVersion, refreshDetail] = useState(0);
  const [drafts, setDrafts] = useState({}), [busy, setBusy] = useState(false), [writeError, setWriteError] = useState(''), [notice, setNotice] = useState('');
  const writeRequest = useRef(null), heading = useRef(null);

  useEffect(() => () => writeRequest.current?.abort(), []);
  useEffect(() => {
    const request = new AbortController();
    setListLoading(true); setListError('');
    api(endpoint + '?status=' + status + '&page=' + page, { signal: request.signal })
      .then(data => {
        if (request.signal.aborted) return;
        const totalPages = Math.max(1, Number(data.totalPages) || 1);
        if (page > totalPages) { setPage(totalPages); return; }
        setList({ tickets: data.tickets || [], total: data.total || 0, totalPages });
      })
      .catch(error => { if (!request.signal.aborted) setListError(error.message); })
      .finally(() => { if (!request.signal.aborted) setListLoading(false); });
    return () => request.abort();
  }, [status, page, listVersion]);

  useEffect(() => {
    const request = new AbortController();
    setTicket(null); setDetailError(''); setWriteError(''); setNotice('');
    if (!selectedId) { setDetailLoading(false); return () => request.abort(); }
    setDetailLoading(true);
    api(endpoint + '/' + encodeURIComponent(selectedId), { signal: request.signal })
      .then(data => {
        if (request.signal.aborted) return;
        if (!data.ticket) throw new Error('Không tìm thấy yêu cầu hỗ trợ.');
        setTicket(data.ticket);
      })
      .catch(error => { if (!request.signal.aborted) setDetailError(error.message); })
      .finally(() => { if (!request.signal.aborted) setDetailLoading(false); });
    return () => request.abort();
  }, [selectedId, detailVersion]);

  useEffect(() => { if (ticket?._id) heading.current?.focus(); }, [ticket?._id]);

  function changeFilter(next) {
    setStatus(next); setPage(1); setSelectedId(null);
  }
  function changePage(next) { setPage(next); setSelectedId(null); }
  async function updateTicket(kind) {
    if (!ticket || writeRequest.current) return;
    const id = ticket._id, message = (drafts[id] || '').trim();
    if (kind === 'reply' && (!message || message.length > 4000)) return;
    const request = new AbortController(); writeRequest.current = request;
    setBusy(true); setWriteError(''); setNotice('');
    try {
      const result = await api(endpoint + '/' + encodeURIComponent(id) + (kind === 'reply' ? '/messages' : ''), {
        method: kind === 'reply' ? 'POST' : 'PATCH', signal: request.signal,
        body: JSON.stringify(kind === 'reply' ? { message } : { status: kind }),
      });
      if (request.signal.aborted) return;
      if (!result.ticket) throw new Error('Chưa nhận được trạng thái mới. Hãy tải lại hội thoại để kiểm tra.');
      setTicket(result.ticket);
      if (kind === 'reply') setDrafts(previous => ({ ...previous, [id]: '' }));
      setNotice(kind === 'reply' ? 'Đã gửi phản hồi.' : kind === 'CLOSED' ? 'Đã đóng yêu cầu.' : 'Đã mở lại yêu cầu.');
      refreshList(value => value + 1);
    } catch (error) { if (!request.signal.aborted) setWriteError(error.message); }
    finally {
      if (!request.signal.aborted) setBusy(false);
      if (writeRequest.current === request) writeRequest.current = null;
    }
  }
  const draft = ticket ? drafts[ticket._id] || '' : '';

  return <section className="support-inbox" aria-labelledby="support-inbox-heading">
    <header className="support-inbox-heading"><div><p className="section-index">RUNFURTHER / CHĂM SÓC NGƯỜI CHẠY</p><h2 id="support-inbox-heading">Một lời nhắn. Một sự đồng hành.</h2><p>Tiếp nhận câu hỏi và phản hồi trực tiếp cho người dùng.</p></div><button type="button" className="quiet-button" disabled={busy || listLoading || detailLoading} onClick={() => { refreshList(value => value + 1); refreshDetail(value => value + 1); }}>Làm mới</button></header>
    <div className="support-inbox-filters" aria-label="Lọc yêu cầu hỗ trợ">{Object.entries(statuses).map(([key, label]) => <button type="button" key={key} aria-pressed={status === key} disabled={busy} onClick={() => changeFilter(key)}>{label}</button>)}</div>
    <div className="support-inbox-grid">
      <aside className="support-ticket-list" aria-label="Danh sách yêu cầu" aria-busy={listLoading}>
        <div className="support-list-heading"><h3>Hộp thư</h3>{!listLoading && !listError && <span>{list.total} yêu cầu</span>}</div>
        {listLoading ? <p className="support-inbox-empty" role="status">Đang tải hộp thư...</p> : listError ? <div className="support-inbox-error" role="alert"><p>{listError}</p><button type="button" className="text-action" onClick={() => refreshList(value => value + 1)}>Tải lại danh sách</button></div> : !list.tickets.length ? <div className="support-inbox-empty"><h3>Hộp thư đã gọn.</h3><p>Chưa có yêu cầu ở trạng thái “{statuses[status]}”.</p></div> : <ul>{list.tickets.map(item => <li key={item._id}><button type="button" className="support-ticket-row" aria-pressed={selectedId === item._id} disabled={busy} onClick={() => setSelectedId(item._id)}><span className="support-ticket-meta"><span>{item.userId?.fullName || 'Người dùng'}</span><time dateTime={item.updatedAt || item.createdAt}>{dateLabel(item.updatedAt || item.createdAt)}</time></span><strong>{item.subject}</strong><span className="support-ticket-preview">{item.messages?.at(-1)?.content || 'Mở để xem nội dung yêu cầu'}</span></button></li>)}</ul>}
        {!listLoading && !listError && list.totalPages > 1 && <nav className="support-pagination" aria-label="Trang yêu cầu hỗ trợ"><button type="button" disabled={busy || page <= 1} onClick={() => changePage(page - 1)}>Trước</button><span>{page} / {list.totalPages}</span><button type="button" disabled={busy || page >= list.totalPages} onClick={() => changePage(page + 1)}>Sau</button></nav>}
      </aside>
      <div className="support-ticket-detail" aria-busy={detailLoading}>
        {!selectedId ? <div className="support-detail-placeholder"><span aria-hidden="true">RF.</span><h3>Lắng nghe để cùng đi xa.</h3><p>Chọn một yêu cầu trong hộp thư để xem lịch sử và gửi phản hồi.</p></div> : detailLoading ? <p className="support-inbox-empty" role="status">Đang mở hội thoại...</p> : detailError ? <div className="support-inbox-error" role="alert"><p>{detailError}</p><button type="button" className="text-action" onClick={() => refreshDetail(value => value + 1)}>Tải lại hội thoại</button></div> : ticket && <>
          <header className="support-thread-heading"><div><span className={'support-status support-status-' + ticket.status.toLowerCase()}>{statuses[ticket.status] || ticket.status}</span><h3 ref={heading} tabIndex={-1}>{ticket.subject}</h3><p>{ticket.userId?.fullName || 'Người dùng'}<span>{ticket.userId?.email}</span></p></div><button type="button" className="quiet-button" disabled={busy} onClick={() => updateTicket(ticket.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}>{ticket.status === 'CLOSED' ? 'Mở lại yêu cầu' : 'Đóng yêu cầu'}</button></header>
          <ol className="support-message-log" role="log" aria-label="Lịch sử hỗ trợ" aria-live="polite" aria-relevant="additions text">{(ticket.messages || []).map((message, index) => <li key={message._id || index} className={'support-message support-message-' + (message.role === 'support' ? 'staff' : 'customer')}><div className="support-message-author"><strong>{message.role === 'support' ? 'RunFurther' : ticket.userId?.fullName || 'Người dùng'}</strong><time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time></div><p>{message.content}</p></li>)}</ol>
          {writeError && <p role="alert" className="support-inbox-error">{writeError}</p>}
          <p className="support-write-status" role="status">{busy ? 'Đang lưu...' : notice}</p>
          {ticket.status === 'CLOSED' ? <p className="support-closed-note">Yêu cầu đã đóng. Bạn có thể mở lại để tiếp tục phản hồi.</p> : <form className="support-reply" onSubmit={event => { event.preventDefault(); updateTicket('reply'); }}><label htmlFor="support-admin-reply">Phản hồi của RunFurther</label><textarea id="support-admin-reply" name="message" rows={4} required maxLength={4000} disabled={busy} value={draft} onChange={event => setDrafts(previous => ({ ...previous, [ticket._id]: event.target.value }))} placeholder="Viết câu trả lời rõ ràng và hữu ích cho người chạy..." aria-describedby="support-reply-count" /><div><small id="support-reply-count">{draft.length.toLocaleString('vi-VN')} / 4.000 ký tự</small><button type="submit" className="button-dark" disabled={busy || !draft.trim() || draft.length > 4000}>{busy ? 'Đang gửi...' : 'Gửi phản hồi'}</button></div></form>}
        </>}
      </div>
    </div>
  </section>;
}
