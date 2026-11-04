// A pill fixed to the bottom of the screen once the hero has scrolled away,
// so signing in (or installing) is always one tap away while reading.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LOGO } from '../../brand.js';
import InstallButton from '../../InstallButton.jsx';

export default function StickyCta({ cta }) {
  const [show, setShow] = useState(false);
  // Shown between the hero and the closing chapter, which have their own buttons.
  useEffect(() => {
    const hero = document.querySelector('.lp-hero'), end = document.querySelector('.lp-closing');
    if (!hero || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = { hero: true, end: false };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen[e.target === hero ? 'hero' : 'end'] = e.isIntersecting;
      setShow(!seen.hero && !seen.end);
    }, { threshold: 0.15 });
    io.observe(hero); if (end) io.observe(end);
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
