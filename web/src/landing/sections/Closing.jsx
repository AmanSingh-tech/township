import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useScene } from '../motion/useScene.js';
import { fadeUp, revealWords } from '../motion/effects.js';
import SplitWords from '../components/SplitWords.jsx';
import Icon from '../components/Icon.jsx';

const ROLES = [
  ['Residents', 'Pay, report, approve visitors, book.', '/login'],
  ['Help desk and accounts', 'Complaints, bank matching, bills.', '/login'],
  ['Committee', 'The month, signed and frozen.', '/login'],
  ['Guards', 'Open the console on a paired tablet.', '/gate'],
];

export default function Closing({ cta, demo }) {
  const ref = useRef(null);
  useScene(ref, ({ el, q }) => {
    revealWords(q('.lp-h'), { trigger: el, start: 'top 72%' });
    fadeUp(q('.lp-closing-ctas, .lp-role'), { trigger: el, start: 'top 60%', delay: 0.35, stagger: 0.07 });
  });
  return (
    <section className="lp-closing" data-nav="light" ref={ref}>
      <div className="lp-wrap">
        <SplitWords as="h2" className="lp-h" text="Your township is ready." />
        <div className="lp-closing-ctas">
          <Link className="lp-btn lg" to={cta.to}>{cta.label}</Link>
          {demo && <p className="lp-note">This is a demo with a sample township. Sign-in codes appear on screen and payments are test payments.</p>}
        </div>
        <div className="lp-roles">
          {ROLES.map(([t, s, to]) => (
            <Link className={`lp-role r${ROLES.findIndex((r) => r[0] === t)}`} to={to} key={t}><b>{t}</b><span>{s}</span><Icon name="arrow" /></Link>
          ))}
        </div>
      </div>
      <footer className="lp-foot lp-wrap">
        <span>Township · society management for a 2,400-flat township</span>
        <nav aria-label="Footer"><Link to="/login">Sign in</Link><Link to="/gate">Gate tablet</Link><Link to="/gate-notice">Privacy notice</Link></nav>
      </footer>
    </section>
  );
}
