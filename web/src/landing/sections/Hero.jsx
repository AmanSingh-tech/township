import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from '../motion/gsap.js';
import { useScene } from '../motion/useScene.js';
import { parallax } from '../motion/effects.js';
import SplitWords from '../components/SplitWords.jsx';
import Skyline from '../components/Skyline.jsx';
import { Phone } from '../components/Devices.jsx';
import { HomeScreen } from '../components/screens.jsx';
import Icon from '../components/Icon.jsx';
import { jumpTo } from '../components/Nav.jsx';
import Chapter from '../components/Chapter.jsx';

export default function Hero({ cta }) {
  const ref = useRef(null);

  useScene(ref, ({ el, q }) => {
    // Entrance: words rise, then the phone comes up out of the skyline.
    gsap.timeline({ delay: 0.15 })
      .from(q('.lp-hero-eyebrow'), { autoAlpha: 0, y: 14, duration: 0.8 })
      .from(q('.lp-display .sw-i'), { yPercent: 118, rotate: 5, transformOrigin: '0% 100%', duration: 1.3, stagger: 0.08, ease: 'expo.out' }, '<0.1')
      .from(q('.lp-hero-lead, .lp-hero-ctas'), { autoAlpha: 0, y: 22, duration: 1, stagger: 0.1 }, '<0.45')
      .from(q('.lp-hero-phone'), { yPercent: 34, scale: 0.9, autoAlpha: 0, duration: 1.8, ease: 'expo.out' }, '<-0.2')
      .from(q('.lp-hero-glow'), { scale: 0.4, autoAlpha: 0, duration: 2, ease: 'power2.out' }, '<')
      .from(q('.lp-float-in'), { autoAlpha: 0, scale: 0.85, y: 30, duration: 1, stagger: 0.18, ease: 'back.out(1.6)' }, '-=1.1');

    // Scroll: the words drift up and away while the phone rises to meet the
    // next section. Outer wrappers move here; the entrance uses the inner ones.
    gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: 0.4 } })
      .to(q('.lp-hero-copy'), { yPercent: -22, autoAlpha: 0, ease: 'none' }, 0)
      .to(q('.lp-hero-device'), { yPercent: -18, scale: 1.06, ease: 'none' }, 0);
    parallax(q('[data-speed]'), el);
  });

  return (
    <section className="lp-hero" ref={ref}>
      <div className="lp-hero-sky" data-speed="-0.3" aria-hidden="true" />
      <Skyline seed={7} color="#1d1420" windows={['rgba(231,175,231,0.2)', 'rgba(247,200,168,0.16)', 'rgba(188,211,242,0.16)']} minH={0.45} maxH={0.95} speed="-0.24" className="far" />
      <Skyline seed={21} color="#171019" windows={['rgba(255,206,140,0.34)', 'rgba(231,175,231,0.3)', 'rgba(197,220,184,0.26)']} minH={0.25} maxH={0.7} density={1.2} speed="-0.12" className="mid" />
      <Skyline seed={40} color="#110c12" windows={['rgba(255,196,120,0.42)', 'rgba(247,200,168,0.36)', 'rgba(231,175,231,0.34)']} minH={0.12} maxH={0.34} density={1.4} speed="0.08" className="near" />
      <div className="lp-hero-device">
        <div className="lp-hero-glow" aria-hidden="true" />
        <Phone className="lp-hero-phone"><HomeScreen /></Phone>
        <div className="lp-float f1" data-speed="0.18" aria-hidden="true"><div className="lp-float-in"><i className="tint-sage"><Icon name="check" /></i><span><b>Paid · ₹6,370</b>Receipt RCT/2026-27/01842</span></div></div>
        <div className="lp-float f2" data-speed="0.32" aria-hidden="true"><div className="lp-float-in"><i className="tint-butter"><Icon name="visitor" /></i><span><b>Rakesh is at Gate 1</b>Approve or deny</span></div></div>
        <div className="lp-float f3" data-speed="0.1" aria-hidden="true"><div className="lp-float-in"><i className="tint-peach"><Icon name="fix" /></i><span><b>Plumber on the way</b>Water leak · 2:40 pm</span></div></div>
      </div>
      <div className="lp-hero-fade" aria-hidden="true" />
      <Chapter about="Township" n={1} />
      <div className="lp-hero-copy">
        <p className="lp-hero-eyebrow">Township</p>
        <SplitWords as="h1" className="lp-display" text="Home, handled." />
        <p className="lp-hero-lead">Maintenance, complaints, visitors and the gate, in one calm app for every flat in the township.</p>
        <div className="lp-hero-ctas">
          <Link className="lp-btn" to={cta.to}>{cta.label}</Link>
          <a className="lp-btn ghost" href="#product" onClick={jumpTo('product')}>See how it works <Icon name="down" /></a>
        </div>
      </div>
    </section>
  );
}
