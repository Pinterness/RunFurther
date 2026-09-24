'use client';
import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
export default function Modal({ title, onClose, busy = false, children }) {
  const ref = useRef(null), titleId = useId();
  useEffect(() => {
    const dialog = ref.current; const before = document.activeElement;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; before?.focus(); };
  }, []);
  return <dialog className="rf-dialog" ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === ref.current && !busy) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="dialog-close" aria-label="Đóng" onClick={onClose} disabled={busy}>×</button></div>{children}
  </dialog>;
}
export function LoginPrompt({ onClose, next = '/marketplace' }) {
  return <Modal title="Đăng nhập để tiếp tục" onClose={onClose}><p className="dialog-copy">Bạn cần đăng nhập để đăng tin hoặc mua trên marketplace. Hồ sơ và vé của bạn sẽ được tải tự động.</p><div className="dialog-actions"><Link className="button-primary" href={'/login?next=' + encodeURIComponent(next)}>Đăng nhập</Link><Link className="text-action" href={'/register?next=' + encodeURIComponent(next)}>Tạo tài khoản</Link></div></Modal>;
}
