// Team: header reveal + batched card stagger. Lazy-loads the 19 photos.

import { splitLines } from '../fx/text.js';

export function initTeam({ reduced } = {}) {
  const team = document.getElementById('team');
  if (!team) return;

  // Lazy/async decode on every team photo (aspect-ratio is fixed → no CLS).
  team.querySelectorAll('.team-photo-wrap img').forEach((img) => {
    img.loading = 'lazy';
    img.decoding = 'async';
  });

  if (reduced) return;

  const label = team.querySelector('.section-label');
  const title = team.querySelector('.section-title');
  const intro = team.querySelector('.team-intro');
  const cards = team.querySelectorAll('.team-card');

  team.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));

  gsap.set([label, intro], { opacity: 0, y: 24 });
  const titleLines = title ? splitLines(title) : [];
  if (!titleLines.length) gsap.set(title, { opacity: 0, y: 24 });

  const head = gsap.timeline({
    scrollTrigger: { trigger: team, start: 'top 74%' },
    defaults: { ease: 'power4.out' },
  });
  head.to(label, { opacity: 1, y: 0, duration: 0.7 });
  if (titleLines.length) head.to(titleLines, { yPercent: 0, duration: 1, stagger: 0.09 }, '-=0.5');
  else head.to(title, { opacity: 1, y: 0, duration: 0.9 }, '-=0.5');
  head.to(intro, { opacity: 1, y: 0, duration: 0.8 }, '-=0.7');

  gsap.set(cards, { opacity: 0, y: 44 });
  ScrollTrigger.batch(cards, {
    start: 'top 88%',
    onEnter: (batch) =>
      gsap.to(batch, { opacity: 1, y: 0, duration: 0.85, ease: 'power3.out', stagger: 0.07, overwrite: true }),
    once: true,
  });
}
