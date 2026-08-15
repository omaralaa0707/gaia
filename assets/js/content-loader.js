(function () {
  const page = document.body.getAttribute('data-content-page');
  if (!page) return;

  function applyValue(el, type, value) {
    if (type === 'image') {
      el.setAttribute('src', value);
    } else {
      el.textContent = value;
    }
  }

  function slotType(el) {
    return el.tagName === 'IMG' ? 'image' : 'text';
  }

  function hydrate() {
    fetch(`/api/content?page=${encodeURIComponent(page)}`)
      .then(r => r.json())
      .then(({ slots }) => {
        if (!slots) return;
        for (const [slotId, value] of Object.entries(slots)) {
          const el = document.querySelector(`[data-slot="${slotId}"]`);
          if (!el) continue; // page/manifest drift — fail soft, keep static content
          applyValue(el, slotType(el), value);
        }
      })
      .catch(() => {}); // network failure — page keeps its last-known-good static content
  }

  hydrate();

  // Edit-mode bridge: only active when embedded (e.g. inside the admin panel's iframe)
  if (window.parent === window) return;

  let editModeOn = false;

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'gaia-cms:enter-edit-mode') {
      editModeOn = true;
      document.querySelectorAll('[data-slot]').forEach(el => {
        el.style.outline = '2px dashed #4f8cff';
        el.style.cursor = 'pointer';
      });
    } else if (msg.type === 'gaia-cms:update-slot') {
      const el = document.querySelector(`[data-slot="${msg.slotId}"]`);
      if (el) applyValue(el, slotType(el), msg.value);
    }
  });

  document.addEventListener('click', (event) => {
    if (!editModeOn) return;
    const el = event.target.closest('[data-slot]');
    if (!el) return;
    event.preventDefault();
    const type = slotType(el);
    const rect = el.getBoundingClientRect();
    window.parent.postMessage({
      type: 'gaia-cms:slot-clicked',
      slotId: el.getAttribute('data-slot'),
      value: type === 'image' ? el.getAttribute('src') : el.textContent,
      slotType: type,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    }, '*');
  }, true);
})();
