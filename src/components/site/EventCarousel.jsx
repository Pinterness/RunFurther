'use client';
import EventPhoto from './EventPhoto';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './event-carousel.css';

export default function EventCarousel({ events }) {
  const [active, setActive] = useState(0), [paused, setPaused] = useState(false), [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [reduced, setReduced] = useState(true);
  const touch = useRef(null), dragged = useRef(false);
  const count = events.length;
  const index = count ? active % count : 0;
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const sync = () => setReduced(media.matches); sync(); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync); }, []);
  useEffect(() => {
    if (count < 2 || paused || hovered || focused || reduced) return;
    const timer = setInterval(() => { if (!document.hidden) setActive(value => (value + 1) % count); }, 4200);
    return () => clearInterval(timer);
  }, [count, paused, hovered, focused, reduced]);
  const move = direction => setActive(value => (value + direction + count) % count);
  return <div className="event-carousel" role="region" aria-roledescription="carousel" aria-label="Lịch hẹn với chính mình" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); } }}>
    {count > 1 && <div className="carousel-controls"><div className="carousel-arrows"><button type="button" aria-label="Giải trước" onClick={() => move(-1)}>←</button><button type="button" aria-label="Giải tiếp theo" onClick={() => move(1)}>→</button></div><div className="carousel-dots" aria-label="Chọn giải">{events.map((event, i) => <button type="button" key={event._id || event.slug} aria-label={'Xem giải ' + (i + 1)} aria-pressed={i === index} onClick={() => setActive(i)}><span /></button>)}</div><button type="button" className="carousel-pause" aria-pressed={paused} onClick={() => setPaused(value => !value)} disabled={reduced}>{reduced ? 'Chuyển thủ công' : paused ? 'Bật tự chuyển' : 'Dừng tự chuyển'}</button></div>}
    <div className="event-carousel-stage" onTouchStart={event => { touch.current = event.touches[0].clientX; dragged.current = false; }} onTouchEnd={event => { const delta = touch.current === null ? 0 : event.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(delta) > 45) { dragged.current = true; move(delta < 0 ? 1 : -1); } }} onTouchCancel={() => { touch.current = null; }} onClickCapture={event => { if (dragged.current) { event.preventDefault(); dragged.current = false; } }}>
      {events.map((event, itemIndex) => {
        let offset = (itemIndex - index + count) % count;
        if (offset > count / 2) offset -= count;
        const current = itemIndex === index;
        const hidden = Math.abs(offset) > 1;
        return <article className={'carousel-slide ' + (current ? 'is-current' : '')} key={event._id || event.slug} style={{ '--slide-offset': offset, '--slide-scale': current ? 1 : .86, '--slide-opacity': hidden ? 0 : current ? 1 : .65, zIndex: current ? 3 : 1, visibility: hidden ? 'hidden' : 'visible' }} role="group" aria-roledescription="slide" aria-label={(itemIndex + 1) + ' / ' + count} aria-hidden={hidden || undefined}>
          <Link className="landing-event-card" href={'/events/' + event.slug} onFocus={() => setActive(itemIndex)}>
            <div className="landing-event-image"><EventPhoto src={event.bannerUrl || '/assets/figma/event-trail.png'} alt="" loading="lazy" draggable="false" style={{ objectPosition: ['25% center','60% center','85% center'][itemIndex % 3] }} /><span className="event-status">{event.status === 'COMPLETED' || new Date(event.dateInfo?.raceDate).getTime() < Date.now() ? 'Giải đã diễn ra' : event.status === 'REGISTRATION_CLOSED' || new Date(event.dateInfo?.registrationEnd).getTime() < Date.now() ? 'Đóng đăng ký' : event.status === 'REGISTRATION_OPEN' ? 'Mở đăng ký' : 'Khám phá giải'}</span><span className="event-image-arrow" aria-hidden="true">↗</span></div>
            <div className="carousel-card-copy"><div className="landing-event-meta"><span>{event.location?.city}</span><span>{event.dateInfo?.raceDate ? new Date(event.dateInfo.raceDate).toLocaleDateString('vi-VN') : 'Chờ công bố'}</span></div><h3>{event.name}</h3><div className="landing-event-bottom"><span>{(event.categories || []).join(' / ') || 'Xem cự ly'}</span><span>{event.price == null ? 'Xem chi tiết' : 'Từ ' + Number(event.price).toLocaleString('vi-VN') + 'đ'}</span></div></div>
          </Link>
        </article>;
      })}
    </div>
  </div>;
}
