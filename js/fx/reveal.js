// Generic scroll-reveal for any .reveal element not claimed by a bespoke section
// animation. Adds .visible (CSS handles the transition). Above-fold elements are
// revealed immediately so the hero/first paint isn't blank.

export function initReveals() {
  const els = document.querySelectorAll('.reveal:not(.gsap-managed)');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });

  els.forEach((el) => obs.observe(el));

  // Reveal anything already near the top on load.
  requestAnimationFrame(() => {
    els.forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.94) el.classList.add('visible');
    });
  });
}
