// Team profile modal: clicking a .team-card opens the therapist's bio in an
// overlay instead of navigating to profile.html (which stays as a plain,
// linkable fallback - e.g. for opening in a new tab, or if JS fails).

import { getLenis } from '../core/scroll.js';

export function initTeamModal() {
  const modal = document.getElementById('team-modal');
  const body = document.getElementById('team-modal-body');
  const cards = document.querySelectorAll('.team-card');
  if (!modal || !body || !cards.length) return;

  const cache = new Map();
  let lastFocused = null;

  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      const url = new URL(card.href, location.href);
      const slug = url.searchParams.get('slug');
      if (!slug) return; // let it navigate normally
      e.preventDefault();
      lastFocused = card;
      open(slug);
    });
  });

  modal.querySelectorAll('[data-modal-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  async function open(slug) {
    show();
    body.innerHTML = '<div class="team-modal-loading">Loading&hellip;</div>';

    try {
      let therapist = cache.get(slug);
      if (!therapist) {
        const res = await fetch(`/api/team?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error('not found');
        ({ therapist } = await res.json());
        cache.set(slug, therapist);
      }
      render(therapist);
    } catch {
      body.innerHTML = `<div class="team-modal-loading">Could not load this profile. <a href="profile.html?slug=${encodeURIComponent(slug)}">Open full page &rarr;</a></div>`;
    }
  }

  function render(t) {
    const photoHtml = t.photo_url
      ? `<img class="tm-photo" src="${esc(t.photo_url)}" alt="${esc(t.name)}">`
      : `<div class="tm-photo-empty">${esc((t.name || '?').charAt(0))}</div>`;

    const details = Array.isArray(t.details) ? t.details : [];
    const factsHtml = [{ label: 'Role', value: t.role }, ...details]
      .filter((d) => d.value)
      .map((d) => `<div class="tm-fact"><strong>${esc(d.label)}</strong>${esc(d.value)}</div>`)
      .join('');

    const bio = (t.bio || '').trim();
    const bioHtml = bio
      ? bio.split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
      : '<p class="tm-bio-empty">Full bio coming soon.</p>';

    body.innerHTML = `
      <div class="tm-grid">
        <div>
          ${photoHtml}
          <div class="tm-facts">${factsHtml}</div>
          <a href="book.html" class="tm-cta">Book with ${esc((t.name || '').split(' ')[0])}</a>
        </div>
        <div>
          <div class="tm-eyebrow">Gaia Specialist</div>
          <h2 class="tm-name" id="tm-name">${esc(t.name)}</h2>
          <div class="tm-role">${esc(t.role || '')}</div>
          <div class="tm-bio">${bioHtml}</div>
        </div>
      </div>`;
  }

  function show() {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    getLenis()?.stop();
    modal.querySelector('.team-modal-close')?.focus();
  }

  function close() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    getLenis()?.start();
    lastFocused?.focus();
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
