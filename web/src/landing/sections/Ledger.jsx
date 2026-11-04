import { useRef } from 'react';
import { useScene } from '../motion/useScene.js';
import { fadeUp, highlightWords, sheetIn } from '../motion/effects.js';
import Chapter from '../components/Chapter.jsx';
import SplitWords from '../components/SplitWords.jsx';

const TEXT = 'Every rupee is a line in the ledger. Lines are never edited, only corrected by new ones. A second person approves every manual decision. Receipts never skip a number. And once the committee signs a month, the database itself will not let anyone change it.';

// Words light up as they are read.
export default function Ledger() {
  const ref = useRef(null);
  useScene(ref, ({ el, q }) => {
    sheetIn(el, { tilt: -2 });
    fadeUp(q('.lp-eyebrow'), { trigger: el, start: 'top 80%' });
    highlightWords(q('.lp-ledger-text'), { trigger: q('.lp-ledger-text')[0], start: 'top 78%', end: 'bottom 52%' });
    fadeUp(q('.lp-ledger-foot > *'), { trigger: q('.lp-ledger-foot')[0], stagger: 0.12 });
  });
  return (
    <section className="lp-ledger" data-nav="light" ref={ref} aria-label="Accounts">
      <Chapter about="trust" n={6} />
      <div className="lp-wrap">
        <p className="lp-eyebrow">Accounts you can trust</p>
        <SplitWords as="p" className="lp-ledger-text" text={TEXT} />
        <div className="lp-ledger-foot">
          <div><b>Bank statements</b><span>Credits post themselves only on strong evidence. The rest wait for a person.</span></div>
          <div><b>Tally export</b><span>Every voucher balances, ready for the auditor.</span></div>
          <div><b>Signed reports</b><span>Frozen, fingerprinted, and checked every time they open.</span></div>
        </div>
      </div>
    </section>
  );
}
