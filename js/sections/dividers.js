// Decorative video divider bands - parallax + scale on scroll. No copy (aria-hidden).

export function initDividers({ reduced } = {}) {
  if (reduced) return;
  document.querySelectorAll('.divider-band').forEach((band) => {
    const layers = band.querySelectorAll('video, .band-poster');
    if (!layers.length) return;
    gsap.fromTo(
      layers,
      { yPercent: -8, scale: 1.16 },
      {
        yPercent: 8, scale: 1.0, ease: 'none',
        scrollTrigger: { trigger: band, start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });
}
