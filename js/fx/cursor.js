// Custom cursor (dot + trailing ring) and magnetic buttons. Desktop fine-pointer
// only - the caller already gates on (hover:hover) and (pointer:fine).

export function initCursor() {
  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  const label = document.createElement('span');
  label.className = 'cursor-label';
  ring.appendChild(label);
  document.body.append(dot, ring);
  document.body.classList.add('cursor-active');

  const xDot = gsap.quickTo(dot, 'x', { duration: 0.18, ease: 'power3' });
  const yDot = gsap.quickTo(dot, 'y', { duration: 0.18, ease: 'power3' });
  const xRing = gsap.quickTo(ring, 'x', { duration: 0.42, ease: 'power3' });
  const yRing = gsap.quickTo(ring, 'y', { duration: 0.42, ease: 'power3' });

  let visible = false;
  window.addEventListener('mousemove', (e) => {
    if (!visible) { visible = true; gsap.to([dot, ring], { opacity: 1, duration: 0.3 }); }
    xDot(e.clientX); yDot(e.clientY);
    xRing(e.clientX); yRing(e.clientY);
  }, { passive: true });
  window.addEventListener('mouseleave', () => {
    visible = false; gsap.to([dot, ring], { opacity: 0, duration: 0.3 });
  });

  // Hover growth + contextual hint label.
  const hintSelector = '[data-cursor], a, button, .service-card, .team-card, .method-item, [data-magnetic]';
  document.querySelectorAll(hintSelector).forEach((el) => {
    const hint = el.getAttribute('data-cursor');
    el.addEventListener('mouseenter', () => {
      ring.classList.add('is-hover');
      if (hint) { label.textContent = hint; ring.classList.add('is-hint'); }
    });
    el.addEventListener('mouseleave', () => {
      ring.classList.remove('is-hover', 'is-hint');
      label.textContent = '';
    });
  });

  initMagnetic();
}

// Magnetic pull toward the pointer for tagged elements.
function initMagnetic() {
  document.querySelectorAll('[data-magnetic], .btn-primary, .nav-cta').forEach((el) => {
    const strength = el.classList.contains('btn-primary') || el.classList.contains('nav-cta') ? 0.4 : 0.22;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      xTo(mx * strength); yTo(my * strength);
    });
    el.addEventListener('mouseleave', () => { xTo(0); yTo(0); });
  });
}
