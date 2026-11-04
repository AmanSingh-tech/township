import { useRef } from 'react';
import { gsap } from '../motion/gsap.js';
import { useScene } from '../motion/useScene.js';
import { revealWords } from '../motion/effects.js';
import SplitWords from '../components/SplitWords.jsx';
import ImageSequence from '../components/ImageSequence.jsx';
import { usePhoneSequence } from '../frames/usePhoneSequence.js';
import { SEQ_HEIGHT, SEQ_WIDTH } from '../frames/phoneSequence.js';

const CAPTIONS = [
  ['Two taps to pay.', 'UPI or card, with a numbered receipt the moment it clears.'],
  ['Nothing to install.', 'It opens in the browser and lives on the home screen like an app.'],
  ['Made for your flat.', 'Residents see their own flat only: dues, complaints and visitors.'],
];

// Pinned: the phone turns a full circle as you scroll, while captions take
// turns either side of it.
export default function Spin() {
  const ref = useRef(null);
  const seq = useRef(null);
  const frames = usePhoneSequence();

  useScene(ref, ({ el, q, mobile }) => {
    revealWords(q('.lp-spin-head h2'), { trigger: el, start: 'top 70%' });
    const turn = { p: 0 };
    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: { trigger: el, start: 'top top', end: () => `+=${window.innerHeight * (mobile ? 2.2 : 2.8)}`, pin: true, scrub: 0.7, invalidateOnRefresh: true },
    });
    tl.to(turn, { p: 1, ease: 'none', duration: 10, onUpdate: () => seq.current?.seek(turn.p) }, 0)
      // The phone rises from below the heading, and the heading clears out
      // of its way before they meet.
      .fromTo(q('.lp-spin-device'), { scale: 0.72, yPercent: 34 }, { scale: 1, yPercent: 0, duration: 2.6, ease: 'power2.inOut' }, 0)
      .to(q('.lp-spin-head'), { autoAlpha: 0, y: -90, scale: 0.94, duration: 1.3, ease: 'power2.in' }, 0.2)
      .fromTo(q('.lp-spin-glow'), { scale: 0.7, opacity: 0.5 }, { scale: 1.35, opacity: 1, duration: 10, ease: 'none' }, 0)
      .fromTo(q('.lp-spin-big'), { xPercent: 12 }, { xPercent: -12, duration: 10, ease: 'none' }, 0);
    q('.lp-cap').forEach((c, i) => {
      const at = 1.8 + i * 2.7;
      tl.fromTo(c, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.7 }, at)
        .to(c, { autoAlpha: 0, y: -40, duration: 0.7 }, at + 1.8);
    });
    tl.to(q('.lp-spin-device'), { scale: 0.92, duration: 1 }, 9);
  });

  return (
    <section className="lp-spin" data-nav="light" ref={ref}>
      <div className="lp-spin-glow" aria-hidden="true" />
      <div className="lp-bigtype lp-spin-big" aria-hidden="true">₹13,004</div>
      <div className="lp-spin-head">
        <p className="lp-eyebrow">The resident app</p>
        <SplitWords as="h2" className="lp-h" text={'One app.\nEvery corner of home.'} />
      </div>
      <div className="lp-spin-device">
        <ImageSequence ref={seq} frames={frames} width={SEQ_WIDTH} height={SEQ_HEIGHT} className="lp-spin-canvas"
          label="The Township resident app on a phone, turning to show its front and back" />
      </div>
      <ul className="lp-caps">
        {CAPTIONS.map(([t, s], i) => (
          <li className={`lp-cap c${i}`} key={t}><b><i className={`lp-cap-dot d${i}`} aria-hidden="true" />{t}</b><span>{s}</span></li>
        ))}
      </ul>
    </section>
  );
}
