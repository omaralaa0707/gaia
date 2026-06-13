// Cinematic preloader. Gates on real readiness (fonts + hero poster + hero video),
// counts up, then a choreographed curtain reveal hands off into the hero intro.

import { flags } from './flags.js';
import { primeVideo } from './media.js';

export function runPreloader({ onReveal } = {}) {
  const pre = document.getElementById('preloader');
  const html = document.documentElement;
  const fireReveal = (() => { let done = false; return () => { if (!done) { done = true; onReveal && onReveal(); } }; })();
  const cleanup = () => { html.classList.remove('is-booting'); if (pre) pre.remove(); };

  // No preloader node → just release straight into the hero intro.
  if (!pre) { cleanup(); fireReveal(); return; }

  const bar = pre.querySelector('.pre-bar');
  const count = pre.querySelector('.pre-count');
  const letters = pre.querySelectorAll('.pre-word span');
  const heroVideo = document.querySelector('.hero-bg-video');

  // Reduced motion: brief fade, no theatrics.
  if (flags.reduceMotion) {
    fireReveal();
    gsap.to(pre, { opacity: 0, duration: 0.4, delay: 0.25, onComplete: cleanup });
    return;
  }

  const state = { p: 0 };
  const setProgress = (v) => {
    state.p = v;
    if (bar) gsap.set(bar, { scaleX: v / 100 });
    if (count) count.textContent = Math.round(v);
  };

  // Readiness: fonts + hero poster decode + hero video first frame (raced w/ timeout).
  const heroPoster = new Image();
  const readiness = Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((res) => {
      if (!heroVideo) return res();
      const posterSrc = heroVideo.getAttribute('poster');
      if (!posterSrc) return res();
      heroPoster.onload = heroPoster.onerror = () => res();
      heroPoster.src = posterSrc;
    }),
    heroVideo ? primeVideo(heroVideo) : Promise.resolve(),
  ]);

  // Crawl to ~85% while loading, then snap to 100 on ready.
  const crawl = gsap.to(state, {
    p: 85, duration: 2.4, ease: 'power1.out',
    onUpdate: () => setProgress(state.p),
  });

  let revealed = false;
  const reveal = () => {
    if (revealed) return; revealed = true;
    crawl.kill();

    const tl = gsap.timeline({ onComplete: cleanup });
    tl.to(state, { p: 100, duration: 0.5, ease: 'power2.out', onUpdate: () => setProgress(state.p) });
    tl.to(letters, { yPercent: -120, duration: 0.7, ease: 'power4.in', stagger: 0.05 }, '-=0.1');
    tl.to([count, pre.querySelector('.pre-track'), pre.querySelector('.pre-sub')], { opacity: 0, duration: 0.4 }, '<');
    tl.to(pre, { yPercent: -100, duration: 1.1, ease: 'power4.inOut' }, '-=0.15');
    // Hand off to the hero intro just before the curtain finishes clearing.
    tl.add(fireReveal, '-=0.6');
  };

  readiness.then(() => gsap.delayedCall(Math.max(0, 0.5 - crawl.time()), reveal));
  gsap.delayedCall(5, reveal); // safety: never trap behind a stalled asset
}
