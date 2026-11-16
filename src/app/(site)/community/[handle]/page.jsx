'use client';
// /community/<handle> (spec 4.6): hồ sơ cộng đồng thật, thay cho trang dữ liệu giả cũ. Client component vì API cần token;
// Next 16 truyền params dạng Promise nên đọc bằng use(params). Mọi chữ đều hiện qua JSX nên HTML trong họ tên hay lời
// giới thiệu chỉ là chữ.
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RunnerAvatar from '../../../../components/site/RunnerAvatar';
import { api } from '../../../../lib/clientApi';
import { loginHref, memberSinceLabel } from '../../../../lib/communityClient';
import '../../../../components/site/community.css';

const BEST_TIME_ORDER = ['5K', '10K', '21K', '42K'];

export default function CommunityProfilePage({ params }) {
  const { handle } = use(params);
  const router = useRouter();
  const [profile, setProfile] = useState(null), [state, setState] = useState('loading'), [error, setError] = useState('');

  async function load() {
    setState('loading'); setError('');
    try {
      setProfile(await api('/community/profiles/' + encodeURIComponent(handle)));
      setState('ready');
    } catch (failure) {
      if (failure.status === 401) { router.replace(loginHref('/community/' + handle)); return; }
      if (failure.status === 404) { setState('missing'); return; }
      setError(failure.message); setState('error');
    }
  }
  useEffect(() => {
    if (!localStorage.getItem('rf_token')) { router.replace(loginHref('/community/' + handle)); return; }
    load();
  }, [handle]);

  let content;
  if (state === 'loading') content = <div className="runner-empty" role="status">Đang tải hồ sơ...</div>;
  else if (state === 'missing') content = <div className="runner-empty">
    <h1 className="community-missing">Không tìm thấy hồ sơ</h1>
    <p>Hồ sơ này không tồn tại hoặc đang ẩn.</p>
    <Link className="button-dark" href="/community">Về trang cộng đồng</Link>
  </div>;
  else if (state === 'error') content = <div role="alert" className="notice notice-error">{error} <button type="button" className="text-action" onClick={load}>Thử lại</button></div>;
  else content = <>
    <section className="runner-cover community-cover">
      <RunnerAvatar large name={profile.displayName} theme={profile.avatarTheme} />
      <div className="runner-identity">
        <p className="section-index">RUNFURTHER RUNNER</p>
        <h1 className="community-name">{profile.displayName}</h1>
        <p className="community-handle">@{profile.handle}</p>
        <small>Tham gia từ {memberSinceLabel(profile.memberSince)}</small>
      </div>
    </section>
    {profile.results && <section className="runner-metrics community-results" aria-label="Thành tích">
      <div><span>{profile.results.completedRaces}</span><small>Giải đã hoàn thành</small></div>
      <div><span>{profile.results.totalKm.toLocaleString('vi-VN')}<em> km</em></span><small>Quãng đường hoàn thành</small></div>
      {BEST_TIME_ORDER.filter(key => profile.results.bestTimes?.[key]).map(key => <div key={key}><span>{profile.results.bestTimes[key]}</span><small>Tốt nhất {key}</small></div>)}
    </section>}
    <dl className="community-details">
      <div><dt>Giới thiệu</dt><dd>{profile.bio || 'Người chạy này chưa viết lời giới thiệu.'}</dd></div>
      {profile.club && <div><dt>Câu lạc bộ</dt><dd>{profile.club}</dd></div>}
    </dl>
  </>;

  return <div className="runner-shell community-shell">
    <Link className="text-action community-back" href="/community">← Cộng đồng</Link>
    {content}
  </div>;
}
