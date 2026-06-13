// Lazy video manager.
// Ambient videos ship as <video preload="none" poster ...> with data-src (and
// optional data-src-mobile). We inject the source only when the element nears the
// viewport, then play/pause via a tighter observer. If richMedia is false
// (reduced-motion / save-data) we never inject anything — the poster stands alone.

import { flags } from './flags.js';

const loadObserver = new IntersectionObserver(onLoadIntersect, {
  rootMargin: '100% 0px',
});
const playObserver = new IntersectionObserver(onPlayIntersect, {
  rootMargin: '10% 0px',
  threshold: 0.01,
});

const mobile = window.matchMedia('(max-width: 768px)');

function pickSrc(video) {
  const m = video.dataset.srcMobile;
  return mobile.matches && m ? m : video.dataset.src;
}

function injectSource(video) {
  if (video.dataset.loaded) return;
  const src = pickSrc(video);
  if (!src) return;
  video.src = src;
  video.dataset.loaded = '1';
  video.load();
}

function onLoadIntersect(entries) {
  for (const e of entries) {
    if (e.isIntersecting) {
      injectSource(e.target);
      loadObserver.unobserve(e.target);
    }
  }
}

function onPlayIntersect(entries) {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting) {
      injectSource(v);
      const p = v.play();
      if (p) p.catch(() => {}); // autoplay denial / Low Power Mode → poster stays
    } else if (!v.paused) {
      v.pause();
    }
  }
}

// Register every [data-src] video. Call once after DOM is ready.
export function initVideos() {
  const videos = document.querySelectorAll('video[data-src]');
  if (!flags.richMedia) return; // posters only

  videos.forEach((v) => {
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    loadObserver.observe(v);
    playObserver.observe(v);
  });
}

// Eagerly prepare a single video (the hero) and resolve when it can paint.
export function primeVideo(video, timeout = 3500) {
  return new Promise((resolve) => {
    if (!flags.richMedia) return resolve(false);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    video.addEventListener('loadeddata', () => finish(true), { once: true });
    injectSource(video);
    const p = video.play();
    if (p) p.catch(() => {});
    setTimeout(() => finish(false), timeout);
  });
}
