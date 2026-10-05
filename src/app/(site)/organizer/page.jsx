'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/clientApi';
import EventEditor, { eventStatuses, slugify } from '../../../components/site/EventEditor';
import OrganizerAccess from '../../../components/site/OrganizerAccess';
import Modal from '../../../components/site/Modal';
export default function OrganizerPage() {
  const router = useRouter();
  const [events, setEvents] = useState([]), [organizations, setOrganizations] = useState([]), [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true), [guest, setGuest] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [modal, setModal] = useState(''), [formError, setFormError] = useState('');
  const [application, setApplication] = useState(null);
  const approved = application?.status === 'APPROVED';
  const [organization, setOrganization] = useState({ name: '', slug: '', type: 'ENTERPRISE' });
  async function load() {
    setLoading(true); setError(''); setApplication(null); setEvents([]); setOrganizations([]); setModal('');
    if (!localStorage.getItem('rf_token')) { setGuest(true); setLoading(false); return; }
    try {
      const account = await api('/auth/me');
      setUser(account.user); setGuest(false);
      if (account.user.systemRole === 'SUPER_ADMIN') { router.replace('/admin'); return; }
      const access = await api('/admin/organizer-access');
      setApplication(access.application);
      if (access.application?.status !== 'APPROVED') return;
      const [managed, own] = await Promise.all([api('/admin/events'), api('/organizations/mine')]);
      setEvents(managed.events); setOrganizations(own.organizations);
    } catch (error) { if (error.status === 401) setGuest(true); else setError(error.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function createOrg(e) {
    e.preventDefault(); setBusy(true); setFormError('');
    try { const data = await api('/organizations', { method: 'POST', body: JSON.stringify(organization) }); setOrganizations(list => [data.organization, ...list]); setModal('event'); }
    catch (error) { if (error.status === 401) { setModal(''); setGuest(true); } else setFormError(error.message); } finally { setBusy(false); }
  }
  async function createEvent(value) {
    setBusy(true); setFormError('');
    try { const data = await api('/admin/events', { method: 'POST', body: JSON.stringify(value) }); router.push('/organizer/events/' + data.event._id); }
    catch (error) { if (error.status === 401) { setModal(''); setGuest(true); } else setFormError(error.message); setBusy(false); }
  }
  if (guest) return <div className="runner-shell runner-guest"><p className="section-index">DÀNH CHO BAN TỔ CHỨC</p><h1>Đường chạy của bạn.<br />Bắt đầu từ đây.</h1><p>Đăng nhập bằng tài khoản cá nhân để tạo và quản lý sự kiện của bạn.</p><Link className="button-primary" href="/login?next=%2Forganizer">Đăng nhập để bắt đầu</Link><Link className="text-action" href="/register?next=%2Forganizer">Tạo tài khoản</Link></div>;
  if (loading || user?.systemRole === 'SUPER_ADMIN') return <div className="runner-shell"><p className="runner-empty" role="status">Đang kiểm tra quyền tổ chức...</p></div>;
  if (error) return <div className="runner-shell"><h1>Chưa thể mở trang tổ chức.</h1><p role="alert" className="notice notice-error">{error}</p><button className="quiet-button" onClick={load}>Thử lại</button></div>;
  if (!approved) return <div className="runner-shell"><div className="runner-page-heading"><div><p className="section-index">RUNFURTHER / ĐĂNG KÝ TỔ CHỨC</p><h1>Đăng ký trở thành<br />ban tổ chức.</h1></div></div><OrganizerAccess application={application} onChange={setApplication} /></div>;
  return <div className="runner-shell organizer-page"><div className="runner-page-heading"><div><p className="section-index">RUNFURTHER / BAN TỔ CHỨC</p><h1>Tạo nên những<br />đường chạy đáng nhớ.</h1></div><button className="button-primary" disabled={loading || !!error || !approved} onClick={() => { setFormError(''); setModal(organizations.length ? 'event' : 'organization'); }}>Tạo sự kiện ↗</button></div><div className="organizer-intro"><p>Chỉ các sự kiện bạn tạo và còn quyền quản lý được hiển thị tại đây. Nhân sự được phân công riêng trong từng giải.</p><button className="text-action" disabled={loading || !approved} onClick={() => { setFormError(''); setModal('organization'); }}>Thêm đơn vị tổ chức</button></div>
  {!loading && !error && <OrganizerAccess application={application} onChange={setApplication} />}
  {error && <p role="alert" className="notice notice-error">{error} <button className="text-action" onClick={load}>Thử lại</button></p>}
  {loading ? <p role="status" className="runner-empty">Đang tải sự kiện...</p> : !error && (events.length ? <div className="organizer-events">{events.map(event => <article className="organizer-event" key={event._id}><span className="ticket-status">{eventStatuses[event.status]}</span><h2>{event.name}</h2>{['HIDDEN', 'SUSPENDED'].includes(event.moderation?.state) && <p className="notice notice-error">{event.moderation.state === 'HIDDEN' ? 'Đã ẩn' : 'Tạm ngừng'}: {event.moderation.reason}</p>}<p>{event.location.city} · {new Date(event.dateInfo.raceDate).toLocaleDateString('vi-VN')}</p><Link className="text-action" href={'/organizer/events/' + event._id}>Quản lý sự kiện →</Link></article>)}</div> : <div className="runner-empty"><span className="empty-track">START</span><h2>Giải chạy đầu tiên của bạn.</h2><p>Tạo đơn vị tổ chức, lưu bản nháp, thêm cự ly và phân công đội ngũ trước khi công bố.</p><button className="button-dark" disabled={!approved} onClick={() => { setFormError(''); setModal(organizations.length ? 'event' : 'organization'); }}>Bắt đầu tạo giải</button></div>)}
  <section className="market-guide"><p className="section-index">BA BƯỚC ĐỂ SẴN SÀNG</p><div><article><span>01</span><h3>Tạo bản nháp</h3><p>Điền lịch trình và địa điểm. Giải chưa công khai khi bạn đang chuẩn bị.</p></article><article><span>02</span><h3>Thiết lập giải</h3><p>Thêm cự ly, giá vé, số suất và phân công nhân sự theo đúng vai trò.</p></article><article><span>03</span><h3>Công bố & vận hành</h3><p>Chọn trạng thái mở đăng ký khi sẵn sàng; theo dõi danh sách người chạy của giải.</p></article></div></section>
  {modal && <Modal title={modal === 'event' ? 'Tạo sự kiện' : 'Đơn vị tổ chức của bạn'} busy={busy} onClose={() => setModal('')}>{formError && <p role="alert" className="notice notice-error">{formError}</p>}{modal === 'event' ? <EventEditor organizations={organizations} busy={busy} onSave={createEvent} /> : <form onSubmit={createOrg}><p className="dialog-copy">Đơn vị này gắn với tài khoản của bạn và dùng cho các sự kiện bạn tạo.</p><div className="runner-fields"><label className="field-wide">Tên đơn vị<input required maxLength={200} value={organization.name} onChange={e => setOrganization({ ...organization, name: e.target.value })} onBlur={() => { if (!organization.slug) setOrganization({ ...organization, slug: slugify(organization.name) }); }} /></label><label className="field-wide">Đường dẫn đơn vị<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={organization.slug} onChange={e => setOrganization({ ...organization, slug: e.target.value })} /></label><label className="field-wide">Loại đơn vị<select value={organization.type} onChange={e => setOrganization({ ...organization, type: e.target.value })}><option value="ENTERPRISE">Đơn vị tổ chức lâu dài</option><option value="CASUAL">Nhóm ngắn hạn (60 ngày)</option></select></label></div><div className="form-bottom"><button className="button-primary" disabled={busy}>{busy ? 'Đang tạo...' : 'Lưu đơn vị & tiếp tục'}</button></div></form>}</Modal>}
  </div>;
}
