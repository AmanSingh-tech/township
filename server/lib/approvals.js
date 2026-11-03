import { q, one, many, tx } from '../db.js';
import { recordPayment, postAdjustment } from './billing.js';
import { audit } from './audit.js';
import { HttpError } from './util.js';

const vpaOf = (narration) => (narration.match(/[a-z0-9._-]{2,}@[a-z]{2,}/i) || [])[0]?.toLowerCase() || null;

export async function requestApproval(actor, a) {
  const row = await one(`INSERT INTO approvals (kind, flat_id, bank_row_id, amount, payload, summary, requested_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
  [a.kind, a.flatId || null, a.bankRowId || null, a.amount ?? null, JSON.stringify(a.payload || {}), a.summary, actor.id]);
  await audit(actor, 'approval.requested', 'approval', row.id, { kind: a.kind, summary: a.summary });
  return row.id;
}

async function lockQueuedRow(rowId) {
  const r = await one('SELECT * FROM bank_rows WHERE id = $1 FOR UPDATE', [rowId]);
  if (!r || r.status !== 'queue') throw new HttpError(409, 'This bank credit has already been handled.');
  return r;
}

export const requestBankPost = (rowId, flatId, rememberVpa, actor) => tx(async () => {
  const r = await lockQueuedRow(rowId);
  const flat = await one('SELECT id FROM flats WHERE id = $1', [String(flatId || '').toUpperCase()]);
  if (!flat) throw new HttpError(400, 'No such flat.');
  await q("UPDATE bank_rows SET status = 'pending_approval' WHERE id = $1", [rowId]);
  return requestApproval(actor, {
    kind: 'bank_post', flatId: flat.id, bankRowId: rowId, amount: r.amount,
    payload: { rememberVpa: !!rememberVpa, vpa: vpaOf(r.narration) },
    summary: `Post bank credit ₹${r.amount} (${r.txn_date}) to ${flat.id}`,
  });
});

export const requestBankIgnore = (rowId, reason, actor) => tx(async () => {
  const r = await lockQueuedRow(rowId);
  if (!String(reason || '').trim()) throw new HttpError(400, 'Say why this credit is not maintenance.');
  await q("UPDATE bank_rows SET status = 'pending_approval' WHERE id = $1", [rowId]);
  return requestApproval(actor, {
    kind: 'bank_ignore', bankRowId: rowId, amount: r.amount, payload: { reason },
    summary: `Mark bank credit ₹${r.amount} (${r.txn_date}) as not maintenance: ${reason}`,
  });
});

export const requestAdjustment = ({ flatId, amount, direction, reason }, actor) => tx(async () => {
  const flat = await one('SELECT id FROM flats WHERE id = $1', [flatId]);
  amount = Math.round(Number(amount));
  if (!flat) throw new HttpError(400, 'No such flat.');
  if (!(amount > 0)) throw new HttpError(400, 'Enter an amount above zero.');
  if (!['debit', 'credit'].includes(direction)) throw new HttpError(400, 'Choose charge or credit.');
  if (!String(reason || '').trim()) throw new HttpError(400, 'A reason is required, e.g. the committee resolution number.');
  return requestApproval(actor, {
    kind: 'adjustment', flatId, amount, payload: { direction, reason },
    summary: `${direction === 'credit' ? 'Credit' : 'Charge'} ₹${amount} to ${flatId}: ${reason}`,
  });
});

export async function listApprovals(status = 'pending') {
  return many(`SELECT a.*, r.name requested_by_name, d.name decided_by_name, b.narration, b.txn_date
    FROM approvals a JOIN users r ON r.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
    LEFT JOIN bank_rows b ON b.id = a.bank_row_id
    WHERE a.status = $1 ORDER BY a.requested_at DESC LIMIT 100`, [status]);
}

export const decideApproval = (id, approve, note, actor) => tx(async () => {
  const a = await one('SELECT * FROM approvals WHERE id = $1 FOR UPDATE', [id]);
  if (!a || a.status !== 'pending') throw new HttpError(409, 'This request has already been decided.');
  if (a.requested_by === actor.id) throw new HttpError(403, 'Someone other than the requester must approve this.');
  let result = {};
  if (approve) {
    if (a.kind === 'bank_post') {
      const r = await one('SELECT * FROM bank_rows WHERE id = $1 FOR UPDATE', [a.bank_row_id]);
      const p = await recordPayment({ flatId: a.flat_id, amount: r.amount, paidOn: r.txn_date, method: 'bank',
        reference: r.reference || r.narration.slice(0, 40), utr: r.utr, postedBy: actor.name }, actor);
      await q("UPDATE bank_rows SET status = 'resolved', flat_id = $2, payment_id = $3, resolved_by = $4, resolved_at = now() WHERE id = $1",
        [r.id, a.flat_id, p.id, actor.name]);
      if (a.payload.rememberVpa && a.payload.vpa) {
        await q(`INSERT INTO upi_handles (vpa, flat_id, learned) VALUES ($1, $2, true)
          ON CONFLICT (vpa) DO UPDATE SET flat_id = $2, learned = true`, [a.payload.vpa, a.flat_id]);
      }
      result = { receiptNo: p.receipt_no };
    } else if (a.kind === 'bank_ignore') {
      await q("UPDATE bank_rows SET status = 'ignored', resolved_by = $2, resolved_at = now(), reasons = $3 WHERE id = $1",
        [a.bank_row_id, actor.name, JSON.stringify([`Not maintenance: ${a.payload.reason}`])]);
    } else if (a.kind === 'adjustment') {
      await postAdjustment({ flatId: a.flat_id, amount: a.amount, direction: a.payload.direction, reason: a.payload.reason }, actor);
    } else if (a.kind === 'phone_change') {
      const { applyPhoneChange } = await import('./privacy.js');
      await applyPhoneChange(a.payload, actor);
    }
  } else if (a.bank_row_id) {
    await q("UPDATE bank_rows SET status = 'queue' WHERE id = $1", [a.bank_row_id]);
  }
  await q('UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1',
    [id, approve ? 'approved' : 'rejected', actor.id, note || null]);
  await audit(actor, approve ? 'approval.approved' : 'approval.rejected', 'approval', id, { summary: a.summary, note });
  return { ok: true, ...result };
});
