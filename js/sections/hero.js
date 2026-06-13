// Hero: choreographed intro (returned, fired on preloader reveal) + scroll parallax.

import { splitLines } from '../fx/text.js';

export function initHero({ isDesktop, reduced } = {}) {
  const hero = document.getElementById('hero');
  if (!hero) return () => {};

  const video = hero.querySelector('.hero-bg-video');
  const eyebrow = hero.querySelector('.hero-eyebrow');
  const title = hero.querySelector('.hero-title');
  const sub = hero.querySelector('.hero-sub');
  const ctas = hero.querySelector('.hero-content > div.reveal');
  const stats = hero.querySelector('.hero-stats');
  const statNums = hero.querySelectorAll('.stat-num');

  // Reduced motion: leave everything as the static, fully-visible page.
  if (reduced) return () => {};

  // Mark hero reveals as bespoke so the generic observer leaves them alone.
  hero.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));

  // Pre-intro hidden states (inline → wins over CSS).
  const lines = splitLines(title);
  gsap.set([eyebrow, sub, ctas, stats], { opacity: 0, y: 28 });
  gsap.set(eyebrow, { x: -20 });

  // Scroll parallax on the video + content fade-out.
  if (video) {
    gsap.fromTo(
      video,
      { yPercent: 0, scale: 1.06 },
      {
        yPercent: isDesktop ? -14 : -7, scale: 1.12, ease: 'none',
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      }
    );
  }
  gsap.to(hero.querySelector('.hero-content'), {
    opacity: 0, y: -40, ease: 'none',
    scrollTrigger: { trigger: hero, start: 'center top', end: 'bottom top', scrub: true },
  });

  // Count-up helper that preserves the literal suffix ("+", etc.).
  const countUp = (el, tl, pos) => {
    const raw = el.textContent.trim();
    const target = parseFloat(raw);
    const suffix = raw.replace(/[\d.]/g, '');
    if (isNaN(target)) return;
    const o = { v: 0 };
    el.textContent = '0' + suffix;
    tl.to(o, {
      v: target, duration: 1.1, ease: 'power2.out',
      onUpdate: () => { el.textContent = Math.round(o.v) + suffix; },
    }, pos);
  };

  // The intro timeline, returned to be fired when the preloader hands off.
  return function intro() {
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
    tl.to(eyebrow, { opacity: 1, x: 0, y: 0, duration: 0.9 });
    if (lines.length) {
      tl.to(lines, { yPercent: 0, duration: 1.15, stagger: 0.1 }, '-=0.5');
    } else {
      tl.to(title, { opacity: 1, y: 0, duration: 1 }, '-=0.5');
    }
    tl.to(sub, { opacity: 1, y: 0, duration: 0.9 }, '-=0.7');
    tl.to(ctas, { opacity: 1, y: 0, duration: 0.8 }, '-=0.6');
    tl.to(stats, { opacity: 1, y: 0, duration: 0.8 }, '-=0.55');
    statNums.forEach((el, i) => countUp(el, tl, i === 0 ? '-=0.4' : '<0.1'));
    return tl;
  };
}
