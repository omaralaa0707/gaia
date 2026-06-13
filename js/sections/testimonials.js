// Testimonials: pinned scrubbed reveal on desktop (cards rise in sequence,
// quote glyphs drift); simple staggered fade on mobile.

import { splitLines } from '../fx/text.js';

export function initTestimonials({ isDesktop, reduced } = {}) {
  const sec = document.getElementById('testimonials');
  if (!sec) return;

  const title = sec.querySelector('.section-title');
  const cards = sec.querySelectorAll('div.reveal[style*="border-radius"]');
  const quotes = sec.querySelectorAll('div.reveal[style*="border-radius"] > div:first-child');

  if (reduced) return;

  sec.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));

  const label = sec.querySelector('.section-label');
  gsap.set(label, { opacity: 0, y: 22 });
  const titleLines = title ? splitLines(title) : [];
  if (!titleLines.length) gsap.set(title, { opacity: 0, y: 22 });
  const head = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 72%' }, defaults: { ease: 'power4.out' } });
  head.to(label, { opacity: 1, y: 0, duration: 0.7 });
  if (titleLines.length) head.to(titleLines, { yPercent: 0, duration: 1, stagger: 0.09 }, '-=0.5');
  else head.to(title, { opacity: 1, y: 0, duration: 0.9 }, '-=0.5');

  if (!cards.length) return;

  if (isDesktop) {
    gsap.set(cards, { opacity: 0, y: 80, rotate: (i) => (i - 1) * 1.5, transformOrigin: 'center bottom' });
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sec, start: 'top 60%', end: 'bottom 85%', scrub: 0.6,
      },
    });
    cards.forEach((card, i) => {
      tl.to(card, { opacity: 1, y: 0, rotate: 0, duration: 1, ease: 'power3.out' }, i * 0.5);
    });
    // Oversized quote glyphs drift slightly against scroll.
    quotes.forEach((q) => {
      gsap.fromTo(q, { y: 14 }, {
        y: -14, ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true },
      });
    });
  } else {
    gsap.set(cards, { opacity: 0, y: 40 });
    ScrollTrigger.batch(cards, {
      start: 'top 88%',
      onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12, overwrite: true }),
      once: true,
    });
  }
}
