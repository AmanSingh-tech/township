// One place where GSAP is set up for the landing page, so every section gets
// the same plugins and defaults.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
// Mobile address bars resize the viewport while scrolling; recalculating
// every pin on each of those resizes is what makes pinned pages judder.
ScrollTrigger.config({ ignoreMobileResize: true });
gsap.defaults({ ease: 'power3.out', duration: 1 });

export { gsap, ScrollTrigger };

export const MOTION = '(prefers-reduced-motion: no-preference)';
export const MOBILE = '(max-width: 767px)';
export const prefersReducedMotion = () => typeof matchMedia === 'function' && !matchMedia(MOTION).matches;
