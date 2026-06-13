// Navbar scroll effect
const nav = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

// Mobile menu
const mobileMenu = document.getElementById('mobile-menu');
const hamburger = document.getElementById('hamburger');
function toggleMenu() {
  mobileMenu.classList.toggle('open');
}
hamburger.addEventListener('click', toggleMenu);
mobileMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', toggleMenu));

// Scroll reveal
const revEls = document.querySelectorAll('.reveal');
const revObs = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('visible'); revObs.unobserve(e.target); }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });
revEls.forEach((el) => revObs.observe(el));

// Trigger visible for above-fold elements
setTimeout(() => {
  revEls.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('visible');
  });
}, 80);
