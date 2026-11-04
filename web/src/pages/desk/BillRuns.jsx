import { useState } from 'react';
import { api, getSession } from '../../api.js';
import { inr, date, ago, rate as fmtRate } from '../../format.js';
import { useApi, useToast } from '../../ui.jsx';

const thisMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const label = (p) => new Date(p + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Accounts prepares a month's bills; a committee member approves and issues.
export default function BillRuns({ mode }) {
  const me = getSession().user;
  const toast = useToast();
  const { data, reload } = useApi('/desk/bill-runs');
  const [period, setPeriod] = useState(thisMonth());
  const canApprove = ['committee', 'admin'].includes(me.role);
  const runs = (data || []).filter((r) => mode === 'approve' ? r.status === 'draft' : true);
  if (mode === 'approve' && !runs.length) return null;

  async function prepare() {
    try { await api('/desk/bill-runs', { method: 'POST', body: { period } }); toast('Sent to the committee for approval'); reload(); }
    catch (e) { toast(e.message); }
  }
  async function decide(r, approve) {
    const note = approve ? '' : prompt('Reason for sending back');
    if (!approve && !note) return;
    if (approve && !confirm(`Issue ${r.flat_count} bills for ${label(r.period)}, ${inr(r.total)} in all? Residents are notified immediately.`)) return;
    try {
      const out = await api(`/desk/bill-runs/${r.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note } });
      toast(approve ? `${out.created} bills issued` : 'Sent back to accounts');
      reload();
    } catch (e) { toast(e.message); }
  }

  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="row between wrap">
        <h2>{mode === 'approve' ? 'Bills waiting for your approval' : 'Monthly bills'}</h2>
        {mode !== 'approve' && (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" type="month" style={{ width: 'auto', height: 38 }} value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} aria-label="Billing month" />
            <button className="btn primary sm" onClick={prepare}>Prepare bills</button>
          </div>
        )}
      </div>
      {runs.length === 0 ? <p className="faint small">No bill runs yet. Prepare a month’s bills; the committee approves them before residents see them.</p> : (
        <div className="list">
          {runs.slice(0, mode === 'approve' ? 5 : 6).map((r) => (
            <div key={r.id} className="row between wrap" style={{ padding: '12px 0', gap: 12 }}>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{label(r.period)} · {r.flat_count} flats · {inr(r.total)}</div>
                <div className="faint tiny">{fmtRate(r.rate)} per sq ft · due {date(r.due_on)} · prepared by {r.prepared_by_name} {ago(r.prepared_at)}
                  {r.decided_by_name ? ` · ${r.status === 'issued' ? 'issued' : 'sent back'} by ${r.decided_by_name}` : ''}{r.note ? ` · “${r.note}”` : ''}</div>
              </div>
              {r.status === 'draft' && canApprove && r.prepared_by !== me.id ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" onClick={() => decide(r, false)}>Send back</button>
                  <button className="btn sm primary" onClick={() => decide(r, true)}>Approve and issue</button>
                </div>
              ) : <span className={`pill ${r.status === 'issued' ? 'ok' : r.status === 'draft' ? 'warn' : ''}`}>{r.status === 'draft' ? 'Waiting for committee' : r.status === 'issued' ? 'Issued' : 'Sent back'}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
