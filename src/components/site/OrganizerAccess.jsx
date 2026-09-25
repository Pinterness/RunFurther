'use client';
import { useState } from 'react';
import { api } from '../../lib/clientApi';
export default function OrganizerAccess({ application, onChange }) {
  const [form, setForm] = useState({ organizationName: application?.organizationName || '', phone: application?.phone || '', description: application?.description || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { onChange((await api('/admin/organizer-access', { method: 'POST', body: JSON.stringify(form) })).application); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (application?.status === 'APPROVED') return <p className="notice">Quyền tổ chức đã được duyệt. Bạn có thể tạo đơn vị và giải chạy của mình.</p>;
  return <section className="organizer-panel"><h2>Đăng ký quyền tổ chức</h2><p className="organizer-hint">Super Admin xét duyệt trước khi bạn tạo đơn vị và giải. Sau khi tạo giải, bạn là chủ giải và tự phân công đội ngũ.</p>
    {application?.status === 'PENDING' ? <p className="notice" role="status">Đơn của {application.organizationName} đang chờ Super Admin xét duyệt.</p> : <form onSubmit={submit}>{application?.reviewNote && <p className="notice notice-error">Lý do từ chối: {application.reviewNote}. Bạn có thể bổ sung và gửi lại.</p>}<div className="runner-fields"><label>Tên đơn vị dự kiến<input required maxLength={200} value={form.organizationName} onChange={e => setForm({ ...form, organizationName: e.target.value })} /></label><label>Số điện thoại liên hệ<input required type="tel" maxLength={30} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label className="field-wide">Giới thiệu và kế hoạch tổ chức<textarea required maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label></div>{error && <p role="alert" className="notice notice-error">{error}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy}>{busy ? 'Đang gửi...' : 'Gửi xét duyệt'}</button></div></form>}
  </section>;
}
