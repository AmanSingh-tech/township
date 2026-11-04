import { useRef } from 'react';
import { useScene } from '../motion/useScene.js';
import { countUp, fadeUp, parallax, revealWords, portalIn } from '../motion/effects.js';
import Chapter from '../components/Chapter.jsx';
import SplitWords from '../components/SplitWords.jsx';

// Figures from the full-size load test (see the README).
const STATS = [
  { v: 2400, label: 'flats in 28 towers, on one ledger' },
  { v: 4.1, dec: 1, unit: 's', label: 'to prepare a month of bills for every flat' },
  { v: 0.9, dec: 1, unit: 's', label: 'for a visitor alert, even behind 4,200 bill messages' },
  { v: 28, unit: 'ms', label: 'for 95% of requests at five times bill-day traffic' },
  { v: 0, label: 'ledger lines anyone can edit. Mistakes get a new entry.' },
  { v: 2, label: 'people approve every manual money decision' },
];
const fmt = (v, dec = 0) => v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export default function Numbers() {
  const ref = useRef(null);
  useScene(ref, ({ el, q, mobile }) => {
    portalIn(el);
    parallax(q('.lp-numbers-big'), el);
    revealWords(q('.lp-h'), { trigger: el, start: 'top 75%' });
    fadeUp(q('.lp-numbers-head .lp-lead'), { trigger: el, start: 'top 70%', delay: 0.3 });
    // Children fade in; the stat itself carries the parallax, so they never fight over y.
    fadeUp(q('.lp-stat > *'), { trigger: q('.lp-stats')[0], start: 'top 80%', stagger: 0.06, y: 50 });
    if (!mobile) parallax(q('.lp-stat[data-speed]'), q('.lp-stats')[0]);
    return countUp(q('.lp-stat-v [data-value]'));
  });
  return (
    <section className="lp-numbers" ref={ref} aria-label="In numbers">
      <Chapter about="scale" n={4} />
      <div className="lp-bigtype lp-numbers-big" data-speed="-0.2" aria-hidden="true">2,400</div>
      <div className="lp-wrap">
        <div className="lp-numbers-head">
          <SplitWords as="h2" className="lp-h" text={'Built for a township,\nnot a building.'} />
          <p className="lp-lead">Tested at full size: 2,400 flats, a year of bills, six thousand complaints and close to four hundred thousand gate entries.</p>
        </div>
        <div className="lp-stats">
          {STATS.map((s, i) => (
            <div className={`lp-stat c${i}`} key={s.label} data-speed={i % 3 === 1 ? '0.06' : undefined}>
              <p className="lp-stat-v"><span data-value={s.v} data-decimals={s.dec || 0}>{fmt(s.v, s.dec)}</span>{s.unit && <small>{s.unit}</small>}</p>
              <p className="lp-stat-l">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
