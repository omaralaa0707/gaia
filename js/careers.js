// Careers page: department tabs, role selection, validation, and submission to /api/join-team.

import { initAmbient } from './fx/ambient.js';

const MAX_CV = 4 * 1024 * 1024; // Vercel functions reject request bodies over 4.5 MB
const CV_EXT = /\.(pdf|docx?)$/i;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

initAmbient();

// ── Mobile menu ──
const hamburger = $('#hamburger');
const menu = $('#mobile-menu');
if (hamburger && menu) {
  hamburger.setAttribute('role', 'button');
  hamburger.setAttribute('aria-label', 'Open menu');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.tabIndex = 0;
  const toggle = (open = !menu.classList.contains('open')) => {
    menu.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  hamburger.addEventListener('click', () => toggle());
  hamburger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
}

// ── Department tabs ──
const form = $('#career-form');
const tabs = $$('.dept-tab');
const deptInput = $('input[name="Department"]', form);
const roleError = $('#err-role');

function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    panel.hidden = !on;
    // Disabled fieldsets are skipped by FormData, so only the visible panel's role is sent.
    $('fieldset', panel).disabled = !on;
    if (!on) $$('input[type=radio]', panel).forEach((r) => { r.checked = false; });
  });
  deptInput.value = tab.dataset.dept;
  roleError.hidden = true;
  updateRoleLabel();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

// ── Role selection ──
const applyingFor = $('#applying-for');
const applyingRole = $('#applying-role');
function updateRoleLabel() {
  const picked = $('input[name="Role Applied For"]:checked:not(:disabled)', form);
  applyingFor.hidden = !picked;
  if (picked) applyingRole.textContent = picked.value;
}
form.addEventListener('change', (e) => {
  if (e.target.name === 'Role Applied For') {
    roleError.hidden = true;
    updateRoleLabel();
  }
});

// ── CV picker (click or drag-and-drop) ──
const cv = $('#f-cv');
const drop = $('#file-drop');
const fileName = $('#file-name');
const dropDefault = fileName.textContent;

function showFile() {
  const f = cv.files[0];
  drop.classList.toggle('has-file', !!f);
  fileName.textContent = f ? `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)` : dropDefault;
}
cv.addEventListener('change', showFile);
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) { cv.files = e.dataTransfer.files; showFile(); }
});

// ── Validation ──
function setError(input, msg) {
  const field = input.closest('.field');
  const err = $('.field-error', field);
  field.classList.toggle('invalid', !!msg);
  err.textContent = msg || '';
  err.hidden = !msg;
  input.setAttribute('aria-invalid', String(!!msg));
}

function validate() {
  let firstBad = null;
  const fail = (el, msg) => { setError(el, msg); firstBad = firstBad || el; };

  const name = $('#f-name'), email = $('#f-email'), phone = $('#f-phone'), letter = $('#f-letter');
  name.value.trim() ? setError(name) : fail(name, 'Please enter your full name.');
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? setError(email) : fail(email, 'Please enter a valid email address.');
  /\d{7,}/.test(phone.value.replace(/\D/g, '')) ? setError(phone) : fail(phone, 'Please enter a valid phone number.');
  letter.value.trim().length >= 20 ? setError(letter) : fail(letter, 'Please tell us a little more (at least a couple of sentences).');

  const f = cv.files[0];
  if (!f) fail(cv, 'Please upload your CV.');
  else if (!CV_EXT.test(f.name)) fail(cv, 'Your CV must be a PDF or Word document.');
  else if (f.size > MAX_CV) fail(cv, 'Your CV is too large (max 4 MB).');
  else setError(cv);

  const noRole = !$('input[name="Role Applied For"]:checked:not(:disabled)', form);
  roleError.hidden = !noRole;
  if (noRole) firstBad = $('.role-panel:not([hidden]) input[type=radio]', form).closest('.role-card');

  return firstBad;
}

// Clear an error as soon as the user starts fixing it.
$$('input:not([type=radio]):not([type=hidden]), textarea', form).forEach((el) =>
  el.addEventListener('input', () => el.closest('.field')?.classList.contains('invalid') && setError(el)));

// ── Submit ──
const btn = $('#submit-btn');
const status = $('#form-status');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.hidden = true;
  if ($('input[name="website"]', form).value) return; // honeypot

  const bad = validate();
  if (bad) {
    bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (bad.focus && !bad.matches('label')) bad.focus({ preventScroll: true });
    return;
  }

  const label = $('.btn-label', btn);
  btn.disabled = true;
  label.textContent = 'Sending…';
  try {
    const body = new FormData(form);
    body.delete('website');
    const res = await fetch('/api/join-team', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');

    form.hidden = true;
    const ok = $('#success');
    ok.hidden = false;
    ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ok.focus({ preventScroll: true });
  } catch (err) {
    status.textContent = err.message;
    status.hidden = false;
    btn.disabled = false;
    label.textContent = 'Submit Application';
  }
});
