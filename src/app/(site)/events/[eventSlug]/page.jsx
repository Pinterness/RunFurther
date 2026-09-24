import Link from 'next/link';
import { getEvent } from '../../../../lib/events';
import VolunteerModal from '../../../../components/events/VolunteerModal';

export default async function EventPage({ params }) {
  const { eventSlug } = await params;
  const event = await getEvent(eventSlug);

  return (
    <>
      <section className="event-cover">
        <img src="/assets/figma/event-trail.png" alt="" />
        <div className="event-cover-content">
          <span className="tag">ROAD & TRAIL RUN</span>
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
            <Link href="#route">Sơ đồ đường chạy</Link>
            <Link href="#schedule">Lịch trình</Link>
            <Link href={`/events/${event.slug}/results`}>Kết quả</Link>
            <Link href={`/events/${event.slug}/staff-login`} style={{ color: '#059669', fontWeight: 600 }}>
              🔑 Cổng Nhân Sự
            </Link>
          </nav>

          <h2>Giới thiệu về giải chạy</h2>
          <p>
            {event.name} là hành trình dành cho cộng đồng chạy bộ yêu thử thách.
            Trải nghiệm cung đường đầy cảm xúc và khám phá giới hạn mới của bản thân
            cùng hàng nghìn runner trên khắp Việt Nam.
          </p>

          <h2>Quyền lợi vận động viên</h2>
          <ul className="checklist">
            <li>Áo đấu thể thao phiên bản giới hạn 2025.</li>
            <li>Bộ Race-Kit bao gồm BIB, Chip Timing chuẩn quốc tế.</li>
            <li>Huy chương hoàn thành (Finisher Medal) đúc nổi tinh xảo.</li>
            <li>Hình ảnh lưu niệm chất lượng cao từ đường chạy nhận diện tự động qua BIB.</li>
            <li>Tích lũy điểm thưởng RunPoints để đổi vé miễn phí cho các giải sau.</li>
          </ul>
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
