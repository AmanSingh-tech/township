import { useMemo } from 'react';

// A row of towers with lit windows, generated from a seed so it is the same on
// every visit. Several rows at different depths make the parallax layers.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function Skyline({ seed = 1, color, windows = 'rgba(255,214,150,0.5)', minH = 0.35, maxH = 0.95, density = 1, className = '', speed }) {
  const towers = useMemo(() => {
    const r = rng(seed); const out = []; let x = -40;
    while (x < 1640) {
      const w = 54 + r() * 70 * density;
      out.push({ x, w, h: 400 * (minH + r() * (maxH - minH)), lit: 0.25 + r() * 0.75, off: Math.floor(r() * 3) });
      x += w + 8 + r() * 30;
    }
    return out;
  }, [seed, minH, maxH, density]);
  const id = `lp-win-${seed}`;
  return (
    <svg className={`lp-skyline ${className}`} viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true" data-speed={speed}>
      <defs>
        {[0, 1, 2].map((o) => (
          <pattern key={o} id={`${id}-${o}`} width="16" height="20" patternUnits="userSpaceOnUse" x={o * 5} y={o * 7}>
            <rect x="4" y="5" width="6" height="8" rx="1" fill={windows} />
          </pattern>
        ))}
      </defs>
      {towers.map((t, i) => (
        <g key={i}>
          <rect x={t.x} y={400 - t.h} width={t.w} height={t.h} fill={color} />
          <rect x={t.x + 6} y={400 - t.h + 14} width={t.w - 12} height={t.h - 14} fill={`url(#${id}-${t.off})`} opacity={t.lit} />
        </g>
      ))}
    </svg>
  );
}
