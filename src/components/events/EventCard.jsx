import Link from 'next/link';
import EventPhoto from '../site/EventPhoto';
const labels = { REGISTRATION_OPEN: 'Đang mở đăng ký', REGISTRATION_CLOSED: 'Đã đóng đăng ký', COMPLETED: 'Đã kết thúc', PUBLISHED: 'Sắp mở đăng ký' };
export default function EventCard({ event }) {
  return <article className="race-card"><Link className="race-image" href={`/events/${event.slug}`}><EventPhoto src={event.bannerUrl || '/assets/figma/event-trail.png'} alt="" /><span>{labels[event.status] || event.status}</span></Link><div className="race-body"><Link href={`/events/${event.slug}`}><h2>{event.name}</h2></Link><p className="race-location"><img src="/assets/figma/map-pin.svg" alt="" />{event.location?.city}</p><div className="distance-tags">{(event.categories || []).map(category => <span key={category}>{category}</span>)}</div><div className="race-card-bottom"><div><small>Đã đăng ký / Sức chứa</small><strong>{event.quota ?? 0} / {event.quotaTotal ?? 0}</strong></div><div><small>Giá từ</small><b>{event.price == null ? 'Chưa công bố' : Number(event.price).toLocaleString('vi-VN') + 'đ'}</b></div></div></div></article>;
}
