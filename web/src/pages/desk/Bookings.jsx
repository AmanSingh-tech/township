import { useState } from 'react';
import { api } from '../../api.js';
import { inr } from '../../format.js';
import { useApi, Skeleton, Empty, useToast } from '../../ui.jsx';

const ist = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const t5 = (t) => String(t).slice(0, 5);

export default function Bookings() {
  const toast = useToast();
  const [day, setDay] = useState(ist());
  const { data, reload } = useApi(`/desk/bookings?date=${day}`, [day]);
  async function cancel(b) {
    if (!confirm(`Cancel ${b.amenity} for ${b.flat_id}, ${t5(b.start_time)}? Any fee is credited back.`)) return;
    try { await api(`/desk/bookings/${b.id}/cancel`, { method: 'POST', body: {} }); toast('Cancelled and refunded'); reload(); }
    catch (e) { toast(e.message); }
  }
  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Bookings</h1><p className="muted">Who has the clubhouse and courts on a given day.</p></div>
        <input className="input" type="date" style={{ width: 'auto', height: 40 }} value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <div className="card flush">
        {!data ? <Skeleton h={160} /> : data.length === 0 ? <Empty>No bookings that day.</Empty> : (
          <table className="table">
            <thead><tr><th>Amenity</th><th>Time</th><th>Flat</th><th>Booked by</th><th className="num">Fee</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b.id} style={{ opacity: b.status === 'cancelled' ? 0.5 : 1 }}>
                <td style={{ fontWeight: 500 }}>{b.amenity}</td><td className="num">{t5(b.start_time)}–{t5(b.end_time)}</td><td>{b.flat_id}</td><td className="small">{b.booked_by}</td>
                <td className="num small">{b.fee ? inr(b.fee) : '—'}</td>
                <td>{b.status === 'confirmed' ? <span className="pill ok">Confirmed</span> : <span className="pill">Cancelled{b.refunded ? ', refunded' : ''}</span>}</td>
                <td className="right">{b.status === 'confirmed' && <button className="btn sm ghost danger" onClick={() => cancel(b)}>Cancel</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
