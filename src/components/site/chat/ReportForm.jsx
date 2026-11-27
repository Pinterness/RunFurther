'use client';
// Hộp "Báo cáo tin này" trong khung chat (P15.2): chọn lý do, ghi chú tùy chọn (tối đa 500 ký tự), gửi đúng seq của tin
// được chọn. Báo cáo lại cùng tin thì server trả báo cáo cũ, giao diện báo "đã báo cáo rồi".
import { useEffect, useRef, useState } from 'react';
import * as chat from '../../../lib/chatClient';

const NOTE_MAX = 500;

export default function ReportForm({ conversationId, message, name, onClose, onExpired }) {
  const [reason, setReason] = useState(''), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const boxRef = useRef(null);
  useEffect(() => { boxRef.current?.focus(); }, []);

  async function submit(event) {
    event.preventDefault();
    if (!reason || busy) return;
    setBusy(true); setError('');
    try {
      // Báo cáo lại cùng tin thì server trả báo cáo cũ (200): với người dùng, kết quả vẫn là tin đã được báo cáo.
      await chat.reportMessage(conversationId, message.seq, reason, note.trim());
      setDone('Đã gửi báo cáo. Super Admin sẽ xem đúng tin này; người kia không được báo.');
    } catch (failure) {
      if (failure.status === 401) { onExpired(); return; }
      setError(failure.message);
    } finally { setBusy(false); }
  }

  return <div className="chat-report" role="group" aria-labelledby={'report-title-' + message.seq} tabIndex={-1} ref={boxRef}>
    <p id={'report-title-' + message.seq} className="chat-report-title">Báo cáo tin của {name}</p>
    <blockquote className="chat-report-quote">{message.text}</blockquote>
    {done
      ? <><p role="status">{done} Nếu không muốn nhận tin từ người này nữa, bạn có thể chặn ở đầu khung chat.</p>
        <button type="button" className="chat-button-ghost" onClick={onClose}>Đóng</button></>
      : <form onSubmit={submit}>
        <fieldset className="chat-report-reasons">
          <legend>Lý do</legend>
          {chat.REPORT_REASONS.map(([value, label]) => <label key={value}>
            <input type="radio" name={'report-reason-' + message.seq} value={value} checked={reason === value} onChange={() => setReason(value)} />{label}
          </label>)}
        </fieldset>
        <label htmlFor={'report-note-' + message.seq}>Ghi chú thêm (không bắt buộc)</label>
        <textarea id={'report-note-' + message.seq} rows={2} maxLength={NOTE_MAX} value={note} onChange={event => setNote(event.target.value)} />
        {error && <p className="chat-error" role="alert">{error}</p>}
        <div className="chat-invite-actions">
          <button type="submit" className="chat-button-danger" disabled={!reason || busy}>{busy ? 'Đang gửi…' : 'Gửi báo cáo'}</button>
          <button type="button" className="chat-button-ghost" onClick={onClose} disabled={busy}>Hủy</button>
        </div>
      </form>}
  </div>;
}
