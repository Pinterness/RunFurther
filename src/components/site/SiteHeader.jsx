'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import NotificationBell from './NotificationBell';
import RunnerAvatar from './RunnerAvatar';

const navigation = [
  { href: '/', label: 'Trang chủ' },
  { href: '/events', label: 'Giải chạy' },
  { href: '/marketplace', label: 'Chuyển nhượng BIB' },
  { href: '/lookup', label: 'Tra cứu' },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [organizerApproved, setOrganizerApproved] = useState(false);
  const accountRef = useRef(null);
  const menuButtonRef = useRef(null);
  const accountButtonRef = useRef(null);

  useEffect(() => {
    const sync = () => {
      setOrganizerApproved(false);
      try {
        const token = localStorage.getItem('rf_token');
        const stored = JSON.parse(localStorage.getItem('rf_user') || 'null');
        setUser(token && stored?.fullName ? stored : null);
      } catch { setUser(null); }
    };
    sync();
    setMenuOpen(false);
    setAccountOpen(false);
    window.addEventListener('storage', sync);
    window.addEventListener('rf-auth', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('rf-auth', sync); };
  }, [pathname]);

  useEffect(() => {
    setOrganizerApproved(false);
    if (!accountOpen || !user || user.systemRole === 'SUPER_ADMIN') return;
    const token = localStorage.getItem('rf_token');
    if (!token) return;
    const controller = new AbortController();
    // Organizer approval is separate from RUNNER and from per-event roles.
    // Recheck when opening the menu; never grant a link from cached profile data.
    async function checkOrganizerAccess() {
      try {
        const response = await fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/admin/organizer-access', {
          signal: controller.signal, cache: 'no-store', headers: { Authorization: 'Bearer ' + token },
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted && localStorage.getItem('rf_token') === token) setOrganizerApproved(data.application?.status === 'APPROVED');
      } catch { /* Keep organizer navigation hidden when approval cannot be verified. */ }
    }
    checkOrganizerAccess();
    return () => controller.abort();
  }, [accountOpen, user]);

  useEffect(() => {
    const outside = event => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      if (accountOpen) { setAccountOpen(false); accountButtonRef.current?.focus(); }
      if (menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen, accountOpen]);

  function logout() {
    localStorage.removeItem('rf_token');
    localStorage.removeItem('rf_user');
    setUser(null); setOrganizerApproved(false); setAccountOpen(false); setMenuOpen(false);
    router.push('/login'); router.refresh();
  }

  return <>
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <header className="app-header">
      <Link className="app-brand" href="/" aria-label="RunFurther — Trang chủ">
        <span className="brand-strides" aria-hidden="true"><i /><i /><i /></span>
        <span>run<span className="brand-light">further</span><span className="brand-period">.</span></span>
      </Link>
      <nav id="site-navigation" className={`app-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Điều hướng chính">
        {navigation.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return <Link className={active ? 'is-active' : ''} href={item.href} key={item.href} aria-current={active ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{item.label}</Link>;
        })}
        <Link className="mobile-register" href="/register">Tạo tài khoản</Link>
      </nav>
      <div className="app-user">
        {user && <NotificationBell userId={user.id || user._id} />}
        {user ? <div className="account-control" ref={accountRef}>
          <button ref={accountButtonRef} className="account-trigger" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen} aria-controls="account-dropdown">
            <RunnerAvatar name={user.fullName} theme={user.avatarTheme} />
            <span className="account-name">{user.fullName}</span><span className={`account-chevron ${accountOpen ? 'is-open' : ''}`} aria-hidden="true">⌄</span>
          </button>
          {accountOpen && <div className="account-dropdown" id="account-dropdown">
            <p>TÀI KHOẢN CỦA BẠN</p>
            <Link href="/account" onClick={() => setAccountOpen(false)}>Hồ sơ & vé của tôi</Link>
            <Link href="/account/wallet" onClick={() => setAccountOpen(false)}>Ví & RunPoints</Link>
            {user.systemRole === 'SUPER_ADMIN' ? <Link href="/admin" onClick={() => setAccountOpen(false)}>Kiểm duyệt nền tảng</Link> : organizerApproved && <Link href="/organizer" onClick={() => setAccountOpen(false)}>Khu vực ban tổ chức</Link>}
            <button onClick={logout}>Đăng xuất</button>
          </div>}
        </div> : <>
          <Link className="header-login" href="/login">Đăng nhập<span className="link-arrow" aria-hidden="true">↗</span></Link>
          <Link className="header-register" href="/register">Tham gia ngay</Link>
        </>}
        <button ref={menuButtonRef} className={`menu-toggle ${menuOpen ? 'is-open' : ''}`} aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => { setMenuOpen(!menuOpen); setAccountOpen(false); }}><span /><span /></button>
      </div>
    </header>
  </>;
}
