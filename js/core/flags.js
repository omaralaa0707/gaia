// Capability flags, read once at boot. The whole motion layer branches on these.

const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
const conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;

export const flags = {
  reduceMotion: mqReduce.matches,
  finePointer: mqFine.matches,
  saveData: !!(conn && conn.saveData),
  // True when we are allowed to download/play heavy video + run rich motion.
  get richMedia() {
    return !this.reduceMotion && !this.saveData;
  },
};

// Desktop showpiece breakpoint (matches gsap.matchMedia branches).
export const DESKTOP = '(min-width: 1024px)';
export const MOBILE = '(max-width: 1023px)';
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';
