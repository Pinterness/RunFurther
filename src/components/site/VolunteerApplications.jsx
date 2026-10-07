'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/clientApi';
import Modal from './Modal';

export const volunteerRoles = { CHECKIN: 'Điểm danh', RACE_KIT: 'Phát race-kit', MARSHAL: 'Điều phối đường chạy', WATER_STATION: 'Trạm tiếp nước', TIMING: 'Tính giờ', MEDICAL: 'Y tế', VOLUNTEER: 'Hỗ trợ chung' };
const statuses = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' };

export default function VolunteerApplications({ endpoint = '/staff/volunteers/me', manage = false, suspended = false }) {
  const [status, setStatus] = useState(manage ? 'PENDING' : '');
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [review, setReview] = useState(null), [role, setRole] = useState('VOLUNTEER'), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState(''), [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`${endpoint}?page=${page}${status ? '&status=' + status : ''}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, page, status, refresh]);
  function openReview(application, decision) {
    setReview({ application, decision }); setRole(application.desiredRole); setNote(''); setFormError(''); setNotice('');
  }
  async function submit(event) {
    event.preventDefault(); if (inFlight.current || suspended) return;
    inFlight.current = true; setBusy(true); setFormError('');
    try {
      await api(`${endpoint}/${review.application._id}/review`, { method: 'POST', body: JSON.stringify({ status: review.decision, assignedRole: role, reviewNote: note.trim() }) });
      setNotice(review.decision === 'APPROVED' ? 'Đã duyệt đơn và tạo phân công. Xem mã truy cập trong mục Nhân sự.' : 'Đã từ chối đơn và lưu lý do.');
      setReview(null); setRefresh(value => value + 1);
      window.dispatchEvent(new Event('rf-notifications'));
    } catch (error) { setFormError(error.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="volunteer-applications" aria-label={manage ? 'Duyệt tình nguyện viên' : 'Đơn tình nguyện viên của tôi'}>
    <div className="organizer-section-heading"><div><h2>{manage ? 'Đơn tình nguyện viên' : 'Cùng góp sức cho đường chạy.'}</h2><p>{manage ? 'Duyệt đơn để phân công nhân sự trong giải này.' : 'Trạng thái được lấy từ hệ thống. Kết quả và lời nhắn của chủ giải sẽ xuất hiện tại đây.'}</p></div><button className="quiet-button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>Cập nhật đơn</button></div>
    {manage && <div className="runner-tabs" aria-label="Trạng thái đơn">{Object.entries(statuses).map(([key, label]) => <button key={key} disabled={busy} aria-pressed={status === key} onClick={() => { setStatus(key); setPage(1); }}>{label}</button>)}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error ? <p className="notice notice-error" role="alert">{error} <button className="text-action" onClick={() => setRefresh(value => value + 1)}>Thử lại</button></p> : loading ? <p role="status">Đang tải đơn tình nguyện viên...</p> : <>
      <p className="organizer-hint">{data?.total || 0} đơn · Trang {page} / {data?.totalPages || 1}</p>
      {data?.applications.length ? <div className="volunteer-list">{data.applications.map(application => <article className="organizer-panel volunteer-card" key={application._id}>
        <div className="volunteer-card-heading"><h3>{manage ? application.applicant.fullName : application.eventId?.name || 'Giải chạy'}</h3><span className="ticket-status">{statuses[application.status]}</span></div>
        <p>{volunteerRoles[application.assignedRole || application.desiredRole]} · Gửi ngày {new Date(application.createdAt).toLocaleDateString('vi-VN')}</p>
        {manage && <><p>{application.applicant.email} · {application.applicant.phone}</p><p>Size áo: {application.applicant.tShirtSize || 'Chưa cung cấp'}</p>{application.applicant.note && <p>Ghi chú: {application.applicant.note}</p>}{!application.userId && <p className="organizer-hint">Đơn gửi khi chưa đăng nhập. Vui lòng liên hệ người đăng ký để báo kết quả và cung cấp mã sau khi duyệt.</p>}</>}
        {application.reviewNote && <p>Lời nhắn của ban tổ chức: {application.reviewNote}</p>}
        {manage && application.status === 'PENDING' && <div className="organizer-row-actions"><button className="button-primary" disabled={busy || suspended} onClick={() => openReview(application, 'APPROVED')}>Duyệt đơn</button><button className="quiet-button" disabled={busy || suspended} onClick={() => openReview(application, 'REJECTED')}>Từ chối</button></div>}
        {!manage && application.status === 'APPROVED' && (application.loginCode ? <div className="volunteer-access"><details><summary>Xem mã nhân sự của tôi</summary><code>{application.loginCode}</code></details>{application.eventId?.slug && <Link className="text-action" href={`/events/${application.eventId.slug}/staff-login`}>Vào cổng nhân sự ↗</Link>}</div> : <p>Quyền truy cập hiện chưa khả dụng. Vui lòng liên hệ ban tổ chức.</p>)}
      </article>)}</div> : <div className="runner-empty">{manage ? 'Không có đơn ở trạng thái này.' : 'Bạn chưa gửi đơn tình nguyện viên bằng tài khoản này.'}</div>}
      {data?.totalPages > 1 && <nav className="market-pagination" aria-label="Trang đơn tình nguyện viên"><button className="quiet-button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>← Trước</button><button className="quiet-button" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Sau →</button></nav>}
    </>}
    {review && <Modal title={review.decision === 'APPROVED' ? 'Duyệt đơn tình nguyện viên' : 'Từ chối đơn tình nguyện viên'} busy={busy} onClose={() => setReview(null)}><form onSubmit={submit}><p className="dialog-copy">{review.application.applicant.fullName}</p><div className="runner-fields">{review.decision === 'APPROVED' && <label className="field-wide">Vị trí phân công<select value={role} onChange={event => setRole(event.target.value)}>{Object.entries(volunteerRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label className="field-wide">{review.decision === 'REJECTED' ? 'Lý do từ chối' : 'Lời nhắn cho tình nguyện viên (tùy chọn)'}<textarea required={review.decision === 'REJECTED'} maxLength={300} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label></div>{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="dialog-actions"><button className="button-primary" disabled={busy || suspended}>{busy ? 'Đang lưu...' : 'Xác nhận'}</button><button type="button" className="quiet-button" disabled={busy} onClick={() => setReview(null)}>Hủy</button></div></form></Modal>}
  </section>;
}
