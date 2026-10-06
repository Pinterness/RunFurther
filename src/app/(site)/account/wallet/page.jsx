'use client';
import { useCallback, useEffect } from 'react';
import Link from 'next/link';
import WalletTopup from '../../../../components/site/WalletTopup';
import { formatDateTime, formatVnd } from '../../../../lib/format';
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from '../../../../lib/payments';
import { useApiQuery } from '../../../../lib/useApiQuery';

const POLL_INTERVAL_MS = 15_000;
const LEDGER_LABELS = { TOPUP: 'Nạp ví', REGISTRATION: 'Thanh toán vé' };

// Legacy requests have no code or expiry, so they never stop "waiting": do not poll for them.
const isWaitingTopup = (payment) =>
  payment.kind === 'TOPUP' &&
  payment.status === 'PENDING' &&
  Boolean(payment.transferCode) &&
  !payment.transfer?.expired;

function useWalletData() {
  const summary = useApiQuery('/wallet');
  const ledger = useApiQuery('/wallet/ledger');
  const payments = useApiQuery('/wallet/payments');
  const { reload: reloadSummary } = summary;
  const { reload: reloadLedger } = ledger;
  const { reload: reloadPayments } = payments;
  const refresh = useCallback(() => {
    reloadSummary();
    reloadLedger();
    reloadPayments();
  }, [reloadSummary, reloadLedger, reloadPayments]);
  return {
    summary: summary.data,
    entries: ledger.data?.ledger ?? [],
    payments: payments.data?.payments ?? [],
    error: summary.error ?? ledger.error ?? payments.error,
    refresh,
  };
}

// Refreshes while a top-up waits for the admin, so the new balance appears without a reload.
function usePolling(enabled, refresh) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);
}

function SignedOut() {
  return (
    <div className="page wallet-page">
      <h1 className="page-title">Ví của tôi</h1>
      <p role="status" className="notice">
        Vui lòng đăng nhập để xem ví.
      </p>
      <Link className="text-action" href="/login?next=%2Faccount%2Fwallet">
        Đăng nhập
      </Link>
    </div>
  );
}

function BalanceCard({ summary }) {
  return (
    <section className="balance-card">
      <span>Số dư khả dụng</span>
      <strong>{summary ? formatVnd(summary.wallet.balance) : '—'}</strong>
      <span>{summary?.runPoints.balance ?? 0} RunPoints</span>
    </section>
  );
}

function LedgerList({ entries }) {
  if (!entries.length) {
    return <p>Chưa có giao dịch.</p>;
  }
  return entries.map((entry) => (
    <div className="transaction-row" key={entry._id}>
      <span>
        {LEDGER_LABELS[entry.referenceType] ?? entry.referenceType} ·{' '}
        {formatDateTime(entry.createdAt)}
      </span>
      <strong>
        {entry.type === 'CREDIT' ? '+' : '−'}
        {formatVnd(entry.amount)}
      </strong>
    </div>
  ));
}

function PaymentHistory({ payments }) {
  const history = payments.filter(
    (payment) => !(payment.kind === 'TOPUP' && payment.status === 'PENDING'),
  );
  if (!history.length) {
    return <p>Chưa có yêu cầu thanh toán nào được xử lý.</p>;
  }
  return history.map((payment) => (
    <p key={payment._id}>
      {[
        PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind,
        formatVnd(payment.amount),
        payment.transferCode,
        PAYMENT_STATUS_LABELS[payment.status] ?? payment.status,
        payment.reviewNote,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  ));
}

export default function WalletPage() {
  const { summary, entries, payments, error, refresh } = useWalletData();
  usePolling(payments.some(isWaitingTopup), refresh);

  if (error?.status === 401) {
    return <SignedOut />;
  }

  return (
    <div className="page wallet-page">
      <h1 className="page-title">Ví của tôi</h1>
      {error && (
        <p role="alert" className="notice notice-error">
          {error.message}{' '}
          <button type="button" onClick={refresh}>
            Thử lại
          </button>
        </p>
      )}
      <div className="split">
        <BalanceCard summary={summary} />
        <WalletTopup rules={summary?.topup} payments={payments} onChanged={refresh} />
      </div>
      <section className="section panel">
        <h2>Lịch sử giao dịch</h2>
        <LedgerList entries={entries} />
        <h2>Yêu cầu thanh toán đã xử lý</h2>
        <PaymentHistory payments={payments} />
        <button type="button" className="quiet-button" onClick={refresh}>
          Cập nhật
        </button>
      </section>
    </div>
  );
}
