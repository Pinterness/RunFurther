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
    <main className="page" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <section className="form-card" style={{ maxWidth: 440, width: '100%', background: '#fff', padding: 32, borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        <span className="eyebrow" style={{ fontSize: 13, color: '#0070f3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
          Cổng Runner & Thành Viên
        </span>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '8px 0 24px' }}>Chào mừng trở lại</h1>

        {error && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="login-email" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 15 }}
            />
          </div>

          <div className="field" style={{ marginBottom: 24 }}>
            <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Mật khẩu
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 15 }}
            />
          </div>

          <button
            className="button button-dark"
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: '#111827',
              color: '#fff',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 15,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>
        </form>

        <p className="muted" style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 20 }}>
          Chưa có tài khoản RunFurther?{' '}
          <Link href={'/register?next=' + encodeURIComponent(destination)} style={{ color: '#0070f3', fontWeight: 600 }}>
            Tạo tài khoản mới
          </Link>
        </p>
      </section>
    </main>
  );
}
