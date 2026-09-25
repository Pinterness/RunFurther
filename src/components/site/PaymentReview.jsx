'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/clientApi';
import Modal from './Modal';
export default function PaymentReview({ endpoint = '/admin', suspended = false }) {
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selection, setSelection] = useState(null), [reference, setReference] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  async function load() { setLoading(true); setError(''); try { setItems((await api(endpoint + '/payments')).payments); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [endpoint]);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(endpoint + '/payments/' + selection.item._id + '/review', { method: 'POST', body: JSON.stringify({ status: selection.status, bankReference: reference, reviewNote: note }) }); setSelection(null); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="organizer-panel"><h2>{endpoint === '/admin' ? 'Đối soát nạp ví' : 'Đối soát tiền vé'}</h2><p className="organizer-hint">Chỉ xác nhận sau khi kiểm tra tiền đã vào tài khoản. Mã giao dịch ngân hàng không được sử dụng lại.</p>
    {!selection && error && <p role="alert" className="notice notice-error">{error} <button onClick={load}>Thử lại</button></p>}
    {loading ? <p role="status">Đang tải yêu cầu...</p> : !items.length ? <p className="runner-empty">Chưa có yêu cầu thanh toán.</p> : <div className="organizer-staff-list">{items.map(item => <article className="organizer-staff" key={item._id}><div><h3>{Number(item.amount).toLocaleString('vi-VN')}đ</h3><p>{item.requestKey}</p><small>{({ PENDING: 'Chờ đối soát', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối' })[item.status]} · {item.reviewNote}</small></div>{item.status === 'PENDING' && <div className="organizer-row-actions"><button className="button-dark" disabled={suspended} onClick={() => { setSelection({ item, status: 'APPROVED' }); setReference(''); setNote(''); setError(''); }}>Xác nhận đã nhận tiền</button><button className="quiet-button" onClick={() => { setSelection({ item, status: 'REJECTED' }); setReference(''); setNote(''); setError(''); }}>Từ chối</button></div>}</article>)}</div>}
    {selection && <Modal title={selection.status === 'APPROVED' ? 'Xác nhận giao dịch' : 'Từ chối yêu cầu'} busy={busy} onClose={() => setSelection(null)}><form onSubmit={submit}><div className="runner-fields">{selection.status === 'APPROVED' && <label className="field-wide">Mã giao dịch ngân hàng<input required minLength={3} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label>}<label className="field-wide">Ghi chú / lý do<textarea required={selection.status === 'REJECTED'} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label></div>{error && <p role="alert" className="notice notice-error">{error}</p>}<div className="form-bottom"><button className="button-primary" disabled={busy}>Lưu quyết định</button></div></form></Modal>}
  </section>;
}
