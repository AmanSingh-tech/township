import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { inr, date } from '../../format.js';
import { useApi, Skeleton, Empty, useToast, Icon } from '../../ui.jsx';
import { TINTS } from './parts.jsx';

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plusDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const t5 = (t) => String(t).slice(0, 5);

export default function Book() {
  const { t } = useT();
  const toast = useToast();
  const { data: amenities } = useApi('/amenities');
  const { data: mine, reload: reloadMine } = useApi('/bookings');
  const [aid, setAid] = useState(null);
  const [day, setDay] = useState(istToday());
  const [avail, setAvail] = useState(null);
  const [pick, setPick] = useState([]);
  const [busy, setBusy] = useState(false);
  const amenity = amenities?.find((a) => a.id === aid) || amenities?.[0];

  useEffect(() => {
    if (!amenity) return;
    setPick([]); setAvail(null);
    api(`/amenities/${amenity.id}/availability?date=${day}`).then(setAvail).catch((e) => toast(e.message));
  }, [amenity?.id, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => amenity ? Array.from({ length: Math.min(amenity.advance_days, 13) + 1 }, (_, i) => plusDays(istToday(), i)) : [], [amenity]);
  // Slots must be next to each other: tapping extends or restarts the run.
  function toggle(i) {
    if (pick.includes(i)) return setPick(pick.filter((x) => x < i));
    const contiguous = pick.length && (i === Math.max(...pick) + 1) && pick.length < amenity.max_slots_per_booking;
    setPick(contiguous ? [...pick, i] : [i]);
  }
  async function confirm() {
    setBusy(true);
    try {
      const start = avail.slots[Math.min(...pick)].start;
      await api('/bookings', { method: 'POST', body: { amenityId: amenity.id, date: day, start, slots: pick.length } });
      toast(`${amenity.name}: ${date(day)} ${start}`);
      setPick([]); reloadMine();
      setAvail(await api(`/amenities/${amenity.id}/availability?date=${day}`));
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  async function cancelIt(b) {
    if (!window.confirm(`${b.amenity}, ${date(b.on_date)} ${t5(b.start_time)}?`)) return;
    try {
      const r = await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: {} });
      toast(r.refunded ? `Cancelled. ${inr(r.fee)} credited back.` : 'Cancelled.');
      reloadMine();
      if (b.amenity_id === amenity?.id && b.on_date === day) setAvail(await api(`/amenities/${amenity.id}/availability?date=${day}`));
    } catch (e) { toast(e.message); }
  }

  if (!amenities) return <Skeleton h={300} />;
  if (!amenities.length) return <Empty>No amenities can be booked yet.</Empty>;
  const upcoming = (mine || []).filter((b) => b.status === 'confirmed' && b.on_date >= istToday());

  return (
    <div className="stack-lg book">
      <div className="amen-scroll" role="tablist" aria-label="Amenities">
        {amenities.map((a, i) => (
          <button key={a.id} role="tab" aria-selected={amenity.id === a.id} className={`amen tint-${TINTS[i % TINTS.length]} ${amenity.id === a.id ? 'on' : ''}`} onClick={() => setAid(a.id)}>
            <span className="amen-name">{a.name}</span>
            <span className="amen-fee num">{a.fee ? `${inr(a.fee)} ${t('perSlot')}` : t('free')}</span>
          </button>
        ))}
      </div>

      <section className="card stack" style={{ gap: 8 }}>
        <div style={{ fontWeight: 600 }}>{amenity.name}</div>
        {amenity.description && <div className="faint small">{amenity.description}</div>}
        {amenity.rules && <p className="muted small">{amenity.rules}</p>}
        {amenity.fee > 0 && <p className="faint tiny">{t('chargedToBill')} · {t('freeCancel', { h: amenity.cancel_hours })}</p>}
      </section>

      <div className="day-scroll" role="tablist" aria-label={t('forDate')}>
        {days.map((d) => (
          <button key={d} role="tab" aria-selected={d === day} className={`day ${d === day ? 'on' : ''}`} onClick={() => setDay(d)}>
            <span className="tiny">{new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</span>
            <b>{Number(d.slice(8))}</b>
          </button>
        ))}
      </div>

      {!avail ? <Skeleton h={160} /> : avail.closed ? <div className="notice warn">{t('closed')}: {avail.closed}</div>
        : avail.slots.every((s) => s.past) ? <p className="empty">{t('noSlotsLeft')}</p> : (
        <div className="slots">
          {/* Slots that have already started today are left out. A picked run is joined into one block. */}
          {avail.slots.map((s, i) => {
            if (s.past) return null;
            const full = s.left === 0, on = pick.includes(i);
            const cap = amenity.capacity || 1;
            return (
              <button key={s.start} disabled={full} onClick={() => toggle(i)} aria-pressed={on}
                className={`slot ${on ? 'on' : ''} ${on && pick.includes(i - 1) ? 'join-l' : ''} ${on && pick.includes(i + 1) ? 'join-r' : ''}`}>
                <span className="slot-t">{s.start}</span>
                <span className="slot-l">{full ? t('full') : t('slotsLeft', { n: s.left })}</span>
                <span className="slot-bar" aria-hidden="true"><i style={{ width: `${(s.left / cap) * 100}%` }} /></span>
              </button>
            );
          })}
        </div>
      )}

      {pick.length > 0 && (
        <div className="book-bar">
          <div className="grow">
            <b>{amenity.name}</b>
            <div className="tiny">{date(day, { weekday: 'short', day: 'numeric', month: 'short' })} · {avail.slots[Math.min(...pick)].start}–{avail.slots[Math.max(...pick)].end}</div>
          </div>
          <button className="btn primary" disabled={busy} onClick={confirm}>
            <Icon name="check" size={16} />{t('confirmBooking')}{amenity.fee ? ` · ${inr(amenity.fee * pick.length)}` : ''}
          </button>
        </div>
      )}

      <section>
        <div className="section-title"><h2>{t('yourBookings')}</h2></div>
        <div className="card flush list">
          {upcoming.length ? upcoming.map((b) => (
            <div key={b.id} className="list-item">
              <span className="bk-date" aria-hidden="true"><b>{Number(String(b.on_date).slice(8, 10))}</b><span>{date(b.on_date, { month: 'short' })}</span></span>
              <div className="grow"><div style={{ fontWeight: 500 }}>{b.amenity}</div><div className="faint tiny">{date(b.on_date, { weekday: 'short' })} · {t5(b.start_time)}–{t5(b.end_time)}{b.fee ? ` · ${inr(b.fee)}` : ''}</div></div>
              <button className="btn sm ghost danger" onClick={() => cancelIt(b)}>{t('cancelBooking')}</button>
            </div>
          )) : <Empty>{t('noBookings')}</Empty>}
        </div>
      </section>
    </div>
  );
}
