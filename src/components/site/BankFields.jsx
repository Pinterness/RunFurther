'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/clientApi';
import TransferDetails from './TransferDetails';
// Defaults keep the event form wording; the wallet top-up settings pass their own copy.
const DEFAULT_COPY = {
  title: 'Tài khoản nhận tiền vé',
  hint: 'Chọn ngân hàng và kiểm tra tài khoản trước khi nhận chuyển khoản. Có thể để trống toàn bộ để chỉ dùng ví.',
  disableLabel: 'Tắt chuyển khoản',
};
export default function BankFields({ value, onChange, title = DEFAULT_COPY.title, hint = DEFAULT_COPY.hint, disableLabel = DEFAULT_COPY.disableLabel, variant = 'ticket' }) {
  const [banks, setBanks] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [preview, setPreview] = useState(false);
  async function load() { setLoading(true); setError(''); try { setBanks((await api('/banks')).banks); } catch { setError('Chưa tải được danh sách ngân hàng.'); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  const bank = banks.find(b => b.bin === value.bankBin || (!value.bankBin && [b.code,b.shortName,b.name].includes(value.bankName)));
  const enabled = !!(value.bankBin || value.bankName || value.accountNo || value.accountName);
  const valid = bank && /^[a-zA-Z0-9]{1,19}$/.test(value.accountNo.trim()) && value.accountName.trim().length >= 2;
  const query = new URLSearchParams({ amount: '10000', addInfo: 'XEMTRUOC', accountName: value.accountName.trim() });
  const qrUrl = valid ? `https://img.vietqr.io/image/${bank.bin}-${value.accountNo.trim()}-compact2.png?${query}` : null;
  return <><h3 className="form-subheading">{title}</h3><p className="organizer-hint">{hint}</p>{error && <p role="alert" className="notice notice-error">{error} <button type="button" onClick={load}>Thử lại</button></p>}<div className="runner-fields"><label>Ngân hàng<select aria-label="Ngân hàng" name="bankBin" value={bank?.bin || value.bankBin || ''} required={enabled} onChange={e => { const next = banks.find(b => b.bin === e.target.value); setPreview(false); onChange({ bankBin: next?.bin || '', bankName: next?.shortName || '' }); }}><option value="">{loading ? 'Đang tải ngân hàng...' : 'Chọn ngân hàng'}</option>{value.bankBin && !bank && <option value={value.bankBin}>Ngân hàng đã lưu ({value.bankBin})</option>}{banks.map(b => <option value={b.bin} key={b.bin}>{b.shortName} — {b.name}</option>)}</select></label><label>Số tài khoản<input name="accountNo" autoComplete="off" required={enabled} pattern="[a-zA-Z0-9]{1,19}" maxLength={19} value={value.accountNo} onChange={e => { setPreview(false); onChange({ accountNo: e.target.value }); }} /></label><label>Tên chủ tài khoản<input name="accountName" required={enabled} minLength={2} maxLength={100} value={value.accountName} onChange={e => { setPreview(false); onChange({ accountName: e.target.value }); }} /></label></div><div className="organizer-row-actions"><button className="quiet-button" type="button" disabled={!valid} onClick={() => setPreview(!preview)}>{preview ? 'Đóng xem trước' : 'Xem trước QR'}</button>{enabled && <button className="text-action" type="button" onClick={() => { setPreview(false); onChange({ bankBin:'', bankName:'', accountNo:'', accountName:'' }); }}>{disableLabel}</button>}</div>{preview && <TransferDetails preview variant={variant} bankInfo={{ ...value, bankName: bank.shortName }} amount={10000} orderCode="XEMTRUOC" qrUrl={qrUrl} />}</>;
}
