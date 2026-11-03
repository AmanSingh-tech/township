import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, getSession } from '../../api.js';
import { inr, ago } from '../../format.js';
import { useApi, Skeleton, Empty, useToast } from '../../ui.jsx';

const KIND = { bank_post: 'Post bank credit', bank_ignore: 'Not maintenance', adjustment: 'Ledger adjustment', phone_change: 'Mobile number change' };

export default function Approvals() {
  const me = getSession().user;
  const toast = useToast();
  const { refreshCounts } = useOutletContext();
  const [tab, setTab] = useState('pending');
  const { data, reload } = useApi(`/desk/approvals?status=${tab === 'pending' ? 'pending' : 'decided'}`, [tab]);
  const [notes, setNotes] = useState({});

  async function decide(a, approve) {
    try {
      const r = await api(`/desk/approvals/${a.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note: notes[a.id] || '' } });
      toast(approve ? `Approved${r.receiptNo ? ` · receipt ${r.receiptNo}` : ''}` : 'Rejected; returned to the queue');
      reload(); refreshCounts();
    } catch (e) { toast(e.message); }
  }

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Approvals</h1><p className="muted">Manual money decisions, and changes to a resident’s login number, take effect only after a second person approves them.</p></div>
        <div className="tabs">
          <button className={tab === 'pending' ? 'on' : ''} onClick={() => setTab('pending')}>Waiting</button>
          <button className={tab === 'decided' ? 'on' : ''} onClick={() => setTab('decided')}>Approved</button>
        </div>
      </div>
      {!data ? <Skeleton h={200} /> : data.length === 0 ? <div className="card"><Empty>Nothing {tab === 'pending' ? 'waiting' : 'approved yet'}.</Empty></div> : (
        <div className="stack">
          {data.map((a) => {
            const mine = a.requested_by === me.id;
            return (
              <div key={a.id} className="card stack" style={{ gap: 12 }}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <span className="pill info">{KIND[a.kind]}</span>
                    <div style={{ fontWeight: 500, marginTop: 8 }}>{a.summary}</div>
                    {a.narration && <div className="mono faint" style={{ marginTop: 4, wordBreak: 'break-all' }}>{a.narration}</div>}
                    <div className="faint tiny" style={{ marginTop: 6 }}>Requested by {a.requested_by_name} · {ago(a.requested_at)}{a.decided_by_name ? ` · approved by ${a.decided_by_name}` : ''}</div>
                  </div>
                  {a.amount != null && <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{inr(a.amount)}</div>}
                </div>
                {tab === 'pending' && (mine ? <p className="faint small">Waiting for someone else to approve your request.</p> : (
                  <div className="row wrap">
                    <input className="input grow" style={{ height: 38, minWidth: 200 }} placeholder="Note (optional)" value={notes[a.id] || ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                    <button className="btn" onClick={() => decide(a, false)}>Reject</button>
                    <button className="btn primary" onClick={() => decide(a, true)}>Approve</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
