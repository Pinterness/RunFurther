'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/clientApi';
import { formatDateTime, formatVnd } from '../../lib/format';
import './topup.css';

const REASONS = {
  AMOUNT_MISMATCH: 'Số tiền không khớp', BANK_SNAPSHOT_MISMATCH: 'Khác tài khoản nhận của đơn',
  PAYMENT_BEFORE_ORDER: 'Tiền đến trước khi tạo đơn', PAYMENT_AFTER_EXPIRY: 'Chuyển sau hạn thanh toán',
  MISSING_OR_AMBIGUOUS_CODE: 'Thiếu mã hoặc có nhiều mã thanh toán', WRONG_PAYMENT_FLOW: 'Sai luồng thanh toán',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn thuộc kết nối này', BOOKING_ALREADY_PAID_OR_CANCELLED: 'Vé đã thanh toán hoặc đã hủy',
  PAYMENT_ALREADY_REVIEWED: 'Lệnh đã được xử lý', BANK_REFERENCE_USED: 'Mã giao dịch đã được sử dụng',
  USER_INACTIVE: 'Tài khoản người dùng đang khóa', WALLET_INACTIVE: 'Ví đang khóa',
  NO_CAPACITY_FOR_DELAYED_PAYMENT: 'Thông báo đến chậm và giải đã hết chỗ', ORDER_UNAVAILABLE: 'Đơn không đủ điều kiện hoàn tất',
  EVENT_NOT_PAYABLE: 'Giải đã hủy hoặc kết thúc',
};

export default function SepayReceipts({ endpoint }) {
  const [receipts, setReceipts] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(null);
  async function load(before) {
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ status: 'REVIEW' });
      if (before) query.set('before', before);
      const result = await api(endpoint + '/receipts?' + query);
      setReceipts(previous => before ? [...previous, ...result.receipts] : result.receipts);
      setCursor(result.nextCursor);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [endpoint]);
  async function retry(id) {
    setBusy(true); setError('');
    try { await api(endpoint + '/receipts/' + id + '/retry', { method: 'POST' }); await load(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <section className="organizer-panel sepay-receipts" aria-label="Giao dịch SePay cần đối soát">
    <div className="organizer-row-actions"><h3>Giao dịch ngân hàng cần kiểm tra</h3><button type="button" className="quiet-button" disabled={busy} onClick={() => load()}>Làm mới</button></div>
    <p className="organizer-hint">Các khoản dưới đây chưa được tự động xử lý. Kiểm tra sao kê trước khi duyệt thủ công hoặc hoàn tiền. Kiểm tra lại chỉ đối chiếu giao dịch gốc, không bỏ qua điều kiện thanh toán.</p>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {!receipts.length && <p className="runner-empty" role="status">{busy ? 'Đang tải giao dịch…' : 'Chưa có giao dịch SePay cần kiểm tra.'}</p>}
    <div className="organizer-staff-list">{receipts.map(item => <article className="organizer-staff" key={item._id}>
      <div><h4>{formatVnd(item.amount)} · {item.transferCode || 'Chưa xác định mã đơn'}</h4>
        <p>{REASONS[item.reason] || item.reason}</p><small>{item.referenceCode} · {formatDateTime(item.paidAt)}</small>
        <p>{item.content}</p></div>
      <button type="button" className="quiet-button" disabled={busy} onClick={() => retry(item._id)}>Kiểm tra lại</button>
    </article>)}</div>
    {cursor && <button type="button" className="quiet-button" disabled={busy} onClick={() => load(cursor)}>Xem thêm</button>}
  </section>;
}
