// SplitText line-reveal helper. Splits an element into masked lines and returns
// the line elements ready to be tweened from yPercent:110 → 0.

export function splitLines(el) {
  if (!el || !window.SplitText) return [];
  const split = new SplitText(el, {
    type: 'lines',
    linesClass: 'split-line',
    mask: 'lines',
    autoSplit: true,
  });
  gsap.set(split.lines, { yPercent: 110 });
  return split.lines;
}

// Convenience: build a from-tween config for revealed lines.
export function lineRevealVars(extra = {}) {
  return {
    yPercent: 0,
    duration: 1.1,
    ease: 'power4.out',
    stagger: 0.09,
    ...extra,
  };
}
