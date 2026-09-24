import Link from 'next/link';
import EventCard from '../../../components/events/EventCard';
import { getEventPage } from '../../../lib/events';
export default async function EventsPage({ searchParams }) {
  const params = await searchParams;
  const query = Object.fromEntries(['city', 'distance', 'search', 'page'].filter(key => typeof params[key] === 'string' && params[key]).map(key => [key, params[key]]));
  const { events, pagination } = await getEventPage(query);
  const pageLink = page => '/events?' + new URLSearchParams({ ...query, page });
  return <div className="page-container"><header className="page-heading"><h1>Tìm Kiếm Thử Thách Mới</h1><p>Khám phá và đăng ký các giải chạy.</p></header><form className="filters"><input className="filter" name="search" aria-label="Tên giải chạy" placeholder="Tên giải chạy..." defaultValue={query.search || ''} /><input className="filter" name="city" aria-label="Địa điểm" placeholder="Địa điểm..." defaultValue={query.city || ''} /><select className="filter" name="distance" aria-label="Cự ly" defaultValue={query.distance || ''}><option value="">Tất cả cự ly</option>{[5,10,21,42].map(km => <option key={km} value={km}>{km}K</option>)}</select><button className="button-dark">Lọc kết quả</button></form><section className="event-grid">{events.map(event => <EventCard event={event} key={event.slug} />)}</section>{!events.length && <p>Không tìm thấy giải phù hợp.</p>}<div className="pagination">{pagination.page > 1 && <Link href={pageLink(pagination.page - 1)}>Trước</Link>}<span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span>{pagination.page < pagination.totalPages && <Link href={pageLink(pagination.page + 1)}>Sau</Link>}</div></div>;
}
