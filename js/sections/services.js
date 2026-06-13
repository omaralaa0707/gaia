// Services: desktop builds a pinned horizontal gallery from the existing grid
// (single source of truth — mobile/no-JS keep the vertical grid). The 6 cards are
// MOVED (not cloned) into a track behind a video intro panel.

export function initServices({ isDesktop, reduced } = {}) {
  const section = document.getElementById('services');
  if (!section || !isDesktop || reduced) return;

  const header = section.querySelector('.services-header');
  const grid = section.querySelector('.services-grid');
  const cards = grid ? [...grid.querySelectorAll('.service-card')] : [];
  if (!grid || cards.length === 0) return;

  // --- Build the pinned structure ---
  document.body.classList.add('has-horizontal');
  section.classList.add('services-track-wrap');

  const pin = document.createElement('div');
  pin.className = 'services-pin';
  pin.setAttribute('data-cursor', 'Drag');
  const track = document.createElement('div');
  track.className = 'services-track';

  // Intro panel = video texture + the original header content (moved in).
  const intro = document.createElement('div');
  intro.className = 'track-intro';
  const video = document.createElement('video');
  video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'none';
  video.setAttribute('aria-hidden', 'true');
  video.poster = 'assets/video/services/texture-poster.jpg';
  const introContent = document.createElement('div');
  introContent.className = 'intro-content';
  if (header) introContent.append(...header.childNodes);
  intro.append(video, introContent);

  track.append(intro, ...cards);

  const progress = document.createElement('div');
  progress.className = 'services-progress';
  const progressBar = document.createElement('span');
  progress.append(progressBar);

  pin.append(track);
  section.append(pin, progress);
  if (header) header.remove();

  // Eager-load the small intro texture (always on-screen while pinned).
  video.src = 'assets/video/services/texture-540.mp4';
  video.load();
  const tryPlay = () => { const p = video.play(); if (p) p.catch(() => {}); };
  tryPlay();

  // --- Horizontal scroll ---
  const getDistance = () => Math.max(0, track.scrollWidth - window.innerWidth + window.innerWidth * 0.14);

  const tween = gsap.to(track, {
    x: () => -getDistance(),
    ease: 'none',
    scrollTrigger: {
      trigger: pin,
      start: 'top top',
      end: () => '+=' + getDistance(),
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => { progressBar.style.width = (self.progress * 100).toFixed(2) + '%'; },
      onEnter: tryPlay,
      onEnterBack: tryPlay,
    },
  });

  // Subtle per-card drift as each card crosses the viewport horizontally.
  cards.forEach((card) => {
    gsap.fromTo(card, { y: 30 }, {
      y: -30, ease: 'none',
      scrollTrigger: {
        trigger: card, containerAnimation: tween,
        start: 'left right', end: 'right left', scrub: true,
      },
    });
  });
}
