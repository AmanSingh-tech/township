import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { prefersReducedMotion } from '../motion/gsap.js';

// Scrolls to a section anchor. Anchors sit outside pinned sections, so the
// target is where the section starts, however far its pin has run.
export function jumpTo(id) {
  return (e) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
}

// The bar turns light over light sections (data-nav="light"). A pinned
// section is fixed at the top while pinned, so its box still tells the truth.
function useNavTone(ref) {
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const line = (ref.current?.offsetHeight || 56) / 2;
      const light = [...document.querySelectorAll('[data-nav="light"]')].some((s) => {
        const r = s.getBoundingClientRect();
        return r.top <= line && r.bottom >= line;
      });
      ref.current?.classList.toggle('on-light', light);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame); };
  }, [ref]);
}

export default function Nav({ cta }) {
  const ref = useRef(null);
  useNavTone(ref);
  return (
    <header className="lp-nav" ref={ref}>
      <div className="lp-nav-in">
        <Link to="/welcome" className="lp-brand"><img src="/icon.svg" alt="" />Township</Link>
        <nav className="lp-nav-links" aria-label="Sections">
          <a href="#residents" onClick={jumpTo('residents')}>Residents</a>
          <a href="#gate" onClick={jumpTo('gate')}>Gate</a>
          <a href="#accounts" onClick={jumpTo('accounts')}>Accounts</a>
        </nav>
        <Link className="lp-btn sm" to={cta.to}>{cta.label}</Link>
      </div>
    </header>
  );
}
