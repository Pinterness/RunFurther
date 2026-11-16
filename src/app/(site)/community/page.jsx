'use client';
// /community (spec 4.6): lưới hồ sơ cộng đồng mới nhất, chỉ cho thành viên đã đăng nhập. Client component vì cần token.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RunnerAvatar from '../../../components/site/RunnerAvatar';
import { api } from '../../../lib/clientApi';
import { loginHref, memberSinceLabel } from '../../../lib/communityClient';
import '../../../components/site/community.css';

export default function CommunityPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');

  async function load(next) {
    setLoading(true); setError('');
    try {
      const data = await api('/community/profiles?page=' + next);
      // Hồ sơ mới bật giữa hai lần tải làm danh sách dịch xuống, nên bỏ hồ sơ đã có để không hiện trùng.
      setProfiles(current => (next === 1 ? data.profiles : [...current, ...data.profiles.filter(item => !current.some(shown => shown.handle === item.handle))]));
      setPage(next); setHasMore(data.hasMore);
    } catch (failure) {
      if (failure.status === 401) router.replace(loginHref('/community'));
      else setError(failure.message);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    if (!localStorage.getItem('rf_token')) { router.replace(loginHref('/community')); return; }
    load(1);
  }, []);

  let content;
  if (loading && !profiles.length) content = <div className="runner-empty" role="status">Đang tải hồ sơ cộng đồng...</div>;
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
        <small>Tham gia {memberSinceLabel(profile.memberSince)}</small>
      </Link>
    </li>)}
  </ul>;

  return <div className="runner-shell community-shell">
    <div className="runner-page-heading"><div><p className="section-index">CỘNG ĐỒNG RUNFURTHER</p><h1>Những người chạy cùng bạn.</h1></div><Link className="text-action" href="/account#community">Hồ sơ cộng đồng của bạn ↗</Link></div>
    <p className="community-lead">Chỉ thành viên đã đăng nhập mới xem được trang này. Mỗi người tự bật hồ sơ của mình và tắt lúc nào cũng được.</p>
    {error && <div role="alert" className="notice notice-error">{error} <button type="button" className="text-action" onClick={() => load(1)}>Thử lại</button></div>}
    {content}
    {hasMore && <div className="community-more"><button type="button" className="quiet-button" onClick={() => load(page + 1)} disabled={loading}>{loading ? 'Đang tải...' : 'Xem thêm'}</button></div>}
  </div>;
}
