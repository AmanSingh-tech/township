import { q, one, many, val, tx } from '../db.js';
import { getSettings } from './settings.js';
import { raiseBills, billAmount } from './billing.js';
import { send } from './notify.js';
import { audit } from './audit.js';
import { periodLabel, today, HttpError } from './util.js';
import { inrText } from './money.js';

// Accounts prepares a month's bills; a committee member (not the preparer)
// approves. Only then are bills issued and residents told.
export async function prepareBillRun(period, actor) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period || '')) throw new HttpError(400, 'Choose a month.');
  const s = await getSettings();
  const issuedOn = `${period}-${String(s.billDay).padStart(2, '0')}`;
  if (issuedOn > today()) throw new HttpError(400, `${periodLabel(period)} bills can be prepared from ${issuedOn.slice(8)} ${periodLabel(period)}.`);
  const flats = await many(`SELECT f.id, f.area FROM flats f WHERE NOT EXISTS
    (SELECT 1 FROM bills b WHERE b.flat_id = f.id AND b.period = $1)`, [period]);
  if (!flats.length) throw new HttpError(409, `Every flat already has a bill for ${periodLabel(period)}.`);
  const total = flats.reduce((sum, f) => sum + billAmount(f.area, s.ratePerSqft), 0);
  return tx(async () => {
    if (await val("SELECT COUNT(*) FROM bill_runs WHERE period = $1 AND status = 'draft'", [period])) {
      throw new HttpError(409, `Bills for ${periodLabel(period)} are already waiting for approval.`);
    }
    const run = await one(`INSERT INTO bill_runs (period, rate, issued_on, due_on, flat_count, total, prepared_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [period, s.ratePerSqft, issuedOn, `${period}-${String(s.dueDay).padStart(2, '0')}`, flats.length, total, actor.id]);
    await audit(actor, 'billrun.prepared', 'bill_run', run.id, { period, flats: flats.length, total, rate: s.ratePerSqft });
    return run;
  });
}

export function listBillRuns() {
  return many(`SELECT r.*, p.name prepared_by_name, d.name decided_by_name FROM bill_runs r
    JOIN users p ON p.id = r.prepared_by LEFT JOIN users d ON d.id = r.decided_by
    ORDER BY r.period DESC, r.id DESC LIMIT 24`);
}

export const decideBillRun = (id, approve, note, actor) => tx(async () => {
  const run = await one('SELECT * FROM bill_runs WHERE id = $1 FOR UPDATE', [id]);
  if (!run || run.status !== 'draft') throw new HttpError(409, 'This bill run has already been decided.');
  if (run.prepared_by === actor.id) throw new HttpError(403, 'Someone other than the preparer must approve the bills.');
  if (!approve) {
    await q("UPDATE bill_runs SET status = 'rejected', decided_by = $2, decided_at = now(), note = $3 WHERE id = $1", [id, actor.id, note || null]);
    await audit(actor, 'billrun.rejected', 'bill_run', id, { note });
    return { ok: true, status: 'rejected' };
  }
  const result = await raiseBills(run.period, actor, run);
  await q("UPDATE bill_runs SET status = 'issued', decided_by = $2, decided_at = now(), note = $3, flat_count = $4, total = $5 WHERE id = $1",
    [id, actor.id, note || null, result.created, result.total]);
  await audit(actor, 'billrun.issued', 'bill_run', id, { period: run.period, ...result });
  // Tell every resident (owners, tenants, family) of each billed flat.
  const people = await many(`SELECT u.phone, b.amount FROM bills b JOIN users u ON u.flat_id = b.flat_id AND u.active
    WHERE b.bill_run_id = $1`, [id]);
  for (const p of people) {
    await send('push', p.phone, `Your ${periodLabel(run.period)} maintenance bill of ${inrText(p.amount)} is ready. Due ${run.due_on.slice(8)} ${periodLabel(run.period).split(' ')[0]}.`,
      { title: 'Maintenance bill', url: '/bills' });
  }
  return { ok: true, status: 'issued', ...result };
});
