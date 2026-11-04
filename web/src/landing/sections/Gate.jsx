import { useRef } from 'react';
import { gsap } from '../motion/gsap.js';
import { useScene } from '../motion/useScene.js';
import { fadeUp, parallax, revealWords } from '../motion/effects.js';
import SplitWords from '../components/SplitWords.jsx';
import Skyline from '../components/Skyline.jsx';
import { Tablet } from '../components/Devices.jsx';
import { GateScreen } from '../components/screens.jsx';

// Night scene in layers: sky, far towers, street lights, then the tablet,
// which tips up from flat as it scrolls into place.
export default function Gate() {
  const ref = useRef(null);
  useScene(ref, ({ el, q }) => {
    revealWords(q('.lp-h'), { trigger: el, start: 'top 65%' });
    fadeUp(q('.lp-gate-copy .lp-lead, .lp-gate-facts li'), { trigger: el, start: 'top 55%', delay: 0.3, stagger: 0.08 });
    parallax(q('[data-speed]'), el);
    const tablet = q('.lp-tablet')[0];
    gsap.fromTo(tablet, { rotateX: 32, yPercent: 22, scale: 0.86 }, {
      rotateX: 0, yPercent: 0, scale: 1, ease: 'none',
      scrollTrigger: { trigger: q('.lp-gate-stage')[0], start: 'top bottom', end: 'center 60%', scrub: 0.6 },
    });
    // Rows key off the stage, which never tilts, so their timing is measured
    // from where the tablet really sits.
    const stage = q('.lp-gate-stage')[0];
    gsap.from(q('.gt-row'), { autoAlpha: 0, x: -24, stagger: 0.14, duration: 0.8, scrollTrigger: { trigger: stage, start: 'top 72%', once: true } });
    gsap.from(q('.gt-off'), { autoAlpha: 0, scale: 0.8, duration: 0.6, delay: 0.7, ease: 'back.out(2)', scrollTrigger: { trigger: stage, start: 'top 72%', once: true } });
  });
  return (
    <section className="lp-gate" ref={ref} aria-label="The gate tablet">
      <div className="lp-gate-sky" aria-hidden="true" data-speed="-0.25" />
      <div className="lp-lamps" aria-hidden="true">
        <i style={{ left: '12%', top: '30%' }} data-speed="0.12" />
        <i style={{ left: '78%', top: '18%' }} data-speed="-0.1" />
        <i style={{ left: '58%', top: '62%' }} data-speed="0.2" />
      </div>
      <Skyline seed={88} color="#0c1530" windows="rgba(255,206,140,0.22)" minH={0.2} maxH={0.6} speed="-0.15" className="gate-far" />
      <div className="lp-wrap lp-gate-copy">
        <p className="lp-eyebrow">At the gate</p>
        <SplitWords as="h2" className="lp-h" text="The gate never waits for the network." />
        <p className="lp-lead">When the connection drops, the guard keeps logging entries and the tablet sends them once it is back. Residents still get the knock on their phone.</p>
        <ul className="lp-gate-facts">
          <li><b>PIN sign-in</b> on tablets paired to one gate</li>
          <li><b>Guest codes</b> checked in a second</li>
          <li><b>Visitor photos</b> deleted after 90 days</li>
        </ul>
      </div>
      <div className="lp-gate-stage">
        <Tablet><GateScreen /></Tablet>
      </div>
    </section>
  );
}
