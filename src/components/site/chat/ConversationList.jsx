'use client';
// Danh sách cuộc trò chuyện của /messages: hai tab "Trò chuyện" và "Lời mời" (spec 4.3), mỗi dòng là một liên kết.
import RunnerAvatar from '../RunnerAvatar';
import { shortTime } from '../../../lib/chatClient';

const BOXES = [['chats', 'Trò chuyện'], ['invites', 'Lời mời']];

function previewOf(conversation) {
  const text = conversation.lastMessage?.text || '';
  return conversation.lastMessage?.mine ? 'Bạn: ' + text : text;
}

export default function ConversationList({ box, onBox, lists, selectedId, onOpen, onMore }) {
  const current = lists[box];
  // Số lời mời trên tab chỉ đếm những gì đã tải (tối đa 20 một trang), nên còn trang sau thì ghi "20+".
  const inviteCount = lists.invites.items.length ? lists.invites.items.length + (lists.invites.hasMore ? '+' : '') : '';
  function onTabKey(event) {
    // Tab theo mẫu WAI-ARIA: mũi tên trái/phải đổi tab, Home/End về đầu/cuối.
    const index = BOXES.findIndex(([key]) => key === box);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: BOXES.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const [key] = BOXES[(next + BOXES.length) % BOXES.length];
    onBox(key);
    document.getElementById('chat-tab-' + key)?.focus();
  }

  let body;
  if (current.loading && !current.items.length) body = <p className="chat-state" role="status">Đang tải cuộc trò chuyện…</p>;
  else if (current.error && !current.items.length) body = <div className="chat-state" role="alert"><p>{current.error}</p><button type="button" className="chat-link-button" onClick={() => onMore(box, true)}>Thử lại</button></div>;
  else if (!current.items.length) body = <div className="chat-state">
    <h2>{box === 'invites' ? 'Chưa có lời mời nào' : 'Chưa có cuộc trò chuyện nào'}</h2>
    <p>{box === 'invites' ? 'Khi một người chạy khác mời bạn nhắn tin, lời mời sẽ hiện ở đây.' : 'Mở hồ sơ của một người chạy trong Cộng đồng rồi bấm “Nhắn tin” để bắt đầu.'}</p>
  </div>;
  else body = <ul className="chat-list">
    {current.items.map(conversation => {
      const pendingInvite = conversation.isRequester && conversation.status !== 'ACTIVE';
      const label = `${conversation.other.displayName}${conversation.unread ? ', có tin chưa đọc' : ''}${pendingInvite ? ', đang chờ chấp nhận' : ''}`;
      return <li key={conversation.id}>
        <a className={'chat-row' + (conversation.unread ? ' is-unread' : '')} data-id={conversation.id} href={'/messages?c=' + encodeURIComponent(conversation.id)}
          aria-current={conversation.id === selectedId ? 'true' : undefined} aria-label={label}
          onClick={event => { event.preventDefault(); onOpen(conversation); }}>
          <span aria-hidden="true"><RunnerAvatar name={conversation.other.displayName} theme={conversation.other.avatarTheme} /></span>
          <span className="chat-row-main">
            <span className="chat-row-name">{conversation.other.displayName}</span>
            <span className="chat-row-preview">{pendingInvite ? 'Đang chờ chấp nhận' : previewOf(conversation)}</span>
          </span>
          <span className="chat-row-side">{shortTime(conversation.lastMessageAt)}{conversation.unread && <span className="chat-dot" aria-hidden="true" />}</span>
        </a>
      </li>;
    })}
  </ul>;

  return <section className="chat-panel chat-list-panel" aria-label="Danh sách cuộc trò chuyện">
    <div className="chat-tabs" role="tablist" aria-label="Hộp tin nhắn" onKeyDown={onTabKey}>
      {BOXES.map(([key, name]) => <button key={key} id={'chat-tab-' + key} type="button" role="tab" className="chat-tab"
        aria-selected={box === key} aria-controls="chat-tabpanel" tabIndex={box === key ? 0 : -1} onClick={() => onBox(key)}>
        {key === 'invites' && inviteCount ? `${name} (${inviteCount})` : name}
      </button>)}
    </div>
    <div id="chat-tabpanel" role="tabpanel" aria-labelledby={'chat-tab-' + box}>
      {body}
      {current.hasMore && <button type="button" className="chat-more" disabled={current.loading} onClick={() => onMore(box)}>{current.loading ? 'Đang tải…' : 'Xem thêm'}</button>}
    </div>
  </section>;
}
