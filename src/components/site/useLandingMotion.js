'use client';
import { useEffect } from 'react';

export default function useLandingMotion(root) {
  useEffect(() => {
    const container = root.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hero = container.querySelector('.landing-hero');
    const seen = new WeakSet();
    let observer, mutations, frame = 0;
    const reveal = node => { node.classList.add('is-visible'); observer?.unobserve(node); };
    const updateMist = () => {
      frame = 0;
      const rect = hero.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height * .8)));
      hero.style.setProperty('--mist-progress', progress.toFixed(3));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(updateMist); };
    const register = () => container.querySelectorAll('[data-reveal]').forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      if (media.matches || !observer) reveal(node);
      else { node.classList.add('will-reveal'); observer.observe(node); }
    });
    const focus = event => {
      // Keyboard users must never land on an invisible or blurred control.
      let node = event.target.closest('[data-reveal]');
      while (node && container.contains(node)) {
        node.classList.remove('will-reveal'); reveal(node);
        node = node.parentElement?.closest('[data-reveal]');
      }
    };
    const setup = () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame); frame = 0;
      if (media.matches) {
        container.querySelectorAll('[data-reveal]').forEach(node => { node.classList.remove('will-reveal'); reveal(node); });
        hero.style.setProperty('--mist-progress', '1');
        observer = null;
      } else {
        observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
          entries.forEach(entry => { if (entry.isIntersecting) reveal(entry.target); });
        }, { threshold: .08, rootMargin: '0px 0px -24px 0px' }) : null;
        container.querySelectorAll('.will-reveal:not(.is-visible)').forEach(node => observer?.observe(node));
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        updateMist();
      }
      register();
    };
    setup();
    mutations = new MutationObserver(register);
    mutations.observe(container, { childList: true, subtree: true });
    media.addEventListener('change', setup);
    container.addEventListener('focusin', focus);
    return () => {
      observer?.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame);
      media.removeEventListener('change', setup); container.removeEventListener('focusin', focus);
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll);
      container.querySelectorAll('[data-reveal]').forEach(node => node.classList.remove('will-reveal'));
      hero.style.removeProperty('--mist-progress');
    };
  }, [root]);
}
