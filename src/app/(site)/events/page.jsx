import EventFilters from '../../../components/events/EventFilters';
import Link from 'next/link';
import EventCard from '../../../components/events/EventCard';
import { getEventPage } from '../../../lib/events';
export default async function EventsPage({ searchParams }) {
  const params = await searchParams;
  const query = Object.fromEntries(['city', 'distance', 'search', 'page', 'range', 'sort'].filter(key => typeof params[key] === 'string' && params[key]).map(key => [key, params[key]]));
  const { events, pagination } = await getEventPage({ ...query, ...({short:{distanceMin:0,distanceMax:10},medium:{distanceMin:10,distanceMax:21},half:{distanceMin:21,distanceMax:42},marathon:{distanceMin:42,distanceMax:50},ultra:{distanceMin:50}}[query.range] || {}) });
  const pageLink = page => '/events?' + new URLSearchParams({ ...query, page });
  return <div className="page-container"><header className="page-heading"><p className="section-index">MỖI GIẢI CHẠY, MỘT HÀNH TRÌNH</p><h1>Vạch xuất phát tiếp theo.</h1><p>Tìm cung đường và cự ly phù hợp. Viết tiếp câu chuyện của bạn.</p></header><EventFilters key={JSON.stringify(query)} query={query} /><p className="section-description">{pagination.total} giải phù hợp</p><section className="event-grid">{events.map(event => <EventCard event={event} key={event.slug} />)}</section>{!events.length && <p>Không tìm thấy giải phù hợp.</p>}<div className="pagination">{pagination.page > 1 && <Link href={pageLink(pagination.page - 1)}>Trước</Link>}<span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span>{pagination.page < pagination.totalPages && <Link href={pageLink(pagination.page + 1)}>Sau</Link>}</div></div>;
}
