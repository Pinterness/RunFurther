'use client';
import Link from 'next/link';

export default function SiteError({ retry }) {
  return <section className="runner-shell runner-guest" role="alert">
    <p className="section-index">RUNFURTHER</p><h1>Chưa thể tải trang.</h1>
    <p>Máy chủ có thể đang khởi động hoặc kết nối bị gián đoạn. Bạn hãy chờ khoảng một phút rồi thử lại.</p>
    <div className="runner-error-actions"><button className="button-primary" onClick={() => retry()}>Thử lại</button><Link className="quiet-button" href="/">Về trang chủ</Link></div>
  </section>;
}
