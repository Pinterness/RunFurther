'use client';

import { useState, useEffect, use } from 'react';

export default function StaffCheckInPage({ params }) {
  const unwrappedParams = use(params);
  const eventSlug = unwrappedParams.eventSlug;

  const [event, setEvent] = useState(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [runner, setRunner] = useState(null);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [recentCheckins, setRecentCheckins] = useState([]);

  useEffect(() => {
    async function loadEvent() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${apiUrl}/events/${eventSlug}`);
        if (res.ok) {
          const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Thao t?c th?t b?i.');
          setEvent(data.event);
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadEvent();
  }, [eventSlug]);

  const staffHeaders = () => {
    const staff = JSON.parse(sessionStorage.getItem('rf_staff') || 'null');
    if (!staff || staff.eventId !== event?._id) throw new Error('Vui l?ng ??ng nh?p nh?n s? cho gi?i n?y.');
    return { 'Content-Type': 'application/json', 'x-login-code': staff.loginCode };
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!query.trim() || !event?._id) return;

    setSearching(true);
    setMessage('');
    setRunner(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/staff/events/${event._id}/search?q=${encodeURIComponent(query.trim())}`, { headers: staffHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Thao t?c th?t b?i.');

      if (res.ok && data.runners && data.runners.length > 0) {
        setRunner(data.runners[0]);
      } else {
        setMessage('Không tìm thấy thông tin vận động viên.');
        setIsSuccess(false);
      }
    } catch (err) {
      setMessage('Lỗi tìm kiếm: ' + err.message);
      setIsSuccess(false);
    } finally {
      setSearching(false);
    }
  };

  const handleCheckin = async () => {
    if (!runner || !event?._id) return;

    setActionLoading(true);
    setMessage('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/staff/events/${event._id}/checkin`, {
        method: 'POST',
        headers: staffHeaders(),
        body: JSON.stringify({ registrationId: runner._id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Thao t?c th?t b?i.');
      if (res.ok) {
        setMessage(data.message);
        setIsSuccess(true);
        setRunner({
          ...runner,
          logistics: { ...runner.logistics, hasCheckedIn: true },
          status: 'CHECKED_IN',
        });
        setRecentCheckins((prev) => [
          {
            bibNumber: runner.bibNumber,
            name: runner.runnerProfile?.fullName,
            time: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 4),
        ]);
      } else {
        setMessage(data.message || 'Lỗi khi Check-in.');
        setIsSuccess(false);
      }
    } catch (err) {
      setMessage('Lỗi: ' + err.message);
      setIsSuccess(false);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 850, margin: '0 auto', padding: '30px 20px' }}>
      <header style={{ marginBottom: 28 }}>
        <span style={{ fontSize: 13, color: '#0070f3', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          CỔNG ĐIỂM DANH ĐƯỜNG CHẠY (CHECK-IN DESK)
        </span>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '6px 0' }}>
          Check-In Vận Động Viên
        </h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          {event?.name || 'Sự kiện chạy bộ'} • Điểm danh trước vạch xuất phát
        </p>
      </header>

      {/* Quick Search Box */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Quét mã QR hoặc nhập số BIB (vd: 5K-10001), SĐT, Họ tên..."
          style={{
            flex: 1,
            padding: '14px 18px',
            fontSize: 16,
            borderRadius: 10,
            border: '2px solid #0070f3',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={searching}
          style={{
            padding: '0 28px',
            background: '#0070f3',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {searching ? 'Đang tìm...' : 'Tra Cứu'}
        </button>
      </form>

      {message && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 8,
          marginBottom: 20,
          background: isSuccess ? '#ecfdf5' : '#fee2e2',
          color: isSuccess ? '#065f46' : '#b91c1c',
          fontWeight: 600,
        }}>
          {message}
        </div>
      )}

      {/* Runner Found Card */}
      {runner && (
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
          marginBottom: 28,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>SỐ BIB:</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#1e3a8a' }}>{runner.bibNumber}</div>
            </div>
            <div>
              <span style={{
                display: 'inline-block',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 700,
                background: runner.logistics?.hasCheckedIn ? '#ecfdf5' : '#fee2e2',
                color: runner.logistics?.hasCheckedIn ? '#065f46' : '#b91c1c',
              }}>
                {runner.logistics?.hasCheckedIn ? '✓ ĐÃ CHECK-IN' : 'CHƯA CHECK-IN'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, background: '#f9fafb', padding: 16, borderRadius: 10, marginBottom: 20 }}>
            <div>
              <small style={{ color: '#6b7280' }}>Họ và tên VĐV</small>
              <div style={{ fontWeight: 600 }}>{runner.runnerProfile?.fullName}</div>
            </div>
            <div>
              <small style={{ color: '#6b7280' }}>Cự ly thi đấu</small>
              <div style={{ fontWeight: 600 }}>{runner.categoryId?.name}</div>
            </div>
            <div>
              <small style={{ color: '#6b7280' }}>Liên hệ khẩn cấp</small>
              <div style={{ fontWeight: 500 }}>{runner.runnerProfile?.emergencyContact || 'N/A'} ({runner.runnerProfile?.emergencyPhone || ''})</div>
            </div>
          </div>

          <button
            type="button"
            disabled={actionLoading || runner.logistics?.hasCheckedIn}
            onClick={handleCheckin}
            style={{
              width: '100%',
              padding: '16px',
              background: runner.logistics?.hasCheckedIn ? '#9ca3af' : '#0070f3',
              color: '#fff',
              fontWeight: 700,
              fontSize: 18,
              borderRadius: 10,
              border: 'none',
              cursor: runner.logistics?.hasCheckedIn ? 'not-allowed' : 'pointer',
            }}
          >
            {actionLoading ? 'Đang cập nhật...' : runner.logistics?.hasCheckedIn ? '✓ VĐV NÀY ĐÃ ĐIỂM DANH' : '✓ XÁC NHẬN CHECK-IN VÀO ĐƯỜNG CHẠY'}
          </button>
        </div>
      )}

      {/* History */}
      {recentCheckins.length > 0 && (
        <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#4b5563', marginBottom: 12 }}>
            VẬN ĐỘNG VIÊN VỪA CHECK-IN GẦN ĐÂY:
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
            {recentCheckins.map((item, idx) => (
              <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span><b>{item.bibNumber}</b> - {item.name}</span>
                <span style={{ color: '#059669', fontWeight: 600 }}>{item.time}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
