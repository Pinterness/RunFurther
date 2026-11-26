'use client';
// Hộp soạn lời mời nhắn tin trên trang hồ sơ cộng đồng (P13.3): tin đầu tiên gửi kèm lời mời. Gửi xong mở /messages
// đúng cuộc vừa tạo; hai người đã có cuộc (409 kèm conversationId) thì mở cuộc đó. Người nhận không đạt điều kiện thì
// chỉ báo "Không gửi được lời mời.", không nói lý do (spec T9). Mất mạng thì gửi lại bằng đúng mã cũ.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as chat from '../../../lib/chatClient';
import { loginHref } from '../../../lib/communityClient';
import './chat.css';

const TEXT_MAX = 1000;

export default function InviteComposer({ handle, name, onCancel }) {
  const router = useRouter();
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Một mã cho mỗi lần mở hộp: bấm gửi lại sau khi mất mạng dùng đúng mã này, server không tạo lời mời thứ hai.
  const [clientMessageId] = useState(() => chat.newClientMessageId());
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true); setError('');
    try {
      const data = await chat.sendInvite(handle, message, clientMessageId);
      chat.notifyChatChanged();
      router.push('/messages?c=' + encodeURIComponent(data.conversation.id));
    } catch (failure) {
      setBusy(false);
      if (failure.status === 401) { router.replace(loginHref('/community/' + handle)); return; }
      if (failure.code === 'CHAT_CONVERSATION_EXISTS' && failure.data?.conversationId) {
        router.push('/messages?c=' + encodeURIComponent(failure.data.conversationId));
        return;
      }
      if (failure.code === 'CHAT_TARGET_NOT_FOUND') setError('Không gửi được lời mời.');
      else if (!failure.status) setError('Chưa gửi được vì mất kết nối. Bạn bấm gửi lại nhé.');
      else setError(failure.message);
    }
  }

  return <form className="chat-invite-composer" onSubmit={submit} aria-labelledby="invite-composer-title">
    <h2 id="invite-composer-title">Gửi lời mời nhắn tin tới {name}</h2>
    <p className="chat-invite-help">Lời mời đi kèm tin đầu tiên của bạn. {name} trả lời được sau khi chấp nhận lời mời; trước đó bạn chưa gửi thêm tin được.</p>
    <label htmlFor="invite-text">Tin nhắn đầu tiên</label>
    <textarea id="invite-text" ref={inputRef} rows={3} maxLength={TEXT_MAX} value={text} onChange={event => setText(event.target.value)}
      placeholder="Ví dụ: Chào bạn, mình cũng chạy 21K Hà Nội, bạn có muốn tập chung không?" />
    {error && <p className="chat-error" role="alert">{error}</p>}
    <div className="chat-invite-actions">
      <button type="submit" className="button-primary" disabled={busy || !text.trim()}>{busy ? 'Đang gửi…' : 'Gửi lời mời'}</button>
      <button type="button" className="chat-button-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
    </div>
  </form>;
}
