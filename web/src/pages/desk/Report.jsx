import { useEffect, useState } from 'react';
import { api, getSession } from '../../api.js';
import { inr, pct, duration, date } from '../../format.js';
import { useApi, Skeleton, Icon, useToast } from '../../ui.jsx';
import BillRuns from './BillRuns.jsx';
import { RateBars, HBars, Legend, SERIES, AGEING } from './Charts.jsx';

function Kpi({ label, value, sub, tone }) {
  return <div className="kpi"><div className="k-label">{label}</div><div className="k-value">{value}</div>{sub && <div className={`k-sub ${tone || ''}`}>{sub}</div>}</div>;
}

export default function Report() {
  const me = getSession().user;
  const toast = useToast();
  const [period, setPeriod] = useState('');
  const { data: live } = useApi(`/desk/report${period ? `?period=${period}` : ''}`, [period]);
  const { data: signoffs, reload: reloadSignoffs } = useApi('/desk/report/signoffs');
  const [signed, setSigned] = useState(null);
  const [showLive, setShowLive] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const signedMeta = live && signoffs?.find((x) => x.period === live.period);
  useEffect(() => {
    setSigned(null);
    if (signedMeta) api(`/desk/report/signoffs/${signedMeta.period}`).then(setSigned).catch(() => {});
  }, [signedMeta?.period]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = signed && !showLive ? signed.data : live;
  const canSign = ['committee', 'admin'].includes(me.role);

  async function signOff() {
    const note = prompt(`Sign off the ${live.periodLabel} report? The figures are frozen as they are now.\n\nNote (e.g. meeting and resolution number):`);
    if (note === null) return;
    try { await api(`/desk/report/${live.period}/signoff`, { method: 'POST', body: { note } }); toast('Report signed'); reloadSignoffs(); }
    catch (e) { toast(e.message); }
  }
  if (!r) return <div className="stack"><Skeleton h={60} /><Skeleton h={110} /><Skeleton h={280} /></div>;
  const c = r.complaints;
  const cur = r.current;

  async function download() {
    const res = await fetch(`/api/desk/report.csv?period=${r.period}`, { headers: { Authorization: `Bearer ${getSession().token}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `committee-report-${r.period}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div>
          <h1>Committee report</h1>
          <p className="muted">{r.periodLabel} · figures as of {date(r.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}, computed from the flat ledgers and complaint records.</p>
        </div>
        <div className="row">
          <select className="input" style={{ width: 'auto', height: 40 }} value={r.period} onChange={(e) => setPeriod(e.target.value)} aria-label="Billing month">
            {r.periods.map((p) => <option key={p} value={p}>{r.trend.find((t) => t.period === p)?.label || p}</option>)}
          </select>
          <button className="btn" onClick={download}><Icon name="download" size={18} />CSV</button>
          <button className="btn" onClick={() => window.print()}>Print</button>
          {canSign && !signedMeta && live?.current && <button className="btn primary" onClick={signOff}>Sign off</button>}
        </div>
      </div>

      {canSign && <BillRuns mode="approve" />}

      {signed && (
        <div className={`notice ${signed.verified ? 'ok' : 'danger'} row between wrap`} style={{ gap: 10 }}>
          <span>
            {showLive ? 'Showing live figures. ' : ''}Signed by <b>{signed.signed_by_name}</b> on {date(signed.signed_at, { day: 'numeric', month: 'long', year: 'numeric' })}{signed.note ? ` · ${signed.note}` : ''}.
            {' '}{signed.verified ? 'Figures unchanged since signing' : 'Warning: the stored figures do not match their fingerprint'} · <span className="mono">{signed.sha256.slice(0, 16)}</span>
          </span>
          <button className="link small" onClick={() => setShowLive((v) => !v)}>{showLive ? 'Show signed copy' : 'Show live figures'}</button>
        </div>
      )}

      <div className="kpis">
        <Kpi label={`Collected for ${cur.label.split(' ')[0]}`} value={pct(cur.collectionRate)} sub={`${inr(cur.collected)} of ${inr(cur.billed)}`} />
        <Kpi label="Paid by due date" value={pct(cur.onTimeRate)} sub={`${cur.onTime} of ${cur.flats} flats · target 90%`} tone={cur.onTimeRate >= 0.9 ? 'good' : 'bad'} />
        <Kpi label="Outstanding now" value={inr(r.outstanding)} sub={`includes ${inr(r.interestAccrued)} interest not yet posted`} />
        <Kpi label="Received, not yet identified" value={inr(r.matching.queueAmount)} sub={r.matching.queueCount ? `${r.matching.queueCount} bank credits in the accounts queue` : 'Nothing waiting in the accounts queue'} tone={r.matching.queueCount ? 'bad' : undefined} />
      </div>

      <div className="grid-2">
        <section className="card stack">
          <div className="row between wrap">
            <h2>Collections by month</h2>
            <button className="link small" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</button>
          </div>
          <Legend items={[['Collected', SERIES.collected], ['Paid by due date', SERIES.onTime], ['Target', null, true]]} />
          {asTable ? (
            <table className="table">
              <thead><tr><th>Month</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Rate</th><th className="num">On time</th></tr></thead>
              <tbody>{r.trend.map((t) => <tr key={t.period}><td>{t.label}</td><td className="num">{inr(t.billed)}</td><td className="num">{inr(t.collected)}</td><td className="num">{pct(t.collectionRate, 1)}</td><td className="num">{pct(t.onTimeRate, 1)}</td></tr>)}</tbody>
            </table>
          ) : <RateBars data={r.trend} target={0.9} format={{ inr, pct }} />}
        </section>

        <section className="card stack">
          <h2>Dues ageing</h2>
          <p className="faint small">Unpaid principal by how long it has been overdue.</p>
          <HBars rows={r.ageing} value={(a) => a.amount} label={(a) => a.label} color={(a) => AGEING[a.key]}
            format={(a) => inr(a.amount)} tipFor={(a) => <>{a.label}: {inr(a.amount)} across {a.flats} flats</>} />
        </section>
      </div>

      <section className="stack">
        <div className="section-title"><h2>Complaints, last {c.windowDays} days</h2></div>
        <div className="kpis">
          <Kpi label="Median first response" value={duration(c.medianFirstResponseMins)} sub={`${pct(c.slaRate)} within target`} />
          <Kpi label="Median time to resolve" value={c.medianResolutionHours == null ? '—' : duration(c.medianResolutionHours * 60)} sub={`${c.raised} raised · ${c.open} open now`} />
          <Kpi label="Reopened" value={pct(c.reopenRate)} sub="target under 8%" tone={c.reopenRate != null && c.reopenRate < 0.08 ? 'good' : 'bad'} />
          <Kpi label="Resident rating" value={c.avgRating ? `${c.avgRating.toFixed(1)} / 5` : '—'} sub={`${c.escalated} safety escalations · ${c.breaching} replies late now`} tone={c.breaching ? 'bad' : ''} />
        </div>
      </section>

      <div className="grid-2">
        <section className="card stack">
          <h2>By category</h2>
          <HBars rows={c.byCategory} value={(x) => x.n} label={(x) => x.category} color={() => SERIES.collected}
            format={(x) => x.n} tipFor={(x) => <>{x.category}: {x.n} complaints</>} />
        </section>
        <section className="card flush">
          <div style={{ padding: '18px 18px 6px' }}><h2>Largest dues</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Flat</th><th>Resident</th><th className="num">Due</th><th className="num">Overdue</th></tr></thead>
              <tbody>
                {r.defaulters.slice(0, 8).map((d) => (
                  <tr key={d.flatId}>
                    <td style={{ fontWeight: 500 }}><a href={`/desk/flats/${d.flatId}`} style={{ textDecoration: 'none' }}>{d.flatId}</a></td>
                    <td className="small muted">{d.name}</td>
                    <td className="num">{inr(d.due)}</td>
                    <td className="num small">{d.daysOverdue} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <p className="faint tiny">Collected = payments allocated to that month’s bills, oldest dues first. Paid by due date = bill fully settled on or before its due date. Interest is simple interest at 21% a year on overdue principal, per the society’s bye-laws.{r.matching.totalCredits > 0 && <> Automatic bank matching: {pct(r.matching.autoRate)} of {r.matching.totalCredits} credits.</>}</p>
    </div>
  );
}
