'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/clientApi';
import Modal from '../site/Modal';
import { volunteerRoles } from '../site/VolunteerApplications';

export default function VolunteerModal({ eventId, eventName }) {
  const [open, setOpen] = useState(false), [signedIn, setSignedIn] = useState(false);
  const [applicant, setApplicant] = useState({ fullName: '', email: '', phone: '', tShirtSize: 'L', note: '' });
  const [desiredRole, setDesiredRole] = useState('CHECKIN');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState(null);
  const inFlight = useRef(false);
  const field = key => ({ value: applicant[key], onChange: event => setApplicant(value => ({ ...value, [key]: event.target.value })) });
  function show() {
    setSignedIn(Boolean(localStorage.getItem('rf_token'))); setError(''); setOpen(true);
  }
  async function submit(event) {
    event.preventDefault(); if (inFlight.current || receipt) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const data = await api('/staff/events/' + eventId + '/volunteers/apply', { method: 'POST', body: JSON.stringify({ applicant, desiredRole }) });
      setReceipt(data.application);
      window.dispatchEvent(new Event('rf-notifications'));
    } catch (error) { setError(error.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="quiet-button" style={{ width: '100%', marginTop: 12 }} onClick={show}>Đăng ký tình nguyện viên</button>
    {open && <Modal title="Đăng ký tình nguyện viên" busy={busy} onClose={() => setOpen(false)}>
      <p className="dialog-copy">Giải chạy: <strong>{eventName}</strong></p>
      {receipt ? <>
        <p role="status" className="notice">Đơn đã được lưu và gửi tới ban tổ chức để xét duyệt.</p>
        <p className="dialog-copy">Mã đơn: <code>{receipt._id}</code></p>
        <p className="dialog-copy">{signedIn ? 'Theo dõi trạng thái và kết quả trong Tài khoản → Tình nguyện viên.' : 'Bạn gửi đơn khi chưa đăng nhập. Hãy giữ mã đơn; ban tổ chức sẽ liên hệ qua thông tin đã cung cấp. Đơn này không tự gắn vào tài khoản đăng nhập sau đó.'}</p>
        <div className="dialog-actions">{signedIn && <Link className="button-primary" href="/account#volunteers">Theo dõi đơn của tôi</Link>}<button className="quiet-button" onClick={() => setOpen(false)}>Đóng</button></div>
      </> : <form onSubmit={submit}>
        {!signedIn && <p className="notice"><Link href={'/login?next=' + encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/events')}>Đăng nhập trước khi gửi</Link> để theo dõi kết quả trong tài khoản. Nếu gửi không đăng nhập, ban tổ chức cần liên hệ với bạn trực tiếp.</p>}
        <div className="runner-fields">
          <label className="field-wide">Họ và tên<input required maxLength={120} autoComplete="name" {...field('fullName')} /></label>
          <label>Email<input required type="email" autoComplete="email" {...field('email')} /></label>
          <label>Số điện thoại<input required type="tel" maxLength={30} autoComplete="tel" {...field('phone')} /></label>
          <label>Vị trí mong muốn<select value={desiredRole} onChange={event => setDesiredRole(event.target.value)}>{Object.entries(volunteerRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Size áo tình nguyện viên<select {...field('tShirtSize')}>{['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map(size => <option key={size}>{size}</option>)}</select></label>
          <label className="field-wide">Ghi chú / Kinh nghiệm<textarea maxLength={500} rows={3} {...field('note')} /></label>
        </div>
        {error && <p role="alert" className="notice notice-error">{error}</p>}
        <div className="dialog-actions"><button className="button-primary" disabled={busy}>{busy ? 'Đang gửi...' : 'Gửi đơn đăng ký'}</button><button type="button" className="quiet-button" disabled={busy} onClick={() => setOpen(false)}>Hủy</button></div>
      </form>}
    </Modal>}
  </>;
}
