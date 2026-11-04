import { useState } from 'react';

// Colours come from the theme (styles.css --chart-*, --seq-*), each set
// checked with the dataviz palette validator against its own surface: two
// categorical series, and a single-hue ramp for dues ageing (grey = not due).
export const SERIES = { collected: 'var(--chart-1)', onTime: 'var(--chart-2)' };
export const AGEING = { current: 'var(--seq-0)', '1-30': 'var(--seq-1)', '31-60': 'var(--seq-2)', '61-90': 'var(--seq-3)', '90+': 'var(--seq-4)' };

function useTip() {
  const [tip, setTip] = useState(null);
  const bind = (content) => ({
    onMouseMove: (e) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, content }); },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  const node = tip && (
    <div role="tooltip" style={{
      position: 'fixed', left: tip.x + 12, top: tip.y - 12, transform: 'translateY(-100%)', pointerEvents: 'none', zIndex: 50,
      background: 'var(--fg)', color: 'var(--bg)', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, boxShadow: 'var(--shadow)', whiteSpace: 'nowrap',
    }}>{tip.content}</div>
  );
  return [bind, node];
}

export function Legend({ items }) {
  return (
    <div className="row wrap" style={{ gap: 16 }}>
      {items.map(([label, color, dashed]) => (
        <span key={label} className="row small muted" style={{ gap: 6 }}>
          {dashed ? <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>
            : <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />}
          {label}
        </span>
      ))}
    </div>
  );
}

// Grouped bars, one percentage axis (0–100%), with a target line.
export function RateBars({ data, target, format }) {
  const [bind, tip] = useTip();
  const W = 560, H = 220, padL = 36, padB = 26, padT = 14;
  const plotW = W - padL, plotH = H - padB - padT;
  const y = (v) => padT + plotH * (1 - v);
  const group = plotW / data.length;
  const bw = Math.min(34, group * 0.26);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Collection rate and paid-by-due-date rate by month">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--line-2)" />
            <text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{g * 100}%</text>
          </g>
        ))}
        {target != null && (
          <g>
            <line x1={padL} x2={W} y1={y(target)} y2={y(target)} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 4" />
            <text x={W - 2} y={y(target) - 6} textAnchor="end" fontSize="11" fill="var(--ink-2)">Target {target * 100}% on time</text>
          </g>
        )}
        {data.map((d, i) => {
          const cx = padL + group * i + group / 2;
          const last = i === data.length - 1;
          const bars = [[d.collectionRate, SERIES.collected, cx - bw - 1], [d.onTimeRate, SERIES.onTime, cx + 1]];
          return (
            <g key={d.period} {...bind(<>
              <b>{d.label}</b><br />
              Collected {format.pct(d.collectionRate, 1)} · {format.inr(d.collected)} of {format.inr(d.billed)}<br />
              Paid by due date {format.pct(d.onTimeRate, 1)} · {d.onTime} of {d.flats} flats
            </>)} style={{ outline: 'none', cursor: 'default' }}>
              <rect x={cx - group / 2} y={padT} width={group} height={plotH} fill="transparent" />
              {bars.map(([v, c, x], k) => {
                const h = Math.max(0, plotH * v);
                return <path key={k} fill={c} d={`M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z`} style={{ display: h > 4 ? undefined : 'none' }} />;
              })}
              {last && bars.map(([v, , x], k) => (
                <text key={k} x={x + bw / 2} y={y(v) - 6} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--ink)">{Math.round(v * 100)}%</text>
              ))}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--ink-2)">{d.label.split(' ')[0].slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}

// Horizontal bars for magnitude by category; color per row optional.
export function HBars({ rows, value, label, color, tipFor, format }) {
  const [bind, tip] = useTip();
  const max = Math.max(1, ...rows.map(value));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={label(r)} className="bar-row" {...bind(tipFor(r))} style={{ outline: 'none' }}>
          <span className="muted ellipsis">{label(r)}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(value(r) / max) * 100}%`, background: color(r), minWidth: value(r) ? 4 : 0 }} /></div>
          <span className="right num small">{format(r)}</span>
        </div>
      ))}
      {tip}
    </div>
  );
}
