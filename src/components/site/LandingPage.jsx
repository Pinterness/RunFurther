'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import './landing.css';
import HeroRunners from './HeroRunners';
import EventCarousel from './EventCarousel';
import useLandingMotion from './useLandingMotion';

const distances = [
  { km: '5', label: 'Bắt đầu một thói quen', title: 'Bước đầu. Cảm hứng lớn.', description: 'Một cự ly vừa đủ để bắt đầu, tận hưởng không khí và tìm thấy niềm vui trong từng bước chạy.', level: 'CHO NGƯỜI MỚI BẮT ĐẦU', line: 'Bước đầu tiên cũng là một thành tựu.' },
  { km: '10', label: 'Tìm nhịp chạy của bạn', title: 'Thêm một chút. Xa hơn một chút.', description: 'Khi bạn đã tìm được nhịp, hãy cho mình một mục tiêu mới. 10 km để khám phá sức bền của chính bạn.', level: 'CHO MỘT THỬ THÁCH MỚI', line: 'Tìm nhịp của bạn. Giữ lửa của bạn.' },
  { km: '21', label: 'Vượt giới hạn quen thuộc', title: 'Nửa marathon. Trọn đam mê.', description: 'Dành cho những buổi sáng dậy sớm, những tuần tập luyện và khoảnh khắc bạn vượt qua giới hạn quen thuộc.', level: 'CHO NGƯỜI MUỐN TIẾN XA HƠN', line: 'Một hành trình xứng đáng để theo đuổi.' },
  { km: '42', label: 'Viết nên cột mốc của bạn', title: 'Một vạch đích. Một phiên bản mới.', description: 'Marathon là hành trình của sự bền bỉ. Tìm giải chạy tiếp theo và dành thời gian chuẩn bị cho cột mốc của bạn.', level: 'CHO MỘT CỘT MỐC ĐÁNG NHỚ', line: 'Điều lớn lao bắt đầu từ từng bước nhỏ.' },
];
const steps = [
  { title: 'Tìm đường chạy của bạn', body: 'Chọn địa điểm, cự ly và giải chạy phù hợp với mục tiêu. Xem thông tin trước khi quyết định hành trình tiếp theo.', link: '/events', cta: 'Khám phá giải chạy', tag: 'KHÁM PHÁ', heading: 'Một lựa chọn.\nNhiều trải nghiệm.', detail: 'Địa điểm · Cự ly · Ngày thi đấu' },
  { title: 'Đăng ký, rồi sẵn sàng', body: 'Điền thông tin vận động viên và giữ chỗ trong 10 phút. Vé được cấp sau khi thanh toán bằng ví hoặc chuyển khoản được đối soát.', link: '/account', cta: 'Xem vé của tôi', tag: 'CHUẨN BỊ', heading: 'Bớt thủ tục.\nThêm thời gian tập.', detail: 'Thông tin rõ ràng · Vé trong tài khoản' },
  { title: 'Có mặt. Và hết mình.', body: 'Tra cứu BIB, nhận race-kit và check-in tại sự kiện. Khi ban tổ chức công bố kết quả, bạn có thể xem lại thành tích của mình.', link: '/lookup', cta: 'Tra cứu BIB', tag: 'XUẤT PHÁT', heading: 'Bạn tập trung chạy.\nChúng tôi kết nối.', detail: 'Tra cứu BIB · Nhận kit · Check-in' },
];
const questions = [
  ['Tôi mới bắt đầu chạy, nên chọn cự ly nào?', 'Bạn có thể bắt đầu tìm hiểu các giải 5 km, đọc điều kiện tham gia và chọn cự ly phù hợp với khả năng hiện tại. Bộ lọc giải chạy giúp bạn so sánh địa điểm, cự ly và ngày thi đấu.'],
  ['Sau khi đăng ký, tôi nhận vé ở đâu?', 'Sau khi thanh toán được xác nhận, vé, số BIB và mã QR được hiển thị trong mục “Vé giải chạy” ở tài khoản của bạn. Chuyển khoản cần được quản trị viên đối soát trước khi cấp vé.'],
  ['Tôi có thể chuyển nhượng BIB không?', 'Bạn có thể đăng BIB đủ điều kiện lên sàn chuyển nhượng trước khi giải diễn ra, nếu chưa check-in hoặc nhận race-kit. Khi giao dịch thành công, vé được đổi chủ và cấp mã QR mới.'],
  ['RunPoints được sử dụng như thế nào?', 'RunPoints có thể dùng để giảm giá khi đăng ký giải: 1 điểm tương đương 1.000 đồng, tối đa 50% giá trị đơn. Số điểm khả dụng hiển thị trong ví của bạn.'],
];

function Arrow({ diagonal = false }) { return <span className="link-arrow" aria-hidden="true">{diagonal ? '↗' : '→'}</span>; }

export default function LandingPage() {
  const [distance, setDistance] = useState(2);
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState([]);
  const [eventsStatus, setEventsStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  const root = useRef(null);
  const selected = distances[distance];

  useLandingMotion(root);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setEventsStatus('loading');
    fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/events?limit=3', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
      .then(data => { if (active) { setEvents(data.events || []); setEventsStatus('ready'); } })
      .catch(() => { if (active) setEventsStatus('error'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [retry]);

  function chooseDistance(index) { setDistance(index); }
  function tabKeys(event, index, total, select, prefix) {
    let target;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % total;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + total) % total;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = total - 1;
    if (target === undefined) return;
    event.preventDefault(); select(target); document.getElementById(prefix + target)?.focus();
  }

  return <div className="landing" ref={root}>
    <section className="landing-hero" aria-labelledby="hero-heading">
      <img className="hero-photo" src="/assets/figma/event-trail.png" alt="Đường mòn giữa rừng cây trong ánh nắng buổi sớm" fetchPriority="high" />
      <div className="hero-shade" />
      <div className="hero-scroll-mist" aria-hidden="true" />
      <div className="hero-topline"><span>KHÔNG CHỈ LÀ MỘT GIẢI CHẠY.</span><span>ĐÓ LÀ HÀNH TRÌNH CỦA BẠN.</span></div>
      <div className="hero-stage"><div className="hero-copy">
        <p className="hero-eyebrow"><span /> CỨ BẮT ĐẦU. RỒI BẠN SẼ ĐI XA.</p>
        <h1 id="hero-heading">Bước ra ngoài.<br /><span>Chạy xa hơn.</span></h1>
        <p className="hero-description">Từ bước chạy đầu tiên đến vạch đích tiếp theo.<br className="desktop-break" /> Tìm giải chạy của bạn. Viết hành trình của riêng mình.</p>
        <div className="hero-actions"><Link className="action-primary" href="/events">Tìm giải chạy <Arrow /></Link><a className="hero-secondary" href="#your-distance">Tìm cự ly phù hợp <Arrow diagonal /></a></div>
      </div>
      <HeroRunners /></div>
      <div className="hero-bottom"><span>RUN AT YOUR OWN PACE.</span><a href="#your-distance" className="scroll-cue">KHÁM PHÁ TIẾP <span aria-hidden="true">↓</span></a><span>GO FURTHER, TOGETHER.</span></div>
      <span className="hero-side-note" aria-hidden="true">EST. FOR YOUR NEXT CHAPTER</span>
    </section>

    <div className="landing-manifesto"><span>ĐƯỜNG CHẠY MỚI.</span><span className="manifesto-line" /><span>NHỮNG NGƯỜI BẠN MỚI.</span><span className="manifesto-line" /><span>MỘT PHIÊN BẢN MỚI CỦA BẠN.</span></div>

    <section className="landing-section distance-section" id="your-distance" aria-labelledby="distance-heading">
      <div className="section-intro" data-reveal="mist"><p className="section-index">01 / CHỌN THỬ THÁCH</p><div><h2 id="distance-heading">Mỗi người một nhịp.<br /><span className="text-muted">Mỗi bước một hành trình.</span></h2><p>Không cần chạy giống ai. Chỉ cần tìm điểm bắt đầu của bạn.</p></div></div>
      <div className="distance-workspace" data-reveal="rise">
        <div className="distance-tabs" role="tablist" aria-label="Chọn cự ly">
          {distances.map((item, index) => <button id={'distance-tab-' + index} key={item.km} role="tab" aria-selected={index === distance} aria-controls="distance-panel" tabIndex={index === distance ? 0 : -1} onKeyDown={event => tabKeys(event, index, distances.length, chooseDistance, 'distance-tab-')} onClick={() => chooseDistance(index)} className={index === distance ? 'is-selected' : ''}><span className="distance-tab-number">{item.km}<small> KM</small></span><span>{item.label}</span><Arrow diagonal /></button>)}
        </div>
        <div className="distance-panel" id="distance-panel" role="tabpanel" aria-labelledby={'distance-tab-' + distance} tabIndex={0}>
          <div className="distance-panel-copy" key={selected.km}><p className="section-index">{selected.level}</p><h3>{selected.title}</h3><p>{selected.description}</p><Link className="text-action" href={'/events?distance=' + selected.km}>Tìm giải {selected.km} km <Arrow /></Link></div>
          <div className="distance-art" aria-hidden="true"><div className="track-ring ring-one" /><div className="track-ring ring-two" /><div className="track-ring ring-three" /><span className="distance-big" key={selected.km}>{selected.km}<small>KM</small></span><div className="runner-orbit"><span className="track-runner"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="25" cy="7" r="3" fill="currentColor" stroke="none" /><path d="M22 13 18 23" /><path className="runner-arm" d="m21 14-8 2-4-4m12 2 5 7 6-2" /><path className="runner-leg" d="m18 23 8 5-2 8M18 23l-5 8-8 1" /></svg></span></div><p>{selected.line}</p></div>
        </div>
      </div>
    </section>

    <section className="landing-events" aria-labelledby="events-heading">
      <div className="landing-section">
        <div className="events-section-heading" data-reveal="left"><div><p className="section-index">02 / HẸN NHAU Ở VẠCH XUẤT PHÁT</p><h2 id="events-heading">Lịch hẹn với chính mình.</h2></div><Link className="text-action" href="/events">Tất cả giải chạy <Arrow diagonal /></Link></div>
        <div className="landing-event-grid" aria-live="polite" aria-busy={eventsStatus === 'loading'}>
          {eventsStatus === 'loading' ? [0,1,2].map(i => <div className="event-skeleton" key={i}><div /><p>Đang tìm đường chạy...</p></div>) : eventsStatus === 'error' ? <div className="events-empty"><h3>Đường chạy đang được cập nhật.</h3><p>Chưa tải được lịch giải. Bạn có thể thử kết nối lại.</p><button className="text-action" onClick={() => setRetry(value => value + 1)}>Thử lại <Arrow /></button></div> : events.length ? <div data-reveal="rise"><EventCarousel events={events} /></div> : <div className="events-empty"><h3>Hành trình mới sắp bắt đầu.</h3><p>Các giải chạy sẽ xuất hiện tại đây khi được công bố.</p><Link className="text-action" href="/events">Khám phá danh sách giải <Arrow /></Link></div>}
        </div>
      </div>
    </section>

    <section className="landing-section journey-section" id="how-it-works" aria-labelledby="journey-heading">
      <div className="section-intro" data-reveal="mist"><p className="section-index">03 / ĐƠN GIẢN ĐỂ BẮT ĐẦU</p><div><h2 id="journey-heading">Từ “mình muốn chạy”<br />đến “mình đã làm được”.</h2><p>Một hành trình liền mạch, từ chọn giải đến ngày thi đấu.</p></div></div>
      <div className="journey-grid"><div className="journey-steps" data-reveal="left" role="tablist" aria-orientation="vertical" aria-label="Các bước tham gia">
        {steps.map((item, index) => <button key={item.title} id={'journey-tab-' + index} className={step === index ? 'is-selected' : ''} role="tab" aria-selected={step === index} aria-controls="journey-panel" tabIndex={step === index ? 0 : -1} onKeyDown={event => tabKeys(event, index, steps.length, setStep, 'journey-tab-')} onClick={() => setStep(index)}><span className="step-number">0{index + 1}</span><span><strong>{item.title}</strong><span className="step-body">{item.body}</span></span><Arrow diagonal /></button>)}
      </div><div className="journey-panel" data-reveal="right" role="tabpanel" id="journey-panel" aria-labelledby={'journey-tab-' + step} tabIndex={0}><div className="journey-panel-content" key={step}><p className="section-index">RUNFURTHER / {steps[step].tag}</p><span className="journey-ordinal" aria-hidden="true">0{step + 1}</span><h3>{steps[step].heading.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}</h3><p>{steps[step].detail}</p><Link className="action-light" href={steps[step].link}>{steps[step].cta} <Arrow /></Link></div></div></div>
    </section>

    <section className="landing-section faq-section" id="questions" aria-labelledby="faq-heading"><div data-reveal="mist"><p className="section-index">TRƯỚC KHI XỎ GIÀY</p><h2 id="faq-heading">Có thể bạn<br />đang thắc mắc.</h2><p>Vài điều nhỏ, để bạn sẵn sàng<br />cho một hành trình lớn.</p></div><div className="faq-list">{questions.map(([question, answer], i) => <details key={question} name="landing-faq" data-reveal="right" style={{ "--reveal-delay": i * 70 + "ms" }}><summary><span className="faq-number">0{i + 1}</span><span>{question}</span><span className="faq-plus" aria-hidden="true" /></summary><div className="faq-answer"><p>{answer}</p></div></details>)}</div></section>

    <section className="landing-cta" data-reveal="mist"><div><p className="section-index">VẠCH XUẤT PHÁT Ở NGAY ĐÂY.</p><h2>Hẹn bạn<br />ở ngoài kia<span>.</span></h2></div><div><p>Đôi giày đã sẵn sàng.<br />Còn bạn thì sao?</p><Link className="action-dark" href="/events">Chọn hành trình tiếp theo <Arrow diagonal /></Link><Link className="cta-small-link" href="/register">Chưa có tài khoản? Tham gia RunFurther.</Link></div><span className="cta-background-word" aria-hidden="true">GO.</span></section>
  </div>;
}
