// Contact: ambient video already lazy-loads via the media manager. Reveal the
// heading (SplitText) and stagger the WhatsApp/Instagram cards. Cards are tagged
// as magnetic targets (the cursor module wires up the magnetism in Phase 4).

import { splitLines } from '../fx/text.js';

export function initContact({ reduced } = {}) {
  const sec = document.getElementById('contact');
  if (!sec) return;

  const cards = sec.querySelectorAll('a[href*="wa.me"], a[href*="instagram"]');
  cards.forEach((c) => c.setAttribute('data-magnetic', ''));

  if (reduced) return;

  const label = sec.querySelector('.section-label');
  const title = sec.querySelector('h2.reveal');
  const para = sec.querySelector('p.reveal');

  sec.querySelectorAll('.reveal').forEach((el) => el.classList.add('gsap-managed', 'visible'));

  gsap.set([label, para], { opacity: 0, y: 24 });
  const titleLines = title ? splitLines(title) : [];
  if (!titleLines.length) gsap.set(title, { opacity: 0, y: 24 });
  gsap.set(cards, { opacity: 0, y: 30 });

  const tl = gsap.timeline({
    scrollTrigger: { trigger: sec, start: 'top 70%' },
    defaults: { ease: 'power4.out' },
  });
  tl.to(label, { opacity: 1, y: 0, duration: 0.7 });
  if (titleLines.length) tl.to(titleLines, { yPercent: 0, duration: 1, stagger: 0.1 }, '-=0.5');
  else tl.to(title, { opacity: 1, y: 0, duration: 0.9 }, '-=0.5');
  tl.to(para, { opacity: 1, y: 0, duration: 0.8 }, '-=0.6');
  tl.to(cards, { opacity: 1, y: 0, duration: 0.8, stagger: 0.14 }, '-=0.5');
}
