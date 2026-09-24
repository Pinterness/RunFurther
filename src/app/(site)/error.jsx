'use client';
export default function SiteError({ reset }) {
  return <div className="page-container"><section className="panel"><h1>Chưa tải được dữ liệu</h1><p>Vui lòng thử lại sau khi kết nối được khôi phục.</p><button className="button-dark" onClick={reset}>Thử lại</button></section></div>;
}
