import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { inr, date } from '../../format.js';
import { useApi, Skeleton, Empty, Icon, useToast } from '../../ui.jsx';

const STATUS = {
  posted: ['Posted', 'ok'], resolved: ['Posted by hand', 'ok'], reconciled: ['Already recorded', 'info'],
  queue: ['Needs review', 'warn'], pending_approval: ['Awaiting approval', 'info'], duplicate: ['Duplicate', ''], ignored: ['Not maintenance', ''],
};

function Score({ v }) {
  return <span className="score"><i><b style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></i>{Math.max(0, v)}</span>;
}

function ReviewCard({ row, onDone }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [remember, setRemember] = useState(true);
  const vpa = (row.narration.match(/[a-z0-9._-]{2,}@[a-z]{2,}/i) || [])[0];

  async function search(v) {
    setQ(v);
    setFound(v.trim().length >= 2 ? await api(`/desk/flats?q=${encodeURIComponent(v)}`) : []);
  }
  const [reason, setReason] = useState('');
  async function resolve(body) {
    try {
      if (body.ignore) await api(`/desk/bank/rows/${row.id}/ignore`, { method: 'POST', body: { reason } });
      else await api(`/desk/bank/rows/${row.id}/post`, { method: 'POST', body });
      toast(body.ignore ? 'Sent for approval: not maintenance' : `Sent for approval: post to ${body.flatId}`);
      onDone();
    } catch (e) { toast(e.message); }
  }
  return (
    <div className="card stack" style={{ gap: 14 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="mono" style={{ wordBreak: 'break-all' }}>{row.narration}</div>
          <div className="faint tiny" style={{ marginTop: 4 }}>{date(row.txn_date, { day: 'numeric', month: 'short', year: 'numeric' })}{row.utr ? ` · UTR ${row.utr}` : ''}</div>
        </div>
        <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{inr(row.amount)}</div>
      </div>
      <div className="notice warn small">{row.reasons.join(' · ')}</div>
      {row.candidates.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Suggestions</span>
          {row.candidates.filter((c) => c.score > 0).map((c) => (
            <div key={c.flatId} className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row" style={{ gap: 10 }}><b style={{ fontWeight: 600 }}>{c.flatId}</b><Score v={c.score} /></div>
                <div className="faint tiny">{c.reasons.join(' · ')}</div>
              </div>
              <button className="btn sm" onClick={() => resolve({ flatId: c.flatId, rememberVpa: remember })}>Post here</button>
            </div>
          ))}
        </div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="search" size={16} className="faint" />
          <input className="input" style={{ height: 38 }} placeholder="Find flat or resident" value={q} onChange={(e) => search(e.target.value)} />
        </div>
        {found.map((f) => (
          <div key={f.id} className="row between small">
            <span><b>{f.id}</b> <span className="muted">{f.names}</span> <span className="faint">· due {inr(f.due)}</span></span>
            <button className="btn sm" onClick={() => resolve({ flatId: f.id, rememberVpa: remember })}>Post here</button>
          </div>
        ))}
      </div>
      <div className="row between wrap">
        {vpa ? <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember <span className="mono">{vpa}</span> for this flat</label> : <span />}
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ height: 34, width: 180 }} placeholder="Why not maintenance?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn sm ghost" disabled={!reason.trim()} onClick={() => resolve({ ignore: true })}>Not maintenance</button>
        </div>
      </div>
    </div>
  );
}

export default function Matching() {
  const { refreshCounts } = useOutletContext();
  const toast = useToast();
  const fileRef = useRef();
  const { data: imports, reload: reloadImports } = useApi('/desk/bank/imports');
  const { data: queue, reload: reloadQueue } = useApi('/desk/bank/queue');
  const { data: meta } = useApi('/desk/meta');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);
  const latest = shown || imports?.[0];

  async function upload(text, filename) {
    setBusy(true);
    try {
      const r = await api(`/desk/bank/import?filename=${encodeURIComponent(filename)}`, { method: 'POST', body: text, headers: { 'Content-Type': 'text/csv' } });
      setShown(r);
      toast(`${r.counts.posted} posted automatically, ${r.counts.queue} need review`);
      reloadImports(); reloadQueue(); refreshCounts();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  async function readFile(f) { if (f) upload(await f.text(), f.name); }
  async function downloadSample() {
    try {
      const res = await api('/desk/bank/sample.csv', { raw: true });
      if (!res.ok) throw new Error('The sample statement is not available.');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'sample-bank-statement.csv' });
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message); }
  }
  const done = () => { reloadQueue(); reloadImports(); refreshCounts(); setShown(null); };
  const sum = (rows, s) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.amount, 0);

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Bank matching</h1><p className="muted">Credits are matched to flats by flat number, registered UPI ID, payer name and amount. Unclear credits are never posted automatically.</p></div>
      </div>

      <div className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}>
        <Icon name="upload" size={26} className="faint" />
        <p style={{ marginTop: 8, fontWeight: 500 }}>Drop a bank statement CSV here</p>
        <p className="faint small">HDFC, SBI and ICICI CSV exports work as they are. Re-uploading a statement never posts anything twice.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { readFile(e.target.files[0]); e.target.value = ''; }} />
          <button className="btn" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Matching…' : 'Choose file'}</button>
        </div>
        {meta?.demoStatement && (
          <p className="faint small" style={{ marginTop: 12 }}>
            Demo: <button className="link small" onClick={downloadSample}>download the sample statement</button> made from the sample flats, then drop it here.
          </p>
        )}
      </div>

      <section>
        <div className="section-title"><h2>Needs review {queue?.length ? <span className="faint">· {queue.length} · {inr(queue.reduce((a, r) => a + r.amount, 0))}</span> : ''}</h2></div>
        {!queue ? <Skeleton h={160} /> : queue.length === 0 ? <div className="card"><Empty>Nothing waiting. Every imported credit is accounted for.</Empty></div> : (
          <div className="grid-2">{queue.map((r) => <ReviewCard key={r.id} row={r} onDone={done} />)}</div>
        )}
      </section>

      {latest && (
        <section>
          <div className="section-title">
            <h2>{latest.filename} <span className="faint small">· {latest.uploaded_by} · {new Date(latest.uploaded_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></h2>
            {imports?.length > 1 && (
              <select className="input" style={{ width: 'auto', height: 34 }} value={latest.id} onChange={(e) => setShown(imports.find((i) => i.id === Number(e.target.value)))}>
                {imports.map((i) => <option key={i.id} value={i.id}>Import #{i.id} · {i.filename}</option>)}
              </select>
            )}
          </div>
          <div className="kpis" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="k-label">Posted automatically</div><div className="k-value">{latest.counts.posted}</div><div className="k-sub">{inr(sum(latest.rows, ['posted']))}</div></div>
            <div className="kpi"><div className="k-label">Needed a person</div><div className="k-value">{latest.counts.queue + latest.counts.pending_approval + latest.counts.resolved}</div><div className="k-sub">{inr(sum(latest.rows, ['queue', 'pending_approval', 'resolved']))}</div></div>
            <div className="kpi"><div className="k-label">Online payments</div><div className="k-value">{latest.counts.reconciled}</div><div className="k-sub">Razorpay settlements, recorded when paid</div></div>
            <div className="kpi"><div className="k-label">Skipped</div><div className="k-value">{latest.counts.duplicate + latest.counts.ignored}</div><div className="k-sub">{latest.counts.duplicate} duplicate · {latest.counts.ignored} debit or other</div></div>
          </div>
          <div className="card flush table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Narration</th><th className="num">Amount</th><th>Result</th><th>Flat</th><th className="hide-sm">Why</th></tr></thead>
              <tbody>
                {latest.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small faint" style={{ whiteSpace: 'nowrap' }}>{date(r.txn_date)}</td>
                    <td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.narration}>{r.narration}</td>
                    <td className="num small" style={{ color: r.amount < 0 ? 'var(--ink-3)' : undefined }}>{inr(r.amount)}</td>
                    <td><span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                    <td className="small" style={{ fontWeight: 500 }}>{r.flat_id || '—'}</td>
                    <td className="small muted hide-sm" style={{ maxWidth: 360 }}>{r.reasons.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {imports && !imports.length && <p className="faint small">No statements imported yet. Export the society account’s statement from net banking as CSV and drop it above.</p>}
    </div>
  );
}
