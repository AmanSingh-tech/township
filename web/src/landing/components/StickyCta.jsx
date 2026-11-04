// A pill fixed to the bottom of the screen once the hero has scrolled away,
// so signing in (or installing) is always one tap away while reading.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LOGO } from '../../brand.js';
import InstallButton from '../../InstallButton.jsx';

export default function StickyCta({ cta }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.querySelector('.lp-hero');
    if (!hero || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting), { threshold: 0.15 });
    io.observe(hero);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`lp-sticky ${show ? 'show' : ''}`} aria-hidden={!show}>
      <img src={LOGO} alt="" />
      <Link className="lp-btn sm" to={cta.to} tabIndex={show ? 0 : -1}>{cta.label}</Link>
      <InstallButton variant="icon" className="lp-sticky-install" />
    </div>
  );
}
