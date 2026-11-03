import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { ago, date } from '../../format.js';
import { useApi, Skeleton, Empty, useToast } from '../../ui.jsx';

const ROLES = [['helpdesk', 'Help desk'], ['accounts', 'Accounts'], ['committee', 'Committee'], ['guard', 'Guard'], ['admin', 'Administrator']];
const TABS = [['users', 'Staff'], ['devices', 'Gate tablets'], ['staff', 'Technicians'], ['amenities', 'Amenities'], ['settings', 'Settings'], ['notices', 'Notices'], ['requests', 'Data requests'], ['messages', 'Messages'], ['audit', 'Audit log']];

function Users() {
  const toast = useToast();
  const { data, reload } = useApi('/admin/users');
  const [f, setF] = useState({ name: '', phone: '', role: 'helpdesk', pin: '' });
  async function add(e) {
    e.preventDefault();
    try { await api('/admin/users', { method: 'POST', body: f }); setF({ name: '', phone: '', role: 'helpdesk', pin: '' }); reload(); toast('Added. They can sign in now.'); }
    catch (err) { toast(err.message); }
  }
  async function patch(u, body, msg) {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); reload(); toast(msg); } catch (err) { toast(err.message); }
  }
  return (
    <div className="stack-lg">
      <form className="card row wrap" onSubmit={add}>
        <input className="input grow" style={{ minWidth: 160 }} placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" style={{ width: 160 }} placeholder="Mobile" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <select className="input" style={{ width: 160 }} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {f.role === 'guard' && <input className="input" style={{ width: 120 }} placeholder="PIN" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />}
        <button className="btn primary">Add</button>
      </form>
      <div className="card flush table-wrap">
        {!data ? <Skeleton h={160} /> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{u.name}</td>
                <td className="mono">{u.phone}</td>
                <td>
                  <select className="input" style={{ height: 34, width: 150 }} value={u.role} onChange={(e) => patch(u, { role: e.target.value }, 'Role changed; they will sign in again')}>
                    {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td>{u.active ? <span className="pill ok">Active</span> : <span className="pill">Off</span>}</td>
                <td className="right">
                  {u.role === 'guard' && <button className="btn sm ghost" onClick={() => { const pin = prompt('New PIN (4 to 8 digits)'); if (pin) patch(u, { pin }, 'PIN changed'); }}>Set PIN</button>}
                  <button className="btn sm ghost" onClick={() => patch(u, { active: !u.active }, u.active ? 'Deactivated and signed out' : 'Reactivated')}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p className="faint small">Residents are added from the flat register import, or by the flat’s owner or tenant in the app.</p>
    </div>
  );
}

function Devices() {
  const toast = useToast();
  const { data, reload } = useApi('/admin/devices');
  const [f, setF] = useState({ name: '', gate: 'Gate 1' });
  const [made, setMade] = useState(null);
  async function add(e) {
    e.preventDefault();
    try { setMade(await api('/admin/devices', { method: 'POST', body: f })); setF({ name: '', gate: f.gate }); reload(); }
    catch (err) { toast(err.message); }
  }
  async function revoke(d) {
    if (!confirm(`Revoke ${d.name}? Anyone signed in on it is signed out.`)) return;
    try { await api(`/admin/devices/${d.id}/revoke`, { method: 'POST' }); reload(); } catch (err) { toast(err.message); }
  }
  return (
    <div className="stack-lg">
      <form className="card row wrap" onSubmit={add}>
        <input className="input grow" style={{ minWidth: 180 }} placeholder="Tablet name, e.g. Gate 2 – main" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" style={{ width: 140 }} placeholder="Gate" value={f.gate} onChange={(e) => setF({ ...f, gate: e.target.value })} />
        <button className="btn primary">Register tablet</button>
      </form>
      {made && (
        <div className="notice ok">
          Open <b>{location.origin}/gate</b> on the tablet and enter this pairing code within 24 hours:
          <div className="mono" style={{ fontSize: 28, letterSpacing: '0.2em', marginTop: 6 }}>{made.pairingCode}</div>
        </div>
      )}
      <div className="card flush table-wrap">
        {!data ? <Skeleton h={120} /> : data.length === 0 ? <Empty>No tablets yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Tablet</th><th>Gate</th><th>Status</th><th>Last used</th><th /></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.id} style={{ opacity: d.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{d.name}</td><td>{d.gate}</td>
                <td>{!d.active ? <span className="pill">Revoked</span> : d.paired ? <span className="pill ok">Paired</span> : <span className="pill warn">Waiting for pairing</span>}</td>
                <td className="small faint">{d.last_seen_at ? ago(d.last_seen_at) : '—'}</td>
                <td className="right">{d.active && <button className="btn sm ghost danger" onClick={() => revoke(d)}>Revoke</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Technicians() {
  const toast = useToast();
  const { data, reload } = useApi('/admin/staff');
  const { data: meta } = useApi('/desk/meta');
  const [f, setF] = useState({ name: '', phone: '', skill: 'Plumbing', towers: '' });
  async function add(e) {
    e.preventDefault();
    try { await api('/admin/staff', { method: 'POST', body: f }); setF({ ...f, name: '', phone: '', towers: '' }); reload(); } catch (err) { toast(err.message); }
  }
  const toggle = (s) => api(`/admin/staff/${s.id}`, { method: 'PATCH', body: { active: !s.active } }).then(reload).catch((e) => toast(e.message));
  return (
    <div className="stack-lg">
      <form className="card row wrap" onSubmit={add}>
        <input className="input grow" style={{ minWidth: 160 }} placeholder="Name or vendor" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" style={{ width: 150 }} placeholder="Mobile" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <select className="input" style={{ width: 170 }} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })}>
          {(meta?.categories || []).map((c) => <option key={c}>{c}</option>)}<option value="duty_manager">Duty manager</option>
        </select>
        <input className="input" style={{ width: 200 }} placeholder="Towers (blank = all), e.g. T01,T02" value={f.towers} onChange={(e) => setF({ ...f, towers: e.target.value })} />
        <button className="btn primary">Add</button>
      </form>
      <div className="card flush table-wrap">
        {!data ? <Skeleton h={160} /> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Handles</th><th>Towers</th><th>Mobile</th><th /></tr></thead>
            <tbody>{data.map((s) => (
              <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{s.name}</td><td>{s.skill === 'duty_manager' ? 'Duty manager (safety alerts)' : s.skill}</td>
                <td className="small muted">{s.towers || 'All'}</td><td className="mono">{s.phone}</td>
                <td className="right"><button className="btn sm ghost" onClick={() => toggle(s)}>{s.active ? 'Deactivate' : 'Reactivate'}</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const BLANK_AMENITY = { name: '', description: '', open_time: '06:00', close_time: '22:00', slot_minutes: 60, capacity: 1, fee: 0, max_slots_per_booking: 2, max_bookings_per_week: 3, advance_days: 14, cancel_hours: 24, rules: '', active: true };
function Amenities() {
  const toast = useToast();
  const { data, reload } = useApi('/admin/amenities');
  const [edit, setEdit] = useState(null);
  const [close, setClose] = useState({ date: '', reason: '' });
  const num = ['slot_minutes', 'capacity', 'fee', 'max_slots_per_booking', 'max_bookings_per_week', 'advance_days', 'cancel_hours'];
  async function save(e) {
    e.preventDefault();
    const body = { ...edit };
    for (const k of num) body[k] = Number(body[k]);
    body.open_time = String(body.open_time).slice(0, 5); body.close_time = String(body.close_time).slice(0, 5);
    delete body.id; delete body.created_at;
    try { await api(edit.id ? `/admin/amenities/${edit.id}` : '/admin/amenities', { method: edit.id ? 'PATCH' : 'POST', body }); setEdit(null); reload(); toast('Saved'); }
    catch (err) { toast(err.message); }
  }
  async function closeDay() {
    try {
      const r = await api(`/admin/amenities/${edit.id}/blackouts`, { method: 'POST', body: close });
      toast(`Closed on ${close.date}${r.cancelled ? `; ${r.cancelled} booking${r.cancelled > 1 ? 's' : ''} cancelled and refunded` : ''}`);
      setClose({ date: '', reason: '' });
    } catch (err) { toast(err.message); }
  }
  const f = (label, key, props = {}) => (
    <div className="field"><label>{label}</label><input className="input" value={edit[key]} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} {...props} /></div>
  );
  if (edit) return (
    <form className="card stack-lg" onSubmit={save} style={{ maxWidth: 820 }}>
      <div className="grid-2">
        {f('Name', 'name')}{f('Description', 'description')}
        {f('Opens', 'open_time', { type: 'time' })}{f('Closes', 'close_time', { type: 'time' })}
        {f('Slot length (minutes)', 'slot_minutes', { inputMode: 'numeric' })}{f('Bookings allowed per slot', 'capacity', { inputMode: 'numeric' })}
        {f('Fee per slot (₹, charged to the flat)', 'fee', { inputMode: 'numeric' })}{f('Most slots in one booking', 'max_slots_per_booking', { inputMode: 'numeric' })}
        {f('Bookings per flat per week', 'max_bookings_per_week', { inputMode: 'numeric' })}{f('Book up to (days ahead)', 'advance_days', { inputMode: 'numeric' })}
        {f('Free cancellation until (hours before)', 'cancel_hours', { inputMode: 'numeric' })}
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Open for booking</label>
      </div>
      <div className="field"><label>Rules shown to residents</label><textarea className="input" value={edit.rules} onChange={(e) => setEdit({ ...edit, rules: e.target.value })} /></div>
      <div className="row"><button className="btn primary">Save</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
      {edit.id && (
        <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 18 }}>
          <h3>Close for a day</h3>
          <p className="faint small">Bookings already made for that day are cancelled, refunded and the flats are told.</p>
          <div className="row wrap">
            <input className="input" type="date" style={{ width: 180 }} value={close.date} onChange={(e) => setClose({ ...close, date: e.target.value })} />
            <input className="input grow" placeholder="Reason, e.g. maintenance" value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} />
            <button type="button" className="btn" disabled={!close.date || !close.reason.trim()} onClick={closeDay}>Close that day</button>
          </div>
        </div>
      )}
    </form>
  );
  return (
    <div className="stack-lg">
      <div><button className="btn primary" onClick={() => setEdit({ ...BLANK_AMENITY })}>Add amenity</button></div>
      <div className="card flush table-wrap">
        {!data ? <Skeleton h={120} /> : data.length === 0 ? <Empty>No amenities yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Amenity</th><th>Hours</th><th>Slot</th><th className="num">Fee</th><th>Limits</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{a.name}</td>
                <td className="small">{String(a.open_time).slice(0, 5)}–{String(a.close_time).slice(0, 5)}</td>
                <td className="small">{a.slot_minutes} min × {a.capacity}</td>
                <td className="num">{a.fee ? `₹${a.fee}` : 'Free'}</td>
                <td className="small muted">{a.max_bookings_per_week}/week · {a.advance_days} days ahead · cancel {a.cancel_hours} h before</td>
                <td className="right"><button className="btn sm ghost" onClick={() => setEdit({ ...a })}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const TALLY_FIELDS = [['company', 'Tally company name'], ['bankLedger', 'Bank ledger'], ['gatewayLedger', 'Online payments ledger'], ['maintenanceLedger', 'Maintenance income ledger'],
  ['interestLedger', 'Interest income ledger'], ['amenityLedger', 'Amenity income ledger'], ['adjustmentLedger', 'Adjustments ledger'], ['memberGroup', 'Group for flat ledgers'], ['singleMemberLedger', 'Single members ledger']];
const TALLY_DEFAULTS = { company: '', memberMode: 'per-flat', memberGroup: 'Sundry Debtors', singleMemberLedger: 'Members – Maintenance Receivable', bankLedger: 'Bank Account', gatewayLedger: 'Razorpay Clearing', maintenanceLedger: 'Maintenance Charges', interestLedger: 'Interest on Arrears', amenityLedger: 'Amenity Charges', adjustmentLedger: 'Maintenance Adjustments' };

function Settings() {
  const toast = useToast();
  const { data, setData } = useApi('/admin/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ ...data, interestPct: +(data.interestRatePa * 100).toFixed(2), bank: data.bankDetails || { accountName: '', accountNumber: '', ifsc: '', upiId: '' }, tallyF: { ...TALLY_DEFAULTS, ...(data.tally || {}) } }); }, [data]);
  if (!f) return <Skeleton h={300} />;
  async function save(e) {
    e.preventDefault();
    try {
      const body = {
        societyName: f.societyName, ratePerSqft: Number(f.ratePerSqft), billDay: Number(f.billDay), dueDay: Number(f.dueDay),
        interestRatePa: Number(f.interestPct) / 100, visitorPhotoRetentionDays: Number(f.visitorPhotoRetentionDays),
        bankDetails: f.bank.accountNumber ? f.bank : null,
        tally: f.tallyF,
      };
      setData(await api('/admin/settings', { method: 'PUT', body }));
      toast('Saved. New values apply from the next bill run.');
    } catch (err) { toast(err.message); }
  }
  const field = (label, key, props = {}) => (
    <div className="field"><label>{label}</label><input className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} /></div>
  );
  const bankField = (label, key) => (
    <div className="field"><label>{label}</label><input className="input" value={f.bank[key] || ''} onChange={(e) => setF({ ...f, bank: { ...f.bank, [key]: e.target.value } })} /></div>
  );
  return (
    <form className="card stack-lg" onSubmit={save} style={{ maxWidth: 720 }}>
      <div className="grid-2">
        {field('Society name', 'societyName')}
        {field('Rate per sq ft (₹ a month)', 'ratePerSqft', { inputMode: 'decimal' })}
        {field('Bill date (day of month)', 'billDay', { inputMode: 'numeric' })}
        {field('Due date (day of month)', 'dueDay', { inputMode: 'numeric' })}
        {field('Interest on arrears (% a year, max 21)', 'interestPct', { inputMode: 'decimal' })}
        {field('Delete visitor photos after (days)', 'visitorPhotoRetentionDays', { inputMode: 'numeric' })}
      </div>
      <div className="stack">
        <h3>Society bank account</h3>
        <p className="faint small">Shown to residents who pay by bank transfer.</p>
        <div className="grid-2">{bankField('Account name', 'accountName')}{bankField('Account number', 'accountNumber')}{bankField('IFSC', 'ifsc')}{bankField('UPI ID', 'upiId')}</div>
      </div>
      <div className="stack">
        <h3>Tally ledgers</h3>
        <p className="faint small">Use the ledger names exactly as they are in your Tally company.</p>
        <div className="chips">
          {[['per-flat', 'A ledger for each flat'], ['single', 'One ledger for all members']].map(([k, l]) => (
            <button type="button" key={k} className={`chip ${f.tallyF.memberMode === k ? 'on' : ''}`} onClick={() => setF({ ...f, tallyF: { ...f.tallyF, memberMode: k } })}>{l}</button>
          ))}
        </div>
        <div className="grid-2">{TALLY_FIELDS.filter(([k]) => (f.tallyF.memberMode === 'single' ? k !== 'memberGroup' : k !== 'singleMemberLedger')).map(([k, l]) => (
          <div key={k} className="field"><label>{l}</label><input className="input" value={f.tallyF[k]} onChange={(e) => setF({ ...f, tallyF: { ...f.tallyF, [k]: e.target.value } })} /></div>
        ))}</div>
      </div>
      <div className="row wrap">
        <button className="btn primary">Save settings</button>
        <a className="btn ghost" href={`/gate-notice?days=${f.visitorPhotoRetentionDays}&society=${encodeURIComponent(f.societyName)}`} target="_blank" rel="noreferrer">Print gate notice</a>
      </div>
    </form>
  );
}

function Notices() {
  const toast = useToast();
  const { data, reload } = useApi('/notices');
  const [f, setF] = useState({ title: '', body: '' });
  async function post(e) {
    e.preventDefault();
    try { await api('/admin/notices', { method: 'POST', body: f }); setF({ title: '', body: '' }); reload(); toast('Posted'); } catch (err) { toast(err.message); }
  }
  const remove = (n) => confirm(`Remove “${n.title}”?`) && api(`/admin/notices/${n.id}`, { method: 'DELETE' }).then(reload);
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <form className="card stack" onSubmit={post}>
        <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" placeholder="Notice text" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div><button className="btn primary" disabled={!f.title.trim() || !f.body.trim()}>Post notice</button></div>
      </form>
      <div className="card flush list">
        {(data || []).map((n) => (
          <div key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><b style={{ fontWeight: 500 }}>{n.title}</b> <span className="faint tiny">· {date(n.posted_on)}</span><p className="muted small">{n.body}</p></div>
            <button className="btn sm ghost" onClick={() => remove(n)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Audit() {
  const { data } = useApi('/admin/audit');
  return (
    <div className="card flush table-wrap">
      {!data ? <Skeleton h={200} /> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}>
              <td className="small faint" style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
              <td className="small">{a.user_name}</td>
              <td className="mono">{a.action}{a.entity_id ? ` · ${a.entity_id}` : ''}</td>
              <td className="mono faint" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function DataRequests() {
  const toast = useToast();
  const { data, reload } = useApi('/admin/data-requests');
  async function resolve(r, outcome) {
    const response = prompt(outcome === 'declined' ? 'Reason for declining (shown to the resident)'
      : r.kind === 'erasure' ? 'Note to the resident (their account will be closed and complaint photos deleted; accounts are kept by law)'
      : 'What was corrected? (make the change under Residents first)');
    if (response === null || (outcome === 'declined' && !response.trim())) return;
    try { await api(`/admin/data-requests/${r.id}/resolve`, { method: 'POST', body: { outcome, response } }); reload(); toast('Done'); }
    catch (e) { toast(e.message); }
  }
  return (
    <div className="card flush table-wrap">
      {!data ? <Skeleton h={160} /> : data.length === 0 ? <Empty>No requests from residents.</Empty> : (
        <table className="table">
          <thead><tr><th>Resident</th><th>Request</th><th>Received</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td><b style={{ fontWeight: 500 }}>{r.name}</b><div className="faint tiny">{r.flat_id} · {r.phone}</div></td>
              <td style={{ maxWidth: 380 }}><span className={`pill ${r.kind === 'erasure' ? 'danger' : 'info'}`}>{r.kind}</span><div className="small" style={{ marginTop: 4 }}>{r.details}</div>{r.response && <div className="faint tiny">Reply: {r.response}</div>}</td>
              <td className="small faint">{ago(r.created_at)}</td>
              <td>{r.status === 'open' ? <span className="pill warn">Open</span> : <span className="pill">{r.status}{r.handled_by_name ? ` · ${r.handled_by_name}` : ''}</span>}</td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>{r.status === 'open' && <>
                <button className="btn sm ghost" onClick={() => resolve(r, 'declined')}>Decline</button>
                <button className="btn sm primary" onClick={() => resolve(r, 'done')}>{r.kind === 'erasure' ? 'Erase' : 'Mark done'}</button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function Messages() {
  const { data } = useApi('/admin/messages');
  const tone = { sent: 'ok', failed: 'danger', skipped: '', queued: 'warn' };
  return (
    <div className="card flush table-wrap">
      {!data ? <Skeleton h={160} /> : (
        <table className="table">
          <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}>
              <td className="small faint" style={{ whiteSpace: 'nowrap' }}>{ago(m.at)}</td>
              <td className="small">{m.channel}</td><td className="mono">{m.to_addr}</td>
              <td className="small" style={{ maxWidth: 420 }}>{m.body}</td>
              <td><span className={`pill ${tone[m.status]}`} title={m.error || m.provider_ref || ''}>{m.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  const Panel = { users: Users, devices: Devices, staff: Technicians, amenities: Amenities, settings: Settings, notices: Notices, requests: DataRequests, messages: Messages, audit: Audit }[tab];
  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Admin</h1><p className="muted">Staff, gate tablets, technicians and society settings. Every change is recorded in the audit log.</p></div>
        <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </div>
      <Panel />
    </div>
  );
}
