'use client';
import { useRef, useState } from 'react';
import { api } from '../../lib/clientApi';
import EventPhoto from './EventPhoto';
export default function EventImageUpload({ kind, value, eventId, onChange, onBusy }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef(null);
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Chọn ảnh JPG, PNG hoặc WebP, tối đa 5 MB.'); return; }
    setBusy(true); onBusy(true); setError('');
    try {
      const result = await api((eventId ? '/admin/events/' + eventId : '/admin') + '/images?kind=' + kind, { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
      onChange(result.url);
    } catch (e) { setError(e.message); } finally { setBusy(false); onBusy(false); }
  }
  return <div className={'event-upload upload-' + kind}><span className="upload-label">{kind === 'banner' ? 'Ảnh bìa giải' : 'Logo giải'}</span>{value ? <EventPhoto src={value} alt={kind === 'banner' ? 'Xem trước ảnh bìa' : 'Xem trước logo'} /> : <div className="upload-empty">{kind === 'banner' ? 'Ảnh ngang giới thiệu đường chạy' : 'Dấu ấn của giải'}</div>}<input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label={kind === 'banner' ? 'Tải ảnh bìa' : 'Tải logo'} onChange={upload} disabled={busy} /><div className="organizer-row-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Đang tải...' : value ? 'Đổi ảnh' : 'Chọn ảnh'}</button>{value && <button type="button" className="text-action" disabled={busy} onClick={() => onChange('')}>Gỡ ảnh</button>}<small>{busy ? 'Đang xử lý ảnh...' : 'JPG / PNG / WebP · Tối đa 5 MB'}</small></div>{error && <p role="alert" className="notice notice-error">{error}</p>}</div>;
}
