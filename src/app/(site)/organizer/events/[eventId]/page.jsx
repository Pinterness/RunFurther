'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../../lib/clientApi';
import EventEditor, { eventStatuses } from '../../../../../components/site/EventEditor';
import PaymentReview from '../../../../../components/site/PaymentReview';
import Modal from '../../../../../components/site/Modal';
const roles = { STAFF_MANAGER: 'Quản lý nhân sự', CHECKIN: 'Check-in', RACE_KIT: 'Phát race-kit', CHECKPOINT: 'Trạm kiểm soát', MARSHAL: 'Điều phối đường chạy', TIMING: 'Tính giờ', WATER_STATION: 'Trạm nước', MEDICAL: 'Y tế', VOLUNTEER: 'Tình nguyện viên' };
const emptyCategory = { name: '', code: '', distance: '', price: '', quotaTotal: '', minAge: '', cutOffTimeMinutes: '' };
export default function ManagedEventPage({ params }) {
  const { eventId } = use(params), endpoint = '/admin/events/' + eventId;
  const [data, setData] = useState(null), [accounts, setAccounts] = useState([]), [runners, setRunners] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [guest, setGuest] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState('info'), [modal, setModal] = useState(''), [formError, setFormError] = useState(''), [detailsLoading, setDetailsLoading] = useState(false), [detailsError, setDetailsError] = useState(''), [refresh, setRefresh] = useState(0);
  const [category, setCategory] = useState(emptyCategory), [staff, setStaff] = useState({ employeeName: '', email: '', accountType: 'CHECKIN', locationName: '' });
  async function load() {
    setLoading(true); setError('');
    if (!localStorage.getItem('rf_token')) { setGuest(true); setLoading(false); return; }
    try { setData(await api(endpoint)); setGuest(false); } catch (error) { if (error.status === 401) setGuest(true); else setError(error.message); } finally { setLoading(false); }
  }
  useEffect(() => { setData(null); load(); }, [eventId]);
  useEffect(() => {
    if (!data || !['staff','runners'].includes(tab)) return;
    const controller = new AbortController(); setDetailsLoading(true); setDetailsError('');
    api(endpoint + (tab === 'staff' ? '/staff' : '/registrations?page=' + page), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { if (tab === 'staff') setAccounts(result.accounts); else { setRunners(result.registrations); setTotal(result.total); } } })
      .catch(error => { if (!controller.signal.aborted) { if (error.status === 401) setGuest(true); setDetailsError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setDetailsLoading(false); });
    return () => controller.abort();
  }, [data, tab, page, refresh, endpoint]);
  async function saveEvent(value) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await api(endpoint, { method: 'PATCH', body: JSON.stringify(value) }); setData({ ...data, event: result.event }); setNotice('Đã lưu thông tin sự kiện.'); }
    catch (error) { if (error.status === 401) setGuest(true); else setError(error.message); } finally { setBusy(false); }
  }
  async function saveModal(e) {
    e.preventDefault(); setBusy(true); setFormError('');
    try {
      if (modal === 'category') {
        const rules = {}; if (category.minAge !== '') rules.minAge = Number(category.minAge); if (category.cutOffTimeMinutes !== '') rules.cutOffTimeMinutes = Number(category.cutOffTimeMinutes);
        await api(endpoint + '/categories' + (category._id ? '/' + category._id : ''), { method: category._id ? 'PATCH' : 'POST', body: JSON.stringify({ name: category.name, code: category.code, distance: Number(category.distance), price: Number(category.price), quotaTotal: Number(category.quotaTotal), rules }) });
        setData(await api(endpoint)); setNotice('Đã lưu cự ly.');
      } else {
        await api(endpoint + '/staff', { method: 'POST', body: JSON.stringify(staff) }); setRefresh(value => value + 1); setNotice('Đã tạo phân công nhân sự. Chỉ chia sẻ mã với đúng người được phân công.');
      }
      setModal('');
    } catch (error) { if (error.status === 401) { setModal(''); setGuest(true); } else setFormError(error.message); } finally { setBusy(false); }
  }
  async function staffAction(account, body) {
    setBusy(true); setError(''); setNotice('');
    try { await api(endpoint + '/staff/' + account._id, { method: 'PATCH', body: JSON.stringify(body) }); setRefresh(value => value + 1); setNotice(body.rotateCode ? 'Đã đổi mã. Mã cũ không còn sử dụng được.' : 'Đã cập nhật quyền truy cập của nhân sự.'); }
    catch (error) { if (error.status === 401) setGuest(true); else setError(error.message); } finally { setBusy(false); }
  }
  if (guest) return <div className="runner-shell runner-guest"><h1>Đăng nhập để quản lý giải.</h1><p>Sử dụng tài khoản cá nhân đã tạo sự kiện này.</p><Link className="button-primary" href={'/login?next=' + encodeURIComponent('/organizer/events/' + eventId)}>Đăng nhập</Link></div>;
  if (loading && !data) return <div className="runner-shell" role="status">Đang tải sự kiện...</div>;
  if (!data) return <div className="runner-shell"><h1>Chưa thể mở sự kiện.</h1><p role="alert" className="notice notice-error">{error}</p><div className="runner-error-actions"><button className="quiet-button" onClick={load}>Thử lại</button><Link className="text-action" href="/organizer">Về sự kiện của tôi</Link></div></div>;
  const suspended = ['HIDDEN', 'SUSPENDED'].includes(data.event.moderation?.state);
  return <div className="runner-shell organizer-page"><Link className="text-action" href="/organizer">← Sự kiện của tôi</Link><div className="runner-page-heading organizer-heading"><div><p className="section-index">{eventStatuses[data.event.status]} / BAN TỔ CHỨC</p><h1>{data.event.name}</h1></div>{!['DRAFT','CANCELLED'].includes(data.event.status) && <Link className="quiet-button" href={'/events/' + data.event.slug}>Xem trang công khai ↗</Link>}</div><div className="runner-toolbar"><div className="runner-tabs">{[['info','Thông tin giải'],['categories','Cự ly & vé'],['staff','Nhân sự'],['runners','Người chạy'],['payments','Tiền vé']].map(([key,label]) => <button key={key} aria-pressed={tab === key} disabled={busy} onClick={() => { setTab(key); setError(''); setNotice(''); }}>{label}</button>)}</div></div>
  {error && <p role="alert" className="notice notice-error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
  {suspended && <p className="notice notice-error">Giải đã bị ẩn/tạm ngừng: {data.event.moderation.reason}. Dữ liệu được giữ lại; chỉ Super Admin có thể khôi phục.</p>}
  {tab === 'payments' && <PaymentReview endpoint={endpoint} suspended={suspended} />}
  <fieldset disabled={suspended} style={{ minWidth: 0, border: 0, padding: 0 }}>
  {tab === 'info' && <section className="organizer-panel"><h2>Thông tin & lịch trình</h2><p className="organizer-hint">Chỉ chủ giải được thay đổi thông tin này. Super Admin chỉ kiểm duyệt giải.</p><EventEditor key={data.event._id} event={data.event} onSave={saveEvent} busy={busy} /></section>}
  {tab === 'categories' && <section><div className="organizer-section-heading"><div><h2>Cự ly & số suất</h2><p>Không thể giảm số suất xuống dưới tổng vé đã bán và chỗ đang giữ.</p></div><button className="button-dark" onClick={() => { setCategory(emptyCategory); setFormError(''); setModal('category'); }}>Thêm cự ly</button></div>{data.categories.length ? <div className="organizer-events">{data.categories.map(item => <article key={item._id} className="organizer-event"><span className="section-index">{item.code}</span><h2>{item.distance} km · {item.name}</h2><p>{Number(item.price).toLocaleString('vi-VN')}đ / vé</p><p>Đã bán {item.quotaSold} · Đang giữ {item.quotaHold} · Tổng {item.quotaTotal}</p><button className="text-action" onClick={() => { setCategory({ ...item, minAge: item.rules?.minAge ?? '', cutOffTimeMinutes: item.rules?.cutOffTimeMinutes ?? '' }); setFormError(''); setModal('category'); }}>Chỉnh sửa cự ly</button></article>)}</div> : <div className="runner-empty">Chưa có cự ly. Thêm ít nhất một cự ly trước khi mở bán vé.</div>}</section>}
  {['staff','runners'].includes(tab) && <>{detailsError ? <p role="alert" className="notice notice-error">{detailsError} <button className="text-action" onClick={() => setRefresh(value => value + 1)}>Thử lại</button></p> : detailsLoading ? <p role="status">Đang tải dữ liệu...</p> : tab === 'staff' ? <section><div className="organizer-section-heading"><div><h2>Đội ngũ của sự kiện</h2><p>Mỗi mã chỉ có hiệu lực trong giải này. Khóa quyền hoặc đổi mã khi cần thu hồi truy cập.</p></div><button className="button-dark" onClick={() => { setStaff({ employeeName: '', email: '', accountType: 'CHECKIN', locationName: '' }); setFormError(''); setModal('staff'); }}>Thêm nhân sự</button></div><p className="notice">Cổng nhân sự: <Link href={'/events/' + data.event.slug + '/staff-login'}>/events/{data.event.slug}/staff-login</Link>. Quyền quản lý sự kiện dùng tài khoản cá nhân. Các màn nghiệp vụ hiện có: check-in, phát race-kit; vai trò còn lại mới có phân công và kiểm soát quyền.</p><div className="organizer-staff-list">{accounts.map(account => <article key={account._id} className="organizer-staff"><div><h3>{account.employeeName}</h3><p>{roles[account.accountType] || 'Chủ sự kiện'} · {account.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</p><small>{account.userId?.email || 'Đăng nhập bằng mã nhân sự'} {account.assignment?.locationName && '· ' + account.assignment.locationName}</small></div>{account.accountType !== 'EVENT_ADMIN' && <><details><summary>Xem mã đăng nhập</summary><code>{account.loginCode}</code></details><div className="organizer-row-actions"><button className="quiet-button" disabled={busy} onClick={() => staffAction(account, { status: account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}>{account.status === 'ACTIVE' ? 'Khóa quyền' : 'Mở quyền'}</button><button className="quiet-button" disabled={busy} onClick={() => staffAction(account, { rotateCode: true })}>Đổi mã</button></div></>}</article>)}</div></section> : <section><div className="organizer-section-heading"><div><h2>Người chạy của giải</h2><p>{total} đăng ký đã cấp vé. Trang {page} / {Math.max(1, Math.ceil(total / 50))}.</p></div></div>{runners.length ? <div className="organizer-table-wrap"><table className="organizer-table"><thead><tr><th>BIB</th><th>Người chạy</th><th>Cự ly</th><th>Trạng thái</th><th>Hậu cần</th></tr></thead><tbody>{runners.map(runner => <tr key={runner._id}><td>{runner.bibNumber}</td><td><strong>{runner.runnerProfile.fullName}</strong><small>{runner.runnerProfile.email}</small></td><td>{runner.categoryId?.name}</td><td>{runner.status}</td><td>{runner.logistics.hasCheckedIn ? 'Đã check-in' : 'Chưa check-in'}<small>{runner.logistics.raceKitIssued ? 'Đã nhận kit' : 'Chưa nhận kit'}</small></td></tr>)}</tbody></table></div> : <div className="runner-empty">Chưa có vé được cấp trong sự kiện này.</div>}<nav className="market-pagination" aria-label="Trang người chạy"><button className="quiet-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Trước</button><button className="quiet-button" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Sau →</button></nav></section>}</>}
  </fieldset>
  {modal && <Modal title={modal === 'category' ? 'Thiết lập cự ly' : 'Phân công nhân sự'} busy={busy} onClose={() => setModal('')}><form onSubmit={saveModal}><div className="runner-fields">{modal === 'category' ? [['name','Tên cự ly','text'],['code','Mã cự ly','text'],['distance','Quãng đường (km)','number'],['price','Giá vé (VNĐ)','number'],['quotaTotal','Tổng số suất','number'],['minAge','Tuổi tối thiểu (tùy chọn)','number'],['cutOffTimeMinutes','Cut-off (phút, tùy chọn)','number']].map(([key,label,type]) => <label key={key}>{label}<input type={type} required={!['minAge','cutOffTimeMinutes'].includes(key)} min={key === 'cutOffTimeMinutes' ? 1 : 0} step={key === 'distance' ? '0.01' : '1'} value={category[key]} onChange={e => setCategory({ ...category, [key]: e.target.value })} /></label>) : <><label>Họ tên nhân sự<input required maxLength={120} value={staff.employeeName} onChange={e => setStaff({ ...staff, employeeName: e.target.value })} /></label><label>Vai trò<select value={staff.accountType} onChange={e => setStaff({ ...staff, accountType: e.target.value })}>{Object.entries(roles).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field-wide">Email tài khoản (không bắt buộc)<input type="email" value={staff.email} onChange={e => setStaff({ ...staff, email: e.target.value })} /></label><label className="field-wide">Vị trí phân công<input maxLength={150} value={staff.locationName} onChange={e => setStaff({ ...staff, locationName: e.target.value })} /></label></>}</div>{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy}>{busy ? 'Đang lưu...' : modal === 'category' ? 'Lưu cự ly' : 'Tạo phân công'}</button></div></form></Modal>}
  </div>;
}
