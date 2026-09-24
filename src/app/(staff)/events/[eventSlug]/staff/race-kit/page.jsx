'use client';

import { useState, useEffect, use } from 'react';

export default function StaffRaceKitPage({ params }) {
  const unwrappedParams = use(params);
  const eventSlug = unwrappedParams.eventSlug;

  const [event, setEvent] = useState(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [runner, setRunner] = useState(null);
  const [issuedShirt, setIssuedShirt] = useState('M');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [recentIssued, setRecentIssued] = useState([]);

  // Load event details
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
        const found = data.runners[0];
        setRunner(found);
        setIssuedShirt(found.logistics?.shirtSize || 'M');
      } else {
        setMessage('Không tìm thấy vận động viên nào phù hợp.');
        setIsSuccess(false);
      }
    } catch (err) {
      setMessage('Lỗi khi tìm kiếm: ' + err.message);
      setIsSuccess(false);
    } finally {
      setSearching(false);
    }
  };

  const handleIssueKit = async () => {
    if (!runner || !event?._id) return;

    setActionLoading(true);
    setMessage('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const res = await fetch(`${apiUrl}/staff/events/${event._id}/race-kit`, {
        method: 'POST',
        headers: staffHeaders(),
        body: JSON.stringify({
          registrationId: runner._id,
          issuedShirtSize: issuedShirt,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Thao t?c th?t b?i.');
      if (res.ok) {
        setMessage(data.message);
        setIsSuccess(true);
        setRunner({
          ...runner,
          logistics: { ...runner.logistics, raceKitIssued: true, issuedShirtSize: issuedShirt },
        });
        setRecentIssued((prev) => [
          {
            bibNumber: runner.bibNumber,
            name: runner.runnerProfile?.fullName,
            size: issuedShirt,
            time: new Date().toLocaleTimeString(),
          },
          ...prev.slice(0, 4),
        ]);
      } else {
        setMessage(data.message || 'Lỗi khi phát Race-kit.');
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
        <span style={{ fontSize: 13, color: '#059669', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          TRẠM PHÁT RACE-KIT (RACE-KIT COUNTER)
        </span>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '6px 0' }}>
          Tra Cứu & Phát Túi Race-Kit
        </h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          {event?.name || 'Sự kiện chạy bộ'} • Giảm tải nhân sự: Quét mã hoặc tra nhanh theo SĐT / BIB
        </p>
      </header>

      {/* Quick Search Box */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nhập số BIB (vd: 21K-10001), SĐT, Họ tên, hoặc mã QR..."
          style={{
            flex: 1,
            padding: '14px 18px',
            fontSize: 16,
            borderRadius: 10,
            border: '2px solid #059669',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={searching}
          style={{
            padding: '0 28px',
            background: '#059669',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {searching ? 'Đang tìm...' : 'Tìm Kiếm'}
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
              <div style={{ fontSize: 13, color: '#6b7280' }}>SỐ BIB VẬN ĐỘNG VIÊN:</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#1e3a8a' }}>{runner.bibNumber}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                display: 'inline-block',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 700,
                background: runner.logistics?.raceKitIssued ? '#ecfdf5' : '#fef3c7',
                color: runner.logistics?.raceKitIssued ? '#065f46' : '#92400e',
              }}>
                {runner.logistics?.raceKitIssued ? '✓ ĐÃ NHẬN KIT' : '⏱ CHƯA NHẬN KIT'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, background: '#f9fafb', padding: 16, borderRadius: 10, marginBottom: 20 }}>
            <div>
              <small style={{ color: '#6b7280' }}>Họ và tên</small>
              <div style={{ fontWeight: 600 }}>{runner.runnerProfile?.fullName}</div>
            </div>
            <div>
              <small style={{ color: '#6b7280' }}>Số điện thoại</small>
              <div style={{ fontWeight: 600 }}>{runner.runnerProfile?.phone}</div>
            </div>
            <div>
              <small style={{ color: '#6b7280' }}>Cự ly</small>
              <div style={{ fontWeight: 600 }}>{runner.categoryId?.name || 'N/A'}</div>
            </div>
            <div>
              <small style={{ color: '#6b7280' }}>Size áo đăng ký</small>
              <div style={{ fontWeight: 700, color: '#0070f3' }}>{runner.logistics?.shirtSize || 'M'}</div>
            </div>
          </div>

          {/* Issue Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Size áo trao thực tế:</label>
              <select
                value={issuedShirt}
                onChange={(e) => setIssuedShirt(e.target.value)}
                style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d1d5db', fontWeight: 600 }}
              >
                {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((sz) => (
                  <option key={sz} value={sz}>{sz}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={actionLoading || runner.logistics?.raceKitIssued}
              onClick={handleIssueKit}
              style={{
                flex: 1,
                minWidth: 240,
                padding: '14px 20px',
                background: runner.logistics?.raceKitIssued ? '#9ca3af' : '#059669',
                color: '#fff',
                fontWeight: 700,
                fontSize: 16,
                borderRadius: 8,
                border: 'none',
                cursor: runner.logistics?.raceKitIssued ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Đang cập nhật...' : runner.logistics?.raceKitIssued ? '✓ VĐV NÀY ĐÃ NHẬN KIT RỒI' : '✓ XÁC NHẬN ĐÃ TRAO KIT (1-CLICK)'}
            </button>
          </div>
        </div>
      )}

      {/* Shift history */}
      {recentIssued.length > 0 && (
        <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#4b5563', marginBottom: 12 }}>
            LỊCH SỬ PHÁT GẦN ĐÂY TRONG CA:
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
            {recentIssued.map((item, idx) => (
              <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span><b>{item.bibNumber}</b> - {item.name}</span>
                <span style={{ color: '#6b7280' }}>Size: {item.size} • {item.time}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
