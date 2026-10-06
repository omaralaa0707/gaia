// Ambient nature soundscape - synthesized with Web Audio (no audio files).
// Layers: soft wind, rustling leaves, a faint stream, and occasional distant birds.
// Plays by default (see initAmbient for autoplay limits); a floating toggle mutes it and the choice is
// remembered across pages.

const KEY = 'gaia-ambient';
const MASTER = 0.5;

const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
};

let ctx = null;
let master = null;
let birdTimer = null;
let playing = false;

function noiseBuffer(c, seconds = 6) {
  const buf = c.createBuffer(2, c.sampleRate * seconds, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish: soft, low-heavy
      d[i] = last * 3.5;
    }
  }
  return buf;
}

function lfo(c, rate, depth, target) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
}

function layer(c, buffer, { type, freq, q = 0.7, gain, sweepRate, sweepDepth, swellRate, swellDepth }) {
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.loopStart = Math.random() * 2; // de-sync layers so they never phase together
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  if (sweepRate) lfo(c, sweepRate, sweepDepth, filter.frequency);
  if (swellRate) lfo(c, swellRate, swellDepth, g.gain);
  src.start();
}

function chirp(c) {
  const t = c.currentTime + 0.05;
  const base = 2400 + Math.random() * 1800;
  const notes = 2 + Math.floor(Math.random() * 3);
  const pan = c.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(master);
  for (let i = 0; i < notes; i++) {
    const s = t + i * 0.16;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, s);
    o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), s + 0.07);
    o.frequency.exponentialRampToValueAtTime(base * 0.95, s + 0.13);
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.035, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
    o.connect(g).connect(pan);
    o.start(s);
    o.stop(s + 0.16);
  }
}

function scheduleBirds() {
  birdTimer = setTimeout(() => {
    if (playing && ctx && ctx.state === 'running') chirp(ctx);
    scheduleBirds();
  }, 3500 + Math.random() * 7500);
}

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const buf = noiseBuffer(ctx);

  // Wind: slow breathing swell
  layer(ctx, buf, { type: 'lowpass', freq: 520, gain: 0.55, sweepRate: 0.06, sweepDepth: 220, swellRate: 0.09, swellDepth: 0.22 });
  // Leaves: airy rustle that comes and goes
  layer(ctx, buf, { type: 'highpass', freq: 3200, q: 0.4, gain: 0.05, swellRate: 0.13, swellDepth: 0.035 });
  // Stream: mid-band shimmer
  layer(ctx, buf, { type: 'bandpass', freq: 1300, q: 0.9, gain: 0.09, sweepRate: 0.4, sweepDepth: 350, swellRate: 0.21, swellDepth: 0.03 });
  scheduleBirds();
  return true;
}

async function start() {
  if (!ctx && !build()) return false;
  if (ctx.state === 'suspended') await ctx.resume();
  playing = true;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(MASTER, ctx.currentTime, 1.2);
  return true;
}

function stop() {
  playing = false;
  if (!ctx) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => { if (!playing && ctx) ctx.suspend(); }, 1800);
}

const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';

const CSS = `
.ambient-toggle{position:fixed;left:1.2rem;bottom:1.2rem;z-index:90;display:flex;align-items:center;gap:.6rem;
  padding:.7rem 1rem .7rem .8rem;border-radius:999px;border:1px solid rgba(61,53,48,.14);
  background:rgba(245,239,228,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:#3D3530;font:400 .68rem/1 'Jost',sans-serif;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;
  box-shadow:0 6px 24px rgba(30,24,20,.12);transition:background .25s,transform .2s,border-color .25s}
.ambient-toggle:hover{background:#F5EFE4;border-color:rgba(61,53,48,.3);transform:translateY(-1px)}
.ambient-toggle:focus-visible{outline:2px solid #6B6349;outline-offset:3px}
.ambient-toggle svg{width:18px;height:18px;flex-shrink:0}
.ambient-toggle[aria-pressed="true"]{background:#3D3530;color:#F5EFE4;border-color:#3D3530}
.ambient-toggle[aria-pressed="true"]:hover{background:#6B6349;border-color:#6B6349}
@media (max-width:768px){.ambient-toggle{left:.8rem;bottom:.8rem;padding:.75rem}.ambient-toggle .ambient-label{display:none}}
`;

export function initAmbient() {
  if (document.querySelector('.ambient-toggle')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ambient-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', 'Nature sounds');
  const render = () => {
    btn.setAttribute('aria-pressed', String(playing));
    btn.innerHTML = (playing ? ICON_ON : ICON_OFF) +
      `<span class="ambient-label">${playing ? 'Nature sounds on' : 'Nature sounds'}</span>`;
  };
  render();
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    if (playing) { stop(); store.set('off'); }
    else if (await start()) { store.set('on'); }
    render();
  });

  // Don't burn CPU or audio while the tab is in the background.
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !playing) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  // Sound is on by default; only an explicit "off" from the visitor opts out.
  // Browsers refuse to start audio before a user gesture, so try right away
  // (works where the site is allowed to autoplay) and otherwise start at the
  // first click, tap or keypress.
  if (store.get() !== 'off') {
    const events = ['pointerdown', 'touchend', 'keydown', 'click'];
    const cleanup = () => events.forEach((e) => window.removeEventListener(e, onGesture, true));
    const attempt = async () => {
      if (playing || store.get() === 'off') return cleanup();
      if (!ctx && !build()) return cleanup();
      if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      if (ctx.state !== 'running') return; // still blocked: wait for a gesture
      cleanup();
      if (await start()) render();
    };
    const onGesture = (e) => {
      if (btn.contains(e.target)) return cleanup(); // the toggle handles its own click
      attempt();
    };
    events.forEach((e) => window.addEventListener(e, onGesture, true));
    attempt();
  }
}
