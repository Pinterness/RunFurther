'use client';
// Thẻ lời mời nhắn tin (người nhận thấy): tin đầu của người mời và ba lựa chọn Chấp nhận / Từ chối / Chặn.
// Chặn phải xác nhận ngay trong trang (khung app không hiện hộp confirm của trình duyệt); focus chuyển vào hộp xác nhận
// rồi trả về nút "Chặn" khi người dùng đổi ý.
import { useRef, useState } from 'react';

export default function InviteCard({ conversation, firstText, busy, onAccept, onDecline, onBlock }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef(null), blockRef = useRef(null);
  const name = conversation.other.displayName;
  function ask() { setConfirming(true); requestAnimationFrame(() => confirmRef.current?.focus()); }
  function cancel() { setConfirming(false); requestAnimationFrame(() => blockRef.current?.focus()); }
  return <article className="chat-invite" aria-label={'Lời mời nhắn tin từ ' + name}>
    <div className="chat-invite-who">{name} muốn nhắn tin với bạn</div>
    {firstText && <p className="chat-invite-first">{firstText}</p>}
    {confirming
      ? <div className="chat-confirm" role="group" aria-labelledby="chat-invite-block-question" tabIndex={-1} ref={confirmRef}>
        <p id="chat-invite-block-question">Chặn {name}? Người này sẽ không nhắn được cho bạn nữa và lời mời này biến mất. Họ không nhận được thông báo nào.</p>
        <div className="chat-invite-actions">
          <button type="button" className="chat-button-danger" disabled={busy} onClick={onBlock}>Xác nhận chặn</button>
          <button type="button" className="chat-button-ghost" onClick={cancel}>Không chặn</button>
        </div>
      </div>
      : <div className="chat-invite-actions">
        <button type="button" className="button-primary" disabled={busy} onClick={onAccept}>Chấp nhận</button>
        <button type="button" className="chat-button-ghost" disabled={busy} onClick={onDecline}>Từ chối</button>
        <button type="button" className="chat-block" ref={blockRef} disabled={busy} onClick={ask}>Chặn</button>
      </div>}
  </article>;
}
