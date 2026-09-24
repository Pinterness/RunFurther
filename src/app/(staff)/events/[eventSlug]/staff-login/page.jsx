'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function StaffLoginPage({ params }) {
  const unwrappedParams = use(params);
  const eventSlug = unwrappedParams.eventSlug;
  const router = useRouter();

  const [event, setEvent] = useState(null);
  const [pinCode, setPinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadEvent() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${apiUrl}/events/${eventSlug}`);
        if (res.ok) {
          const data = await res.json();
          setEvent(data.event);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadEvent();
  }, [eventSlug]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!pinCode.trim() || !event?._id) return;

    setError('');
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/staff/events/${event._id}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginCode: pinCode.trim().toUpperCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Mã PIN nhân viên không đúng.');
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('rf_staff', JSON.stringify(data.staff));
      }

      if (data.staff.accountType === 'RACE_KIT') {
        router.push(`/events/${eventSlug}/staff/race-kit`);
      } else {
        router.push(`/events/${eventSlug}/staff/checkin`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="staff-shell" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <section className="staff-task" style={{ maxWidth: 420, width: '100%', background: '#fff', padding: 32, borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        <span className="staff-kicker" style={{ fontSize: 12, color: '#059669', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          RUNFLOW · ĐĂNG NHẬP NHÂN SỰ
        </span>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '8px 0' }}>Sẵn sàng cho ngày thi đấu?</h1>
        <p className="muted" style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
          Nhập mã PIN 6 số (hoặc mã nội bộ) do Ban Nhân sự cấp cho sự kiện <b>{event?.name || 'giải chạy'}</b>.
        </p>

        {error && (
          <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <p style={{ marginBottom: 20 }}>Bạn là người tạo giải? <Link href="/login?next=%2Forganizer" style={{ textDecoration: 'underline' }}>Đăng nhập tài khoản ban tổ chức</Link>.</p>
        <form onSubmit={handleLogin}>
          <div className="field" style={{ marginBottom: 20 }}>
            <label htmlFor="staff-code" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Mã PIN nội bộ (ví dụ: KIT202 hoặc CHK101)
            </label>
            <input
              id="staff-code"
              type="text"
              required
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value.toUpperCase())}
              placeholder="VD: KIT202, CHK101"
              autoCapitalize="characters"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 8,
                border: '2px solid #111827',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 2,
                textAlign: 'center',
              }}
            />
          </div>

          <button
            className="button button-dark"
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: '#111827',
              color: '#fff',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 16,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Đang xác thực...' : 'Đăng Nhập Vào Trạm'}
          </button>
        </form>
      </section>
    </main>
  );
}
