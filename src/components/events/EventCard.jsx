import Link from 'next/link';
import EventPhoto from '../site/EventPhoto';
import { CalendarDays, MapPin } from 'lucide-react';
const labels = { REGISTRATION_OPEN: 'Đang mở đăng ký', REGISTRATION_CLOSED: 'Đã đóng đăng ký', COMPLETED: 'Đã kết thúc', PUBLISHED: 'Sắp mở đăng ký' };
export default function EventCard({ event }) {
  const date = event.dateInfo?.raceDate ? new Date(event.dateInfo.raceDate) : null;
  const raceDate = date && !Number.isNaN(date.getTime()) ? date : null;
  return <article className="race-card"><Link className="race-image" href={`/events/${event.slug}`}><EventPhoto src={event.bannerUrl || '/assets/figma/event-trail.png'} alt="" /><span>{labels[event.status] || event.status}</span></Link><div className="race-body"><Link href={`/events/${event.slug}`}><h2>{event.name}</h2></Link><div className="race-meta"><p className="race-date"><CalendarDays size={16} strokeWidth={1.5} aria-hidden="true" />{raceDate ? <time dateTime={raceDate.toISOString()}>{raceDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })}</time> : <span>Ngày chạy chưa công bố</span>}</p><p className="race-location"><MapPin size={16} strokeWidth={1.5} aria-hidden="true" />{event.location?.city || 'Địa điểm chưa công bố'}</p></div><div className="distance-tags">{(event.categories || []).map(category => <span key={category}>{category}</span>)}</div><div className="race-card-bottom"><div><small>Đã đăng ký / Sức chứa</small><strong>{event.quota ?? 0} / {event.quotaTotal ?? 0}</strong></div><div><small>Giá từ</small><b>{event.price == null ? 'Chưa công bố' : Number(event.price).toLocaleString('vi-VN') + 'đ'}</b></div></div></div></article>;
}
