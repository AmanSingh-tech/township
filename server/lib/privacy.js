import { q, one, many, tx } from '../db.js';
import { audit } from './audit.js';
import { deleteFile } from './storage.js';
import { endAllSessions } from './auth.js';
import { HttpError } from './util.js';
import { requestApproval } from './approvals.js';

// DPDP Act 2023 rights: a copy of your data, correction, and erasure.
// Bills, payments and receipts are kept even after erasure: the society must
// keep its accounts under the Maharashtra Co-operative Societies Act.
export async function exportUserData(user) {
  const flat = user.flat_id;
  return {
    exportedAt: new Date().toISOString(),
    note: 'Personal data held by the society office about you and your flat.',
    profile: await one('SELECT name, phone, role, flat_id, relation, lang, consent_at, created_at FROM users WHERE id = $1', [user.id]),
    household: await many('SELECT name, phone, relation FROM users WHERE flat_id = $1 AND active', [flat]),
    flat: await one('SELECT id, area FROM flats WHERE id = $1', [flat]),
    bills: await many('SELECT period, amount, issued_on, due_on FROM bills WHERE flat_id = $1 ORDER BY period', [flat]),
    ledger: await many('SELECT on_date, kind, description, debit, credit FROM ledger WHERE flat_id = $1 ORDER BY on_date, id', [flat]),
    payments: await many('SELECT paid_on, amount, method, receipt_no, reference FROM payments WHERE flat_id = $1 ORDER BY paid_on', [flat]),
    complaintsYouRaised: await many(`SELECT id, text, category, status, created_at, rating, feedback, photo_key IS NOT NULL has_photo
      FROM complaints WHERE raised_by = $1 ORDER BY created_at`, [user.id]),
    visitorsToYourFlat: await many(`SELECT name, purpose, gate, status, created_at, photo_key IS NOT NULL has_photo
      FROM visitors WHERE flat_id = $1 ORDER BY created_at`, [flat]),
    guestCodes: await many('SELECT guest_name, valid_on, used_at FROM guest_codes WHERE created_by = $1', [user.id]),
    dataRequests: await many('SELECT kind, details, status, created_at, response FROM data_requests WHERE user_id = $1', [user.id]),
  };
}

export async function createDataRequest(user, kind, details) {
  if (!['correction', 'erasure'].includes(kind)) throw new HttpError(400, 'Unknown request.');
  details = String(details || '').trim().slice(0, 1000);
  if (kind === 'correction' && !details) throw new HttpError(400, 'Say what should be corrected.');
  return tx(async () => {
    const r = await one('INSERT INTO data_requests (user_id, kind, details) VALUES ($1, $2, $3) RETURNING id, kind, status, created_at',
      [user.id, kind, details || 'Erase my personal data']);
    await audit(user, 'privacy.request', 'data_request', r.id, { kind });
    return r;
  });
}

export const listDataRequests = () => many(`SELECT r.*, u.name, u.phone, u.flat_id, u.relation, h.name handled_by_name
  FROM data_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by
  ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 200`);

// Erasure: the account is closed, sessions and alerts end, and complaint
// photos are deleted. Financial records stay, as the law requires.
async function erase(userId) {
  await q('UPDATE users SET active = false WHERE id = $1', [userId]);
  await endAllSessions(userId);
  await q('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
  for (const f of await many('SELECT photo_key FROM complaints WHERE raised_by = $1 AND photo_key IS NOT NULL', [userId])) {
    await deleteFile(f.photo_key);
  }
  await q("UPDATE complaints SET photo = NULL, feedback = NULL WHERE raised_by = $1", [userId]);
  await q("DELETE FROM guest_codes WHERE created_by = $1 AND used_at IS NULL", [userId]);
}

export const resolveDataRequest = (id, outcome, response, actor) => tx(async () => {
  const r = await one('SELECT * FROM data_requests WHERE id = $1 FOR UPDATE', [id]);
  if (!r || r.status !== 'open') throw new HttpError(409, 'This request has already been handled.');
  if (!['done', 'declined'].includes(outcome)) throw new HttpError(400, 'Choose done or declined.');
  if (outcome === 'declined' && !String(response || '').trim()) throw new HttpError(400, 'Give the reason for declining.');
  if (outcome === 'done' && r.kind === 'erasure') await erase(r.user_id);
  await q('UPDATE data_requests SET status = $2, handled_by = $3, handled_at = now(), response = $4 WHERE id = $1', [id, outcome, actor.id, response || null]);
  await audit(actor, `privacy.${r.kind}.${outcome}`, 'data_request', id, { userId: r.user_id, response });
  return { ok: true };
});

// Correcting a resident's details (help desk or admin), audited with before and after.
// Name and relation are corrected at once. A new mobile number is the
// resident's login, so it waits for a second staff member's approval.
export async function correctResident(userId, changes, actor) {
  return tx(async () => {
    const u = await one("SELECT * FROM users WHERE id = $1 AND role = 'resident' FOR UPDATE", [userId]);
    if (!u) throw new HttpError(404, 'Resident not found.');
    const name = changes.name != null ? String(changes.name).trim().slice(0, 80) : u.name;
    const phone = changes.phone != null ? String(changes.phone).replace(/\D/g, '').slice(-10) : u.phone;
    const relation = ['owner', 'tenant', 'family'].includes(changes.relation) ? changes.relation : u.relation;
    if (!name || !/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a name and a valid mobile number.');
    if (phone !== u.phone && await one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new HttpError(409, 'That number is already registered.');
    if (name !== u.name || relation !== u.relation) {
      await q('UPDATE users SET name = $2, relation = $3 WHERE id = $1', [userId, name, relation]);
      await audit(actor, 'resident.corrected', 'user', userId, { before: { name: u.name, relation: u.relation }, after: { name, relation } });
    }
    let approvalId = null;
    if (phone !== u.phone) {
      if (await one("SELECT 1 FROM approvals WHERE kind = 'phone_change' AND status = 'pending' AND payload->>'userId' = $1", [String(userId)])) {
        throw new HttpError(409, 'A number change for this resident is already waiting for approval.');
      }
      approvalId = await requestApproval(actor, {
        kind: 'phone_change', flatId: u.flat_id, payload: { userId, from: u.phone, to: phone },
        summary: `Change ${name}'s mobile (${u.flat_id}) from ${u.phone} to ${phone}`,
      });
    }
    return { ok: true, approvalId };
  });
}

// Applied when a second person approves the request above.
export async function applyPhoneChange({ userId, from, to }, actor) {
  const u = await one("SELECT * FROM users WHERE id = $1 AND role = 'resident' FOR UPDATE", [userId]);
  if (!u || u.phone !== from) throw new HttpError(409, 'The resident’s number has changed since this was requested.');
  if (await one('SELECT 1 FROM users WHERE phone = $1', [to])) throw new HttpError(409, 'That number is now registered to someone else.');
  await q('UPDATE users SET phone = $2 WHERE id = $1', [userId, to]);
  await endAllSessions(userId);
  await audit(actor, 'resident.corrected', 'user', userId, { before: { phone: from }, after: { phone: to } });
}
