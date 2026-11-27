import Form from 'next/form';
import Link from 'next/link';
import './event-filters.css';

export default function EventFilters({ query }) {
  return <Form action="/events" className="event-filters">
    <div className="event-search-row">
      <label>Từ khóa<input type="search" name="search" maxLength={120} placeholder="Tên giải, thành phố hoặc địa điểm" defaultValue={query.search || ''} /></label>
      <label>Thành phố<input name="city" maxLength={100} placeholder="Ví dụ: Cần Thơ" defaultValue={query.city || ''} /></label>
      <label>Sắp xếp<select name="sort" defaultValue={query.sort || 'relevance'}><option value="relevance">Phù hợp nhất</option><option value="date">Ngày chạy tăng dần</option><option value="newest">Mới đăng gần đây</option></select></label>
    </div>
    <fieldset><legend>Cự ly phù hợp với bạn</legend><div className="distance-options">{[['','Tất cả'],['short','Dưới 10 km'],['medium','10 – dưới 21 km'],['half','21 – dưới 42 km'],['marathon','42 – dưới 50 km'],['ultra','Từ 50 km']].map(([value,label])=><label key={value}><input type="radio" name="range" value={value} defaultChecked={(query.range || '')===value} /><span>{label}</span></label>)}</div></fieldset>
    <div className="event-filter-actions"><p>Tìm được cả tiếng Việt có dấu và không dấu. Kết quả chỉ đổi khi bạn bấm tìm kiếm.</p><Link href="/events">Xóa bộ lọc</Link><button className="button-dark" type="submit">Tìm giải chạy</button></div>
  </Form>;
}
