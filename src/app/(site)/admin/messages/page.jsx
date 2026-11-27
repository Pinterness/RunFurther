'use client';
// /admin/messages (P15.2, P14): công tắc realtime và hàng chờ báo cáo tin nhắn, chỉ cho Super Admin. Để thành trang con riêng thay vì một tab
// trong /admin, vì /admin/page.jsx là file dùng chung (luật C7); liên kết từ /admin thêm sau khi Thắng đồng ý.
// Server vẫn tự chặn bằng requireSuperAdmin; kiểm tra ở đây chỉ để không hiện khung trống cho người không có quyền.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/clientApi';
import { loginHref } from '../../../../lib/communityClient';
import ChatAdmin from '../../../../components/site/chat/ChatAdmin';
import ChatRealtimeSwitch from '../../../../components/site/chat/ChatRealtimeSwitch';

const DENIED = 'Khu vực này chỉ dành cho Super Admin.';

export default function AdminMessagesPage() {
  const router = useRouter();
  const [state, setState] = useState('loading'), [error, setError] = useState('');
  const expired = () => router.replace(loginHref('/admin/messages'));
  const deny = () => { setState('denied'); setError(DENIED); };

  async function check() {
    setState('loading'); setError('');
    try {
      const { user } = await api('/auth/me');
      if (user.systemRole === 'SUPER_ADMIN') setState('allowed');
      else { setState('denied'); setError(DENIED); }
    } catch (failure) {
      if (failure.status === 401) expired();
      else { setState('error'); setError(failure.message); }
    }
  }
  useEffect(() => {
    if (!localStorage.getItem('rf_token')) { expired(); return; }
    check();
  }, []);

  return <div className="chat-shell">
    <div className="runner-page-heading chat-heading"><div><p className="section-index">Quản trị RunFurther</p><h1>Kiểm duyệt tin nhắn</h1></div><Link className="text-action" href="/admin">Về trang kiểm duyệt</Link></div>
    {state === 'loading' && <p className="chat-state" role="status">Đang kiểm tra quyền…</p>}
    {error && <p className="notice notice-error" role="alert">{error}{state === 'error' && <> <button type="button" onClick={check}>Thử lại</button></>}</p>}
    {state === 'allowed' && <>
      <ChatRealtimeSwitch onExpired={expired} onForbidden={deny} />
      <ChatAdmin onExpired={expired} onForbidden={deny} />
    </>}
  </div>;
}
