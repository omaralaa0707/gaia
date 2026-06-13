// ── GAIA motion entry point ──
// Boot order is load-bearing. The inline <head> script has already set
// `is-booting` + `js` classes and pinned scrollRestoration to manual.

import { flags, DESKTOP, MOBILE, MOTION_OK } from './core/flags.js';
import { initSmoothScroll, getLenis, initAnchors } from './core/scroll.js';
import { initVideos } from './core/media.js';
import { runPreloader } from './core/preloader.js';
import { initReveals } from './fx/reveal.js';
import { initNav } from './sections/nav.js';
import { initHero } from './sections/hero.js';
import { initAbout } from './sections/about.js';
import { initServices } from './sections/services.js';
import { initApproach } from './sections/approach.js';
import { initTeam } from './sections/team.js';
import { initTestimonials } from './sections/testimonials.js';
import { initContact } from './sections/contact.js';
import { initDividers } from './sections/dividers.js';
import { initCursor } from './fx/cursor.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

// Smooth scroll (skip entirely under reduced motion → native scroll).
let lenis = null;
if (!flags.reduceMotion) {
  lenis = initSmoothScroll();
  lenis.stop(); // held until the preloader hands off
}
initAnchors();

// Always-on, motion-independent.
initNav();
initVideos();
initReveals();

// Section showpieces live inside matchMedia branches so crossing the 1024px
// breakpoint or toggling OS motion settings cleanly re-initializes them.
const mm = gsap.matchMedia();
const heroApi = {};

mm.add(
  {
    isDesktop: `${DESKTOP} and ${MOTION_OK}`,
    isMobile: `${MOBILE} and ${MOTION_OK}`,
    reduced: '(prefers-reduced-motion: reduce)',
  },
  (ctx) => {
    const { isDesktop, reduced } = ctx.conditions;
    const opts = { isDesktop, reduced };
    heroApi.intro = initHero(opts);
    initDividers(opts);
    initAbout(opts);
    initServices(opts);
    initApproach(opts);
    initTeam(opts);
    initTestimonials(opts);
    initContact(opts);
  }
);

// Cursor + magnetic run after sections build so they catch the horizontal track
// and the magnetic-tagged contact cards.
if (flags.finePointer && !flags.reduceMotion) initCursor();

// Reveal handoff: run the hero intro, release scroll, settle trigger positions.
function onReveal() {
  if (lenis) lenis.start();
  if (heroApi.intro) heroApi.intro();
  ScrollTrigger.refresh();
}

// bfcache restores: skip the whole show.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    document.documentElement.classList.remove('is-booting');
    const pre = document.getElementById('preloader');
    if (pre) pre.remove();
    if (lenis) lenis.start();
  }
});

// Recompute trigger positions once fonts are in (reflow changes line counts).
if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());

runPreloader({ onReveal });
