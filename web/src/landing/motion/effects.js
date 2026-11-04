// Reusable scroll effects. Each takes elements (or selectors already resolved
// by the section) and returns what it created, so sections compose them.
import { gsap } from './gsap.js';

const wordsOf = (targets) => gsap.utils.toArray(targets).flatMap((el) => [...el.querySelectorAll('.sw-i')]);

// Words rise out of their own mask, one after another. Pairs with <SplitWords>.
export function revealWords(targets, { trigger, start = 'top 82%', stagger = 0.05, delay = 0, duration = 1.15 } = {}) {
  return gsap.from(wordsOf(targets), {
    yPercent: 118, rotate: 4, transformOrigin: '0% 100%', duration, delay, stagger, ease: 'expo.out',
    scrollTrigger: trigger ? { trigger, start, once: true } : undefined,
  });
}

// Blocks fade up in sequence.
export function fadeUp(targets, { trigger, start = 'top 82%', stagger = 0.1, y = 36, delay = 0, duration = 1.1 } = {}) {
  return gsap.from(gsap.utils.toArray(targets), {
    y, autoAlpha: 0, duration, delay, stagger, ease: 'power3.out',
    scrollTrigger: trigger ? { trigger, start, once: true } : undefined,
  });
}

// Layers move at their own speed while `trigger` crosses the screen.
// data-speed > 0 moves faster than the page (foreground), < 0 slower (background).
export function parallax(targets, trigger) {
  return gsap.utils.toArray(targets).map((t) => {
    const speed = parseFloat(t.dataset.speed) || 0;
    const shift = () => speed * trigger.offsetHeight * 0.5;
    return gsap.fromTo(t, { y: () => shift() }, {
      y: () => -shift(), ease: 'none',
      scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
    });
  });
}

// Words light up as the reader scrolls through them.
export function highlightWords(targets, { trigger, start = 'top 72%', end = 'bottom 58%' } = {}) {
  return gsap.fromTo(wordsOf(targets), { opacity: 0.16 }, {
    opacity: 1, ease: 'none', stagger: 0.1,
    scrollTrigger: { trigger, start, end, scrub: 0.6 },
  });
}

// Numbers count up from zero once in view. Reads data-value and data-decimals.
// Returns a cleanup that puts the final figures back.
export function countUp(targets, { start = 'top 86%' } = {}) {
  const els = gsap.utils.toArray(targets);
  const finals = els.map((el) => el.textContent);
  const tweens = els.map((el) => {
    const to = parseFloat(el.dataset.value);
    const dec = Number(el.dataset.decimals || 0);
    const fmt = (v) => v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const o = { v: 0 };
    el.textContent = fmt(0);
    return gsap.to(o, {
      v: to, duration: 2, ease: 'power3.out',
      onUpdate: () => { el.textContent = fmt(o.v); },
      scrollTrigger: { trigger: el, start, once: true },
    });
  });
  return () => { tweens.forEach((t) => t.kill()); els.forEach((el, i) => { el.textContent = finals[i]; }); };
}

// A chapter that arrives like a sheet laid on top of the last one: it rises
// with a slight tilt and settles flat. Not for pinned sections (a transformed
// ancestor would break the pin).
export function sheetIn(el, { tilt = 2.4 } = {}) {
  return gsap.fromTo(el, { rotate: tilt, yPercent: 7, transformOrigin: '50% 0%' }, {
    rotate: 0, yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 30%', scrub: true },
  });
}

// A chapter revealed through a circle that opens as it scrolls in.
export function portalIn(el, { at = '50% 55%' } = {}) {
  return gsap.fromTo(el, { clipPath: `circle(6% at ${at})` }, {
    clipPath: `circle(150% at ${at})`, ease: 'power1.in',
    scrollTrigger: { trigger: el, start: 'top bottom', end: 'top top', scrub: true },
  });
}
