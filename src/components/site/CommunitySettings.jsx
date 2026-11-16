'use client';
// Tab "Cộng đồng" trong /account (spec D1–D2, 4.6): bật hồ sơ qua màn hình đồng ý, sửa lời giới thiệu và hai ô tùy
// chọn, tắt hồ sơ (xóa hẳn) qua hộp xác nhận. Chưa đủ 16 tuổi thì chỉ giải thích và chỉ sang tab hồ sơ người chạy.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from './Modal';
import { api } from '../../lib/clientApi';
import './community.css';

const BIO_MAX = 160;
const blankForm = { bio: '', showClub: false, showResults: false };
const formOf = profile => (profile ? { bio: profile.bio || '', showClub: Boolean(profile.showClub), showResults: Boolean(profile.showResults) } : blankForm);

function SettingsFields({ form, setForm }) {
  return <>
    <label className="community-field" htmlFor="community-bio">Lời giới thiệu <small>(không bắt buộc, tối đa {BIO_MAX} ký tự)</small>
      <textarea id="community-bio" rows={3} maxLength={BIO_MAX} value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} />
    </label>
    <label className="community-check"><input type="checkbox" checked={form.showClub} onChange={event => setForm({ ...form, showClub: event.target.checked })} /><span>Hiện câu lạc bộ<small>Lấy từ hồ sơ người chạy của bạn.</small></span></label>
    <label className="community-check"><input type="checkbox" checked={form.showResults} onChange={event => setForm({ ...form, showResults: event.target.checked })} /><span>Hiện thành tích<small>Chỉ là số tổng hợp: số giải đã hoàn thành, tổng km, thời gian tốt nhất. Không có tên giải hay ngày chạy.</small></span></label>
  </>;
}

export default function CommunitySettings({ onOpenRunnerProfile }) {
  const [data, setData] = useState(null), [form, setForm] = useState(blankForm), [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const me = await api('/community/me');
      setData(me); setForm(formOf(me.profile));
    } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(body, message) {
    setSaving(true); setError(''); setNotice('');
    try {
      const { profile } = await api('/community/me', { method: 'PUT', body: JSON.stringify(body) });
      setData(current => ({ ...current, profile })); setForm(formOf(profile)); setNotice(message);
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true); setError(''); setNotice('');
    try {
      await api('/community/me', { method: 'DELETE' });
      setData(current => ({ ...current, profile: null })); setForm(blankForm); setAgreed(false); setConfirming(false);
      setNotice('Đã tắt và xóa hồ sơ cộng đồng của bạn.');
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  const profile = data?.profile;
  let body;
  if (loading && !data) body = <div className="runner-empty" role="status">Đang tải hồ sơ cộng đồng...</div>;
  else if (!data) body = <button className="button-dark" onClick={load}>Thử lại</button>;
  else if (!data.eligible && !profile) body = <div className="runner-empty community-age">
    <h3>Chưa bật được hồ sơ cộng đồng</h3>
    <p>Hồ sơ cộng đồng và nhắn tin chỉ dành cho người đủ 16 tuổi, tính theo ngày sinh trong hồ sơ người chạy. Nếu bạn chưa nhập ngày sinh hoặc ngày sinh chưa đúng, hãy cập nhật ở tab hồ sơ người chạy.</p>
    <button type="button" className="button-dark" onClick={onOpenRunnerProfile}>Sang Hồ sơ người chạy</button>
  </div>;
  else if (!profile) body = <form className="community-form" onSubmit={event => { event.preventDefault(); save({ consentVersion: data.consentText.version, ...form }, 'Đã bật hồ sơ cộng đồng. Các thành viên đã đăng nhập giờ xem được hồ sơ của bạn.'); }}>
    <h3>Bật hồ sơ cộng đồng</h3>
    <p className="community-consent-text">{data.consentText.text}</p>
    <SettingsFields form={form} setForm={setForm} />
    <label className="community-check community-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>Tôi đồng ý công khai hồ sơ theo nội dung trên</span></label>
    <div className="form-bottom"><button className="button-primary" disabled={!agreed || saving}>{saving ? 'Đang bật...' : 'Bật hồ sơ'}</button></div>
  </form>;
  else body = <>
    <p className="community-live">Hồ sơ của bạn đang hiện với các thành viên đã đăng nhập tại <Link href={'/community/' + profile.handle}>/community/{profile.handle}</Link></p>
    <form className="community-form" onSubmit={event => { event.preventDefault(); save(form, 'Đã lưu hồ sơ cộng đồng.'); }}>
      <SettingsFields form={form} setForm={setForm} />
      <div className="form-bottom"><button className="button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div>
    </form>
    <div className="community-danger">
      <h3>Tắt hồ sơ</h3>
      <p>Tắt là xóa hẳn hồ sơ cộng đồng. Vé, ví và hồ sơ người chạy của bạn không bị ảnh hưởng.</p>
      <button type="button" className="quiet-button" onClick={() => setConfirming(true)}>Tắt và xóa hồ sơ cộng đồng</button>
    </div>
    {confirming && <Modal title="Tắt và xóa hồ sơ cộng đồng?" onClose={() => setConfirming(false)} busy={saving}>
      <p className="dialog-copy">Hồ sơ cộng đồng của bạn sẽ bị xóa hẳn và không ai xem được nữa. Tên hồ sơ @{profile.handle} có thể được cấp cho người khác. Muốn hiện lại, bạn bật và đồng ý lại từ đầu.</p>
      <div className="dialog-actions"><button type="button" className="button-primary" onClick={remove} disabled={saving}>{saving ? 'Đang xóa...' : 'Xóa hồ sơ'}</button><button type="button" className="text-action" onClick={() => setConfirming(false)} disabled={saving}>Giữ lại</button></div>
    </Modal>}
  </>;

  return <section className="community-settings" aria-labelledby="community-settings-title">
    <div className="section-heading"><h2 id="community-settings-title">Hồ sơ cộng đồng</h2><p>Hồ sơ giúp những người chạy khác tìm thấy bạn. Chỉ thành viên đã đăng nhập mới xem được, và bạn chọn thông tin nào được hiện.</p></div>
    {error && <p role="alert" className="notice notice-error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {body}
  </section>;
}
