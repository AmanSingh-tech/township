import { useRef, useState } from 'react';
import { api } from '../../api.js';
import { inr, date } from '../../format.js';
import { useApi, Icon, useToast, Empty } from '../../ui.jsx';

const readBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});
const ACTION = { create: ['New', 'ok'], update: ['Area changes', 'warn'], unchanged: ['No change', ''], exists: ['Already registered', ''] };

export default function ImportRegister() {
  const toast = useToast();
  const fileRef = useRef();
  const { data: history, reload } = useApi('/desk/register/imports');
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [balanceDate, setBalanceDate] = useState(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function choose(f) {
    if (!f) return;
    setBusy(true); setPlan(null);
    try {
      const upload = { filename: f.name, data: await readBase64(f) };
      setFile(upload);
      setPlan(await api('/desk/register/preview', { method: 'POST', body: upload }));
    } catch (e) { toast(e.message); setFile(null); } finally { setBusy(false); }
  }
  async function commit() {
    if (!confirm(`Import ${plan.summary.flatsNew} new flats, ${plan.summary.residentsNew} residents and ${plan.summary.balances} opening balances?`)) return;
    setBusy(true);
    try {
      const r = await api('/desk/register/commit', { method: 'POST', body: { ...file, balanceDate } });
      toast(`Imported: ${r.flatsNew} flats, ${r.residentsNew} residents`);
      setPlan(null); setFile(null); reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  async function template() {
    const res = await api('/desk/register/template', { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'flat-register-template.xlsx' }).click();
    URL.revokeObjectURL(url);
  }
  const s = plan?.summary;

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Import register</h1><p className="muted">Load flats, residents and opening balances from Excel or CSV. You see exactly what will change before anything is saved.</p></div>
        <button className="btn" onClick={template}><Icon name="download" size={18} />Template</button>
      </div>

      <div className="drop">
        <Icon name="upload" size={26} className="faint" />
        <p style={{ marginTop: 8, fontWeight: 500 }}>Excel (.xlsx) or CSV, one row per person</p>
        <p className="faint small">Columns are found by their headings: Flat, Carpet area, Name, Mobile, Relation, Opening balance, UPI ID.</p>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { choose(e.target.files[0]); e.target.value = ''; }} />
        <button className="btn" style={{ marginTop: 14 }} disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Reading…' : 'Choose file'}</button>
      </div>

      {plan && (
        <section className="stack">
          <div className="kpis">
            <div className="kpi"><div className="k-label">New flats</div><div className="k-value">{s.flatsNew}</div><div className="k-sub">{s.flatsAreaChanged} area change{s.flatsAreaChanged === 1 ? '' : 's'}</div></div>
            <div className="kpi"><div className="k-label">New residents</div><div className="k-value">{s.residentsNew}</div><div className="k-sub">{s.residentsExisting} already registered</div></div>
            <div className="kpi"><div className="k-label">Opening balances</div><div className="k-value">{s.balances}</div><div className="k-sub">net {inr(s.balanceTotal)}</div></div>
            <div className="kpi"><div className="k-label">Problems</div><div className="k-value" style={{ color: plan.errors.length ? 'var(--danger)' : undefined }}>{plan.errors.length}</div><div className="k-sub">{plan.rows} rows read</div></div>
          </div>
          {plan.errors.length > 0 ? (
            <div className="card flush">
              <div style={{ padding: '14px 18px 4px' }}><h2>Fix these in the file, then choose it again</h2></div>
              <table className="table"><tbody>{plan.errors.map((e, i) => <tr key={i}><td className="faint small" style={{ width: 90 }}>{e.line ? `Row ${e.line}` : '—'}</td><td className="small">{e.message}</td></tr>)}</tbody></table>
            </div>
          ) : (
            <div className="card row between wrap">
              <div className="field" style={{ minWidth: 240 }}>
                <label>Opening balances are as of</label>
                <input className="input" type="date" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} />
              </div>
              <button className="btn primary lg" disabled={busy} onClick={commit}>Import</button>
            </div>
          )}
          <div className="grid-2">
            <div className="card flush table-wrap" style={{ maxHeight: 420 }}>
              <table className="table">
                <thead><tr><th>Flat</th><th className="num">Area</th><th className="num">Opening</th><th /></tr></thead>
                <tbody>{plan.flats.map((f) => (
                  <tr key={f.id}><td style={{ fontWeight: 500 }}>{f.id}</td>
                    <td className="num small">{f.area}{f.action === 'update' ? <span className="faint"> (was {f.previousArea})</span> : ''}</td>
                    <td className="num small">{f.balance ? inr(f.balance) : '—'}</td>
                    <td><span className={`pill ${ACTION[f.action][1]}`}>{ACTION[f.action][0]}</span></td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card flush table-wrap" style={{ maxHeight: 420 }}>
              <table className="table">
                <thead><tr><th>Flat</th><th>Name</th><th>Mobile</th><th>Relation</th><th /></tr></thead>
                <tbody>{plan.people.map((p) => (
                  <tr key={p.phone}><td className="small">{p.flatId}</td><td>{p.name}</td><td className="mono">{p.phone}</td><td className="small muted">{p.relation}</td>
                    <td><span className={`pill ${ACTION[p.action][1]}`}>{ACTION[p.action][0]}</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="section-title"><h2>Earlier imports</h2></div>
        <div className="card flush">
          {!history?.length ? <Empty>None yet.</Empty> : (
            <table className="table">
              <thead><tr><th>File</th><th>When</th><th>By</th><th className="num">Flats</th><th className="num">Residents</th><th className="num">Balances</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td>{h.filename}</td><td className="small faint">{date(h.imported_at)}</td><td className="small">{h.imported_by_name}</td>
                  <td className="num">{h.flats_created}{h.flats_updated ? ` + ${h.flats_updated} updated` : ''}</td><td className="num">{h.residents_created}</td><td className="num">{h.balances_posted}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
