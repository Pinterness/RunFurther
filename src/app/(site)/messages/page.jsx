'use client';
// /messages (spec 4.3, plan Task 13.2): danh sách cuộc trò chuyện (Trò chuyện / Lời mời) và khung chat của cuộc đang mở.
// Client component vì cần token. Danh sách tự làm mới 30 giây một lần khi tab đang hiện; khung chat tự hỏi tin mới
// 5 giây một lần (ChatThread). Sửa theo phản biện 26-11: bỏ phản hồi danh sách cũ, mở liên kết ?c= qua API, giữ focus.
// P14: khi công tắc realtime bật, trang nối Socket.IO; đang nối thì tắt cả hai nhịp polling, nhận tín hiệu thì làm mới
// danh sách và lấy tin của khung đang mở. Mất socket thì polling tự chạy lại.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConversationList from '../../../components/site/chat/ConversationList';
import ChatThread from '../../../components/site/chat/ChatThread';
import * as chat from '../../../lib/chatClient';
import { loginHref } from '../../../lib/communityClient';
import '../../../components/site/chat/chat.css';

const LIST_POLL_MS = 30000;
const emptyList = () => ({ items: [], hasMore: false, loading: true, error: '' });

export default function MessagesPage() {
  const router = useRouter();
  const [box, setBox] = useState('chats');
  const [lists, setLists] = useState({ chats: emptyList(), invites: emptyList() });
  const [selected, setSelected] = useState(null);
  const [openedByUser, setOpenedByUser] = useState(false);
  const [notice, setNotice] = useState('');
  const [me, setMe] = useState(null);
  // Công tắc realtime theo server (GET /chat/me và mỗi lần tải danh sách), và số lần cần lấy bù của khung đang mở.
  const [realtime, setRealtime] = useState(false);
  const [syncKey, setSyncKey] = useState(0);
  const alive = useRef(true);
  const selectedRef = useRef(null);
  selectedRef.current = selected;
  // Số thứ tự request của từng hộp: phản hồi của lần tải cũ về muộn (ví dụ lượt làm mới 30 giây chạy trước lúc bấm
  // "Chấp nhận") thì bỏ qua, không ghi đè dữ liệu mới.
  const latest = useRef({ chats: 0, invites: 0 });
  const itemsRef = useRef({ chats: [], invites: [] });

  function expired() {
    alive.current = false;
    router.replace(loginHref('/messages'));
  }

  async function load(which, reset = true) {
    const ticket = ++latest.current[which];
    setLists(current => ({ ...current, [which]: { ...current[which], loading: true, error: '' } }));
    try {
      const items = itemsRef.current[which];
      const data = await chat.listConversations(which, reset || !items.length ? undefined : items[items.length - 1]);
      if (!alive.current || ticket !== latest.current[which]) return;
      if (typeof data.realtime === 'boolean') setRealtime(data.realtime);
      const merged = reset ? data.conversations : [...items, ...data.conversations.filter(item => !items.some(shown => shown.id === item.id))];
      itemsRef.current[which] = merged;
      setLists(current => ({ ...current, [which]: { items: merged, hasMore: data.hasMore, loading: false, error: '' } }));
      // Giữ cuộc đang mở khớp với dữ liệu mới (unread, tin cuối).
      setSelected(current => (current ? data.conversations.find(item => item.id === current.id) ?? current : current));
    } catch (error) {
      if (!alive.current || ticket !== latest.current[which]) return;
      if (error.status === 401) expired();
      else setLists(current => ({ ...current, [which]: { ...current[which], loading: false, error: error.message } }));
    }
  }
  const refresh = () => { load('chats'); load('invites'); };
  const live = chat.useChatSocket({
    enabled: realtime,
    onConnect: () => { refresh(); setSyncKey(key => key + 1); },
    // Server chủ động ngắt: coi như realtime tắt tới lần tải danh sách kế tiếp (30 giây), lúc đó server cho biết công
    // tắc đang bật hay tắt.
    onServerClose: () => setRealtime(false),
    onSignal: ({ conversationId }) => {
      refresh();
      chat.notifyChatChanged();
      if (selectedRef.current?.id === conversationId) setSyncKey(key => key + 1);
    },
  });
  const liveRef = useRef(false);
  liveRef.current = live;

  useEffect(() => {
    if (!localStorage.getItem('rf_token')) { router.replace(loginHref('/messages')); return undefined; }
    alive.current = true;
    chat.chatMe().then(data => { if (alive.current) { setMe(data); setRealtime(data.realtime === true); } }).catch(error => { if (error.status === 401) expired(); });
    refresh();
    // Mở thẳng một cuộc từ liên kết /messages?c=<id> (ví dụ từ nút "Nhắn tin" ở P13.3), kể cả cuộc không nằm ở trang
    // đầu hay cuộc người nhận đã từ chối.
    const wanted = new URLSearchParams(window.location.search).get('c');
    if (wanted) {
      chat.getConversation(wanted).then(data => {
        if (!alive.current) return;
        setSelected(data.conversation);
        if (data.conversation.status === 'REQUEST' && !data.conversation.isRequester) setBox('invites');
      }).catch(error => {
        if (!alive.current) return;
        if (error.status === 401) expired();
        else { setNotice('Không tìm thấy cuộc trò chuyện này.'); window.history.replaceState(null, '', '/messages'); }
      });
    }
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !liveRef.current) refresh(); }, LIST_POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);

  function open(conversation) {
    setNotice('');
    setOpenedByUser(true);
    setSelected(conversation);
    window.history.replaceState(null, '', '/messages?c=' + encodeURIComponent(conversation.id));
  }
  // Quay lại danh sách: focus về đúng dòng vừa mở (hoặc tab đang chọn nếu dòng đó đã rời hộp).
  function back(returnTo = selected?.id) {
    setSelected(null);
    window.history.replaceState(null, '', '/messages');
    requestAnimationFrame(() => {
      const row = returnTo && document.querySelector(`.chat-row[data-id="${CSS.escape(returnTo)}"]`);
      (row || document.getElementById('chat-tab-' + box))?.focus();
    });
  }
  // Sau khi chấp nhận, từ chối hay chặn: cập nhật cuộc đang mở rồi tải lại hai hộp.
  function changed(updated) {
    if (!updated || updated.status === 'DECLINED') back(null);
    else { setSelected(updated); if (updated.status === 'ACTIVE') setBox('chats'); }
    refresh();
  }

  let gate = null;
  if (me && !me.eligible) gate = <p className="notice">Bạn cần đủ 16 tuổi và có ngày sinh trong <Link href="/account">Hồ sơ người chạy</Link> để nhắn tin. Bạn vẫn đọc được các cuộc trò chuyện đã có.</p>;
  else if (me?.locked) gate = <p className="notice notice-error">Quyền nhắn tin của bạn đang bị khóa. Bạn vẫn đọc được các cuộc trò chuyện đã có.</p>;
  else if (me && !me.consent) gate = <p className="notice">Bạn cần bật “Cho phép nhắn tin” trong <Link href="/account#community">tab Cộng đồng</Link> trước khi gửi tin.</p>;

  return <div className="chat-shell">
    <div className="runner-page-heading chat-heading"><div><p className="section-index">Tin nhắn RunFurther</p><h1>Tin nhắn</h1></div><Link className="text-action" href="/community">Tìm người chạy trong Cộng đồng</Link></div>
    {gate}
    {notice && <p className="notice notice-error" role="alert">{notice}</p>}
    <div className={'chat-layout' + (selected ? ' has-open' : '')}>
      <ConversationList box={box} onBox={setBox} lists={lists} selectedId={selected?.id} onOpen={open}
        onMore={(which, reset) => load(which, Boolean(reset))} />
      {selected
        ? <ChatThread key={selected.id} conversation={selected} live={live} syncKey={syncKey} onChanged={changed} onBack={() => back()} onExpired={expired} focusOnOpen={openedByUser} />
        : <section className="chat-panel chat-thread" aria-label="Khung trò chuyện"><div className="chat-empty-thread"><p>Chọn một cuộc trò chuyện để xem tin nhắn.</p></div></section>}
    </div>
  </div>;
}
