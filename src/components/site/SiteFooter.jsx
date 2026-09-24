import Link from 'next/link';
export default function SiteFooter() {
  return <footer className="site-footer"><div className="footer-grid">
    <section><Link href="/" className="footer-brand">run<span className="brand-light">further</span><span className="brand-period">.</span></Link><p>Một nơi để tìm giải chạy.<br />Nhiều lý do để bước ra ngoài.</p></section>
    <section><h3>KHÁM PHÁ</h3><Link href="/events">Tìm giải chạy</Link><Link href="/marketplace">Chuyển nhượng BIB</Link><Link href="/lookup">Tra cứu đăng ký</Link></section>
    <section><h3>HÀNH TRÌNH CỦA BẠN</h3><Link href="/account">Vé & thành tích</Link><Link href="/account/wallet">Ví & RunPoints</Link><Link href="/register">Tham gia RunFurther</Link></section>
    <section><h3>BẮT ĐẦU TỪ ĐÂY</h3><Link href="/#how-it-works">Cách tham gia</Link><Link href="/#questions">Câu hỏi thường gặp</Link><Link href="/login">Đăng nhập</Link></section>
  </div><div className="footer-bottom"><span>© {new Date().getFullYear()} RunFurther.</span><span>Chạy theo cách của bạn. <span className="footer-coordinate">VIETNAM / EVERYWHERE</span></span></div></footer>;
}
