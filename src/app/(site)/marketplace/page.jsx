'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal, { LoginPrompt } from '../../../components/site/Modal';
import RunnerAvatar from '../../../components/site/RunnerAvatar';
import RunnerFields from '../../../components/site/RunnerFields';
import { api, blankProfile } from '../../../lib/clientApi';

const money = value => Number(value).toLocaleString('vi-VN') + 'đ';
export default function MarketplacePage() {
  const [type, setType] = useState('BIB_TRANSFER'), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [listings, setListings] = useState([]), [pagination, setPagination] = useState({ total: 0, totalPages: 0 }), [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [formError, setFormError] = useState('');
  const [modal, setModal] = useState(''), [selected, setSelected] = useState(null), [registrations, setRegistrations] = useState([]);
  const [draft, setDraft] = useState({ listingType: 'BIB_TRANSFER', title: '', description: '', price: '', registrationId: '' });
  const [buyer, setBuyer] = useState({ fullName: '', email: '', phone: '', ...blankProfile });
  useEffect(() => {
    if (localStorage.getItem('rf_token')) api('/auth/me').then(data => setUser(data.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/marketplace?' + new URLSearchParams({ listingType: type, search: query, page, limit: 12 }), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setListings(data.listings); setPagination(data.pagination); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [type, query, page, revision]);
  async function authenticated() {
    if (!localStorage.getItem('rf_token')) { setUser(null); setModal('login'); return null; }
    try { const data = await api('/auth/me'); setUser(data.user); return data; }
    catch (error) { if (error.status === 401) { setUser(null); setModal('login'); } else setError(error.message); return null; }
  }
  async function openCreate() {
    setBusy(true); setError(''); setFormError('');
    try {
      if (!await authenticated()) return;
      const data = await api('/registrations/me');
      const available = data.registrations.filter(r => r.status === 'CONFIRMED' && !r.logistics?.hasCheckedIn && !r.logistics?.raceKitIssued && new Date(r.eventId?.dateInfo?.raceDate) > new Date());
      setRegistrations(available); setDraft({ listingType: type, title: '', description: '', price: '', registrationId: '' }); setModal('create');
    } catch (error) { if (error.status === 401) setModal('login'); else setError(error.message); }
    finally { setBusy(false); }
  }
  async function openBuy(listing) {
    setBusy(true); setFormError(''); setError('');
    try {
      const account = await authenticated(); if (!account) return;
      setSelected(listing);
      if (String(listing.sellerId?._id) === String(account.user.id)) { setModal('cancel'); return; }
      setBuyer({ ...blankProfile, ...account.profile, fullName: account.user.fullName, email: account.user.email, phone: account.user.phone || '' });
      setModal('buy');
    } finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setFormError('');
    try {
      if (modal === 'create') {
        await api('/marketplace', { method: 'POST', body: JSON.stringify({ ...draft, price: Number(draft.price), registrationId: draft.listingType === 'BIB_TRANSFER' ? draft.registrationId : undefined }) });
        setNotice('Đã đăng tin. Bạn có thể hủy tin trước khi có người mua.');
      } else if (modal === 'buy') {
        await api('/marketplace/' + selected._id + '/buy', { method: 'POST', body: JSON.stringify({ newRunnerProfile: { ...buyer, gender: buyer.gender === 'Không chia sẻ' ? 'Khác' : buyer.gender } }) });
        setNotice(selected.listingType === 'BIB_TRANSFER' ? 'Mua thành công. Vé và mã QR mới đã có trong tài khoản của bạn.' : 'Thanh toán thành công. Vui lòng phối hợp với người bán để nhận sản phẩm.');
      } else {
        await api('/marketplace/' + selected._id, { method: 'DELETE' }); setNotice('Đã hủy tin đăng.');
      }
      setModal(''); setPage(1); setRevision(value => value + 1);
    } catch (error) { if (error.status === 401) setModal('login'); else setFormError(error.message); }
    finally { setBusy(false); }
  }
  const selectedRegistration = registrations.find(r => r._id === draft.registrationId);
  const maxPrice = selectedRegistration ? Math.floor(selectedRegistration.payment.paidAmount * 1.1) : undefined;
  const changeDraft = event => setDraft({ ...draft, [event.target.name]: event.target.value });
  return <div className="runner-shell market-page">
    <section className="market-hero"><div><p className="section-index">RUNFURTHER / MARKETPLACE</p><h1>Đường chạy tiếp nối.<br /><em>Cơ hội mới bắt đầu.</em></h1><p>Trao lại một suất chạy. Tìm món đồ đồng hành.<br />Kết nối những người cùng chung nhịp bước.</p><button className="button-primary" onClick={openCreate} disabled={busy}>{busy && !modal ? 'Đang kiểm tra...' : 'Đăng tin của bạn ↗'}</button></div><div className="market-hero-art" aria-hidden="true"><div className="market-demo-ticket"><small>PASS IT FORWARD</small><strong>BIB<span>↗</span></strong><div>YOUR NEXT START LINE</div><i /><p>Một tấm vé.<br />Một hành trình mới.</p></div><span className="market-art-note">KEEP THE GOOD RUN GOING.</span></div></section>
    <div className="market-principles"><span>01 · Vé được chuyển sang hồ sơ người mua</span><span>02 · Giá BIB tối đa 110% giá vé gốc</span><span>03 · Thanh toán bằng ví RunFurther</span></div>
    <div className="market-toolbar"><div className="runner-tabs" aria-label="Loại tin đăng">{[['BIB_TRANSFER','Chuyển nhượng BIB'],['GEAR','Đồ chạy bộ']].map(([value,label]) => <button key={value} aria-pressed={type === value} onClick={() => { setType(value); setPage(1); }}>{label}</button>)}</div><form className="market-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}><label className="sr-only" htmlFor="market-search">Tìm tin đăng</label><input id="market-search" type="search" placeholder="Tìm giải chạy, tên sản phẩm..." value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /><button aria-label="Tìm kiếm" type="submit">Tìm →</button></form></div>
    {notice && <p className="notice" role="status">{notice} <Link href="/account">Về tài khoản ↗</Link></p>}
    {error ? <div className="notice notice-error" role="alert">{error} <button className="text-action" onClick={() => setRevision(value => value + 1)}>Thử lại</button></div> : loading ? <div className="runner-empty" role="status">Đang tìm những cơ hội mới...</div> : <>
      <div className="market-results"><p>{pagination.total} tin đăng {query && 'cho “' + query + '”'}</p><span>Mới nhất trước</span></div>
      {listings.length ? <div className="market-grid">{listings.map(listing => <article key={listing._id} className={'market-card ' + (listing.listingType === 'GEAR' ? 'market-gear' : '')}>
        <div className="market-card-top"><span>{listing.listingType === 'BIB_TRANSFER' ? 'BIB / CHUYỂN NHƯỢNG' : 'GEAR / ĐỒ CHẠY BỘ'}</span><span>↗</span></div>
        <div className="market-card-visual">{listing.listingType === 'BIB_TRANSFER' ? <><span className="market-bib">{listing.bibNumber || 'BIB'}</span><small>{listing.categoryInfo || 'Vé tham gia giải'}</small></> : <><span className="gear-word">RUN<br />AGAIN.</span><small>ĐỒ CHẠY BỘ / CƠ HỘI MỚI</small></>}</div>
        <div className="market-card-body"><p className="market-event">{listing.eventId?.name || 'Từ cộng đồng RunFurther'}</p><h2>{listing.title}</h2><p className="market-description">{listing.description || 'Liên kết cộng đồng, tiếp nối hành trình.'}</p><div className="market-seller"><RunnerAvatar name={listing.sellerId?.fullName} /><span>{listing.sellerId?.fullName || 'Người chạy'}</span></div><div className="market-card-bottom"><div><small>Giá chuyển nhượng</small><strong>{money(listing.price)}</strong>{listing.listingType === 'BIB_TRANSFER' && <span>Giá gốc {money(listing.originalPrice)}</span>}</div><button className="button-dark" onClick={() => openBuy(listing)} disabled={busy}>{String(listing.sellerId?._id) === String(user?.id) ? 'Quản lý tin' : 'Xem & mua'}</button></div></div>
      </article>)}</div> : <div className="runner-empty market-empty"><span className="empty-track" aria-hidden="true">NEXT</span><h2>{query ? 'Chưa tìm thấy tin phù hợp.' : 'Cơ hội tiếp theo đang chờ.'}</h2><p>{query ? 'Thử một từ khóa khác hoặc xem tất cả tin đăng.' : 'Chưa có tin trong mục này. Bạn có thể là người bắt đầu.'}</p>{query ? <button className="button-dark" onClick={() => { setSearch(''); setQuery(''); setPage(1); }}>Xem tất cả tin</button> : <button className="button-dark" onClick={openCreate} disabled={busy}>Đăng tin đầu tiên ↗</button>}</div>}
      {pagination.totalPages > 1 && <nav className="market-pagination" aria-label="Trang tin đăng"><button className="quiet-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Trước</button><span>{page} / {pagination.totalPages}</span><button className="quiet-button" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Sau →</button></nav>}
    </>}
    <section className="market-guide"><p className="section-index">MỘT CUỘC CHUYỂN GIAO, THẬT DỄ DÀNG</p><div><article><span>01</span><h3>Chọn một cơ hội</h3><p>Tìm đúng giải, đúng cự ly hoặc món đồ bạn đang cần.</p></article><article><span>02</span><h3>Kiểm tra & xác nhận</h3><p>Kiểm tra hồ sơ người chạy và số tiền trước khi thanh toán từ ví.</p></article><article><span>03</span><h3>Sẵn sàng bước tiếp</h3><p>BIB được chuyển quyền sở hữu, mã QR mới xuất hiện trong “Vé của tôi”.</p></article></div></section>
    {modal === 'login' && <LoginPrompt onClose={() => setModal('')} />}
    {modal === 'create' && <Modal title="Đăng tin của bạn" busy={busy} onClose={() => setModal('')}><form onSubmit={submit}><p className="dialog-copy">Chia sẻ một cơ hội mới cùng cộng đồng người chạy.</p><div className="runner-fields"><label className="field-wide">Loại tin<select name="listingType" value={draft.listingType} onChange={changeDraft}><option value="BIB_TRANSFER">Chuyển nhượng BIB</option><option value="GEAR">Đồ chạy bộ</option></select></label>
      {draft.listingType === 'BIB_TRANSFER' && <><label className="field-wide">Vé của bạn<select name="registrationId" required value={draft.registrationId} onChange={changeDraft}><option value="">Chọn vé chuyển nhượng</option>{registrations.map(r => <option key={r._id} value={r._id}>{r.eventId?.name} · {r.categoryId?.name} · {r.bibNumber}</option>)}</select></label>{!registrations.length && <p className="notice field-wide">Bạn chưa có vé đủ điều kiện. Chỉ vé đã xác nhận, chưa nhận kit/check-in và giải chưa diễn ra mới có thể chuyển nhượng.</p>}</>}
      <label className="field-wide">Tiêu đề<input name="title" required maxLength={160} value={draft.title} onChange={changeDraft} placeholder="Bạn muốn nhượng lại điều gì?" /></label><label className="field-wide">Mô tả<textarea name="description" maxLength={2000} rows={3} value={draft.description} onChange={changeDraft} /></label><label className="field-wide">Giá (VNĐ)<input name="price" type="number" min={1} step={1} max={draft.listingType === 'BIB_TRANSFER' ? maxPrice : undefined} required value={draft.price} onChange={changeDraft} />{draft.listingType === 'BIB_TRANSFER' && <small>{maxPrice !== undefined ? 'Tối đa ' + money(maxPrice) : 'Không vượt quá 110% giá vé gốc.'}</small>}</label></div>{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy || (draft.listingType === 'BIB_TRANSFER' && !registrations.length)}>{busy ? 'Đang đăng...' : 'Đăng tin'}</button></div></form></Modal>}
    {modal === 'buy' && selected && <Modal title="Kiểm tra trước khi mua" busy={busy} onClose={() => setModal('')}><form onSubmit={submit}><p className="dialog-copy"><strong>{selected.title}</strong></p>{selected.description && <p className="dialog-copy">{selected.description}</p>}{selected.listingType === 'BIB_TRANSFER' && <><p className="dialog-copy">Đã điền từ hồ sơ của bạn. Thông tin dưới đây sẽ in trên vé mới.</p><div className="runner-fields">{[['fullName','Họ và tên','text'],['email','Email','email'],['phone','Số điện thoại','tel']].map(([key,label,inputType]) => <label key={key}>{label}<input type={inputType} required value={buyer[key]} onChange={event => setBuyer({ ...buyer, [key]: event.target.value })} /></label>)}</div><RunnerFields value={buyer} onChange={setBuyer} prefix="market-buyer" /></>}
      <div className="market-payment"><span>Trừ từ ví RunFurther</span><strong>{money(selected.price)}</strong><Link href="/account/wallet">Xem số dư / nạp ví ↗</Link></div>{selected.listingType === 'GEAR' && <p className="notice">Khoản tiền sẽ chuyển cho người bán ngay khi xác nhận. Hãy thống nhất việc giao nhận trước khi thanh toán.</p>}{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy}>{busy ? 'Đang xử lý...' : 'Xác nhận thanh toán ' + money(selected.price)}</button></div></form></Modal>}
    {modal === 'cancel' && selected && <Modal title="Quản lý tin của bạn" busy={busy} onClose={() => setModal('')}><form onSubmit={submit}><p className="dialog-copy">{selected.title}</p><p>Hủy tin sẽ gỡ khỏi marketplace. Vé BIB sẽ trở lại trạng thái đã xác nhận trong tài khoản của bạn.</p>{formError && <p role="alert" className="notice notice-error">{formError}</p>}<div className="form-bottom"><button className="button-dark" disabled={busy}>{busy ? 'Đang xử lý...' : 'Hủy tin đăng'}</button></div></form></Modal>}
  </div>;
}
