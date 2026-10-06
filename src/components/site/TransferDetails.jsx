'use client';
import { useState } from 'react';
import { formatDateTime, formatVnd } from '../../lib/format';

// Wording per use: ticket payments go to the race organiser, top-ups go to RunFurther.
const COPY = {
  ticket: {
    heading: 'Chuyển khoản cho chủ giải',
    qrAlt: 'QR chuyển khoản tiền vé',
    previewHint: 'QR xem trước · Không dùng để mua vé',
    source: 'Tên hiển thị ở đây do chủ giải cung cấp.',
    afterTransfer:
      'Chuyển đúng số tiền và nội dung. Vé chỉ được cấp sau khi chủ giải xác nhận đã nhận tiền.',
    expired: (code) =>
      `Đơn đã hết hạn giữ chỗ. Không chuyển khoản theo mã này. Nếu đã chuyển tiền, hãy liên hệ chủ giải và cung cấp mã đơn ${code} để đối soát.`,
    unavailable: (amount) =>
      amount === 0
        ? 'Đơn miễn phí, không cần chuyển khoản.'
        : 'Chuyển khoản chưa khả dụng cho đơn này. Bạn có thể thanh toán bằng ví hoặc liên hệ chủ giải.',
  },
  topup: {
    heading: 'Chuyển khoản vào ví RunFurther',
    qrAlt: 'QR chuyển khoản nạp ví',
    previewHint: 'QR xem trước · Không dùng để nạp ví',
    source: 'Tài khoản nhận do RunFurther cấu hình.',
    afterTransfer:
      'Chuyển đúng số tiền và nội dung. Số dư chỉ được cộng sau khi quản trị viên xác nhận đã nhận tiền.',
    expired: (code) =>
      `Mã đã hết hạn. Không chuyển khoản theo mã này. Nếu đã chuyển tiền, hãy gửi yêu cầu hỗ trợ kèm mã ${code}. Chưa chuyển thì tạo lệnh nạp mới.`,
    unavailable: () =>
      'Lệnh nạp này không có thông tin chuyển khoản. Nếu bạn đã chuyển tiền, hãy gửi yêu cầu hỗ trợ để được đối soát.',
  },
};
const COPYABLE_ROWS = new Set(['Số tài khoản', 'Số tiền', 'Nội dung chuyển khoản']);

function QrImage({ qrUrl, alt, hint }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setFailedUrl(null);
    setAttempt((count) => count + 1);
  }

  return (
    <div className="transfer-qr">
      {failedUrl === qrUrl ? (
        <div className="qr-unavailable">
          <p>Chưa tải được ảnh QR. Bạn vẫn có thể chuyển khoản bằng thông tin bên cạnh.</p>
          <button type="button" className="quiet-button" onClick={retry}>
            Tải lại QR
          </button>
        </div>
      ) : (
        // VietQR serves a dynamic PNG from another domain; next/image adds nothing for a QR code.
        <img
          key={`${qrUrl}#${attempt}`}
          src={qrUrl}
          width="270"
          height="320"
          alt={alt}
          onError={() => setFailedUrl(qrUrl)}
          referrerPolicy="no-referrer"
        />
      )}
      <small>{hint}</small>
    </div>
  );
}

export default function TransferDetails({
  bankInfo,
  amount,
  orderCode,
  qrUrl,
  expired = false,
  preview = false,
  variant = 'ticket',
  expiresAt,
}) {
  const [message, setMessage] = useState('');
  const copy = COPY[variant] ?? COPY.ticket;

  if (expired) {
    return (
      <p role="status" className="notice notice-error">
        {copy.expired(orderCode)}
      </p>
    );
  }
  if (!bankInfo || !qrUrl) {
    return <p className="notice">{copy.unavailable(amount)}</p>;
  }

  async function copyValue(value, label) {
    try {
      await navigator.clipboard.writeText(String(value));
      setMessage(`Đã sao chép ${label.toLowerCase()}.`);
    } catch {
      setMessage('Không thể sao chép tự động. Bạn có thể chọn và sao chép thông tin bên dưới.');
    }
  }

  const rows = [
    ['Ngân hàng', bankInfo.bankName, bankInfo.bankName],
    ['Số tài khoản', bankInfo.accountNo, bankInfo.accountNo],
    ['Chủ tài khoản', bankInfo.accountName, bankInfo.accountName],
    ['Số tiền', formatVnd(amount), amount],
    ['Nội dung chuyển khoản', orderCode, orderCode],
  ];

  return (
    <div className="transfer-details">
      <QrImage
        qrUrl={qrUrl}
        alt={preview ? 'QR xem trước tài khoản nhận tiền' : copy.qrAlt}
        hint={preview ? copy.previewHint : 'Quét mã bằng ứng dụng ngân hàng'}
      />
      <div className="transfer-copy">
        <h3>{preview ? 'Kiểm tra tài khoản nhận tiền' : copy.heading}</h3>
        <dl>
          {rows.map(([label, text, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <span>{text}</span>
                {COPYABLE_ROWS.has(label) && (
                  <button
                    type="button"
                    className="text-action"
                    aria-label={`Sao chép ${label.toLowerCase()}`}
                    onClick={() => copyValue(value, label)}
                  >
                    Sao chép
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="transfer-note">
          Kiểm tra tên người nhận trong ứng dụng ngân hàng trước khi chuyển. {copy.source}
        </p>
        {!preview && <p className="transfer-note">{copy.afterTransfer}</p>}
        {!preview && variant === 'topup' && expiresAt && (
          <p className="transfer-note">Mã có hiệu lực đến {formatDateTime(expiresAt)}.</p>
        )}
        <p role="status" className="copy-status">
          {message}
        </p>
      </div>
    </div>
  );
}
