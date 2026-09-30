'use client';
import { useEffect, useRef } from 'react';

const stops = [0, .25, .47, .71, 1];
const chapterAt = value => {
  for (let i = 0; i < stops.length - 1; i++) if (value < (stops[i] + stops[i + 1]) / 2) return i;
  return 4;
};
const activities = ['idle', 'drinking', 'idle', 'receiving-kit', 'medal'];

export default function useJourneyController({ root, canvasHost, simple, failed, panel, setFailed, setEnhanced, setChapter, setActivity }) {
  const controller = useRef(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(() => { controller.current?.setPanelOpen(Boolean(panel)); }, [panel]);

  useEffect(() => {
    const node = root.current;
    const media = matchMedia('(prefers-reduced-motion: reduce), (max-height: 650px)');
    let disposed = false, generation = 0, cleanup = () => {};
    async function setup() {
      const run = ++generation;
      cleanup(); cleanup = () => {}; controller.current = null;
      node.dataset.enhanced = 'false'; setEnhanced(false); setActivity('idle');
      if (media.matches || simple || failed) return;
      try {
        const [{ createRaceWorld }, { gsap }, { ScrollTrigger }] = await Promise.all([
          import('./createRaceWorld'), import('gsap'), import('gsap/ScrollTrigger'),
        ]);
        if (disposed || run !== generation) return;
        gsap.registerPlugin(ScrollTrigger);
        const stage = node.querySelector('.immersive-stage'), header = document.querySelector('.app-header');
        let alive = true, frame = 0, resizeFrame = 0, visible = true, lastTime = 0, lastSize = '';
        let trigger, observer, resize, travel, action, busy = false, current = 0, lastPhase = -1;
        let lastWheel = -Infinity, touchStart = null, lastProgress = 0, movingUntil = 0;
        let paused = Boolean(panelRef.current);
        const state = { progress: 0, running: 0, gait: 0, travelDirection: 1, actionProgress: 0, actionIndex: 0, kitCollected: false, medalAwarded: false };
        const world = createRaceWorld(canvasHost.current, () => { if (alive) setFailed(true); });
        cleanup = () => {
          alive = false; cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame);
          observer?.disconnect(); resize?.disconnect(); travel?.kill(); action?.kill();
          document.removeEventListener('visibilitychange', visibility);
          window.removeEventListener('wheel', wheel); window.removeEventListener('keydown', keydown);
          stage.removeEventListener('touchstart', touchBegin); stage.removeEventListener('touchmove', touchMove); stage.removeEventListener('touchend', touchEnd);
          trigger?.kill(true); world.dispose();
          delete node.dataset.scrollStart; delete node.dataset.scrollEnd;
        };
        function sync(progress) {
          state.progress = progress;
          if (Math.abs(progress - lastProgress) > .00001 && !busy) movingUntil = performance.now() + 150;
          lastProgress = progress;
          if (progress < .68) state.kitCollected = false;
          if (progress < .97) state.medalAwarded = false;
          const next = chapterAt(progress);
          if (next !== lastPhase) {
            const old = node.querySelector('.immersive-chapter:not([inert])');
            if (old?.contains(document.activeElement)) node.querySelectorAll('.immersive-controls nav button')[next]?.focus({ preventScroll: true });
            lastPhase = next; setChapter(next);
          }
          if (!busy) current = next;
          node.style.setProperty('--journey-progress', progress.toFixed(4));
        }
        function draw(now) {
          frame = 0;
          if (!alive || !visible || document.hidden || paused) { lastTime = 0; return; }
          const dt = lastTime ? Math.min((now - lastTime) / 1000, .06) : 0;
          lastTime = now;
          if (!busy) state.running = now < movingUntil ? 1 : 0;
          state.gait += dt * 11 * state.running;
          world.render(state, now / 1000);
          frame = requestAnimationFrame(draw);
        }
        function wake() { if (alive && visible && !document.hidden && !paused && !frame) frame = requestAnimationFrame(draw); }
        function visibility() {
          if (document.hidden) { cancelAnimationFrame(frame); frame = 0; lastTime = 0; travel?.pause(); action?.pause(); }
          else if (!paused) { travel?.resume(); action?.resume(); wake(); }
        }
        function finishArrival(index) {
          current = index; busy = false; state.running = 0; movingUntil = 0;
          if (index === 3) state.kitCollected = true;
          if (index === 4) state.medalAwarded = true;
          setActivity('idle');
        }
        function arrive(index) {
          state.running = 0; state.actionIndex = index; state.actionProgress = 0;
          const activity = activities[index]; setActivity(activity);
          if (activity === 'idle') { finishArrival(index); return; }
          action = gsap.to(state, {
            actionProgress: 1, duration: index === 1 ? 2 : 1.7, ease: 'none',
            onComplete: () => finishArrival(index),
          });
          if (paused || document.hidden) action.pause();
        }
        function move(index) {
          if (!alive || busy || !trigger) return;
          index = Math.max(0, Math.min(4, index));
          if (Math.abs(state.progress - stops[index]) < .002) { current = index; return; }
          busy = true; current = index; setActivity('running');
          state.travelDirection = stops[index] < state.progress ? -1 : 1;
          state.running = 1; state.actionProgress = 0; state.actionIndex = 0;
          if (index < 3) state.kitCollected = false;
          if (index < 4) state.medalAwarded = false;
          const position = { value: scrollY };
          const destination = trigger.start + (trigger.end - trigger.start) * stops[index];
          travel = gsap.to(position, {
            value: destination, duration: 2.8 + Math.min(1.2, Math.abs(state.progress - stops[index]) * 1.2), ease: 'none',
            onUpdate: () => { window.scrollTo({ top: position.value, behavior: 'instant' }); ScrollTrigger.update(); },
            onComplete: () => { sync(stops[index]); arrive(index); },
          });
          if (paused || document.hidden) travel.pause();
        }
        const interactive = target => target instanceof Element && target.closest('.immersive-panel-dialog, [data-support-widget], input, textarea, select, [contenteditable], .app-header');
        function inScene() {
          if (!trigger || paused) return false;
          return scrollY >= trigger.start - 3 && scrollY <= trigger.end + 3;
        }
        function canLeave(direction) {
          return !busy && ((direction < 0 && state.progress < .002) || (direction > 0 && state.progress > .998));
        }
        function wheel(event) {
          if (paused && !interactive(event.target) && event.cancelable) { event.preventDefault(); return; }
          if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || Math.abs(event.deltaY) < 2 || interactive(event.target) || !inScene()) return;
          const direction = Math.sign(event.deltaY);
          if (canLeave(direction)) return;
          event.preventDefault();
          const now = performance.now(), quiet = now - lastWheel > 240;
          lastWheel = now;
          // One wheel/trackpad gesture is one leg. Ignore both busy input and its momentum tail.
          if (!busy && quiet) move(current + direction);
        }
        function keydown(event) {
          if (!inScene() || interactive(event.target) || (event.target instanceof Element && event.target.closest('button,a')) || event.altKey || event.ctrlKey || event.metaKey) return;
          const direction = ['ArrowDown','PageDown',' '].includes(event.key) ? 1 : ['ArrowUp','PageUp'].includes(event.key) ? -1 : 0;
          if (!direction || canLeave(direction)) return;
          event.preventDefault(); if (!event.repeat && !busy) move(current + direction);
        }
        function touchBegin(event) {
          touchStart = !interactive(event.target) && event.touches.length === 1 && inScene()
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
        }
        function touchMove(event) {
          if (!touchStart || event.touches.length !== 1) { touchStart = null; return; }
          const dy = touchStart.y - event.touches[0].clientY, dx = touchStart.x - event.touches[0].clientX;
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) && !canLeave(Math.sign(dy))) event.preventDefault();
        }
        function touchEnd(event) {
          if (!touchStart || !event.changedTouches.length) return;
          const dy = touchStart.y - event.changedTouches[0].clientY, dx = touchStart.x - event.changedTouches[0].clientX;
          touchStart = null;
          if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) && !busy && !canLeave(Math.sign(dy))) move(current + Math.sign(dy));
        }
        function size() {
          if (!alive) return;
          const headerHeight = header?.getBoundingClientRect().height || 0;
          const dimensions = [stage.clientWidth, innerHeight, headerHeight].join(':');
          if (dimensions === lastSize) return;
          lastSize = dimensions; node.style.setProperty('--scene-header', headerHeight + 'px');
          if (!resizeFrame) resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0; if (alive) { trigger?.refresh(); world.resize(); }
          });
        }
        node.dataset.enhanced = 'true'; setEnhanced(true);
        node.style.setProperty('--scene-header', (header?.getBoundingClientRect().height || 0) + 'px');
        world.resize();
        trigger = ScrollTrigger.create({
          trigger: stage, pin: true, pinSpacing: true, start: () => 'top ' + (header?.getBoundingClientRect().height || 0),
          end: '+=6000', anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: self => sync(self.progress),
          onRefresh: self => { node.dataset.scrollStart = String(self.start); node.dataset.scrollEnd = String(self.end); world.resize(); sync(self.progress); },
        });
        controller.current = {
          go: move,
          next: () => move(current + 1),
          previous: () => move(current - 1),
          setPanelOpen(value) {
            paused = value; state.running = 0;
            if (paused) { travel?.pause(); action?.pause(); cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
            else if (!document.hidden) { if (busy && travel?.progress() < 1) state.running = 1; travel?.resume(); action?.resume(); wake(); }
          },
        };
        observer = new IntersectionObserver(entries => {
          visible = entries[0].isIntersecting;
          if (!visible) { cancelAnimationFrame(frame); frame = 0; lastTime = 0; } else wake();
        });
        observer.observe(node);
        resize = new ResizeObserver(size); resize.observe(stage); if (header) resize.observe(header);
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('keydown', keydown);
        stage.addEventListener('touchstart', touchBegin, { passive: true });
        stage.addEventListener('touchmove', touchMove, { passive: false }); stage.addEventListener('touchend', touchEnd, { passive: true });
        sync(trigger.progress); wake(); trigger.refresh();
      } catch {
        if (!disposed && run === generation) { cleanup(); cleanup = () => {}; setFailed(true); }
      }
    }
    setup(); media.addEventListener('change', setup);
    return () => { disposed = true; ++generation; cleanup(); controller.current = null; media.removeEventListener('change', setup); };
  }, [simple, failed, root, canvasHost, setFailed, setEnhanced, setChapter, setActivity]);
  return controller;
}
