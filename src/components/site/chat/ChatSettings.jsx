'use client';
// Phần "Tin nhắn" trong tab Cộng đồng của /account (P13.3, spec 4.7): bật nhắn tin qua màn hình đồng ý (ô không tick
// sẵn, gửi đúng phiên bản văn bản đồng ý), tắt nhắn tin, và danh sách người đã chặn kèm nút "Bỏ chặn".
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as chat from '../../../lib/chatClient';
import { loginHref } from '../../../lib/communityClient';
import RunnerAvatar from '../RunnerAvatar';
import './chat.css';

export default function ChatSettings() {
  const router = useRouter();
  const [me, setMe] = useState(null), [blocks, setBlocks] = useState([]);
  const [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');

  function fail(failure) {
    if (failure.status === 401) router.replace(loginHref('/account#community'));
    else setError(failure.message);
  }
  async function load() {
    setError('');
    try {
      const [mine, list] = await Promise.all([chat.chatMe(), chat.listBlocks()]);
      setMe(mine); setBlocks(list.blocks);
    } catch (failure) { fail(failure); }
  }
  useEffect(() => { load(); }, []);

  async function run(action, message) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); }
    catch (failure) { fail(failure); }
    finally { setBusy(false); }
  }
  const enable = () => run(async () => { setMe(await chat.giveChatConsent(me.consentText.version)); setAgreed(false); },
    'Đã bật nhắn tin. Bạn gửi được lời mời, và thành viên khác gửi được lời mời cho bạn.');
  const disable = () => run(async () => { await chat.withdrawChatConsent(); setMe(current => ({ ...current, consent: false })); },
    'Đã tắt nhắn tin. Bạn không gửi hay nhận tin mới nữa; tin cũ vẫn xem được.');
  const release = block => run(async () => { await chat.unblock(block.id); setBlocks(current => current.filter(item => item.id !== block.id)); },
    `Đã bỏ chặn ${block.displayName}.`);

  let body;
  if (!me) body = error ? <button type="button" className="button-dark" onClick={load}>Thử lại</button> : <p className="chat-state" role="status">Đang tải cài đặt tin nhắn…</p>;
  else if (!me.eligible) body = <p className="notice">Nhắn tin chỉ dành cho người đủ 16 tuổi, tính theo ngày sinh trong hồ sơ người chạy.</p>;
  else if (me.consent) body = <div className="chat-settings-on">
    <p>Nhắn tin đang bật. Bạn xem các cuộc trò chuyện ở trang <Link href="/messages">Tin nhắn</Link>.</p>
    {me.locked && <p className="notice notice-error">Quyền nhắn tin của bạn đang bị khóa. Bạn vẫn đọc được các cuộc trò chuyện đã có.</p>}
    <button type="button" className="quiet-button" disabled={busy} onClick={disable}>Tắt nhắn tin</button>
  </div>;
  else body = <form className="community-form" onSubmit={event => { event.preventDefault(); if (agreed) enable(); }}>
    <p className="community-consent-text">{me.consentText.text}</p>
    <label className="community-check community-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>Cho phép thành viên gửi lời mời nhắn tin cho tôi</span></label>
    <div className="form-bottom"><button className="button-primary" disabled={!agreed || busy}>{busy ? 'Đang bật…' : 'Bật nhắn tin'}</button></div>
  </form>;

  return <section className="community-settings chat-settings" aria-labelledby="chat-settings-title">
    <div className="section-heading"><h2 id="chat-settings-title">Tin nhắn</h2><p>Nhắn tin riêng với những người chạy khác qua lời mời. Bạn chặn được bất kỳ ai, và người bị chặn không được báo.</p></div>
    {error && me && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {body}
    <h3 className="chat-blocks-title">Người bạn đã chặn</h3>
    {blocks.length
      ? <ul className="chat-blocks">{blocks.map(block => <li key={block.id}>
        <span aria-hidden="true"><RunnerAvatar name={block.displayName} theme={block.avatarTheme} /></span>
        <span className="chat-blocks-name">{block.displayName}</span>
        <button type="button" className="chat-button-ghost" disabled={busy} onClick={() => release(block)}>Bỏ chặn</button>
      </li>)}</ul>
      : <p className="chat-state">Bạn chưa chặn ai.</p>}
  </section>;
}
