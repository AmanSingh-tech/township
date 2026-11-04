import { useLayoutEffect } from 'react';
import { gsap, MOTION, MOBILE } from './gsap.js';

// Runs a section's animation `build` inside a GSAP matchMedia scoped to `ref`.
// Every tween and ScrollTrigger it creates is reverted on unmount, and rebuilt
// when the breakpoint or the motion preference changes.
//
// With reduced motion, `build` never runs. Sections are written so the plain
// HTML and CSS already show their final, readable state; `is-animated` on the
// section root is what switches on pinned layouts.
//
// build({ el, q, mobile }) may return a cleanup function.
export function useScene(ref, build, deps = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mm = gsap.matchMedia(el);
    mm.add({ motion: MOTION, mobile: MOBILE }, (ctx) => {
      if (!ctx.conditions.motion) return undefined;
      el.classList.add('is-animated');
      const cleanup = build({ el, q: gsap.utils.selector(el), mobile: ctx.conditions.mobile });
      return () => { cleanup?.(); el.classList.remove('is-animated'); };
    });
    return () => mm.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
