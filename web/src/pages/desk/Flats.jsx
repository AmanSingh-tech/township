import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { inr, date } from '../../format.js';
import { useApi, Skeleton, Empty, Icon, useToast } from '../../ui.jsx';
import BillRuns from './BillRuns.jsx';

export default function Flats() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data: list, reload } = useApi(`/desk/flats?q=${encodeURIComponent(q)}`, [q]);
  const { data: flat, reload: reloadFlat } = useApi(id ? `/desk/flats/${id}` : '/desk/meta', [id]);
  const [adj, setAdj] = useState({ direction: 'credit', amount: '', reason: '' });

  async function requestAdjustment(e) {
    e.preventDefault();
    try {
      await api(`/desk/flats/${id}/adjustments`, { method: 'POST', body: adj });
      toast('Sent for approval');
      setAdj({ direction: 'credit', amount: '', reason: '' });
      reloadFlat();
    } catch (err) { toast(err.message); }
  }

  const f = id && flat?.status ? flat : null;

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Flats & bills</h1><p className="muted">Prepare monthly bills, and look up any flat’s dues and ledger.</p></div>
      </div>
      <BillRuns />
      <div className="split">
        <div className="card flush">
          <div style={{ padding: 14 }} className="row">
            <Icon name="search" size={18} className="faint" />
            <input className="input" style={{ height: 40 }} placeholder="Flat number or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!list ? <Skeleton h={200} /> : (
            <table className="table">
              <thead><tr><th>Flat</th><th className="hide-sm">Residents</th><th className="num">Area</th><th className="num">Due</th></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} className={`click ${id === x.id ? 'sel' : ''}`} onClick={() => nav(`/desk/flats/${x.id}`)}>
                    <td style={{ fontWeight: 500 }}>{x.id}</td>
                    <td className="small muted hide-sm ellipsis" style={{ maxWidth: 260 }}>{x.names}</td>
                    <td className="num small">{x.area}</td>
                    <td className="num" style={{ color: x.due ? undefined : 'var(--ok)' }}>{x.due ? inr(x.due) : 'Paid'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside className="panel">
          {!f ? <div className="card quiet"><Empty>Select a flat.</Empty></div> : (
            <div className="card stack" style={{ gap: 16 }}>
              <div>
                <div className="row between"><h2>{f.id}</h2><span className="faint small">{f.area} sq ft</span></div>
                <div className="faint small">{f.residents.map((r) => `${r.name} (${r.relation})`).join(' · ')}</div>
              </div>
              <div className="row between">
                <div><div className="faint small">Total due</div><div className="num" style={{ fontSize: 26, fontWeight: 600 }}>{inr(f.status.totalDue)}</div></div>
                {f.status.daysOverdue > 0 && <span className="pill danger">{f.status.daysOverdue} days overdue</span>}
              </div>
              {f.status.accruedInterest > 0 && <p className="faint small">Includes {inr(f.status.accruedInterest)} interest accrued since the last posting.</p>}
              {f.pending.length > 0 && <div className="notice small">{f.pending.map((p) => <div key={p.id}>Awaiting approval: {p.summary}</div>)}</div>}
              <form className="stack" style={{ gap: 8 }} onSubmit={requestAdjustment}>
                <span className="label">Adjustment</span>
                <div className="row" style={{ gap: 8 }}>
                  <select className="input" style={{ width: 'auto', height: 38 }} value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })}>
                    <option value="credit">Credit (reduce dues)</option>
                    <option value="debit">Charge (add to dues)</option>
                  </select>
                  <input className="input" style={{ height: 38, width: 110 }} inputMode="numeric" placeholder="₹" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value.replace(/\D/g, '') })} />
                </div>
                <input className="input" style={{ height: 38 }} placeholder="Reason, e.g. MC resolution 14/2026" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                <button className="btn sm" disabled={!adj.amount || !adj.reason.trim()}>Send for approval</button>
              </form>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Entry</th><th className="num">Dr</th><th className="num">Cr</th></tr></thead>
                  <tbody>
                    {f.ledger.map((l) => (
                      <tr key={l.id}>
                        <td className="small faint" style={{ whiteSpace: 'nowrap' }}>{date(l.on_date)}</td>
                        <td className="small">{l.description}</td>
                        <td className="num small">{l.debit ? inr(l.debit) : ''}</td>
                        <td className="num small" style={{ color: 'var(--ok)' }}>{l.credit ? inr(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
