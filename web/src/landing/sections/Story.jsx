import { useRef } from 'react';
import { gsap, prefersReducedMotion } from '../motion/gsap.js';
import { useScene } from '../motion/useScene.js';
import { Phone } from '../components/Devices.jsx';
import { PayScreen, FixScreen, VisitorScreen, BookScreen } from '../components/screens.jsx';

const STEPS = [
  { tab: 'Pay', title: 'Dues, paid\nbefore dinner.', body: 'See exactly what is owed and why, pay by UPI or card, and keep every receipt in one place. Interest is shown, never hidden.', Screen: PayScreen, glow: '#d58fdf' },
  { tab: 'Fix', title: 'Report it once.\nWatch it get fixed.', body: 'Snap the leak. It goes to the right technician for your tower, you follow every step, then rate the fix or reopen it.', Screen: FixScreen, glow: '#f4a06e' },
  { tab: 'Visitors', title: 'Know who is\nat the gate.', body: 'Approve or turn away a visitor from wherever you are, or send a guest a code before they arrive.', Screen: VisitorScreen, glow: '#7fcb93' },
  { tab: 'Book', title: 'The clubhouse,\nwithout the calls.', body: 'Pick a slot, see the fee and the cancellation cut-off, and it is added to your maintenance bill.', Screen: BookScreen, glow: '#7eaef0' },
];

const Lines = ({ text }) => text.split('\n').map((l, i) => <span key={i} className="lp-line">{l}</span>);

// Pinned: four features take turns. The copy and the phone screen change at
// each step, and the scroll settles on whole steps so nothing is left half
// faded. The tabs jump straight to a step.
export default function Story() {
  const ref = useRef(null);
  const tlRef = useRef(null);

  useScene(ref, ({ el, q, mobile }) => {
    const steps = q('.lp-step'), screens = q('.lp-story-screen'), tabs = q('.lp-tabs button'), phone = q('.lp-story-phone')[0];
    const n = steps.length;
    gsap.set(steps.slice(1), { autoAlpha: 0 });
    gsap.set(screens.slice(1), { autoAlpha: 0 });
    let active = -1;
    const mark = (i) => {
      if (i === active) return;
      active = i;
      tabs.forEach((t, k) => { t.classList.toggle('on', k === i); t.setAttribute('aria-current', k === i ? 'step' : 'false'); });
    };
    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: el, start: 'top top', end: () => `+=${window.innerHeight * n * (mobile ? 0.8 : 1)}`,
        pin: true, scrub: 0.8, invalidateOnRefresh: true,
        // Nearest step, never skipping one: no inertia, which would fling a fast
        // scroll past the middle steps.
        snap: { snapTo: 'labels', inertia: false, duration: { min: 0.25, max: 0.6 }, delay: 0.12, ease: 'power1.inOut' },
        onUpdate: (self) => mark(Math.min(n - 1, Math.floor(self.progress * tl.duration() + 0.3))),
      },
    });
    tl.addLabel('s0', 0);
    for (let i = 1; i < n; i++) {
      tl.to(steps[i - 1], { autoAlpha: 0, y: -36, duration: 0.4 }, i - 0.55)
        // Everything lands before the step's label, so a settled scroll never leaves a line half-way.
        .fromTo(steps[i], { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: 0.38 }, i - 0.45)
        .fromTo(steps[i].querySelectorAll('.lp-eyebrow, .lp-line, .lp-lead'), { yPercent: 60 }, { yPercent: 0, duration: 0.32, stagger: 0.03 }, i - 0.45)
        .to(screens[i - 1], { autoAlpha: 0, scale: 0.94, duration: 0.4 }, i - 0.55)
        .fromTo(screens[i], { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.45 }, i - 0.4)
        .to(phone, { rotateY: i % 2 ? -14 : 14, rotateX: 4, duration: 0.3, ease: 'sine.inOut' }, i - 0.55)
        .to(phone, { rotateY: 0, rotateX: 0, duration: 0.4, ease: 'sine.inOut' }, i - 0.25)
        .to(el, { '--lp-glow': STEPS[i].glow, duration: 0.5 }, i - 0.5)
        .addLabel(`s${i}`, i);
    }
    tl.to({}, { duration: 0.35 });
    tlRef.current = tl;
    // The first step arrives with the section.
    gsap.from(steps[0].querySelectorAll('.lp-eyebrow, .lp-line, .lp-lead'), { y: 40, autoAlpha: 0, stagger: 0.08, duration: 1, scrollTrigger: { trigger: el, start: 'top 65%', once: true } });
    gsap.from(phone, { y: 80, rotateX: 12, autoAlpha: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 65%', once: true } });
    mark(0);
    return () => { tlRef.current = null; };
  });

  const go = (i) => {
    const tl = tlRef.current;
    const smooth = prefersReducedMotion() ? 'auto' : 'smooth';
    if (tl?.scrollTrigger) window.scrollTo({ top: tl.scrollTrigger.labelToScroll(`s${i}`), behavior: smooth });
    else document.getElementById(`lp-step-${i}`)?.scrollIntoView({ behavior: smooth, block: 'center' });
  };

  return (
    <section className="lp-story" data-nav="light" ref={ref} style={{ '--lp-glow': STEPS[0].glow }} aria-label="What residents can do">
      <div className="lp-story-in">
        <div className="lp-story-stage" aria-hidden="true">
          <div className="lp-story-glow" />
          <Phone className="lp-story-phone">
            {STEPS.map(({ tab, Screen }) => <div className="lp-story-screen" key={tab}><Screen /></div>)}
          </Phone>
        </div>
        <div className="lp-story-copy">
          <div className="lp-tabs" role="group" aria-label="Features">
            {STEPS.map((s, i) => <button type="button" key={s.tab} onClick={() => go(i)}>{s.tab}</button>)}
          </div>
          <div className="lp-steps">
            {STEPS.map(({ tab, title, body, Screen }, i) => (
              <article className="lp-step" id={`lp-step-${i}`} key={tab}>
                <p className="lp-eyebrow"><span className="lp-step-dot" style={{ background: STEPS[i].glow }} />{String(i + 1).padStart(2, '0')} · {tab}</p>
                <h2 className="lp-h2"><Lines text={title} /></h2>
                <p className="lp-lead">{body}</p>
                <Phone className="lp-step-phone"><Screen /></Phone>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
