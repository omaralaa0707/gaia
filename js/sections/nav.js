// Navbar: scrolled state, hide-on-scroll-down / show-on-up, accessible mobile menu.

import { getLenis } from '../core/scroll.js';

export function initNav() {
  const nav = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  if (!nav) return;

  // Scrolled background + direction-based hide/show via ScrollTrigger.
  let lastY = window.scrollY;
  let hidden = false;
  const show = () => { if (hidden) { gsap.to(nav, { yPercent: 0, duration: 0.4, ease: 'power3.out' }); hidden = false; } };
  const hide = () => { if (!hidden) { gsap.to(nav, { yPercent: -100, duration: 0.4, ease: 'power3.out' }); hidden = true; } };

  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 60);
    if (y > 240 && y > lastY + 4) hide();
    else if (y < lastY - 4 || y < 240) show();
    lastY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile menu
  if (hamburger && menu) {
    hamburger.setAttribute('role', 'button');
    hamburger.setAttribute('aria-label', 'Open menu');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('tabindex', '0');

    const lenis = () => getLenis();
    const open = () => {
      menu.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      const l = lenis(); if (l) l.stop();
      document.body.style.overflow = 'hidden';
      const first = menu.querySelector('a'); if (first) first.focus();
    };
    const close = () => {
      menu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      const l = lenis(); if (l) l.start();
      document.body.style.overflow = '';
    };
    const toggle = () => (menu.classList.contains('open') ? close() : open());

    hamburger.addEventListener('click', toggle);
    hamburger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) close();
    });
  }
}
