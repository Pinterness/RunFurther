'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/clientApi';
import Modal from '../../../components/site/Modal';
import TopupAccountForm from '../../../components/site/TopupAccountForm';
import TopupReview from '../../../components/site/TopupReview';
import SupportInbox from '../../../components/site/SupportInbox';
const states = { ACTIVE: 'Hoạt động', HIDDEN: 'Đã ẩn', SUSPENDED: 'Tạm ngừng' };
export default function PlatformPage() {
  const [allowed, setAllowed] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [tab, setTab] = useState('applications');
  const [applications, setApplications] = useState([]), [events, setEvents] = useState([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [decision, setDecision] = useState(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [history, setHistory] = useState(null), [formError, setFormError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const { user } = await api('/auth/me');
      if (user.systemRole !== 'SUPER_ADMIN') { setAllowed(false); setError('Khu vực này chỉ dành cho Super Admin.'); return; }
      setAllowed(true);
      if (tab === 'applications') setApplications((await api('/admin/platform/applications')).applications);
      if (tab === 'events') { const result = await api('/admin/platform/events?page=' + page); setEvents(result.events); setTotal(result.total); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [tab, page]);
  function choose(item, action, type) { setDecision({ item, action, type }); setReason(''); setFormError(''); }
  async function submit(e) {
    e.preventDefault(); setBusy(true); setFormError('');
    try {
      const application = decision.type === 'application';
      await api('/admin/platform/' + (application ? 'applications/' : 'events/') + decision.item._id + (application ? '/review' : '/moderation'), { method: 'POST', body: JSON.stringify(application ? { status: decision.action, reason } : { action: decision.action, reason }) });
      setDecision(null); await load();
    } catch (e) { setFormError(e.message); } finally { setBusy(false); }
  }
  async function viewHistory(event) { setError(''); try { setHistory({ name: event.name, items: (await api('/admin/platform/events/' + event._id + '/history')).history }); } catch (e) { setError(e.message); } }
  return <div className="runner-shell organizer-page"><p className="section-index">RUNFURTHER / SUPER ADMIN</p><h1>Kiểm duyệt nền tảng.</h1><p className="notice">Duyệt quyền tổ chức, ẩn/ngừng giải và đối soát nạp ví. Chủ giải tự quản lý nhân sự, người chạy và tiền vé. Mọi giải đều được giữ lại cùng lịch sử kiểm duyệt.</p>
    {error && <p role="alert" className="notice notice-error">{error} <button onClick={load}>Thử lại</button></p>}
    {!allowed && !loading && <Link className="text-action" href="/login?next=%2Fadmin">Đăng nhập tài khoản quản trị</Link>}
    {allowed && <><div className="runner-toolbar"><div className="runner-tabs">{[['applications','Quyền tổ chức'],['events','Kiểm duyệt giải'],['payments','Nạp ví'],['support','Hỗ trợ khách']].map(([key,label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div></div>
    {loading ? <p role="status">Đang tải...</p> : tab === 'support' ? <SupportInbox /> : tab === 'payments' ? <><TopupAccountForm /><TopupReview /></> : tab === 'applications' ? <div className="organizer-staff-list">{applications.length === 0 && <p className="runner-empty">Chưa có đơn đăng ký tổ chức.</p>}{applications.map(item => <article className="organizer-staff" key={item._id}><div><h2>{item.organizationName}</h2><p>{item.userId?.fullName} · {item.userId?.email} · {item.phone}</p><p>{item.description}</p><small>{({ PENDING:'Chờ duyệt', APPROVED:'Đã duyệt', REJECTED:'Đã từ chối' })[item.status]} · {item.reviewNote}</small></div>{item.status === 'PENDING' && <div className="organizer-row-actions"><button className="button-dark" onClick={() => choose(item, 'APPROVED', 'application')}>Duyệt quyền tổ chức</button><button className="quiet-button" onClick={() => choose(item, 'REJECTED', 'application')}>Từ chối</button></div>}</article>)}</div> : <><div className="organizer-events">{events.map(item => <article className="organizer-event" key={item._id}><span className="ticket-status">{states[item.moderation?.state || 'ACTIVE']}</span><h2>{item.name}</h2><p>Chủ giải: {item.createdBy?.fullName || 'Chưa xác định'}</p><p>{item.location?.city} · {item.status}</p>{item.moderation?.reason && <p className="notice">{item.moderation.reason}</p>}<div className="organizer-row-actions">{Object.entries(states).filter(([key]) => key !== (item.moderation?.state || 'ACTIVE')).map(([key]) => <button className="quiet-button" key={key} onClick={() => choose(item, key, 'event')}>{key === 'ACTIVE' ? 'Khôi phục' : key === 'HIDDEN' ? 'Ẩn giải' : 'Tạm ngừng'}</button>)}<button className="text-action" onClick={() => viewHistory(item)}>Lịch sử</button></div></article>)}</div>{!events.length && <p className="runner-empty">Chưa có giải.</p>}<nav className="market-pagination" aria-label="Trang kiểm duyệt"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page}</span><button disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>Sau</button></nav></>}
    </>}
    {decision && <Modal title={decision.type === 'application' ? 'Xét duyệt quyền tổ chức' : 'Kiểm duyệt: ' + decision.item.name} busy={busy} onClose={() => setDecision(null)}><form onSubmit={submit}><p className="dialog-copy">Quyết định: {({ APPROVED:'Duyệt quyền tổ chức', REJECTED:'Từ chối', ACTIVE:'Khôi phục', HIDDEN:'Ẩn giải', SUSPENDED:'Tạm ngừng giải' })[decision.action]}. Lý do được lưu và hiển thị cho người tổ chức.</p><div className="runner-fields"><label className="field-wide">Lý do quyết định<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label></div>{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy || !reason.trim()}>Xác nhận quyết định</button></div></form></Modal>}
    {history && <Modal title={'Lịch sử: ' + history.name} onClose={() => setHistory(null)}>{history.items.length ? history.items.map(item => <article className="notice" key={item._id}><strong>{states[item.action]}</strong><p>{item.reason}</p><small>{new Date(item.createdAt).toLocaleString('vi-VN')}</small></article>) : <p>Chưa có quyết định kiểm duyệt.</p>}</Modal>}
  </div>;
}
