import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { ago, duration, time } from '../../format.js';
import { useApi, usePoll, Skeleton, Empty, Icon, STATUS_TONE, URGENCY_TONE, useToast } from '../../ui.jsx';

const STATUS_LABEL = { open: 'Raised', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const FILTERS = [
  ['open', 'Open', (c) => !['resolved', 'closed'].includes(c.status)],
  ['late', 'Response late', (c) => !c.first_response_at && !['resolved', 'closed'].includes(c.status) && Date.parse(c.due_by) < Date.now()],
  ['escalated', 'Safety', (c) => c.escalated && c.status !== 'closed'],
  ['resolved', 'Awaiting resident', (c) => c.status === 'resolved'],
  ['all', 'All', () => true],
];

function Timer({ c }) {
  if (['resolved', 'closed'].includes(c.status)) return <span className="faint small">—</span>;
  if (c.first_response_at) return <span className="faint small">Responded</span>;
  const left = (Date.parse(c.due_by) - Date.now()) / 60000;
  return <span className={`small num ${left < 0 ? 'error' : left < 30 ? '' : 'muted'}`} style={{ fontWeight: left < 30 ? 600 : 400 }}>
    <Icon name="clock" size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{left < 0 ? `${duration(left)} late` : `${duration(left)} left`}
  </span>;
}

export default function Queue() {
  const { refreshCounts } = useOutletContext();
  const toast = useToast();
  const { data: list, reload } = useApi('/desk/complaints');
  const { data: meta } = useApi('/desk/meta');
  const { data: staff } = useApi('/desk/staff');
  const [filter, setFilter] = useState('open');
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [, tick] = useState(0);
  usePoll(() => { reload(); tick((n) => n + 1); }, 15000);

  const rows = useMemo(() => {
    if (!list) return [];
    const f = FILTERS.find((x) => x[0] === filter)[2];
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    return list.filter(f).sort((a, b) => (b.escalated - a.escalated) || (rank[a.urgency] - rank[b.urgency]) || a.due_by.localeCompare(b.due_by));
  }, [list, filter]);

  async function open(id) {
    setSelId(id); setNote('');
    setDetail(await api(`/complaints/${id}`));
  }
  async function patch(body, msg) {
    try {
      setDetail(await api(`/desk/complaints/${selId}`, { method: 'PATCH', body }));
      setNote('');
      if (msg) toast(msg);
      reload(); refreshCounts();
    } catch (e) { toast(e.message); }
  }

  return (
    <>
      <div className="main-head">
        <div><h1>Complaints</h1><p className="muted">Sorted by safety, urgency and response deadline.</p></div>
        <div className="tabs">
          {FILTERS.map(([k, l, f]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span className="n">{list ? list.filter(f).length : ''}</span></button>)}
        </div>
      </div>
      <div className="split">
        <div className="card flush">
          {!list ? <Skeleton h={300} /> : rows.length === 0 ? <Empty>Nothing here.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Complaint</th><th>Category</th><th>Status</th><th>Response</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={`click ${selId === c.id ? 'sel' : ''}`} onClick={() => open(c.id)}>
                      <td style={{ maxWidth: 340 }}>
                        <div className="row" style={{ gap: 8 }}>
                          {c.escalated && <Icon name="alert" size={16} style={{ color: 'var(--danger)', flex: 'none' }} />}
                          <span className="ellipsis" style={{ fontWeight: 500 }}>{c.text}</span>
                        </div>
                        <div className="faint tiny">{c.flat_id} · #{c.id} · {ago(c.created_at)}{c.linked_count ? ` · ${c.linked_count + 1} flats` : ''}{c.duplicate_of ? ` · linked to #${c.duplicate_of}` : ''}</div>
                      </td>
                      <td><div className="small">{c.category}</div><span className={`pill ${URGENCY_TONE[c.urgency]}`} style={{ height: 20, fontSize: 11.5 }}>{c.urgency}</span></td>
                      <td><span className={`pill ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span><div className="faint tiny ellipsis" style={{ maxWidth: 150, marginTop: 2 }}>{c.assignee || 'Unassigned'}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}><Timer c={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="panel">
          {!detail ? <div className="card quiet"><Empty>Select a complaint to see details and act on it.</Empty></div> : (
            <div className="card stack" style={{ gap: 18 }}>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row between">
                  <span className="faint small">#{detail.id} · {detail.flat_id} · {detail.raised_by?.name}</span>
                  <span className={`pill ${STATUS_TONE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
                </div>
                <p style={{ fontSize: 15.5 }}>{detail.text}</p>
                {detail.photo_url && <img src={detail.photo_url} alt="" style={{ borderRadius: 10, maxHeight: 220, objectFit: 'cover' }} />}
                <a className="link small row" style={{ gap: 6 }} href={`tel:${detail.raised_by?.phone}`}><Icon name="phone" size={14} />{detail.raised_by?.phone}</a>
              </div>

              {detail.escalated && (
                <div className="notice danger small">
                  <b>Safety rule: {detail.escalation_reason}.</b> Escalated to the duty manager by rule, whatever the classifier said. Urgency stays critical.
                </div>
              )}
              {detail.linked.length > 0 && (
                <div className="notice small">
                  <Icon name="link" size={14} style={{ verticalAlign: -2 }} /> {detail.duplicate_of ? `Duplicate of #${detail.duplicate_of}.` : `${detail.linked.length} linked reports.`}{' '}
                  {detail.linked.map((l) => <button key={l.id} className="link" style={{ marginRight: 6 }} onClick={() => open(l.id)}>#{l.id} {l.flat_id}</button>)}
                  {detail.duplicate_of && <button className="link" onClick={() => patch({ unlink: true }, 'Unlinked')}>Unlink</button>}
                  <div className="faint tiny" style={{ marginTop: 4 }}>Updates to the main complaint reach every linked flat. Each flat closes its own.</div>
                </div>
              )}

              <div className="stack" style={{ gap: 8 }}>
                <div className="row between">
                  <span className="label">Category</span>
                  <span className="faint tiny">AI: {detail.ai_category}, {Math.round((detail.ai_confidence || 0) * 100)}% sure{detail.category_changed_by ? ` · changed by ${detail.category_changed_by}` : ''}
                    {detail.escalated && detail.ai_category !== detail.category ? ' · set by the safety rule' : ''}</span>
                </div>
                {!detail.category_changed_by && !detail.escalated && (detail.ai_confidence ?? 1) < (meta?.unsureBelow ?? 0.6) && (
                  <p className="notice warn small">The AI is unsure about this category. Check it and tap the right one if needed.</p>
                )}
                <div className="chips">
                  {meta?.categories.map((cat) => (
                    <button key={cat} className={`chip ${detail.category === cat ? 'on' : ''}`} style={{ height: 30, fontSize: 13 }}
                      onClick={() => cat !== detail.category && patch({ category: cat }, `Moved to ${cat}`)}>{cat}</button>
                  ))}
                </div>
              </div>

              <div className="grid-2" style={{ gap: 10 }}>
                <div className="field">
                  <label>Urgency</label>
                  <select className="input" value={detail.urgency} onChange={(e) => patch({ urgency: e.target.value })}>
                    {meta?.urgencies.map((u) => <option key={u} value={u}>{u} ({duration(meta.sla[u])})</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Assigned to</label>
                  <select className="input" value={detail.assignee_id || ''} onChange={(e) => patch({ assigneeId: Number(e.target.value) })}>
                    {staff?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.skill === 'duty_manager' ? 'Duty manager' : s.skill}</option>)}
                  </select>
                </div>
              </div>

              {detail.status !== 'closed' && (
                <div className="stack" style={{ gap: 8 }}>
                  <input className="input" placeholder="Note for the resident (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="row">
                    {detail.status !== 'in_progress' && detail.status !== 'resolved' && <button className="btn grow" onClick={() => patch({ status: 'in_progress', note }, 'Resident notified')}>Start work</button>}
                    {detail.status !== 'resolved' && <button className="btn primary grow" onClick={() => patch({ status: 'resolved', note }, 'Marked resolved; resident will confirm')}>Mark resolved</button>}
                    {note && <button className="btn" onClick={() => patch({ note }, 'Note added')}>Add note</button>}
                  </div>
                  {detail.status === 'resolved' && <p className="faint small">Waiting for the resident to confirm and rate, or reopen.</p>}
                </div>
              )}

              <div>
                <div className="label" style={{ marginBottom: 10 }}>History</div>
                <div className="timeline">
                  {[...detail.events].reverse().map((e) => (
                    <div key={e.id} className={`ev k-${e.kind}`}>
                      <div className="small">{e.note}</div>
                      <div className="faint tiny">{e.actor} · {ago(e.at)} · {time(e.at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
