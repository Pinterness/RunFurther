'use client';
// Công tắc realtime của chat trong /admin/messages (P14, ADR realtime 3.8). Tắt thì server ngắt mọi socket và từ chối
// kết nối mới; trang tin nhắn của người dùng tự quay về hỏi lại server mỗi 5 giây, nên chat vẫn chạy, chỉ chậm hơn.
// Biến môi trường CHAT_REALTIME=off trên Render là công tắc tổng: đang đặt thì bật ở đây cũng không có realtime.
import { useEffect, useRef, useState } from 'react';
import * as chat from '../../../lib/chatClient';
import './chat.css';

const when = iso => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

export default function ChatRealtimeSwitch({ onExpired, onForbidden }) {
  const [setting, setSetting] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const alive = useRef(true);

  function fail(failure) {
    if (failure.status === 401) onExpired();
    else if (failure.status === 403) onForbidden();
    else setError(failure.message);
  }
  async function load() {
    setError('');
    try { const data = await chat.realtimeSetting(); if (alive.current) setSetting(data.setting); }
    catch (failure) { if (alive.current) fail(failure); }
  }
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, []);

  async function toggle() {
    setSaving(true); setError('');
    try { const data = await chat.updateRealtimeSetting(!setting.realtimeEnabled); if (alive.current) setSetting(data.setting); }
    catch (failure) { if (alive.current) fail(failure); }
    finally { if (alive.current) setSaving(false); }
  }

  const live = setting && setting.realtimeEnabled && !setting.forcedOff;
  return <section className="chat-panel chat-admin chat-realtime" aria-labelledby="chat-realtime-title" aria-busy={!setting || saving}>
    <div className="chat-admin-head">
      <h2 id="chat-realtime-title">Tin nhắn tức thì</h2>
      <p>Khi bật, tin hiện bên kia ngay qua WebSocket. Khi tắt, trang tin nhắn tự hỏi lại máy chủ mỗi 5 giây, nên tin vẫn tới, chỉ chậm hơn. Tắt khi realtime gặp sự cố.</p>
    </div>
    <div className="chat-admin-body">
      {error && <p className="notice notice-error" role="alert">{error}{!setting && <> <button type="button" onClick={load}>Thử lại</button></>}</p>}
      {!setting && !error && <p className="chat-state" role="status">Đang tải công tắc…</p>}
      {setting && <>
        <div className="chat-realtime-row">
          <button type="button" role="switch" aria-checked={setting.realtimeEnabled} aria-label="Bật tin nhắn tức thì" className={'chat-switch' + (setting.realtimeEnabled ? ' is-on' : '')} disabled={saving} onClick={toggle}><span aria-hidden="true" /></button>
          <p className="chat-realtime-state" role="status">{saving ? 'Đang lưu…' : live ? 'Đang bật' : 'Đang tắt'}</p>
        </div>
        {setting.forcedOff && <p className="notice" role="status">Máy chủ đang đặt CHAT_REALTIME=off, nên realtime tắt dù công tắc ở đây đang bật. Người giữ tài khoản Render xóa biến này để mở lại.</p>}
        <h3 className="chat-realtime-history-title">Lịch sử bật tắt</h3>
        {setting.history.length
          ? <ol className="chat-realtime-history">{setting.history.map((entry, index) => <li key={index}><strong>{entry.realtimeEnabled ? 'Bật' : 'Tắt'}</strong> <span className="chat-meta">{entry.changedBy?.fullName || 'Không rõ'} · <time dateTime={entry.changedAt}>{when(entry.changedAt)}</time></span></li>)}</ol>
          : <p className="chat-meta">Chưa có lần bật tắt nào. Chưa bật tắt lần nào thì realtime coi như bật.</p>}
      </>}
    </div>
  </section>;
}
