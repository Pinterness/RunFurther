'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import Modal from './Modal';
const labels = { CONFIRMED: 'Vé đã xác nhận', CHECKED_IN: 'Đã check-in', KIT_COLLECTED: 'Đã nhận race-kit', PENDING_TRANSFER: 'Đang chuyển nhượng', TRANSFERRED: 'Đã chuyển nhượng', CANCELLED: 'Đã hủy' };
export default function TicketCard({ ticket }) {
  const [open, setOpen] = useState(false), [qr, setQr] = useState(''), [error, setError] = useState('');
  const valid = ['CONFIRMED', 'CHECKED_IN', 'KIT_COLLECTED'].includes(ticket.status);
  useEffect(() => {
    let active = true;
    setQr(''); setError('');
    if (open && valid && ticket.qrToken) QRCode.toDataURL(ticket.qrToken, { width: 280, margin: 2, errorCorrectionLevel: 'M' }).then(value => { if (active) setQr(value); }).catch(() => { if (active) setError('Không tạo được mã QR. Vui lòng mở lại vé.'); });
    return () => { active = false; };
  }, [open, valid, ticket.qrToken]);
  return <><article className="runner-ticket"><div className="ticket-distance"><span>{ticket.categoryId?.distance ?? '—'}</span><small>KM</small></div><div className="ticket-info"><span className={'ticket-status ' + (valid ? 'status-valid' : '')}>{labels[ticket.status] || ticket.status}</span><h3>{ticket.eventId?.name || 'Giải chạy'}</h3><p>{ticket.eventId?.dateInfo?.raceDate ? new Date(ticket.eventId.dateInfo.raceDate).toLocaleDateString('vi-VN') : 'Chờ công bố'} · {ticket.eventId?.location?.city}</p><small>{ticket.categoryId?.name} · Áo {ticket.logistics?.shirtSize}</small></div><div className="ticket-bib"><small>BIB CỦA BẠN</small><strong>{ticket.bibNumber || 'Đang cấp'}</strong><button className="text-action" onClick={() => setOpen(true)}>Xem vé <span aria-hidden="true">↗</span></button></div></article>{open && <Modal title="Vé tham gia giải chạy" onClose={() => setOpen(false)}><div className="ticket-detail"><p className="section-index">{labels[ticket.status]}</p><h3>{ticket.eventId?.name}</h3><p>{ticket.runnerProfile?.fullName}</p>{valid && qr ? <img src={qr} width="280" height="280" alt="Mã QR vé để nhân sự kiểm tra" /> : <p>{valid ? error || (ticket.qrToken ? 'Đang tạo mã QR...' : 'Vé chưa có mã QR. Vui lòng liên hệ ban tổ chức.') : 'Mã QR không khả dụng khi vé bị hủy hoặc đang chuyển nhượng.'}</p>}<strong>{ticket.bibNumber}</strong><p>Race-kit: {ticket.logistics?.raceKitIssued ? 'Đã nhận' : 'Chưa nhận'} · Check-in: {ticket.logistics?.hasCheckedIn ? 'Đã check-in' : 'Chưa check-in'}</p>{qr && valid && <a className="button-dark" download={'RunFurther-' + ticket.bibNumber + '.png'} href={qr}>Tải mã QR</a>}{ticket.eventId?.slug && <Link className="text-action" href={'/events/' + ticket.eventId.slug}>Xem thông tin giải</Link>}</div></Modal>}</>;
}
