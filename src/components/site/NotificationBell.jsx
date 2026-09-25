'use client';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/clientApi';
export default function NotificationBell({ userId }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const root = useRef(null), trigger = useRef(null);
  useEffect(() => { setItems([]); setOpen(false); }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const token = localStorage.getItem('rf_token');
        if (!token) return;
        const response = await fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/notifications', { signal: controller.signal, headers: { Authorization: 'Bearer ' + token } });
        if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setItems(data.notifications); }
      } catch { /* Opening the panel provides an explicit error and retry. */ }
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [userId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError('');
    api('/notifications', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setItems(data.notifications); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const close = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { controller.abort(); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  async function markRead() {
    setError('');
    try { await api('/notifications/read', { method: 'POST', body: JSON.stringify({ keys: items.map(i => i.key) }) }); setItems(list => list.map(i => ({ ...i, read: true }))); } catch (e) { setError(e.message); }
  }
  const unread = items.filter(i => !i.read).length;
  return <div className="notification-control" ref={root}><button type="button" ref={trigger} className="notification-trigger" aria-label={'Thông báo' + (unread ? `, ${unread} chưa đọc` : '')} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen(value => !value)}><Bell size={19} strokeWidth={1.6} />{unread > 0 && <span className="notification-dot" />}</button>
    {open && <section className="notification-panel" id="notification-panel" aria-label="Thông báo của bạn"><div className="notification-heading"><h2>Thông báo</h2>{unread > 0 && <button onClick={markRead}>Đánh dấu đã đọc</button>}</div>{loading ? <p role="status">Đang tải...</p> : error ? <p role="alert">{error}</p> : items.length ? <ul>{items.map(item => <li key={item.key} className={item.read ? '' : 'is-unread'}><Link href={item.href} onClick={() => setOpen(false)}><strong>{item.title}</strong><span>{item.detail}</span><small>{new Date(item.at).toLocaleString('vi-VN')}</small></Link></li>)}</ul> : <p>Bạn chưa có thông báo mới.</p>}</section>}
  </div>;
}
