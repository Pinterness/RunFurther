'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/clientApi';
import TransferDetails from './TransferDetails';
import './bank-fields.css';

export const EMPTY_BANK_ACCOUNT = { bankBin: '', bankName: '', accountNo: '', accountName: '' };
export function accountFields(value) {
  return Object.fromEntries(Object.keys(EMPTY_BANK_ACCOUNT).map(key => [key, value[key] || '']));
}

export default function BankFields({ value, onChange, onAction, title = 'Tài khoản nhận tiền vé', hint = 'Tắt chuyển khoản để ẩn tài khoản và QR với người mua. Tài khoản đã lưu vẫn được giữ để bật lại.', disableLabel = 'Tắt chuyển khoản', variant = 'ticket' }) {
  const [banks, setBanks] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [preview, setPreview] = useState(false);
  const hasAccount = Object.keys(EMPTY_BANK_ACCOUNT).some(key => Boolean(value[key]));
  const enabled = value.bankTransferEnabled ?? hasAccount;
  const [editing, setEditing] = useState(!hasAccount);
  async function load() {
    setLoading(true); setError('');
    try { setBanks((await api('/banks')).banks); }
    catch { setError('Chưa tải được danh sách ngân hàng.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const bank = banks.find(b => b.bin === value.bankBin || (!value.bankBin && [b.code, b.shortName, b.name].includes(value.bankName)));
  const valid = bank && /^[a-zA-Z0-9]{1,19}$/.test((value.accountNo || '').trim()) && (value.accountName || '').trim().length >= 2;
  const showFields = enabled || editing;
  const query = new URLSearchParams({ amount: '10000', addInfo: 'XEMTRUOC', accountName: (value.accountName || '').trim() });
  const qrUrl = enabled && valid ? `https://img.vietqr.io/image/${bank.bin}-${value.accountNo.trim()}-compact2.png?${query}` : null;
  function change(patch) { setPreview(false); onChange(patch); }
  async function action(kind) {
    setPreview(false);
    const patch = kind === 'delete'
      ? { bankAccountInfo: { ...EMPTY_BANK_ACCOUNT }, bankTransferEnabled: false }
      : enabled ? { bankTransferEnabled: false }
        : { bankAccountInfo: accountFields(value), bankTransferEnabled: true };
    if (onAction) {
      const saved = await onAction(patch);
      if (!saved) return;
    } else {
      onChange({ ...(patch.bankAccountInfo || {}), bankTransferEnabled: patch.bankTransferEnabled });
    }
    setEditing(kind === 'delete');
  }
  return <div className="bank-settings">
    <h3 className="form-subheading">{title}</h3>
    <p className="organizer-hint">{hint}</p>
    <p role="status" className="bank-state">{enabled ? 'Chuyển khoản đang bật' : hasAccount ? 'Chuyển khoản đã tắt · Tài khoản được giữ lại' : 'Chưa có tài khoản nhận'}</p>
    <div className="organizer-row-actions">
      <button className="quiet-button" type="button" disabled={!enabled && !valid} onClick={() => action('toggle')}>{enabled ? disableLabel : 'Bật chuyển khoản'}</button>
      {!enabled && <button className="text-action" type="button" onClick={() => setEditing(!editing)}>{editing ? 'Ẩn thông tin tài khoản' : hasAccount ? 'Đổi tài khoản' : 'Thêm tài khoản'}</button>}
      {hasAccount && <button className="text-action" type="button" onClick={() => action('delete')}>Xóa tài khoản nhận</button>}
    </div>
    {error && <p role="alert" className="notice notice-error">{error} <button type="button" onClick={load}>Thử lại</button></p>}
    {showFields && <>
      <div className="runner-fields">
        <label>Ngân hàng<select aria-label="Ngân hàng" name="bankBin" value={bank?.bin || value.bankBin || ''} required={enabled || hasAccount} onChange={e => { const next = banks.find(b => b.bin === e.target.value); change({ bankBin: next?.bin || '', bankName: next?.shortName || '' }); }}>
          <option value="">{loading ? 'Đang tải ngân hàng...' : 'Chọn ngân hàng'}</option>
          {value.bankBin && !bank && <option value={value.bankBin}>Ngân hàng đã lưu ({value.bankBin})</option>}
          {banks.map(b => <option value={b.bin} key={b.bin}>{b.shortName} — {b.name}</option>)}
        </select></label>
        <label>Số tài khoản<input name="accountNo" autoComplete="off" required={enabled || hasAccount} pattern="[a-zA-Z0-9]{1,19}" maxLength={19} value={value.accountNo || ''} onChange={e => change({ accountNo: e.target.value })} /></label>
        <label>Tên chủ tài khoản<input name="accountName" required={enabled || hasAccount} minLength={2} maxLength={100} value={value.accountName || ''} onChange={e => change({ accountName: e.target.value })} /></label>
      </div>
      {enabled && <div className="organizer-row-actions"><button className="quiet-button" type="button" disabled={!valid} onClick={() => setPreview(!preview)}>{preview ? 'Đóng xem trước' : 'Xem trước QR'}</button></div>}
    </>}
    {!onAction && <p className="organizer-hint">Nhấn lưu bên dưới để áp dụng thay đổi.</p>}
    {enabled && preview && qrUrl && <TransferDetails preview variant={variant} bankInfo={{ ...value, bankName: bank.shortName }} amount={10000} orderCode="XEMTRUOC" qrUrl={qrUrl} />}
  </div>;
}
