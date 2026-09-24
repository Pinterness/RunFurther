'use client';

import { useState } from 'react';

export default function VolunteerModal({ eventId, eventName }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [desiredRole, setDesiredRole] = useState('CHECKIN');
  const [tShirtSize, setTShirtSize] = useState('L');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const token = typeof window !== 'undefined' ? localStorage.getItem('rf_token') : null;

      const res = await fetch(`${apiUrl}/staff/events/${eventId}/volunteers/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          applicant: {
            fullName,
            email,
            phone,
            tShirtSize,
            note,
          },
          desiredRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Không thể gửi đơn đăng ký.');
      }

      setIsSuccess(true);
      setMessage(data.message);
      setTimeout(() => {
        setOpen(false);
        setMessage('');
      }, 2500);
    } catch (err) {
      setIsSuccess(false);
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          marginTop: 12,
          padding: '12px',
          background: '#fff',
          border: '1px solid #10b981',
          color: '#059669',
          borderRadius: 8,
          fontWeight: 700,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        🤝 Đăng Ký Làm Tình Nguyện Viên (Volunteer)
      </button>

      {open && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 480, width: '100%', padding: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>
              Đăng Ký Tình Nguyện Viên
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Giải chạy: <b>{eventName}</b>
            </p>

            {message && (
              <div style={{
                padding: 10,
                borderRadius: 6,
                marginBottom: 14,
                background: isSuccess ? '#ecfdf5' : '#fee2e2',
                color: isSuccess ? '#065f46' : '#b91c1c',
                fontSize: 13,
                fontWeight: 600,
              }}>
                {message}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Họ và tên *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Số điện thoại *</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0901234567"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vị trí mong muốn</label>
                  <select
                    value={desiredRole}
                    onChange={(e) => setDesiredRole(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="CHECKIN">Điểm danh Check-in</option>
                    <option value="RACE_KIT">Phát túi Race-Kit & BIB</option>
                    <option value="MARSHAL">Trọng tài đường chạy</option>
                    <option value="WATER_STATION">Trạm tiếp nước & chuối</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Size áo TNV</label>
                  <select
                    value={tShirtSize}
                    onChange={(e) => setTShirtSize(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    {['S', 'M', 'L', 'XL', 'XXL'].map((sz) => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Ghi chú / Kinh nghiệm</label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Kinh nghiệm tham gia các giải chạy trước..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{ flex: 1, padding: 10, background: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: 10,
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Đang gửi...' : 'Nộp Đơn Đăng Ký'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

