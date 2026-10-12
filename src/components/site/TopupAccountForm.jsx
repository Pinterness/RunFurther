'use client';
import { useState } from 'react';
import { api } from '../../lib/clientApi';
import { formatDateTime } from '../../lib/format';
import { useApiQuery } from '../../lib/useApiQuery';
import BankFields, { accountFields } from './BankFields';
import './topup.css';

const SETTINGS_PATH = '/admin/platform/topup-account';
const EMPTY_ACCOUNT = { bankBin: '', bankName: '', accountNo: '', accountName: '' };

const describeAccount = (account) =>
  account?.accountNo
    ? `${account.bankName} · ${account.accountNo} · ${account.accountName}`
    : 'Đã xóa tài khoản nhận';

function AccountEditor({ initialAccount, enabled, onSaved }) {
  const [account, setAccount] = useState({ ...EMPTY_ACCOUNT, ...initialAccount, bankTransferEnabled: enabled });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function saveAccount(body) {
    setBusy(true);
    setError('');
    try {
      const saved = await api(SETTINGS_PATH, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setAccount({ ...saved.account, bankTransferEnabled: saved.bankTransferEnabled });
      onSaved(saved);
      return saved;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={event => { event.preventDefault(); saveAccount({ bankAccountInfo: accountFields(account), bankTransferEnabled: account.bankTransferEnabled }); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <BankFields
        value={account}
        onChange={(patch) => setAccount((current) => ({ ...current, ...patch }))}
        title="Ngân hàng và số tài khoản"
        hint="Tắt nạp ví để ẩn tài khoản và QR với người dùng, giữ thông tin để bật lại. Xóa tài khoản nhận để thay bằng tài khoản khác."
        disableLabel="Tắt nạp ví"
        variant="topup"
        onAction={saveAccount}
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
      </fieldset>
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
                {describeAccount(entry.bankAccountInfo)} · {entry.bankTransferEnabled === false ? 'Đã tắt' : 'Đã bật'} · {entry.changedBy?.fullName ?? 'Không rõ'}{' '}
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
        ? 'Đã lưu và bật tài khoản nhận. Lệnh mới dùng tài khoản này.'
        : saved.account?.accountNo ? 'Đã tắt nạp ví và ẩn QR. Tài khoản được giữ để bật lại.' : 'Đã xóa tài khoản nhận. Bạn có thể thêm tài khoản khác.',
    );
    reload();
  }

  return (
    <section className="topup-account" aria-labelledby="topup-account-title">
      <h2 id="topup-account-title">Tài khoản nhận nạp ví</h2>
      <p className="organizer-hint">
        Người dùng chuyển tiền nạp ví vào tài khoản này. Mỗi lệnh nạp giữ tài khoản tại thời điểm
        tạo để đối soát. Khi tắt hoặc thay tài khoản, hướng dẫn chuyển tiền cũ được ẩn.
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
            enabled={setting.bankTransferEnabled ?? setting.configured}
            onSaved={handleSaved}
          />
          <AccountHistory setting={setting} />
        </>
      )}
    </section>
  );
}
