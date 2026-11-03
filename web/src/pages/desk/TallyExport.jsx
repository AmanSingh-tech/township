import { useState } from 'react';
import { getSession } from '../../api.js';
import { date } from '../../format.js';
import { useApi, Empty, Icon, useToast } from '../../ui.jsx';

const ist = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export default function TallyExport() {
  const toast = useToast();
  const { data: history, reload } = useApi('/desk/tally/exports');
  const lastTo = history?.[0]?.to_date;
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(ist());
  const start = from ?? (lastTo ? new Date(Date.parse(lastTo) + 86400000).toISOString().slice(0, 10) : `${ist().slice(0, 7)}-01`);

  async function exportFile(format, confirmOverlap = false) {
    const res = await fetch('/api/desk/tally/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getSession().token}` },
      body: JSON.stringify({ from: start, to, format, confirmOverlap }),
    });
    if (res.status === 409) {
      const { error } = await res.json();
      if (confirm(`${error}\n\nExport anyway?`)) return exportFile(format, true);
      return;
    }
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || 'Export failed');
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `tally-${start}-to-${to}.${format === 'csv' ? 'csv' : 'xml'}` }).click();
    URL.revokeObjectURL(url);
    reload();
  }

  return (
    <div className="stack-lg">
      <div className="main-head">
        <div><h1>Tally export</h1><p className="muted">Bills, interest, amenity charges and adjustments go to Tally as Journal vouchers; payments as Receipt vouchers. Ledger names are set in Admin → Settings.</p></div>
      </div>
      <div className="card row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label>From</label><input className="input" type="date" value={start} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input className="input" type="date" value={to} max={ist()} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn primary" onClick={() => exportFile('xml')}><Icon name="download" size={18} />Tally XML</button>
        <button className="btn" onClick={() => exportFile('csv')}>Day book CSV</button>
      </div>
      <p className="faint small">In Tally: Gateway of Tally → Import → Vouchers, and choose the XML file. Each flat gets its own ledger under Sundry Debtors unless Settings says to use one ledger for all members. Import each date range once.</p>
      <section>
        <div className="section-title"><h2>Earlier exports</h2></div>
        <div className="card flush">
          {!history?.length ? <Empty>None yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Dates</th><th className="num">Vouchers</th><th>By</th><th>When</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td>{date(h.from_date)} – {date(h.to_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td className="num">{h.vouchers}</td><td className="small">{h.exported_by_name}</td><td className="small faint">{date(h.exported_at)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
