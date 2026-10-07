import Link from 'next/link';
import { getEvent } from '../../../../lib/events';
import VolunteerModal from '../../../../components/events/VolunteerModal';
import EventPhoto from '../../../../components/site/EventPhoto';

export default async function EventPage({ params }) {
  const { eventSlug } = await params;
  const event = await getEvent(eventSlug);

  return (
    <>
      <section className="event-cover">
        <EventPhoto src={event.bannerUrl} />
        <div className="event-cover-content">
          {event.logoUrl && <EventPhoto className="event-brand-logo" src={event.logoUrl} alt={'Logo ' + event.name} />}
          <span className="tag">RUNFURTHER / GIẢI CHẠY</span>
          <h1>{event.name}</h1>
          <p>⌖ {event.location?.city}　　▣ {new Date(event.dateInfo.raceDate).toLocaleDateString('vi-VN')}</p>
        </div>
      </section>

      <div className="event-layout">
        <section className="event-copy">
          <nav className="tabs">
            <Link className="active" href={`/events/${event.slug}`}>
              Tổng quan
            </Link>
            <Link href="#route">Địa điểm</Link>
            <Link href="#schedule">Lịch trình</Link>
            <Link href={`/events/${event.slug}/results`}>Kết quả</Link>
            <Link href={`/events/${event.slug}/staff-login`} className="staff-entry-link">
              Cổng nhân sự ↗
            </Link>
          </nav>

          <h2 id="route">Địa điểm tổ chức</h2>
          <p>{event.location?.venue} · {event.location?.city}</p>
          <h2 id="schedule">Lịch trình đăng ký</h2>
          <ul className="checklist">
            <li>Mở đăng ký: {new Date(event.dateInfo.registrationStart).toLocaleString('vi-VN')}.</li>
            <li>Đóng đăng ký: {new Date(event.dateInfo.registrationEnd).toLocaleString('vi-VN')}.</li>
            <li>Ngày chạy: {new Date(event.dateInfo.raceDate).toLocaleString('vi-VN')}.</li>
          </ul>
          <h2>Race-kit và quyền lợi</h2>
          <p>Thông tin chi tiết về race-kit, huy chương và quyền lợi do ban tổ chức công bố. Vui lòng xác nhận với ban tổ chức trước khi đăng ký.</p>
        </section>

        <aside className="card order-card">
          <h2>Đăng ký tham gia</h2>
          <small>CÁC CỰ LY THI ĐẤU</small>
          {event.categories.map(category => <div className="choice" key={category._id}>
            <span>{category.name}</span><b>{category.price.toLocaleString('vi-VN')}đ</b>
          </div>)}

          <Link className="button-primary" href={`/events/${event.slug}/register`}>
            Đăng Ký Suất Chạy (Giữ chỗ 10p)
          </Link>

          {/* Volunteer Application Modal */}
          <VolunteerModal eventId={event._id} eventName={event.name} />
        </aside>
      </div>
    </>
  );
}
