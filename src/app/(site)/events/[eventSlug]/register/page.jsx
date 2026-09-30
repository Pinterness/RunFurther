'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { api } from '../../../../../lib/clientApi';
import EventPhoto from '../../../../../components/site/EventPhoto';
import TransferDetails from '../../../../../components/site/TransferDetails';

export default function RegistrationPage({ params }) {
  const unwrappedParams = use(params);
  const eventSlug = unwrappedParams.eventSlug;

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);

  // Runner info form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('Nam');
  const [birthday, setBirthday] = useState('');
  const [nationality, setNationality] = useState('Việt Nam');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [shirtSize, setShirtSize] = useState('M');
  const [club, setClub] = useState('');

  // Addons & Points
  const [photoPackage, setPhotoPackage] = useState(false);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pastaParty, setPastaParty] = useState(false);
  const [usePoints, setUsePoints] = useState(false);

  // Flow & Hold state
  const [step, setStep] = useState(1); // 1: Form, 2: Payment/Hold, 3: Success
  const [submitting, setSubmitting] = useState(false);
  const [bookingData, setBookingData] = useState(null);
  const [confirmData, setConfirmData] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(600);
  const [errorMessage, setErrorMessage] = useState('');
  const [transferPending, setTransferPending] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileState, setProfileState] = useState('');
  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        if (!localStorage.getItem('rf_token')) { setProfileState('guest'); return; }
        const { user, profile } = await api('/auth/me');
        if (!active) return;
        setFullName(user.fullName || ''); setEmail(user.email || ''); setPhone(user.phone || '');
        setBirthday(profile.birthday); setGender(profile.gender === 'Không chia sẻ' ? 'Khác' : profile.gender);
        setNationality(profile.nationality); setClub(profile.club); setShirtSize(profile.shirtSize);
        setEmergencyContact(profile.emergencyContact); setEmergencyPhone(profile.emergencyPhone);
        setProfileState('loaded');
      } catch (error) { if (active) setProfileState(error.status === 401 ? 'guest' : 'failed'); }
      finally { if (active) setProfileLoading(false); }
    }
    loadProfile();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step !== 2 || !bookingData?.booking?._id) return;
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const token = localStorage.getItem('rf_token');
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/bookings/${bookingData.booking._id}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (disposed) return;
        if (!response.ok) throw new Error(data.message);
        setSecondsLeft(data.holdSecondsRemaining);
        setBookingData(previous => ({ ...previous, ...(data.bankInfo !== undefined ? { bankInfo: data.bankInfo, vietQrUrl: data.vietQrUrl } : {}), paymentBlocked: data.paymentBlocked }));
        if (data.booking.status === 'PAID' && data.registration) {
          setConfirmData({ ...data, bibNumber: data.registration.bibNumber });
          setErrorMessage('');
          setStep(3);
        }
      } catch (error) { if (!disposed) setErrorMessage(error.message); }
      finally { inFlight = false; }
    };
    const timer = setInterval(refresh, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [step, bookingData?.booking?._id]);

  useEffect(() => {
    const token = localStorage.getItem('rf_token');
    if (!token) return;
    fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/wallet', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.ok ? r.json() : null).then(data => { if (data) setPointsBalance(data.runPoints.balance); }).catch(() => {});
  }, []);

  // Fetch Event & Categories
  useEffect(() => {
    async function loadEventData() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${apiUrl}/events/${eventSlug}/categories`);
        if (!res.ok) throw new Error('Không tải được thông tin giải chạy.');
        if (res.ok) {
          const data = await res.json();
          setEvent(data.event);
          setCategories(data.categories || []);
          if (data.categories && data.categories.length > 0) {
            setSelectedCat(data.categories[0]);
          }
        }
      } catch (err) {
        setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadEventData();
  }, [eventSlug]);

  // 10-minute hold countdown timer
  useEffect(() => {
    if (step !== 2 || secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMessage('Thời gian giữ chỗ 10 phút đã hết hạn. Vui lòng tạo lại đơn.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, secondsLeft]);

  // Calculate pricing
  const basePrice = selectedCat?.price ?? 0;
  const addonsTotal = (photoPackage ? 150000 : 0) + (pastaParty ? 100000 : 0);
  const totalAmount = basePrice + addonsTotal;
  const pointsDiscount = usePoints ? Math.min(Math.floor(pointsBalance), Math.floor(totalAmount / 2000)) * 1000 : 0;
  const finalAmount = Math.max(0, totalAmount - pointsDiscount);

  const formatCurrency = (val) => Number(val).toLocaleString('vi-VN') + 'đ';
  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Step 1 -> Step 2: Create 10-Minute Hold
  const handleCreateHold = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSubmitting(true);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('rf_token') : null;
      if (!token) throw new Error('Vui lòng đăng nhập trước khi đăng ký giải.');
      if (!event?._id || !selectedCat?._id) throw new Error('Vui lòng chọn cự ly hợp lệ.');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

      const res = await fetch(`${apiUrl}/bookings/hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eventId: event._id,
          categoryId: selectedCat?._id || categories[0]?._id,
          runnerInfo: {
            fullName,
            email,
            phone,
            gender,
            birthday,
            nationality,
            emergencyContact,
            emergencyPhone,
            shirtSize,
            club,
          },
          addons: { photoPackage, pastaParty },
          usePoints,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Không thể tạo đơn giữ chỗ.');
      }

      setBookingData(data);
      setSecondsLeft(data.holdSecondsRemaining || 600);
      setStep(2);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 -> Step 3: Confirm Payment
  const handleConfirmPayment = async (method = 'VIETQR') => {
    if (!bookingData?.booking?._id) return;
    setErrorMessage('');
    setSubmitting(true);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('rf_token') : null;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

      const res = await fetch(`${apiUrl}/bookings/${bookingData.booking._id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ paymentMethod: method }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Xác nhận thanh toán không thành công.');
      }

      if (data.pending) {
        setTransferPending(true);
        return;
      }
      setConfirmData(data);
      setStep(3);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || profileLoading) return <div className="runner-shell" role="status">Đang tải thông tin đăng ký...</div>;
  if (profileState === 'guest') return <div className="runner-shell runner-guest"><h1>Đăng nhập để đăng ký giải.</h1><p>Hồ sơ người chạy của bạn sẽ được tự điền khi mua vé.</p><Link className="button-primary" href={'/login?next=' + encodeURIComponent('/events/' + eventSlug + '/register')}>Đăng nhập</Link><Link className="text-action" href={'/register?next=' + encodeURIComponent('/events/' + eventSlug + '/register')}>Tạo tài khoản</Link></div>;
  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      {event && <div className="checkout-event-photo"><EventPhoto src={event.bannerUrl} alt={'Ảnh bìa ' + event.name} />{event.logoUrl && <EventPhoto className="checkout-logo" src={event.logoUrl} alt={'Logo ' + event.name} />}</div>}
      <header className="checkout-header" style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--foreground)' }}>
          Đăng Ký Giải Chạy
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 16, marginTop: 4 }}>
          {event?.name || 'Thông tin giải chưa tải được'}
        </p>

        {/* Stepper */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24 }}>
          <span style={{ fontWeight: step >= 1 ? 700 : 400, color: step >= 1 ? 'var(--accent-strong)' : 'var(--muted)' }}>
            1. Thông Tin VĐV
          </span>
          <span>→</span>
          <span style={{ fontWeight: step >= 2 ? 700 : 400, color: step >= 2 ? 'var(--accent-strong)' : 'var(--muted)' }}>
            2. Thanh Toán & Giữ Chỗ (10p)
          </span>
          <span>→</span>
          <span style={{ fontWeight: step === 3 ? 700 : 400, color: step === 3 ? '#10b981' : 'var(--muted)' }}>
            3. Xác Nhận & Cấp BIB
          </span>
        </div>
      </header>

      {errorMessage && (
        <div style={{ padding: 14, background: '#fee2e2', color: '#b91c1c', borderRadius: 'var(--radius-panel)', marginBottom: 20, textAlign: 'center' }}>
          {errorMessage}
        </div>
      )}

      {/* STEP 1: RUNNER FORM & OPTIONS */}
      {step === 1 && <p className="notice">{profileState === 'loaded' ? 'Đã điền thông tin từ hồ sơ của bạn. Bạn có thể chỉnh cho lượt đăng ký này.' : 'Chưa tải được hồ sơ. Bạn có thể nhập thông tin cho lượt đăng ký này.'} <Link href="/account">Xem hồ sơ ↗</Link></p>}
      {step === 1 && (
        <form className="account-layout" onSubmit={handleCreateHold} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
          <div>
            {/* Category Selection */}
            <article style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', padding: 24, marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>1. Chọn Cự Ly Chạy</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                {categories.map((cat) => {
                  const isSelected = selectedCat?.code === cat.code;
                  return (
                    <button
                      type="button"
                      key={cat.code}
                      onClick={() => setSelectedCat(cat)}
                      style={{
                        padding: '16px 12px',
                        borderRadius: 'var(--radius-control)',
                        border: isSelected ? '2px solid var(--accent-strong)' : '1px solid var(--border)',
                        background: isSelected ? 'var(--surface-muted)' : 'var(--surface)',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <strong style={{ display: 'block', fontSize: 20, color: isSelected ? 'var(--accent-strong)' : 'var(--foreground)' }}>
                        {cat.code}
                      </strong>
                      <span style={{ fontSize: 13, color: 'var(--muted)', display: 'block', margin: '4px 0' }}>
                        {cat.name}
                      </span>
                      <b style={{ color: '#059669', fontSize: 14 }}>
                        {formatCurrency(cat.price ?? 0)}
                      </b>
                    </button>
                  );
                })}
              </div>
            </article>

            {/* Runner Profile Form */}
            <article style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', padding: 24, marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>2. Thông Tin Cá Nhân</h2>
              <div className="field"><label htmlFor="runner-birthday">Ngày sinh {selectedCat?.rules?.minAge ? `(Tối thiểu ${selectedCat.rules.minAge} tuổi)` : ''}</label><input id="runner-birthday" type="date" required={Boolean(selectedCat?.rules?.minAge)} value={birthday} onChange={event => setBirthday(event.target.value)} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    HỌ VÀ TÊN *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    EMAIL NHẬN VÉ *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    SỐ ĐIỆN THOẠI *
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    GIỚI TÍNH
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  >
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác / Không chia sẻ</option>
                  </select>
                </div>
              </div>
            </article>

            {/* Additional Info */}
            <article style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>3. Kích Cỡ Áo & Liên Hệ Khẩn Cấp</h2>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>
                  CHỌN KÍCH CỠ ÁO T-SHIRT
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map((sz) => (
                    <button
                      type="button"
                      key={sz}
                      onClick={() => setShirtSize(sz)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-control)',
                        border: shirtSize === sz ? '2px solid var(--accent-strong)' : '1px solid var(--border)',
                        background: shirtSize === sz ? 'var(--surface-muted)' : 'var(--surface)',
                        fontWeight: shirtSize === sz ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    NGƯỜI LIÊN HỆ KHẨN CẤP
                  </label>
                  <input
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    SĐT KHẨN CẤP
                  </label>
                  <input
                    type="text"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)' }}
                  />
                </div>
              </div>
            </article>
          </div>

          {/* Order Summary Sidebar */}
          <aside style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', padding: 24, height: 'fit-content' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Tóm Tắt Đơn Hàng</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <strong>Vé {selectedCat?.code || '5K'}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{event?.name}</div>
              </div>
              <b>{formatCurrency(basePrice)}</b>
            </div>

            <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />

            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Dịch vụ bổ sung:</strong>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                <div>
                  <input
                    type="checkbox"
                    checked={photoPackage}
                    onChange={(e) => setPhotoPackage(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Gói ảnh cá nhân đường chạy
                </div>
                <span>+150.000đ</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer' }}>
                <div>
                  <input
                    type="checkbox"
                    checked={pastaParty}
                    onChange={(e) => setPastaParty(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Vé tiệc Pasta Party
                </div>
                <span>+100.000đ</span>
              </label>
            </div>

            {/* Loyalty Points */}
            <div style={{ background: '#fef3c7', padding: 12, borderRadius: 'var(--radius-panel)', marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', fontWeight: 600, color: '#92400e' }}>
                <div>
                  <input
                    type="checkbox"
                    checked={usePoints}
                    onChange={(e) => setUsePoints(e.target.checked)}
                    style={{ marginRight: 8 }}
                  />
                  Dùng điểm thưởng RunPoints (Xu)
                </div>
                <span>{usePoints ? `-${formatCurrency(pointsDiscount)}` : 'Sẵn sàng'}</span>
              </label>
            </div>

            <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              <span>Tổng thanh toán:</span>
              <span style={{ color: '#059669', fontSize: 20 }}>{formatCurrency(finalAmount)}</span>
            </div>

            <button className="button-primary"
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '14px',
                color: '#fff',
                borderRadius: 'var(--radius-control)',
                fontWeight: 600,
                fontSize: 16,
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Đang tạo giữ chỗ...' : 'Giữ Chỗ & Thanh Toán (10p)'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>
              ⏱ Suất chạy sẽ được giữ trong 10 phút sau khi xác nhận.
            </p>
          </aside>
        </form>
      )}

      {/* STEP 2: PAYMENT & 10-MIN HOLD SCREEN */}
      {step === 2 && bookingData && (
        <div style={{ maxWidth: 800, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-panel)', padding: 'clamp(16px, 3vw, 32px)' }}>
          {/* 10-minute timer alert */}
          <div style={{
            background: secondsLeft < 180 ? '#fee2e2' : 'var(--surface-muted)',
            color: secondsLeft < 180 ? '#b91c1c' : 'var(--forest)',
            padding: '16px 20px',
            borderRadius: 'var(--radius-panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 28,
          }}>
            <div>
              <strong style={{ fontSize: 16, display: 'block' }}>Đang giữ chỗ cự ly cho bạn</strong>
              <span style={{ fontSize: 13 }}>Vui lòng hoàn tất thanh toán trước khi hết hạn giữ vé.</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace' }}>
              ⏱ {formatTimer(secondsLeft)}
            </div>
          </div>

          {bookingData.paymentBlocked ? <p className="notice notice-error">Giải đang bị ẩn hoặc tạm ngừng. Không chuyển tiền; liên hệ chủ giải nếu bạn đã thanh toán.</p> : <TransferDetails bankInfo={bookingData.bankInfo} amount={bookingData.booking.finalAmount} orderCode={bookingData.booking.orderCode} qrUrl={bookingData.vietQrUrl} expired={secondsLeft <= 0} />}
          {transferPending && <p role="status" className="notice">Đã gửi yêu cầu đối soát. Vui lòng không chuyển tiền lần nữa; vé sẽ xuất hiện sau khi chủ giải xác nhận.</p>}
              <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button className="button-dark"
                  type="button"
                  disabled={submitting || transferPending || bookingData.paymentBlocked || secondsLeft <= 0 || !bookingData.vietQrUrl}
                  onClick={() => handleConfirmPayment('VIETQR')}
                  style={{
                    padding: '14px',
                    color: '#fff',
                    borderRadius: 'var(--radius-control)',
                    fontWeight: 600,
                    fontSize: 16,
                    border: 'none',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Đang gửi...' : transferPending ? 'Đang chờ chủ giải đối soát' : 'Tôi đã chuyển khoản — Gửi đối soát'}
                </button>

                <button className="button-dark"
                  type="button"
                  disabled={submitting || transferPending || bookingData.paymentBlocked || secondsLeft <= 0}
                  onClick={() => handleConfirmPayment('WALLET')}
                  style={{
                    padding: '12px',
                    color: '#fff',
                    borderRadius: 'var(--radius-control)',
                    fontWeight: 500,
                    fontSize: 14,
                    border: 'none',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Thanh Toán Bằng Số Dư Ví Nội Bộ
                </button>
              </div>
        </div>
      )}

      {/* STEP 3: SUCCESS & GENERATED BIB SCREEN */}
      {step === 3 && confirmData && (
        <div style={{ maxWidth: 650, margin: '0 auto', background: 'var(--surface)', border: '1px solid #10b981', borderRadius: 'var(--radius-panel)', padding: 36, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#065f46' }}>Đăng Ký & Thanh Toán Thành Công!</h2>
          <p style={{ color: 'var(--muted)', fontSize: 15, marginTop: 4 }}>
            Chào mừng bạn đến với <b>{event?.name || 'giải chạy'}</b>!
          </p>

          {/* BIB Card */}
          <div style={{
            background: 'linear-gradient(135deg, var(--forest-deep), var(--forest))',
            color: '#fff',
            borderRadius: 'var(--radius-panel)',
            padding: '24px',
            margin: '24px auto',
            maxWidth: 420,
            boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          }}>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.8 }}>SỐ BIB CHÍNH THỨC</div>
            <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 3, margin: '8px 0' }}>
              {confirmData.bibNumber}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{confirmData.registration?.runnerProfile?.fullName}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
              Cự ly: {selectedCat?.code} • Size áo: {confirmData.registration?.logistics?.shirtSize}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 12 }}>
              Mã vé QR: {confirmData.registration?.qrToken}
            </div>
          </div>

          <div style={{ background: '#ecfdf5', color: '#065f46', padding: 14, borderRadius: 'var(--radius-panel)', fontSize: 14, marginBottom: 24 }}>
            🎁 Bạn đã được cộng thêm <b>+{confirmData.pointsAwarded || 10} điểm RunPoints</b> vào tài khoản tích lũy!
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Link className="button-primary"
              href="/account"
              style={{
                padding: '12px 24px',
                color: '#fff',
                borderRadius: 'var(--radius-control)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Vào Trang Quản Lý Vé Của Tôi
            </Link>
            <Link className="button"
              href={`/events/${eventSlug}`}
              style={{
                padding: '12px 24px',
                background: 'var(--surface-muted)',
                color: 'var(--foreground)',
                borderRadius: 'var(--radius-control)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Quay Lại Sự Kiện
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
