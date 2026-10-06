'use client';
import { useRef, useState } from 'react';
import { api } from '../../lib/clientApi';
import { formatDateTime, formatVnd } from '../../lib/format';
import {
  DEFAULT_TOPUP_RULES,
  QUICK_TOPUP_AMOUNTS,
  TOPUP_RULE_CHANGE_CODES,
} from '../../lib/payments';
import TransferDetails from './TransferDetails';
import './topup.css';

function TopupForm({ rules, onCreated, onRulesChanged }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per attempt: a retry after a network error reuses it, so the server never opens twice.
  const idempotencyKey = useRef(null);
  const inFlight = useRef(false);
  const quickAmounts = QUICK_TOPUP_AMOUNTS.filter(
    (value) => value >= rules.minAmount && value <= rules.maxAmount,
  );

  function chooseAmount(value) {
    setAmount(String(value));
    idempotencyKey.current = null;
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const created = await api('/wallet/topup', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      idempotencyKey.current = null;
      setAmount('');
      onCreated(created);
    } catch (requestError) {
      setError(requestError.message);
      if (TOPUP_RULE_CHANGE_CODES.includes(requestError.code)) {
        onRulesChanged();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        Nhập số tiền để nhận mã chuyển khoản. Số dư chỉ được cộng sau khi quản trị viên xác nhận đã
        nhận tiền.
      </p>
      <form onSubmit={submit}>
        <input
          aria-label="Số tiền nạp (VND)"
          type="number"
          inputMode="numeric"
          min={rules.minAmount}
          max={rules.maxAmount}
          step="1"
          required
          value={amount}
          onChange={(event) => chooseAmount(event.target.value)}
        />
        <button className="button button-dark" disabled={busy}>
          Tạo lệnh nạp
        </button>
      </form>
      <div className="amount-chips" role="group" aria-label="Chọn nhanh số tiền">
        {quickAmounts.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={Number(amount) === value}
            onClick={() => chooseAmount(value)}
          >
            {formatVnd(value)}
          </button>
        ))}
      </div>
      <p className="topup-limits">
        Tối thiểu {formatVnd(rules.minAmount)}, tối đa {formatVnd(rules.maxAmount)}. Mã chuyển khoản
        có hiệu lực {rules.codeTtlHours} giờ.
      </p>
      {error && (
        <p role="alert" className="notice notice-error topup-error">
          {error}
        </p>
      )}
    </>
  );
}

function TopupRequestCard({ payment, open, onToggle }) {
  const transfer = payment.transfer ?? {};
  const expired = Boolean(transfer.expired);
  const expiry = payment.expiresAt
    ? `hạn ${formatDateTime(payment.expiresAt)}`
    : 'tạo trước khi có mã chuyển khoản';

  return (
    <article className="topup-request">
      <div className="topup-request-head">
        {payment.transferCode ? (
          <strong className="topup-code">{payment.transferCode}</strong>
        ) : (
          <strong>Yêu cầu cũ</strong>
        )}
        <span className="topup-state" data-state={expired ? 'expired' : 'pending'}>
          {expired ? 'Quá hạn' : 'Chờ đối soát'}
        </span>
      </div>
      <p className="topup-meta">
        {formatVnd(payment.amount)} · {expiry}
      </p>
      <div>
        <button type="button" className="quiet-button" aria-expanded={open} onClick={onToggle}>
          {open ? 'Ẩn hướng dẫn chuyển khoản' : 'Xem hướng dẫn chuyển khoản'}
        </button>
      </div>
      {open && (
        <TransferDetails
          variant="topup"
          bankInfo={transfer.bankInfo}
          amount={payment.amount}
          orderCode={payment.transferCode}
          qrUrl={transfer.vietQrUrl}
          expired={expired}
          expiresAt={transfer.expiresAt}
        />
      )}
    </article>
  );
}

/**
 * Top-up panel of the wallet page: the request form and the requests still waiting for money.
 * @param {object} props Component props.
 * @param {typeof DEFAULT_TOPUP_RULES} [props.rules] Rules from GET /api/wallet.
 * @param {object[]} props.payments Caller's payment requests from GET /api/wallet/payments.
 * @param {() => void} props.onChanged Reloads wallet data after a change.
 * @returns {JSX.Element} The panel.
 */
export default function WalletTopup({ rules = DEFAULT_TOPUP_RULES, payments, onChanged }) {
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const waiting = payments.filter(
    (payment) => payment.kind === 'TOPUP' && payment.status === 'PENDING',
  );

  function handleCreated(created) {
    setNotice(created.message);
    setOpenId(created.paymentRequest._id);
    onChanged();
  }

  return (
    <section className="panel topup-panel" aria-labelledby="topup-title">
      <h2 id="topup-title">Nạp tiền vào ví</h2>
      {rules.available ? (
        <TopupForm rules={rules} onCreated={handleCreated} onRulesChanged={onChanged} />
      ) : (
        <p role="status" className="notice">
          Nạp ví tạm đóng. Vui lòng quay lại sau hoặc gửi yêu cầu hỗ trợ.
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {waiting.length > 0 && (
        <div className="topup-requests">
          <h3>Lệnh nạp đang chờ</h3>
          {waiting.map((payment) => (
            <TopupRequestCard
              key={payment._id}
              payment={payment}
              open={openId === payment._id}
              onToggle={() => setOpenId(openId === payment._id ? null : payment._id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
