'use client';
// Hàng chờ báo cáo tin nhắn cho Super Admin (P15.2, spec T12): bản chụp đúng tin bị báo cáo, tên hai bên, lý do và ghi
// chú; "Bỏ qua" hay "Khóa nhắn tin" (có bước xác nhận trong trang); báo cáo đã khóa có "Bỏ khóa". Không có email hay id
// người dùng nào, vì API không trả.
import { useEffect, useRef, useState } from 'react';
import * as chat from '../../../lib/chatClient';
import RunnerAvatar from '../RunnerAvatar';
import './chat.css';

const TABS = [['OPEN', 'Đang chờ'], ['LOCKED', 'Đã khóa'], ['DISMISSED', 'Đã bỏ qua']];
const REASON = Object.fromEntries(chat.REPORT_REASONS);
const when = iso => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

export default function ChatAdmin({ onExpired, onForbidden }) {
  const [status, setStatus] = useState('OPEN');
  const [reports, setReports] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(null), [busy, setBusy] = useState(false);
  const latest = useRef(0), confirmRef = useRef(null), panelRef = useRef(null);
  // Tab đang mở ở lần render mới nhất: thao tác xong mới tải lại, lúc đó người dùng có thể đã sang tab khác.
  const statusRef = useRef(status);
  statusRef.current = status;

  function fail(failure) {
    if (failure.status === 401) onExpired();
    else if (failure.status === 403) onForbidden();
    else setError(failure.message);
  }
  // keep: tải lại sau một thao tác thì giữ danh sách đang hiện tới khi có dữ liệu mới, không nháy chữ "Đang tải".
  async function load(which = status, keep = false) {
    const ticket = ++latest.current;
    if (!keep) setReports(null);
    setError('');
    try {
      const data = await chat.adminReports(which);
      if (ticket === latest.current) setReports(data.reports);
    } catch (failure) { if (ticket === latest.current) fail(failure); }
  }
  useEffect(() => { load(status); }, [status]);

  async function act(run, message) {
    setBusy(true); setError(''); setNotice('');
    // Nút vừa bấm biến mất cùng báo cáo, nên đưa focus về khung danh sách thay vì để rơi về đầu trang.
    try { await run(); setConfirming(null); setNotice(message); panelRef.current?.focus(); await load(statusRef.current, true); }
    catch (failure) { fail(failure); }
    finally { setBusy(false); }
  }
  function askLock(report) { setConfirming(report.id); requestAnimationFrame(() => confirmRef.current?.focus()); }

  let body;
  if (!reports) body = error ? null : <p className="chat-state" role="status">Đang tải báo cáo…</p>;
  else if (!reports.length) body = <p className="chat-state">{status === 'OPEN' ? 'Không có báo cáo nào đang chờ.' : 'Chưa có báo cáo nào ở mục này.'}</p>;
  else body = <ul className="chat-admin-list">
    {reports.map(report => <li key={report.id} className="chat-admin-item">
      <div className="chat-admin-people">
        <span aria-hidden="true"><RunnerAvatar name={report.reporter.displayName} theme={report.reporter.avatarTheme} /></span>
        <span><strong>{report.reporter.displayName}</strong> báo cáo <strong>{report.reported.displayName}</strong></span>
        <span className="chat-meta">{when(report.createdAt)}</span>
      </div>
      <p><span className="chat-admin-reason">{REASON[report.reason] || report.reason}</span>{report.note && <> · {report.note}</>}</p>
      <blockquote className="chat-report-quote">{report.message.text}</blockquote>
      <p className="chat-meta">Tin gửi lúc {when(report.message.sentAt)}</p>
      {report.status === 'OPEN' && (confirming === report.id
        ? <div className="chat-confirm" role="group" aria-labelledby={'lock-q-' + report.id} tabIndex={-1} ref={confirmRef}>
          <p id={'lock-q-' + report.id}>Khóa quyền nhắn tin của {report.reported.displayName}? Người này không gửi được tin hay lời mời nữa, nhưng vẫn mua vé và dùng ví. Bạn bỏ khóa được ở mục "Đã khóa".</p>
          <div className="chat-invite-actions">
            <button type="button" className="chat-button-danger" disabled={busy} onClick={() => act(() => chat.resolveReport(report.id, 'LOCK'), `Đã khóa nhắn tin của ${report.reported.displayName}.`)}>Xác nhận khóa</button>
            <button type="button" className="chat-button-ghost" onClick={() => setConfirming(null)}>Không khóa</button>
          </div>
        </div>
        : <div className="chat-invite-actions">
          <button type="button" className="chat-button-ghost" disabled={busy} onClick={() => act(() => chat.resolveReport(report.id, 'DISMISS'), 'Đã bỏ qua báo cáo.')}>Bỏ qua</button>
          <button type="button" className="chat-button-danger" disabled={busy} onClick={() => askLock(report)}>Khóa nhắn tin</button>
        </div>)}
      {report.status === 'LOCKED' && (report.reported.locked
        ? <button type="button" className="chat-button-ghost" disabled={busy} onClick={() => act(() => chat.unlockMember(report.id), `Đã bỏ khóa nhắn tin của ${report.reported.displayName}.`)}>Bỏ khóa</button>
        : <p className="chat-meta">Đã bỏ khóa.</p>)}
    </li>)}
  </ul>;

  return <section className="chat-panel chat-admin" aria-labelledby="chat-admin-title">
    <div className="chat-admin-head">
      <h2 id="chat-admin-title">Báo cáo tin nhắn</h2>
      <p>Bạn chỉ thấy đúng tin bị báo cáo, không đọc được cuộc trò chuyện.</p>
    </div>
    <div className="chat-tabs" role="tablist" aria-label="Trạng thái báo cáo">
      {TABS.map(([key, label]) => <button key={key} id={'report-tab-' + key} type="button" role="tab" className="chat-tab" aria-selected={status === key} onClick={() => { setNotice(''); setStatus(key); }}>{label}</button>)}
    </div>
    <div className="chat-admin-body" role="tabpanel" aria-labelledby={'report-tab-' + status} tabIndex={-1} ref={panelRef}>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {body}
    </div>
  </section>;
}
