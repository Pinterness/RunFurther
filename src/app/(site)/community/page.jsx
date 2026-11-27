'use client';
// /community (spec 4.6): lưới hồ sơ cộng đồng mới nhất, tìm được theo tên, chỉ cho thành viên đã đăng nhập.
// Client component vì cần token.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RunnerAvatar from '../../../components/site/RunnerAvatar';
import { api } from '../../../lib/clientApi';
import { loginHref, memberSinceLabel } from '../../../lib/communityClient';
import '../../../components/site/community.css';

const QUERY_MAX = 60;

export default function CommunityPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState(''), [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  // Mỗi lần tải có một số thứ tự; phản hồi của lần tải cũ (ví dụ lần tìm trước) về muộn thì bỏ qua. Rời trang cũng
  // tăng số này, để một lỗi 401 về muộn không kéo người dùng đang ở trang khác sang trang đăng nhập.
  const latest = useRef(0);
  // Lần tải gần nhất, để "Thử lại" gửi lại đúng trang và từ khóa vừa hỏng.
  const lastAttempt = useRef({ next: 1, q: '' });

  async function load(next, q) {
    const id = ++latest.current;
    lastAttempt.current = { next, q };
    setLoading(true); setError('');
    try {
      const data = await api('/community/profiles?page=' + next + (q ? '&q=' + encodeURIComponent(q) : ''));
      if (id !== latest.current) return;
      // Hồ sơ mới bật giữa hai lần tải làm danh sách dịch xuống, nên bỏ hồ sơ đã có để không hiện trùng.
      setProfiles(current => (next === 1 ? data.profiles : [...current, ...data.profiles.filter(item => !current.some(shown => shown.handle === item.handle))]));
      setPage(next); setHasMore(data.hasMore); setQuery(q);
    } catch (failure) {
      if (id !== latest.current) return;
      if (failure.status === 401) router.replace(loginHref('/community'));
      else setError(failure.message);
    } finally { if (id === latest.current) setLoading(false); }
  }
  useEffect(() => {
    if (!localStorage.getItem('rf_token')) { router.replace(loginHref('/community')); return; }
    load(1, '');
    return () => { latest.current += 1; };
  }, []);
  function showAll() { setDraft(''); load(1, ''); }

  let content;
  if (loading && !profiles.length) content = <div className="runner-empty" role="status">Đang tải hồ sơ cộng đồng...</div>;
  else if (!profiles.length && !error && query) content = <div className="runner-empty">
    <h2>Không tìm thấy người chạy nào khớp “{query}”</h2>
    <p>Thử gõ ít chữ hơn, ví dụ chỉ tên. Gõ có dấu hay không dấu đều được.</p>
  </div>;
  else if (!profiles.length && !error) content = <div className="runner-empty">
    <span className="empty-track" aria-hidden="true">RUN TOGETHER</span>
    <h2>Chưa có ai bật hồ sơ cộng đồng</h2>
    <p>Bật hồ sơ để những người chạy khác tìm thấy bạn. Bạn chọn thông tin nào được hiện và tắt lúc nào cũng được.</p>
    <Link className="button-dark" href="/account#community">Bật hồ sơ của bạn</Link>
  </div>;
  else content = <ul className="community-grid">
    {profiles.map(profile => <li key={profile.handle}>
      <Link className="community-card" href={'/community/' + profile.handle}>
        <RunnerAvatar name={profile.displayName} theme={profile.avatarTheme} />
        <span className="community-card-name">{profile.displayName}</span>
        <span className="community-card-handle">@{profile.handle}</span>
        {profile.bio && <span className="community-card-bio">{profile.bio}</span>}
        <small>Tham gia từ {memberSinceLabel(profile.memberSince)}</small>
      </Link>
    </li>)}
  </ul>;

  return <div className="runner-shell community-shell">
    <div className="runner-page-heading"><div><p className="section-index">Cộng đồng RunFurther</p><h1>Những người chạy cùng bạn.</h1></div><Link className="text-action" href="/account#community">Hồ sơ cộng đồng của bạn</Link></div>
    <p className="community-lead">Chỉ thành viên đã đăng nhập mới xem được trang này. Mỗi người tự bật hồ sơ của mình, tự chọn có hiện câu lạc bộ và thành tích hay không, và tắt lúc nào cũng được.</p>
    <form className="community-search" role="search" onSubmit={event => { event.preventDefault(); load(1, draft.trim()); }}>
      <label htmlFor="community-q">Tìm theo tên</label>
      <input id="community-q" type="search" maxLength={QUERY_MAX} placeholder="Ví dụ: Nguyễn Văn An" value={draft} onChange={event => setDraft(event.target.value)} />
      <button className="button-dark">Tìm</button>
      {query && <button type="button" className="text-action" onClick={showAll}>Xem tất cả</button>}
    </form>
    {error && <div role="alert" className="notice notice-error">{error} <button type="button" className="text-action" onClick={() => load(lastAttempt.current.next, lastAttempt.current.q)}>Thử lại</button></div>}
    {content}
    {hasMore && <div className="community-more"><button type="button" className="quiet-button" onClick={() => load(page + 1, query)} disabled={loading}>{loading ? 'Đang tải...' : 'Xem thêm'}</button></div>}
  </div>;
}
