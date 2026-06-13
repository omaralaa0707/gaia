// About: portrait clip-path reveal + parallax, badge pop, staggered text.

import { splitLines } from '../fx/text.js';

export function initAbout({ reduced } = {}) {
  if (reduced) return;
  const about = document.getElementById('about');
  if (!about) return;

  const imgWrap = about.querySelector('.about-img-wrap');
  const img = about.querySelector('.about-img-main');
  const badge = about.querySelector('.about-img-badge');
  const label = about.querySelector('.section-label');
  const title = about.querySelector('.section-title');
  const paras = about.querySelectorAll('.about-body, p.reveal');
  const tags = about.querySelectorAll('.cert-tag');

  about.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));

  if (img) gsap.set(img, { clipPath: 'inset(0% 0% 100% 0%)', scale: 1.15 });
  if (badge) gsap.set(badge, { opacity: 0, scale: 0.7, rotate: -6 });
  gsap.set(label, { opacity: 0, y: 26 });
  const titleLines = title ? splitLines(title) : [];
  if (!titleLines.length) gsap.set(title, { opacity: 0, y: 26 });
  gsap.set(paras, { opacity: 0, y: 22 });
  gsap.set(tags, { opacity: 0, y: 16 });

  const tl = gsap.timeline({
    scrollTrigger: { trigger: about, start: 'top 72%' },
    defaults: { ease: 'power4.out' },
  });
  if (img) tl.to(img, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 1.3 });
  tl.to(label, { opacity: 1, y: 0, duration: 0.7 }, '-=1.0');
  if (titleLines.length) tl.to(titleLines, { yPercent: 0, duration: 1, stagger: 0.09 }, '-=0.8');
  else tl.to(title, { opacity: 1, y: 0, duration: 0.9 }, '-=0.8');
  if (badge) tl.to(badge, { opacity: 1, scale: 1, rotate: 0, duration: 0.8, ease: 'back.out(1.6)' }, '-=0.7');
  tl.to(paras, { opacity: 1, y: 0, duration: 0.8, stagger: 0.12 }, '-=0.6');
  tl.to(tags, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06 }, '-=0.4');

  // Gentle continuous parallax on the portrait.
  if (imgWrap) {
    gsap.fromTo(imgWrap, { y: 30 }, {
      y: -30, ease: 'none',
      scrollTrigger: { trigger: about, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }
}
