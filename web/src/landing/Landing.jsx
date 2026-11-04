import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSession } from '../api.js';
import { homeFor } from '../App.jsx';
import { ScrollTrigger } from './motion/gsap.js';
import Nav from './components/Nav.jsx';
import Hero from './sections/Hero.jsx';
import Spin from './sections/Spin.jsx';
import Story from './sections/Story.jsx';
import Numbers from './sections/Numbers.jsx';
import Gate from './sections/Gate.jsx';
import Ledger from './sections/Ledger.jsx';
import Closing from './sections/Closing.jsx';
import StickyCta from './components/StickyCta.jsx';
import '@fontsource/instrument-serif/latin-400.css';
import './landing.css';

// The public front page. Each section owns its animation (see motion/); this
// file only orders them. Anchors sit between sections, outside any pin.
export default function Landing() {
  const session = getSession();
  const cta = session ? { to: homeFor(session.user.role), label: 'Open Township' } : { to: '/login', label: 'Sign in' };
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const title = document.title;
    document.title = 'Township · Home, handled';
    fetch('/api/client-config').then((r) => r.json()).then((c) => setDemo(!!c.demoLogins?.length)).catch(() => {});
    // Pins are measured from the layout; fonts arriving late change it.
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return () => { document.title = title; };
  }, []);

  return (
    <div className="lp">
      <Link className="lp-skip" to={cta.to}>Skip to {cta.label.toLowerCase()}</Link>
      <Nav cta={cta} />
      <main>
        <Hero cta={cta} />
        <span id="product" className="lp-anchor" />
        <Spin />
        <span id="residents" className="lp-anchor" />
        <Story />
        <div className="lp-portal-wrap"><Numbers /></div>
        <span id="gate" className="lp-anchor" />
        <Gate />
        <span id="accounts" className="lp-anchor" />
        <Ledger />
        <Closing cta={cta} demo={demo} />
      </main>
      <StickyCta cta={cta} />
    </div>
  );
}
