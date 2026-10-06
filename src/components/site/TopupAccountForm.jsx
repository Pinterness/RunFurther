'use client';
import { useState } from 'react';
import { api } from '../../lib/clientApi';
import { formatDateTime } from '../../lib/format';
import { useApiQuery } from '../../lib/useApiQuery';
import BankFields from './BankFields';
import './topup.css';

const SETTINGS_PATH = '/admin/platform/topup-account';
const EMPTY_ACCOUNT = { bankBin: '', bankName: '', accountNo: '', accountName: '' };

const describeAccount = (account) =>
  account?.accountNo
    ? `${account.bankName} · ${account.accountNo} · ${account.accountName}`
    : 'Đã tắt nạp ví';

function AccountEditor({ initialAccount, onSaved }) {
  const [account, setAccount] = useState({ ...EMPTY_ACCOUNT, ...initialAccount });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api(SETTINGS_PATH, {
        method: 'PUT',
        body: JSON.stringify({ bankAccountInfo: account }),
      });
      onSaved(saved);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <BankFields
        value={account}
        onChange={(patch) => setAccount((current) => ({ ...current, ...patch }))}
        title="Ngân hàng và số tài khoản"
        hint="Chọn ngân hàng, nhập số tài khoản và tên chủ tài khoản đúng như trong ứng dụng ngân hàng. Để trống toàn bộ để tắt nạp ví."
        disableLabel="Tắt nạp ví"
        variant="topup"
      />
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      <div className="form-bottom">
        <button className="button-primary" disabled={busy}>
          Lưu tài khoản nhận
        </button>
      </div>
    </form>
  );
}

function AccountHistory({ setting }) {
  return (
    <>
      {setting.updatedBy && (
        <p className="organizer-hint">
          Cập nhật gần nhất: {setting.updatedBy.fullName} ({setting.updatedBy.email}) ·{' '}
          {formatDateTime(setting.updatedAt)}
        </p>
      )}
      {setting.history.length > 0 && (
        <details className="topup-history">
          <summary>Lịch sử thay đổi ({setting.history.length})</summary>
          <ul>
            {setting.history.map((entry) => (
              <li key={`${entry.changedAt}-${entry.bankAccountInfo.accountNo}`}>
                {describeAccount(entry.bankAccountInfo)} · {entry.changedBy?.fullName ?? 'Không rõ'}{' '}
                · {formatDateTime(entry.changedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * Super Admin form for the bank account that receives wallet top-ups.
 * @returns {JSX.Element} The settings section.
 */
export default function TopupAccountForm() {
  const { data: setting, error, reload } = useApiQuery(SETTINGS_PATH);
  const [notice, setNotice] = useState('');

  function handleSaved(saved) {
    setNotice(
      saved.configured
        ? 'Đã lưu tài khoản nhận. Chỉ áp dụng cho lệnh nạp mới.'
        : 'Đã tắt nạp ví. Người dùng sẽ thấy thông báo nạp ví tạm đóng.',
    );
    reload();
  }

  return (
    <section className="topup-account" aria-labelledby="topup-account-title">
      <h2 id="topup-account-title">Tài khoản nhận nạp ví</h2>
      <p className="organizer-hint">
        Người dùng chuyển tiền nạp ví vào tài khoản này. Mỗi lệnh nạp giữ tài khoản tại thời điểm
        tạo, nên thay đổi chỉ áp dụng cho lệnh nạp mới.
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {/* Never show an empty form after a failed load: saving it would close top-ups. */}
      {!setting && error && (
        <p role="alert" className="notice notice-error">
          {error.message}{' '}
          <button type="button" onClick={reload}>
            Tải lại
          </button>
        </p>
      )}
      {!setting && !error && <p role="status">Đang tải cấu hình...</p>}
      {setting && (
        <>
          <AccountEditor
            key={setting.updatedAt ?? 'unsaved'}
            initialAccount={setting.account}
            onSaved={handleSaved}
          />
          <AccountHistory setting={setting} />
        </>
      )}
    </section>
  );
}
