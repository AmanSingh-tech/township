// Small pieces shared by the resident screens: a counting amount, colour
// tints for categories and people, labelled progress steps, and a live clock.
import { useEffect, useRef, useState } from 'react';
import { inr } from '../../format.js';
import { Icon, STEP } from '../../ui.jsx';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The amount rises to its value once, when it first appears or changes.
export function CountUp({ value, format = inr, ms = 700 }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); return undefined; }
    const start = performance.now(), a = from.current, b = value;
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (b - a) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className="num">{format(shown)}</span>;
}

// Soft tints used to tell things apart at a glance. Text on them stays in ink.
export const TINTS = ['lilac', 'peach', 'butter', 'sage', 'sky', 'rose'];

const CATEGORY = {
  Plumbing: ['sky', 'drop'], Electrical: ['butter', 'bolt'], Lift: ['lilac', 'lift'], Safety: ['rose', 'alert'],
  Security: ['sage', 'shield'], Housekeeping: ['sage', 'leaf'], Parking: ['sky', 'car'], 'Pest control': ['peach', 'bug'],
  Civil: ['peach', 'wall'], Noise: ['lilac', 'volume'], 'Common areas': ['sage', 'tree'], Other: ['', 'wrench'],
};
export function CategoryBadge({ category, size = 36 }) {
  const [tint, icon] = CATEGORY[category] || CATEGORY.Other;
  return <span className={`badge-ic tint-${tint || 'none'}`} style={{ width: size, height: size }} aria-hidden="true"><Icon name={icon} size={size * 0.5} /></span>;
}

// The same person always gets the same colour.
export function Avatar({ name = '', photo, size = 42 }) {
  const n = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const letters = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className={`avatar-tint tint-${TINTS[n % TINTS.length]}`} style={{ width: size, height: size }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : letters || <Icon name="users" size={18} />}
    </span>
  );
}

// Progress through a complaint, with the step names under the bar.
export function LabelledSteps({ status, alert, t }) {
  const n = STEP[status] || 1;
  const names = ['status_open', 'status_assigned', 'status_in_progress', 'status_resolved'];
  return (
    <div className={`lsteps ${alert ? 'alert' : ''}`} aria-label={t(`status_${status}`)}>
      <div className="lsteps-bar"><i style={{ width: `${((n - 1) / 3) * 100}%` }} /></div>
      <ol>{names.map((k, i) => <li key={k} className={i < n ? 'on' : ''}><span />{t(k)}</li>)}</ol>
    </div>
  );
}

// Ticks every second while mounted; used for countdowns.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

// Time left until midnight in India for a date like 2026-11-04.
export function untilEndOfIstDay(dateIso, now) {
  const end = Date.parse(`${dateIso}T23:59:59+05:30`);
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return { left: s, label: s <= 0 ? null : h > 0 ? `${h} h ${m} min` : `${m} min` };
}
