// Lenis smooth scroll + ScrollTrigger wiring.
// Lenis drives NATIVE scroll, so position:fixed (nav, grain) and ScrollTrigger
// pins (pinType:"fixed") keep working. Never normalizeScroll, never transform body.

let lenis = null;

export function initSmoothScroll() {
  if (lenis) return lenis;
  lenis = new Lenis({
    duration: 1.1,
    lerp: 0.09,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    syncTouch: false, // native momentum on touch
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  ScrollTrigger.config({ ignoreMobileResize: true });

  return lenis;
}

export function getLenis() {
  return lenis;
}

// Anchor links → smooth scroll with navbar offset. Works whether or not Lenis exists.
export function initAnchors(offset = -84) {
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) {
        lenis.scrollTo(target, { offset });
      } else {
        const y = target.getBoundingClientRect().top + window.scrollY + offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });
}
