'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useJourneyController from './useJourneyController';
import './trail-scene.css';

const checkpoints = [
  { name: 'Xuất phát', eyebrow: 'VẠCH XUẤT PHÁT / 01', title: 'Bước ra ngoài.', accent: 'Chạy xa hơn.', body: 'Bạn đang đứng ở vạch xuất phát. Cuộn một lần để bắt đầu chạy đến trạm tiếp theo.', href: '/events', action: 'Tìm giải chạy' },
  { name: 'Trạm nước', eyebrow: 'TRẠM 02 / TIẾP THÊM NĂNG LƯỢNG', title: 'Nghỉ một nhịp.', accent: 'Đi thêm một chặng.', body: 'Một ngụm nước, một hơi thở sâu. Khám phá lịch giải trong khi chuẩn bị cho chặng đường tiếp theo.', href: '#events-heading', action: 'Khám phá các giải' },
  { name: 'Cung đường', eyebrow: 'TRẠM 03 / CHỌN THỬ THÁCH', title: 'Mỗi người một nhịp.', accent: 'Mỗi bước một hành trình.', body: 'Nhìn lại cung đường từ trên cao. Chọn 5, 10, 21 hay 42 km phù hợp với nhịp chạy của bạn.', href: '#your-distance', action: 'Chọn cự ly của bạn' },
  { name: 'Race kit', eyebrow: 'TRẠM 04 / SẴN SÀNG LÊN ĐƯỜNG', title: 'Nhận hành trang.', accent: 'Mang theo háo hức.', body: 'Nhận race kit và tiếp tục đến vạch đích. Tìm hiểu các bước đăng ký, nhận vé và check-in ngay tại đây.', href: '#how-it-works', action: 'Cách tham gia giải' },
  { name: 'Về đích', eyebrow: 'VỀ ĐÍCH / 05', title: 'Một tấm huy chương.', accent: 'Một khởi đầu mới.', body: 'Bạn đã hoàn thành hành trình. Giờ là lúc chọn một đường chạy thật và viết câu chuyện của riêng mình.', href: '/register', action: 'Bắt đầu hành trình' },
];
const panelNames = { distance: 'Chọn cự ly', events: 'Lịch giải', guide: 'Cách tham gia', faq: 'Hỏi đáp' };
const hashes = { '#your-distance': 'distance', '#events-heading': 'events', '#how-it-works': 'guide', '#questions': 'faq' };
const activityLabels = { idle: 'Cuộn một lần để đến trạm tiếp theo', running: 'Đang chạy đến trạm tiếp theo…', drinking: 'Tiếp nước trước chặng mới…', 'receiving-kit': 'Nhận race kit…', medal: 'Nhận huy chương về đích…' };

export default function TrailScene({ panels = {} }) {
  const root = useRef(null), canvasHost = useRef(null), dialog = useRef(null), returnFocus = useRef(null);
  const [enhanced, setEnhanced] = useState(false), [chapter, setChapter] = useState(0);
  const [simple, setSimple] = useState(false), [failed, setFailed] = useState(false);
  const [activity, setActivity] = useState('idle'), [panel, setPanel] = useState(null);
  const controller = useJourneyController({ root, canvasHost, simple, failed, panel, setFailed, setEnhanced, setChapter, setActivity });
  const busy = activity !== 'idle';

  function openPanel(key) {
    if (!enhanced) { root.current.querySelector('[data-panel-page="' + key + '"]')?.scrollIntoView({ behavior: 'instant', block: 'start' }); return; }
    returnFocus.current = document.activeElement;
    setPanel(key);
  }
  function closePanel() {
    setPanel(null);
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      if (!root.current) return;
      if (target instanceof HTMLElement && !target.closest('[inert]')) target.focus({ preventScroll: true });
      else root.current.querySelector('.immersive-panel-trigger')?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!panel || !enhanced) return;
    dialog.current?.focus({ preventScroll: true });
    const handle = event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.current.querySelectorAll('a[href],button:not(:disabled),input,select,textarea,[tabindex="0"]')]
        .filter(node => node.getClientRects().length && !node.closest('[hidden],[inert]'));
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [panel, enhanced]);
  useEffect(() => {
    const followHash = () => {
      const key = hashes[location.hash];
      if (key && enhanced) { returnFocus.current = root.current.querySelector('.immersive-panel-trigger[data-panel="' + key + '"]'); setPanel(key); }
    };
    followHash(); window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, [enhanced]);
  useEffect(() => { if (!enhanced) setPanel(null); }, [enhanced]);

  function go(index) {
    if (controller.current) controller.current.go(index);
    else root.current.querySelectorAll('.immersive-chapter')[index].scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  function toggleSimple() {
    setPanel(null); root.current.scrollIntoView({ behavior: 'instant', block: 'start' }); setSimple(value => !value);
  }
  function anchors(event) {
    const link = event.target.closest('a[href^="#"]');
    const key = link && hashes[link.getAttribute('href')];
    if (key && enhanced) { event.preventDefault(); openPanel(key); }
  }

  return <section ref={root} className="landing-hero immersive-journey" data-enhanced={enhanced} data-chapter={chapter} data-activity={activity} data-panel-open={Boolean(panel)} aria-label="Hành trình RunFurther" onClickCapture={anchors}>
    <div className="immersive-stage">
      <div className="immersive-canvas" ref={canvasHost} aria-hidden="true" />
      <img className="immersive-fallback-photo" src="/assets/figma/event-trail.png" alt="" fetchPriority="high" />
      <div className="immersive-vignette" aria-hidden="true" />
      <div className="hero-scroll-mist" aria-hidden="true" />
      <div className="immersive-topline" aria-hidden="true"><span>RUNFURTHER — YOUR NEXT CHAPTER</span><span>CHẠY THEO NHỊP CỦA BẠN.</span></div>
      <div className="immersive-library" inert={enhanced && Boolean(panel)} aria-label="Khám phá RunFurther">{Object.entries(panelNames).map(([key,label]) => <button type="button" key={key} className="immersive-panel-trigger" data-panel={key} onClick={() => openPanel(key)}>{label}<span aria-hidden="true">↗</span></button>)}</div>
      {checkpoints.map((item, i) => <div key={i} className={'immersive-chapter immersive-chapter-' + i} inert={enhanced && (chapter !== i || Boolean(panel))} aria-hidden={enhanced && (chapter !== i || Boolean(panel)) ? true : undefined}>
        <div className="immersive-copy">
          <p className="hero-eyebrow"><span />{item.eyebrow}</p>
          {i === 0 ? <h1 id="hero-heading">{item.title}<br /><span>{item.accent}</span></h1> : <h2>{item.title}<br /><em>{item.accent}</em></h2>}
          <p className="immersive-description">{item.body}</p>
          <div className="hero-actions"><Link className="action-primary" href={item.href}>{item.action}<span aria-hidden="true">↗</span></Link>{i === 0 && <a className="hero-secondary" href="#your-distance">Chọn cự ly ↗</a>}{i === 4 && <a className="hero-secondary" href="#questions">Giải đáp trước khi đăng ký ↗</a>}</div>
          {i === 2 && <p className="immersive-disclaimer">Sa bàn minh họa. Lộ trình chính thức tại trang của từng giải.</p>}
          {i === 3 && <p className="immersive-disclaimer">Race kit minh họa. Vật phẩm thực tế tùy theo ban tổ chức.</p>}
        </div>
        <span className="immersive-chapter-number" aria-hidden="true">{String(i + 1).padStart(2,'0')}</span>
      </div>)}
      <div className="immersive-controls" inert={enhanced && Boolean(panel)}>
        <nav aria-label="Các trạm hành trình">{checkpoints.map((item,i) => <button key={i} type="button" aria-label={'Trạm ' + (i + 1) + ': ' + item.name} aria-current={enhanced && chapter === i ? 'step' : undefined} disabled={enhanced && busy} onClick={() => go(i)}><span>{String(i + 1).padStart(2,'0')}</span><span>{item.name}</span></button>)}</nav>
        <div className="immersive-step-controls"><button className="immersive-step-previous" type="button" disabled={!enhanced || busy || chapter === 0} aria-label="Trạm trước" onClick={() => controller.current?.previous()}>←</button><p role="status" aria-live="polite">{activityLabels[activity]}</p><button className="immersive-step-next" type="button" disabled={!enhanced || busy || chapter === 4} aria-label="Trạm tiếp theo" onClick={() => controller.current?.next()}>→</button></div>
        <div className="immersive-controls-actions"><a href="#your-distance" className="immersive-skip">Đến chọn cự ly ↗</a>{!failed && <button type="button" className="immersive-motion-toggle" aria-pressed={simple} onClick={toggleSimple}>{simple ? 'Bật trải nghiệm 3D' : 'Xem ít chuyển động'}</button>}</div>
        <span className="immersive-progress" aria-hidden="true" />
      </div>
      <div className="immersive-panel-dialog" ref={dialog} role={enhanced && panel ? 'dialog' : undefined} aria-modal={enhanced && panel ? true : undefined} aria-labelledby={enhanced && panel ? 'immersive-panel-title' : undefined} tabIndex={enhanced && panel ? -1 : undefined} data-open={panel || ''}>
        {enhanced && panel && <div className="immersive-panel-header"><h2 id="immersive-panel-title">{panelNames[panel]}</h2><button type="button" className="immersive-panel-close" aria-label="Đóng nội dung" onClick={closePanel}>Đóng <span aria-hidden="true">×</span></button></div>}
        {Object.entries(panels).map(([key,content]) => <div key={key} className="immersive-panel-page" data-panel-page={key} hidden={enhanced && panel !== key}>{content}</div>)}
      </div>
      {enhanced && panel && <button type="button" className="immersive-panel-backdrop" aria-label="Đóng bảng nội dung" tabIndex={-1} onClick={closePanel} />}
      {failed && <p className="immersive-fallback-note" role="status">Chế độ ảnh tĩnh đang được sử dụng. Bạn vẫn có thể khám phá và đăng ký giải.</p>}
      <noscript><style>{'.immersive-controls nav,.immersive-motion-toggle,.immersive-step-controls,.immersive-library{display:none}'}</style></noscript>
    </div>
  </section>;
}
