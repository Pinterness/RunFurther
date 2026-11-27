'use client';
// Tab "Cộng đồng" trong /account (spec D1–D2, 4.6): bật hồ sơ qua màn hình đồng ý, sửa lời giới thiệu, hai ô tùy
// chọn và handle, tắt hồ sơ (xóa hẳn) qua hộp xác nhận. Chưa đủ 16 tuổi thì chỉ giải thích và chỉ sang tab hồ sơ
// người chạy; hồ sơ đã có mà chủ nay chưa đủ tuổi thì báo đang ẩn và chỉ cho xóa.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import ChatSettings from './chat/ChatSettings';
import { api } from '../../lib/clientApi';
import { bestTimeEntries, loginHref } from '../../lib/communityClient';
import './community.css';

const BIO_MAX = 160;
const blankForm = { bio: '', showClub: false, showResults: false };
// Có hồ sơ thì form có thêm handle để đổi; lúc bật lần đầu handle luôn tự sinh từ họ tên.
const formOf = profile => (profile ? { bio: profile.bio || '', showClub: Boolean(profile.showClub), showResults: Boolean(profile.showResults), handle: profile.handle } : blankForm);
const sameForm = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Câu cạnh ô "Hiện thành tích": kể đủ những gì sẽ hiện trên hồ sơ, để người dùng quyết định khi đã biết (spec D1).
function resultsPreview(results) {
  if (!results) return 'Chưa có kết quả giải nào. Chỉ tính vé đã chạy xong có email trùng email tài khoản này và người chạy đủ 16 tuổi.';
  const best = bestTimeEntries(results.bestTimes).map(([key, time]) => `${key} ${time}`);
  return `Sẽ hiện: ${results.completedRaces} giải đã hoàn thành, ${results.totalKm.toLocaleString('vi-VN')} km`
    + (best.length ? `, thời gian tốt nhất ${best.join(', ')}` : '') + '. Không có tên giải hay ngày chạy.';
}

function SettingsFields({ form, setForm, results }) {
  return <>
    {form.handle !== undefined && <label className="community-field" htmlFor="community-handle">Tên hồ sơ trên đường dẫn
      <small>Đường dẫn là /community/tên-hồ-sơ. Dùng 3–30 chữ thường không dấu, số và dấu gạch nối giữa các chữ. Đổi tên thì đường dẫn cũ không mở được nữa, và tên cũ có thể được người khác chọn.</small>
      <input id="community-handle" maxLength={30} autoCapitalize="none" autoComplete="off" spellCheck={false} value={form.handle} onChange={event => setForm({ ...form, handle: event.target.value })} />
    </label>}
    <label className="community-field" htmlFor="community-bio">Lời giới thiệu <small>(không bắt buộc, tối đa {BIO_MAX} ký tự)</small>
      <textarea id="community-bio" rows={3} maxLength={BIO_MAX} value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} />
    </label>
    <label className="community-check"><input type="checkbox" checked={form.showClub} onChange={event => setForm({ ...form, showClub: event.target.checked })} /><span>Hiện câu lạc bộ<small>Lấy từ hồ sơ người chạy. Chưa có câu lạc bộ thì không hiện gì.</small></span></label>
    <label className="community-check"><input type="checkbox" checked={form.showResults} onChange={event => setForm({ ...form, showResults: event.target.checked })} /><span>Hiện thành tích<small>{resultsPreview(results)}</small></span></label>
  </>;
}

export default function CommunitySettings({ onOpenRunnerProfile }) {
  const router = useRouter();
  const [data, setData] = useState(null), [form, setForm] = useState(blankForm), [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [deleteError, setDeleteError] = useState('');
  const noticeRef = useRef(null);
  // Nút vừa bấm (Bật hồ sơ, Xóa hồ sơ) biến mất sau khi xong, nên chuyển focus tới dòng thông báo.
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  // Hết phiên đăng nhập: api() đã xóa token; chuyển tới đăng nhập rồi quay lại đúng tab này.
  function handleFailure(failure, show) {
    if (failure.status === 401) router.replace(loginHref('/account#community'));
    else show(failure.message);
  }

  async function load() {
    setLoading(true); setError('');
    try {
      const me = await api('/community/me');
      setData(me); setForm(formOf(me.profile));
    } catch (failure) { handleFailure(failure, setError); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(body, message) {
    const submitted = form;
    setSaving(true); setError(''); setNotice('');
    try {
      const { profile } = await api('/community/me', { method: 'PUT', body: JSON.stringify(body) });
      setData(current => ({ ...current, profile }));
      // Người dùng gõ tiếp trong lúc chờ máy chủ thì giữ chữ đang gõ, không ghi đè bằng bản vừa lưu.
      setForm(current => (sameForm(current, submitted) ? formOf(profile) : current));
      setNotice(message);
    } catch (failure) { handleFailure(failure, setError); } finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true); setDeleteError(''); setNotice('');
    try {
      await api('/community/me', { method: 'DELETE' });
      setData(current => ({ ...current, profile: null })); setForm(blankForm); setAgreed(false); setConfirming(false);
      setNotice('Đã tắt và xóa hồ sơ cộng đồng của bạn.');
    } catch (failure) { handleFailure(failure, setDeleteError); } finally { setSaving(false); }
  }
  // Chỉ gửi handle khi người dùng thật sự đổi nó.
  function saveChanges(event) {
    event.preventDefault();
    const { handle, ...settings } = form;
    save(handle !== data.profile.handle ? { ...settings, handle } : settings, 'Đã lưu hồ sơ cộng đồng.');
  }

  const profile = data?.profile;
  const dangerZone = profile && <>
    <div className="community-danger">
      <h3>Tắt hồ sơ</h3>
      <p>Tắt là xóa hẳn hồ sơ cộng đồng. Vé, ví và hồ sơ người chạy của bạn không bị ảnh hưởng.</p>
      <button type="button" className="quiet-button" onClick={() => { setDeleteError(''); setConfirming(true); }}>Tắt và xóa hồ sơ cộng đồng</button>
    </div>
    {confirming && <Modal title="Tắt và xóa hồ sơ cộng đồng?" onClose={() => setConfirming(false)} busy={saving}>
      <p className="dialog-copy">Hồ sơ cộng đồng của bạn sẽ bị xóa hẳn và không ai xem được nữa. Tên hồ sơ @{profile.handle} có thể được cấp cho người khác. Muốn hiện lại, bạn bật và đồng ý lại từ đầu.</p>
      {deleteError && <p role="alert" className="notice notice-error">{deleteError}</p>}
      <div className="dialog-actions"><button type="button" className="button-primary" onClick={remove} disabled={saving}>{saving ? 'Đang xóa...' : 'Xóa hồ sơ'}</button><button type="button" className="text-action" onClick={() => setConfirming(false)} disabled={saving}>Giữ lại</button></div>
    </Modal>}
  </>;

  let body;
  if (loading && !data) body = <div className="runner-empty" role="status">Đang tải hồ sơ cộng đồng...</div>;
  else if (!data) body = <button className="button-dark" onClick={load}>Thử lại</button>;
  else if (!data.eligible && !profile) body = <div className="runner-empty community-age">
    <h3>Chưa bật được hồ sơ cộng đồng</h3>
    <p>Hồ sơ cộng đồng và nhắn tin chỉ dành cho người đủ 16 tuổi, tính theo ngày sinh trong hồ sơ người chạy. Nếu bạn chưa nhập ngày sinh hoặc ngày sinh chưa đúng, hãy cập nhật ở tab hồ sơ người chạy.</p>
    <button type="button" className="button-dark" onClick={onOpenRunnerProfile}>Sang Hồ sơ người chạy</button>
  </div>;
  else if (!data.eligible) body = <>
    <p className="notice">Hồ sơ cộng đồng của bạn đang ẩn với mọi người, vì ngày sinh trong hồ sơ người chạy cho thấy bạn chưa đủ 16 tuổi hoặc chưa có ngày sinh. Bạn vẫn tắt và xóa hồ sơ được.</p>
    {dangerZone}
  </>;
  else if (!profile) body = <form className="community-form" onSubmit={event => { event.preventDefault(); save({ consentVersion: data.consentText.version, ...form }, 'Đã bật hồ sơ cộng đồng. Các thành viên đã đăng nhập giờ xem được hồ sơ của bạn.'); }}>
    <h3>Bật hồ sơ cộng đồng</h3>
    <p className="community-consent-text">{data.consentText.text}</p>
    <SettingsFields form={form} setForm={setForm} results={data.results} />
    <label className="community-check community-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>Tôi đồng ý công khai hồ sơ theo nội dung trên</span></label>
    <div className="form-bottom"><button className="button-primary" disabled={!agreed || saving}>{saving ? 'Đang bật...' : 'Bật hồ sơ'}</button></div>
  </form>;
  else body = <>
    <p className="community-live">Hồ sơ của bạn đang hiện với các thành viên đã đăng nhập tại <Link href={'/community/' + profile.handle}>/community/{profile.handle}</Link></p>
    <form className="community-form" onSubmit={saveChanges}>
      <SettingsFields form={form} setForm={setForm} results={data.results} />
      <div className="form-bottom"><button className="button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div>
    </form>
    {dangerZone}
  </>;

  // Phần Tin nhắn (P13.3) nằm ngay dưới hồ sơ cộng đồng, cùng tab.
  return <><section className="community-settings" aria-labelledby="community-settings-title">
    <div className="section-heading"><h2 id="community-settings-title">Hồ sơ cộng đồng</h2><p>Hồ sơ giúp những người chạy khác tìm thấy bạn, và chỉ thành viên đã đăng nhập mới xem được. Họ tên, avatar, tên hồ sơ, lời giới thiệu và tháng tham gia luôn hiện; câu lạc bộ và thành tích chỉ hiện khi bạn bật.</p></div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}{notice && <p role="status" tabIndex={-1} ref={noticeRef} className="notice">{notice}</p>}
    {body}
  </section><ChatSettings /></>;
}
