'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import RunnerAvatar from '../../../components/site/RunnerAvatar';
import RunnerFields from '../../../components/site/RunnerFields';
import TicketCard from '../../../components/site/TicketCard';
import { api, blankProfile, rememberUser } from '../../../lib/clientApi';

export default function AccountPage() {
  const [user, setUser] = useState(null), [draft, setDraft] = useState({}), [profile, setProfile] = useState({ ...blankProfile });
  const [tickets, setTickets] = useState([]), [bookings, setBookings] = useState([]), [wallet, setWallet] = useState(null), [achievements, setAchievements] = useState(null);
  const [loading, setLoading] = useState(true), [guest, setGuest] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false), [tab, setTab] = useState('tickets');
  async function load() {
    setLoading(true); setError('');
    if (!localStorage.getItem('rf_token')) { setGuest(true); setLoading(false); return; }
    try {
      const account = await api('/auth/me');
      setGuest(false); setUser(account.user); setDraft(account.user); setProfile(account.profile); rememberUser(account.user);
      const responses = await Promise.allSettled([api('/registrations/me'), api('/bookings/me'), api('/wallet'), api('/registrations/achievements/me')]);
      if (responses[0].status === 'fulfilled') setTickets(responses[0].value.registrations);
      if (responses[1].status === 'fulfilled') setBookings(responses[1].value.bookings);
      if (responses[2].status === 'fulfilled') setWallet(responses[2].value);
      if (responses[3].status === 'fulfilled') setAchievements(responses[3].value.achievements);
      if (responses.some(r => r.status === 'rejected')) setError('Một phần dữ liệu chưa tải được. Vui lòng thử lại.');
    } catch (error) { if (error.status === 401) setGuest(true); else setError(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault(); setSaving(true); setNotice(''); setError('');
    try {
      const data = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ fullName: draft.fullName, phone: draft.phone, avatarTheme: draft.avatarTheme, profile }) });
      setUser(data.user); setDraft(data.user); setProfile(data.profile); rememberUser(data.user);
      setNotice('Đã lưu hồ sơ. Thông tin sẽ được tự điền khi bạn mua vé.');
    } catch (error) { setError(error.message); } finally { setSaving(false); }
  }
  if (loading && !user) return <div className="runner-shell"><div className="runner-empty" role="status">Đang tải hồ sơ và vé của bạn...</div></div>;
  if (guest) return <div className="runner-shell"><section className="runner-guest"><RunnerAvatar large /><p className="section-index">HÀNH TRÌNH CỦA RIÊNG BẠN</p><h1>Mọi đường chạy.<br />Trong một tài khoản.</h1><p>Đăng nhập để lưu hồ sơ người chạy, quản lý vé và xem thành tích.</p><Link className="button-primary" href="/login?next=%2Faccount">Đăng nhập</Link><Link className="text-action" href="/register">Tạo tài khoản mới</Link></section></div>;
  if (!user) return <div className="runner-shell"><p role="alert">{error}</p><button onClick={load} className="button-dark">Thử lại</button></div>;
  const pending = bookings.filter(b => b.status === 'HOLD');
  return <div className="runner-shell"><div className="runner-page-heading"><div><p className="section-index">KHÔNG CHỈ LÀ NHỮNG CON SỐ</p><h1>Hành trình của bạn.</h1></div><Link className="text-action" href="/events">Tìm đường chạy tiếp theo ↗</Link></div>
    <section className="runner-cover"><RunnerAvatar large name={draft.fullName} theme={draft.avatarTheme} /><div className="runner-identity"><p className="section-index">RUNFURTHER RUNNER</p><h2>{user.fullName}</h2><p>{profile.club || 'Chạy theo nhịp của riêng mình.'}</p><small>Thành viên từ {new Date(user.createdAt).toLocaleDateString('vi-VN')}</small></div><button className="cover-edit" onClick={() => setTab('profile')}>Chỉnh sửa hồ sơ ↗</button></section>
    <div className="runner-metrics"><div><span>{achievements?.completedRaces ?? '—'}</span><small>Giải đã hoàn thành</small></div><div><span>{achievements?.totalKm ?? '—'}<em> km</em></span><small>Quãng đường hoàn thành</small></div><div><span>{wallet ? Number(wallet.wallet.balance).toLocaleString('vi-VN') : '—'}<em> đ</em></span><Link href="/account/wallet">Ví của tôi ↗</Link></div><div><span>{wallet?.runPoints.balance ?? '—'}</span><small>RunPoints tích lũy</small></div></div>
    <div className="runner-toolbar"><div className="runner-tabs" aria-label="Nội dung tài khoản"><button aria-pressed={tab === 'tickets'} onClick={() => setTab('tickets')}>Vé của tôi <span>{tickets.length}</span></button><button aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>Hồ sơ người chạy</button></div><button className="quiet-button" onClick={load} disabled={loading || saving}>{loading ? 'Đang tải...' : 'Cập nhật'}</button></div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {tab === 'tickets' ? <div className="runner-content-grid"><section><div className="section-heading"><h2>Những vạch xuất phát của bạn</h2><p>Vé đã được xác nhận xuất hiện ở đây, cùng BIB và mã QR.</p></div>{tickets.length ? <div className="runner-ticket-list">{tickets.map(ticket => <TicketCard ticket={ticket} key={ticket._id} />)}</div> : <div className="runner-empty"><span className="empty-track" aria-hidden="true">START</span><h3>Vé đầu tiên đang chờ bạn.</h3><p>Chọn một giải chạy. Sau khi thanh toán được xác nhận, vé sẽ xuất hiện tại đây.</p><Link className="button-dark" href="/events">Khám phá giải chạy →</Link></div>}
      {pending.length > 0 && <section className="pending-bookings"><h3>Đang chờ thanh toán / đối soát</h3>{pending.map(b => <div key={b._id}><span><strong>{b.eventId?.name}</strong><small>{b.orderCode} · {Number(b.finalAmount).toLocaleString('vi-VN')}đ</small></span><span className="ticket-status">Chưa cấp vé</span></div>)}</section>}
    </section><aside className="runner-side"><h3>Hồ sơ sẵn sàng,<br />mua vé nhẹ nhàng.</h3><p>Lưu ngày sinh, size áo và liên hệ khẩn cấp để không phải nhập lại mỗi lần đăng ký.</p><button className="text-action" onClick={() => setTab('profile')}>Hoàn thiện hồ sơ →</button><hr /><Link href="/marketplace" className="side-link">Chuyển nhượng BIB ↗</Link><Link href="/lookup" className="side-link">Tra cứu đăng ký ↗</Link></aside></div> : <form className="profile-editor" onSubmit={save}><section><div className="section-heading"><h2>Thông tin cá nhân</h2><p>Thông tin được dùng cho các lượt mua vé mới. Vé đã cấp giữ nguyên thông tin lúc đăng ký.</p></div><div className="runner-fields"><label htmlFor="profile-name">Họ và tên<input id="profile-name" required maxLength={120} value={draft.fullName || ''} onChange={e => setDraft({ ...draft, fullName: e.target.value })} /></label><label htmlFor="profile-phone">Số điện thoại<input id="profile-phone" type="tel" required maxLength={30} value={draft.phone || ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></label><label className="field-wide" htmlFor="profile-email">Email tài khoản<input id="profile-email" type="email" readOnly value={user.email} /></label></div><h3 className="form-subheading">Thông tin người chạy</h3><RunnerFields value={profile} onChange={setProfile} prefix="profile-runner" /><div className="form-bottom"><button className="button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu hồ sơ'}</button></div></section><aside className="avatar-editor"><RunnerAvatar large name={draft.fullName} theme={draft.avatarTheme} /><h3>Dấu ấn của bạn.</h3><p>Avatar được tạo từ tên của bạn. Chọn một màu phù hợp với cá tính.</p><div className="avatar-swatches">{[['forest','Rừng xanh'],['clay','Cam đất'],['ocean','Đại dương'],['plum','Tím mận']].map(([theme,label]) => <button key={theme} type="button" className={'swatch swatch-' + theme} aria-label={label} aria-pressed={draft.avatarTheme === theme} onClick={() => setDraft({ ...draft, avatarTheme: theme })}><span aria-hidden="true">{draft.avatarTheme === theme ? '✓' : ''}</span></button>)}</div></aside></form>}
  </div>;
}
