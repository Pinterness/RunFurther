'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nextPath, rememberUser } from '../../../lib/clientApi';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState('/account');
  useEffect(() => { setDestination(nextPath()); }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Đăng nhập không thành công.');
      }

      rememberUser(data.user, data.token);
      router.push(nextPath());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="runner-onboarding login-page">
      <aside className="onboarding-story">
        <p className="section-index">RUNFURTHER / TIẾP TỤC HÀNH TRÌNH</p>
        <h2 className="login-story-title">Đường chạy mới.<br />Vẫn là bạn.</h2>
        <p>Những tấm vé, cột mốc và thử thách tiếp theo đang chờ. Bắt đầu từ nơi bạn đã dừng lại.</p>
        <div className="onboarding-track" aria-hidden="true"><span>01</span><i /><span>GO</span></div>
        <small>Chạy theo nhịp của riêng mình.</small>
      </aside>
      <section className="onboarding-form" aria-labelledby="login-heading">
        <p className="section-index">CHÀO MỪNG TRỞ LẠI</p>
        <h1 id="login-heading">Tiếp bước cùng nhau.</h1>
        <p className="section-description">Đăng nhập để quản lý hồ sơ, vé và hành trình của bạn.</p>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <form onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field">
            <label htmlFor="login-password">Mật khẩu</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Nhập mật khẩu của bạn" />
          </div>
          <button className="button-primary" type="submit" disabled={loading}>{loading ? 'Đang xác thực...' : 'Đăng nhập'}</button>
        </form>
        <p className="auth-switch">Chưa có tài khoản? <Link href={'/register?next=' + encodeURIComponent(destination)}>Tạo tài khoản mới</Link></p>
      </section>
    </div>
  );
}
