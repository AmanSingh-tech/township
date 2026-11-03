import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, Skeleton, Empty, Icon, useToast } from '../../ui.jsx';

// Correcting residents' details (DPDP right to correction). Each change is
// audited with the values before and after.
export default function Residents() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, reload } = useApi(`/desk/residents?q=${encodeURIComponent(q)}`, [q]);
  const [edit, setEdit] = useState(null);

  async function save(e) {
    e.preventDefault();
    try {
      const r = await api(`/desk/residents/${edit.id}`, { method: 'PATCH', body: { name: edit.name, phone: edit.phone, relation: edit.relation } });
      toast(r.approvalId ? 'Saved. The new mobile number takes effect once accounts or the admin approves it.' : 'Saved.');
      setEdit(null); reload();
    } catch (err) { toast(err.message); }
  }

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Residents</h1><p className="muted">Correct a resident’s name, mobile number or relation. Every change is recorded with the old and new values; a new mobile number also needs a second person’s approval.</p></div>
      </div>
      <div className="card flush">
        <div style={{ padding: 14 }} className="row">
          <Icon name="search" size={18} className="faint" />
          <input className="input" style={{ height: 40 }} placeholder="Name, mobile or flat" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!data ? <Skeleton h={200} /> : data.length === 0 ? <Empty>No one found.</Empty> : (
          <table className="table">
            <thead><tr><th>Flat</th><th>Name</th><th>Mobile</th><th>Relation</th><th /></tr></thead>
            <tbody>{data.map((u) => edit?.id === u.id ? (
              <tr key={u.id}>
                <td style={{ fontWeight: 500 }}>{u.flat_id}</td>
                <td><input className="input" style={{ height: 36 }} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                <td><input className="input" style={{ height: 36 }} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></td>
                <td>
                  <select className="input" style={{ height: 36 }} value={edit.relation} onChange={(e) => setEdit({ ...edit, relation: e.target.value })}>
                    {['owner', 'tenant', 'family'].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn sm primary" onClick={save}>Save</button></td>
              </tr>
            ) : (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 500 }}>{u.flat_id}</td><td>{u.name}</td><td className="mono">{u.phone}</td><td className="small muted">{u.relation}{u.active ? '' : ' · closed'}</td>
                <td className="right">{u.active && <button className="btn sm ghost" onClick={() => setEdit(u)}>Correct</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
