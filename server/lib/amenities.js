import { q, one, many, val, tx } from '../db.js';
import { audit } from './audit.js';
import { send } from './notify.js';
import { today, addDays, HttpError } from './util.js';

// Bookable amenities. A fee is charged to the flat's maintenance account
// when the booking is made, and credited back on a timely cancellation.
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nowIst = () => {
  const d = new Date(Date.now() + 330 * 60000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const weekBounds = (date) => {
  const d = new Date(date + 'T00:00:00Z');
  const monday = addDays(date, -((d.getUTCDay() + 6) % 7));
  return [monday, addDays(monday, 6)];
};
export const slotLabel = (b) => `${b.on_date} ${String(b.start_time).slice(0, 5)}–${String(b.end_time).slice(0, 5)}`;

export const listAmenities = (all = false) => many(`SELECT * FROM amenities ${all ? '' : 'WHERE active'} ORDER BY name`);

export async function availability(amenityId, date) {
  const a = await one('SELECT * FROM amenities WHERE id = $1 AND active', [amenityId]);
  if (!a) throw new HttpError(404, 'Amenity not found');
  const blackout = await one('SELECT reason FROM amenity_blackouts WHERE amenity_id = $1 AND on_date = $2', [amenityId, date]);
  const taken = await many(`SELECT start_time, end_time FROM bookings WHERE amenity_id = $1 AND on_date = $2 AND status = 'confirmed'`, [amenityId, date]);
  const now = nowIst();
  const slots = [];
  for (let m = toMin(a.open_time); m + a.slot_minutes <= toMin(a.close_time); m += a.slot_minutes) {
    const used = taken.filter((b) => toMin(b.start_time) < m + a.slot_minutes && toMin(b.end_time) > m).length;
    const past = date < now.date || (date === now.date && m <= now.minutes);
    slots.push({ start: toTime(m), end: toTime(m + a.slot_minutes), left: Math.max(0, a.capacity - used), past });
  }
  return { amenity: a, date, closed: blackout?.reason || null, maxDate: addDays(today(), a.advance_days), slots };
}

export async function book({ amenityId, date, start, slots }, user) {
  slots = Math.round(Number(slots) || 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(start || '')) throw new HttpError(400, 'Choose a date and a time.');
  return tx(async () => {
    // Lock the amenity so two flats cannot take the last place at once.
    const a = await one('SELECT * FROM amenities WHERE id = $1 AND active FOR UPDATE', [amenityId]);
    if (!a) throw new HttpError(404, 'Amenity not found');
    const now = nowIst();
    if (date < now.date || date > addDays(now.date, a.advance_days)) throw new HttpError(400, `Book up to ${a.advance_days} days ahead.`);
    if (slots < 1 || slots > a.max_slots_per_booking) throw new HttpError(400, `Book at most ${a.max_slots_per_booking} slot${a.max_slots_per_booking > 1 ? 's' : ''} at a time.`);
    const s = toMin(start), e = s + slots * a.slot_minutes;
    if ((s - toMin(a.open_time)) % a.slot_minutes || s < toMin(a.open_time) || e > toMin(a.close_time)) throw new HttpError(400, 'That time is outside the slots.');
    if (date === now.date && s <= now.minutes) throw new HttpError(400, 'That slot has started.');
    const closed = await one('SELECT reason FROM amenity_blackouts WHERE amenity_id = $1 AND on_date = $2', [a.id, date]);
    if (closed) throw new HttpError(409, `${a.name} is closed that day: ${closed.reason}`);
    const [wFrom, wTo] = weekBounds(date);
    const weekly = await val(`SELECT COUNT(*) FROM bookings WHERE amenity_id = $1 AND flat_id = $2 AND status = 'confirmed' AND on_date BETWEEN $3 AND $4`, [a.id, user.flat_id, wFrom, wTo]);
    if (weekly >= a.max_bookings_per_week) throw new HttpError(409, `Your flat already has ${weekly} booking${weekly > 1 ? 's' : ''} for ${a.name} that week (limit ${a.max_bookings_per_week}).`);
    const overlapping = await many(`SELECT start_time, end_time FROM bookings WHERE amenity_id = $1 AND on_date = $2 AND status = 'confirmed'
      AND start_time < $4 AND end_time > $3`, [a.id, date, toTime(s), toTime(e)]);
    for (let m = s; m < e; m += a.slot_minutes) {
      const used = overlapping.filter((b) => toMin(b.start_time) < m + a.slot_minutes && toMin(b.end_time) > m).length;
      if (used >= a.capacity) throw new HttpError(409, `${toTime(m)} is already full.`);
    }
    const fee = a.fee * slots;
    const b = await one(`INSERT INTO bookings (amenity_id, flat_id, user_id, on_date, start_time, end_time, slots, fee)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [a.id, user.flat_id, user.id, date, toTime(s), toTime(e), slots, fee]);
    if (fee > 0) {
      await q(`INSERT INTO ledger (flat_id, on_date, kind, description, debit, booking_id, created_by) VALUES ($1, $2, 'amenity', $3, $4, $5, $6)`,
        [user.flat_id, today(), `${a.name} booking ${slotLabel(b)}`, fee, b.id, user.name]);
    }
    await audit(user, 'booking.created', 'booking', b.id, { amenity: a.name, date, start: toTime(s), slots, fee });
    return { ...b, amenity: a.name };
  });
}

// Residents cancel their own bookings; staff can cancel any (always refunded).
export async function cancel(bookingId, actor, { staff = false } = {}) {
  return tx(async () => {
    const b = await one(`SELECT b.*, a.name, a.cancel_hours FROM bookings b JOIN amenities a ON a.id = b.amenity_id WHERE b.id = $1 FOR UPDATE OF b`, [bookingId]);
    if (!b || (!staff && b.flat_id !== actor.flat_id)) throw new HttpError(404, 'Booking not found');
    if (b.status !== 'confirmed') throw new HttpError(409, 'This booking is already cancelled.');
    const startsAt = new Date(`${b.on_date}T${String(b.start_time).slice(0, 5)}:00+05:30`);
    if (!staff && startsAt <= new Date()) throw new HttpError(400, 'This booking has already started.');
    const refund = b.fee > 0 && (staff || startsAt - Date.now() >= b.cancel_hours * 3600000);
    await q("UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, refunded = $3 WHERE id = $1", [b.id, actor.name, refund]);
    if (refund) {
      await q(`INSERT INTO ledger (flat_id, on_date, kind, description, credit, booking_id, created_by) VALUES ($1, $2, 'amenity', $3, $4, $5, $6)`,
        [b.flat_id, today(), `Refund: ${b.name} booking ${slotLabel(b)} cancelled`, b.fee, b.id, actor.name]);
    }
    await audit(actor, 'booking.cancelled', 'booking', b.id, { refund, fee: b.fee, staff });
    return { ok: true, refunded: refund, fee: b.fee };
  });
}

export const flatBookings = (flatId) => many(`SELECT b.*, a.name amenity FROM bookings b JOIN amenities a ON a.id = b.amenity_id
  WHERE b.flat_id = $1 AND b.on_date >= $2 ORDER BY b.on_date, b.start_time`, [flatId, addDays(today(), -30)]);

export const bookingsOn = (date) => many(`SELECT b.*, a.name amenity, u.name booked_by FROM bookings b
  JOIN amenities a ON a.id = b.amenity_id JOIN users u ON u.id = b.user_id
  WHERE b.on_date = $1 ORDER BY a.name, b.start_time`, [date]);

const FIELDS = ['name', 'description', 'open_time', 'close_time', 'slot_minutes', 'capacity', 'fee', 'max_slots_per_booking', 'max_bookings_per_week', 'advance_days', 'cancel_hours', 'rules', 'active'];
export async function saveAmenity(id, body, actor) {
  const v = Object.fromEntries(FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  if (v.name !== undefined && !String(v.name).trim()) throw new HttpError(400, 'Give the amenity a name.');
  for (const k of ['open_time', 'close_time']) if (v[k] !== undefined && !/^\d{2}:\d{2}$/.test(v[k])) throw new HttpError(400, 'Times are HH:MM.');
  try {
    const row = id
      ? await one(`UPDATE amenities SET ${Object.keys(v).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...Object.values(v)])
      : await one(`INSERT INTO amenities (${Object.keys(v).join(', ')}) VALUES (${Object.keys(v).map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(v));
    if (!row) throw new HttpError(404, 'Not found');
    if (toMin(row.close_time) - toMin(row.open_time) < row.slot_minutes) throw new HttpError(400, 'Opening hours are shorter than one slot.');
    await audit(actor, id ? 'amenity.updated' : 'amenity.created', 'amenity', row.id, v);
    return row;
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An amenity with that name exists.');
    if (err.code === '23514') throw new HttpError(400, 'One of the values is out of range.');
    throw err;
  }
}

export async function addBlackout(amenityId, date, reason, actor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !String(reason || '').trim()) throw new HttpError(400, 'Choose a date and give a reason.');
  return tx(async () => {
    await q(`INSERT INTO amenity_blackouts (amenity_id, on_date, reason) VALUES ($1, $2, $3)
      ON CONFLICT (amenity_id, on_date) DO UPDATE SET reason = $3`, [amenityId, date, reason]);
    // Bookings already made for that day are cancelled and refunded.
    const affected = await many(`SELECT id FROM bookings WHERE amenity_id = $1 AND on_date = $2 AND status = 'confirmed'`, [amenityId, date]);
    const a = await one('SELECT name FROM amenities WHERE id = $1', [amenityId]);
    for (const b of affected) {
      const r = await cancel(b.id, actor, { staff: true });
      for (const u of await many('SELECT phone FROM users WHERE flat_id = (SELECT flat_id FROM bookings WHERE id = $1) AND active', [b.id])) {
        await send('push', u.phone, `${a.name} is closed on ${date} (${reason}). Your booking is cancelled${r.refunded ? ` and ₹${r.fee} credited back` : ''}.`, { title: 'Booking cancelled', url: '/book' });
      }
    }
    await audit(actor, 'amenity.closed', 'amenity', amenityId, { date, reason, bookingsCancelled: affected.length });
    return { cancelled: affected.length };
  });
}
