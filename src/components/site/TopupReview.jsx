'use client';
import { useState } from 'react';
import { api } from '../../lib/clientApi';
import { formatDateTime, formatVnd } from '../../lib/format';
import { PAYMENT_STATUS_LABELS } from '../../lib/payments';
import { useApiQuery } from '../../lib/useApiQuery';
import Modal from './Modal';
import './topup.css';

const FILTERS = [
  ['PENDING', 'Chờ đối soát'],
  ['APPROVED', 'Đã duyệt'],
  ['REJECTED', 'Đã từ chối'],
  ['', 'Tất cả'],
];

function queuePath(status, search) {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  if (search) {
    params.set('q', search);
  }
  const query = params.toString();
  return query ? `/admin/payments?${query}` : '/admin/payments';
}

const payerOf = (item) =>
  [item.userId?.fullName ?? 'Người dùng', item.userId?.email].filter(Boolean).join(' · ');

function statusLine(item) {
  return [
    PAYMENT_STATUS_LABELS[item.status] ?? item.status,
    item.status === 'PENDING' && item.expired ? 'Quá hạn' : '',
    item.createdAt ? `tạo ${formatDateTime(item.createdAt)}` : '',
    item.expiresAt ? `hạn ${formatDateTime(item.expiresAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function TopupReviewItem({ item, onDecide, onCopy }) {
  return (
    <article className="organizer-staff topup-review-item">
      <div>
        <h3 className={item.transferCode ? 'topup-code' : undefined}>
          {item.transferCode ?? 'Yêu cầu cũ (không có mã)'}
        </h3>
        <p>
          {formatVnd(item.amount)} · {payerOf(item)}
        </p>
        <small>{statusLine(item)}</small>
        {!item.transferCode && <small>{item.requestKey}</small>}
        {item.bankReference && <small>Mã GD ngân hàng: {item.bankReference}</small>}
        {item.reviewNote && <small>{item.reviewNote}</small>}
      </div>
      <div className="organizer-row-actions">
        {item.transferCode && (
          <button type="button" className="text-action" onClick={() => onCopy(item.transferCode)}>
            Sao chép mã
          </button>
        )}
        {item.status === 'PENDING' && (
          <>
            <button type="button" className="button-dark" onClick={() => onDecide('APPROVED')}>
              Xác nhận đã nhận tiền
            </button>
            <button type="button" className="quiet-button" onClick={() => onDecide('REJECTED')}>
              Từ chối
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function decisionBody(decision, form) {
  if (decision.status === 'REJECTED') {
    return { status: 'REJECTED', reviewNote: form.note };
  }
  return {
    status: 'APPROVED',
    bankReference: form.reference,
    receivedAmount: Number(form.received),
    reviewNote: form.note,
  };
}

function DecisionDialog({ decision, onClose, onDone }) {
  const { item, status } = decision;
  const approving = status === 'APPROVED';
  const [form, setForm] = useState({ reference: '', received: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/admin/payments/${item._id}/review`, {
        method: 'POST',
        body: JSON.stringify(decisionBody(decision, form)),
      });
      onDone();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={approving ? 'Xác nhận đã nhận tiền' : 'Từ chối lệnh nạp'}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <dl className="topup-summary">
          <div>
            <dt>Nội dung chuyển khoản cần khớp</dt>
            <dd>{item.transferCode ?? item.requestKey}</dd>
          </div>
          <div>
            <dt>Số tiền yêu cầu</dt>
            <dd>{formatVnd(item.amount)}</dd>
          </div>
          <div>
            <dt>Người nạp</dt>
            <dd>{payerOf(item)}</dd>
          </div>
        </dl>
        <div className="runner-fields">
          {approving && (
            <>
              <label className="field-wide">
                Mã giao dịch ngân hàng
                <input
                  required
                  minLength={3}
                  maxLength={200}
                  value={form.reference}
                  onChange={update('reference')}
                />
              </label>
              <label className="field-wide">
                Số tiền thực nhận (đ)
                <input
                  required
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={form.received}
                  onChange={update('received')}
                />
              </label>
            </>
          )}
          <label className="field-wide">
            Ghi chú / lý do
            <textarea
              required={!approving}
              maxLength={1000}
              value={form.note}
              onChange={update('note')}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="notice notice-error">
            {error}
          </p>
        )}
        <div className="form-bottom">
          <button className="button-primary" disabled={busy}>
            Lưu quyết định
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QueueList({ query, onDecide, onCopy }) {
  if (query.loading) {
    return <p role="status">Đang tải lệnh nạp...</p>;
  }
  const items = query.data?.payments ?? [];
  if (!items.length) {
    return <p className="runner-empty">Không có lệnh nạp phù hợp.</p>;
  }
  return (
    <div className="organizer-staff-list">
      {items.map((item) => (
        <TopupReviewItem
          key={item._id}
          item={item}
          onDecide={(status) => onDecide({ item, status })}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

/**
 * Super Admin queue for reconciling wallet top-ups against bank statements.
 * @returns {JSX.Element} The queue section.
 */
export default function TopupReview() {
  const [status, setStatus] = useState('PENDING');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState(null);
  const [copied, setCopied] = useState('');
  const query = useApiQuery(queuePath(status, search));

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(`Đã sao chép mã ${code}.`);
    } catch {
      setCopied('Không thể sao chép tự động. Hãy chọn và sao chép mã.');
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setSearch(draft.trim());
  }

  function handleDone() {
    setDecision(null);
    query.reload();
  }

  return (
    <section className="organizer-panel topup-review">
      <h2>Đối soát nạp ví</h2>
      <p className="organizer-hint">
        Tìm mã trong nội dung sao kê, kiểm tra đúng số tiền rồi mới xác nhận. Mã giao dịch ngân hàng
        không được dùng lại.
      </p>
      <div className="topup-queue-tools">
        <div className="runner-tabs" role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map(([value, label]) => (
            <button
              type="button"
              key={label}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form role="search" onSubmit={submitSearch}>
          <input
            aria-label="Tìm theo mã chuyển khoản"
            placeholder="VD: NAPK7M2Q9XA"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="quiet-button">
            Tìm
          </button>
        </form>
      </div>
      {copied && (
        <p role="status" className="copy-status">
          {copied}
        </p>
      )}
      {query.error && (
        <p role="alert" className="notice notice-error">
          {query.error.message}{' '}
          <button type="button" onClick={query.reload}>
            Thử lại
          </button>
        </p>
      )}
      <QueueList query={query} onDecide={setDecision} onCopy={copyCode} />
      {decision && (
        <DecisionDialog
          key={`${decision.item._id}-${decision.status}`}
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={handleDone}
        />
      )}
    </section>
  );
}
