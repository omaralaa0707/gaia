// Approach: pinned scroll-scrub chapter.
// Desktop + rich media → canvas image-sequence (Apple style, deterministic on all
// engines) with a windowed bitmap cache to bound memory. Mobile → ambient loop
// behind the text. Reduced motion → static poster. Frames download only when the
// section is near the viewport, never on mobile/save-data.

import { flags } from '../core/flags.js';
import { splitLines } from '../fx/text.js';

const FRAME_COUNT = 120;
const FRAME_URL = (i) => `assets/video/scrub/frames/f-${String(i + 1).padStart(3, '0')}.webp`;

export function initApproach({ isDesktop, reduced } = {}) {
  const section = document.getElementById('approach');
  if (!section) return;

  const title = section.querySelector('.approach-title');
  const label = section.querySelector('.section-label');
  const paras = section.querySelectorAll('.approach-body p');
  const tiles = section.querySelectorAll('.method-item');

  // Reduced motion → static poster background, content already visible.
  if (reduced) {
    section.classList.add('has-scrub');
    addLayer(section, 'img', { className: 'scrub-fallback', src: 'assets/video/scrub/scrub-poster.jpg', alt: '' });
    addDim(section);
    return;
  }

  section.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));
  const titleLines = title ? splitLines(title) : [];
  gsap.set([label, ...paras], { opacity: 0, y: 26 });
  gsap.set(tiles, { opacity: 0, y: 30 });

  // --- Mobile / save-data: ambient loop, no pin, normal reveals ---
  if (!isDesktop || flags.saveData) {
    section.classList.add('has-scrub');
    const v = addLayer(section, 'video', { className: 'scrub-fallback' });
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
    v.poster = 'assets/video/scrub/scrub-poster.jpg';
    v.dataset.src = 'assets/video/scrub/scrub-loop-720.mp4'; // media manager already ran;
    v.src = v.dataset.src; v.load(); const p = v.play(); if (p) p.catch(() => {});
    addDim(section);

    const tl = gsap.timeline({ scrollTrigger: { trigger: section, start: 'top 70%' }, defaults: { ease: 'power4.out' } });
    tl.to(label, { opacity: 1, y: 0, duration: 0.7 });
    if (titleLines.length) tl.to(titleLines, { yPercent: 0, duration: 1, stagger: 0.09 }, '-=0.5');
    tl.to(paras, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15 }, '-=0.6');
    tl.to(tiles, { opacity: 1, y: 0, duration: 0.7, stagger: 0.06 }, '-=0.4');
    return;
  }

  // --- Desktop showpiece: pinned canvas scrub ---
  section.classList.add('has-scrub');
  const canvas = addLayer(section, 'canvas', { className: 'scrub-canvas' });
  canvas.setAttribute('role', 'presentation');
  addDim(section);
  const ctx = canvas.getContext('2d');

  const blobs = new Array(FRAME_COUNT);        // small (~64KB each) — keep all
  const bitmaps = new Map();                   // decoded, windowed ±15
  let currentIndex = 0;
  let dims = { w: 0, h: 0 };

  const fetchBlob = async (i) => {
    if (blobs[i]) return blobs[i];
    const res = await fetch(FRAME_URL(i));
    const blob = await res.blob();
    blobs[i] = blob;
    return blob;
  };
  const ensureBitmap = async (i) => {
    if (i < 0 || i >= FRAME_COUNT) return null;
    if (bitmaps.has(i)) return bitmaps.get(i);
    const blob = await fetchBlob(i);
    const bmp = await createImageBitmap(blob);
    bitmaps.set(i, bmp);
    return bmp;
  };
  const trimWindow = (center) => {
    for (const [k, bmp] of bitmaps) {
      if (Math.abs(k - center) > 15) { if (bmp.close) bmp.close(); bitmaps.delete(k); }
    }
  };
  const nearestLoaded = (i) => {
    for (let d = 0; d < FRAME_COUNT; d++) {
      if (bitmaps.has(i - d)) return i - d;
      if (bitmaps.has(i + d)) return i + d;
    }
    return -1;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    dims = { w: r.width, h: r.height };
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(currentIndex);
  };

  const paint = (i) => {
    const idx = bitmaps.has(i) ? i : nearestLoaded(i);
    if (idx < 0 || !dims.w) return;
    const bmp = bitmaps.get(idx);
    // cover fit
    const cr = dims.w / dims.h;
    const ir = bmp.width / bmp.height;
    let dw = dims.w, dh = dims.h, dx = 0, dy = 0;
    if (ir > cr) { dh = dims.h; dw = dh * ir; dx = (dims.w - dw) / 2; }
    else { dw = dims.w; dh = dw / ir; dy = (dims.h - dh) / 2; }
    ctx.clearRect(0, 0, dims.w, dims.h);
    ctx.drawImage(bmp, dx, dy, dw, dh);
  };

  const draw = (i) => {
    currentIndex = i;
    trimWindow(i);
    // Decode a small window around the target, repaint as each lands.
    for (let k = i - 4; k <= i + 4; k++) {
      if (k >= 0 && k < FRAME_COUNT && !bitmaps.has(k)) {
        ensureBitmap(k).then(() => { if (Math.abs(currentIndex - k) <= 1) paint(currentIndex); }).catch(() => {});
      }
    }
    paint(i);
  };

  // Progressive preload: every 6th frame first (coarse scrub), then the rest.
  let preloadStarted = false;
  const preload = async () => {
    if (preloadStarted) return; preloadStarted = true;
    const order = [];
    for (let i = 0; i < FRAME_COUNT; i += 6) order.push(i);
    for (let i = 0; i < FRAME_COUNT; i++) if (i % 6 !== 0) order.push(i);
    for (const i of order) {
      await ensureBitmap(i).catch(() => {});
      if (i === currentIndex || nearestLoaded(currentIndex) >= 0) paint(currentIndex);
      // Immediately trim back to the live window so we never hold all 120 decoded.
      trimWindow(currentIndex);
    }
  };

  // Begin loading ~1 viewport before the section arrives.
  ScrollTrigger.create({ trigger: section, start: 'top bottom+=100%', once: true, onEnter: preload });

  resize();
  ScrollTrigger.addEventListener('refreshInit', resize);

  // Pinned scrub timeline: frames advance across the whole pin; text phases in.
  const frameProxy = { i: 0 };
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section, start: 'top top', end: '+=250%',
      pin: true, scrub: 1, invalidateOnRefresh: true,
    },
  });
  tl.to(frameProxy, {
    i: FRAME_COUNT - 1, duration: 10, ease: 'none',
    onUpdate: () => draw(Math.round(frameProxy.i)),
  }, 0);
  tl.to(label, { opacity: 1, y: 0, duration: 1, ease: 'power3.out' }, 0.4);
  if (titleLines.length) tl.to(titleLines, { yPercent: 0, duration: 1.4, stagger: 0.12, ease: 'power4.out' }, 0.6);
  tl.to(paras, { opacity: 1, y: 0, duration: 1.4, stagger: 0.3, ease: 'power3.out' }, 1.6);
  tl.to(tiles, { opacity: 1, y: 0, duration: 1.6, stagger: 0.25, ease: 'power3.out' }, 4.5);
}

// --- helpers ---
function addLayer(section, tag, attrs) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if (k === 'className') el.className = v; else el.setAttribute(k, v); });
  section.insertBefore(el, section.firstChild);
  return el;
}
function addDim(section) {
  const dim = document.createElement('div');
  dim.className = 'scrub-dim';
  // place above the media layer but below the content grid
  const grid = section.querySelector('.approach-grid');
  section.insertBefore(dim, grid);
}
