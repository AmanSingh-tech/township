import { Router } from 'express';
import crypto from 'node:crypto';
import { h, allow } from '../http.js';
import { q, one, many, val, tx } from '../db.js';
import { paymentProvider } from '../env.js';
import { createTestOrder, finishTestOrder } from '../lib/placeholderPay.js';
import { flatStatus } from '../lib/billing.js';
import { getSettings } from '../lib/settings.js';
import { createComplaint, logEvent } from '../lib/complaints.js';
import { createOrder, settleOrder, verifyCheckoutSignature } from '../lib/razorpay.js';
import { endSession, publicUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { savePhoto, fileUrl } from '../lib/storage.js';
import { saveSubscription, removeSubscription } from '../lib/push.js';
import { exportUserData, createDataRequest } from '../lib/privacy.js';
import { receiptPdfBuffer } from '../lib/receiptPdf.js';
import { listAmenities, availability, book, cancel as cancelBooking, flatBookings } from '../lib/amenities.js';
import { env, pushEnabled } from '../env.js';
import { today, normalizePhone, HttpError } from '../lib/util.js';

const r = Router();
const resident = allow('resident');

r.post('/auth/logout', h(async (req, res) => { await endSession(req.token); res.json({ ok: true }); }));
r.get('/me', (req, res) => res.json(publicUser(req.user)));
r.patch('/me', h(async (req, res) => {
  if (['en', 'mr', 'hi'].includes(req.body.lang)) await q('UPDATE users SET lang = $2 WHERE id = $1', [req.user.id, req.body.lang]);
  if (req.body.consent === true && !req.user.consent_at) {
    await q('UPDATE users SET consent_at = now() WHERE id = $1', [req.user.id]);
    await audit(req.user, 'privacy.consent', 'user', req.user.id, {});
  }
  res.json(publicUser(await one('SELECT * FROM users WHERE id = $1', [req.user.id])));
}));

// ---- Home and bills ------------------------------------------------------------
const startOfToday = () => new Date(today() + 'T00:00:00+05:30');
const complaintSummary = (c) => ({
  id: c.id, text: c.text, category: c.category, urgency: c.urgency, status: c.status,
  created_at: c.created_at, due_by: c.due_by, first_response_at: c.first_response_at,
  resolved_at: c.resolved_at, escalated: c.escalated, duplicate_of: c.duplicate_of,
  rating: c.rating, assignee: c.assignee_name || null, flat_id: c.flat_id, reopen_count: c.reopen_count,
});
const flatComplaints = (flatId) => many(`SELECT c.*, s.name assignee_name FROM complaints c LEFT JOIN staff s ON s.id = c.assignee_id
  WHERE c.flat_id = $1 ORDER BY c.status = 'closed', c.created_at DESC LIMIT 50`, [flatId]);
const todaysVisitors = async (flatId) => (await many(`SELECT id, name, purpose, gate, status, created_at, decided_by, photo_key
  FROM visitors WHERE flat_id = $1 AND created_at >= $2 ORDER BY created_at DESC`, [flatId, startOfToday()]))
  .map(({ photo_key: k, ...v }) => ({ ...v, photo: fileUrl(k) }));

r.get('/home', resident, h(async (req, res) => {
  const f = req.user.flat_id;
  const [st, flat, complaints, visitors, notices] = await Promise.all([
    flatStatus(f), one('SELECT * FROM flats WHERE id = $1', [f]), flatComplaints(f), todaysVisitors(f),
    many('SELECT * FROM notices ORDER BY posted_on DESC, id DESC LIMIT 3'),
  ]);
  const next = st.bills.find((b) => b.unpaid > 0);
  res.json({
    flat,
    dues: { totalDue: st.totalDue, interest: st.accruedInterest, daysOverdue: st.daysOverdue, dueOn: next?.due_on || null, advance: st.advance },
    complaints: complaints.filter((c) => c.status !== 'closed').map(complaintSummary),
    visitors, notices,
  });
}));

r.get('/bills', resident, h(async (req, res) => {
  const f = req.user.flat_id;
  const s = await getSettings();
  res.json({
    flat: await one('SELECT * FROM flats WHERE id = $1', [f]),
    status: await flatStatus(f),
    rate: s.ratePerSqft, interestRatePa: s.interestRatePa, dueDay: s.dueDay,
    ledger: await many('SELECT * FROM ledger WHERE flat_id = $1 ORDER BY on_date DESC, id DESC', [f]),
    payments: await many('SELECT * FROM payments WHERE flat_id = $1 ORDER BY paid_on DESC, id DESC', [f]),
  });
}));

// ---- Payments (Razorpay) --------------------------------------------------------
r.get('/pay/config', resident, h(async (req, res) => {
  const s = await getSettings();
  res.json({ online: true, provider: paymentProvider, bankDetails: s.bankDetails, societyName: s.societyName });
}));
r.post('/pay/order', resident, h(async (req, res) => {
  const st = await flatStatus(req.user.flat_id);
  const amount = Math.round(Number(req.body.amount) || st.totalDue);
  if (!(amount >= 1)) throw new HttpError(400, 'Nothing to pay.');
  if (amount > Math.max(st.totalDue, 1) * 12 || amount > 500000) throw new HttpError(400, 'Amount is much higher than your dues.');
  const make = paymentProvider === 'razorpay' ? createOrder : createTestOrder;
  res.json({ ...(await make({ flatId: req.user.flat_id, userId: req.user.id, amount })), provider: paymentProvider, prefill: { name: req.user.name, contact: req.user.phone } });
}));
// Placeholder gateway only: the resident's choice on the test checkout.
r.post('/pay/test-complete', resident, h(async (req, res) => {
  if (paymentProvider !== 'placeholder') throw new HttpError(404, 'Not found');
  res.json(await finishTestOrder(req.body.orderId, req.body.outcome, req.user));
}));
r.post('/pay/verify', resident, h(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body;
  const order = await one('SELECT * FROM payment_orders WHERE id = $1', [orderId]);
  if (!order || order.flat_id !== req.user.flat_id) throw new HttpError(404, 'Payment not found.');
  if (!verifyCheckoutSignature(orderId, paymentId, sig)) throw new HttpError(400, 'Payment could not be verified.');
  res.json(await settleOrder(orderId, paymentId, 'checkout'));
}));

async function receipt(req) {
  const p = await one('SELECT * FROM payments WHERE id = $1', [Number(req.params.id) || 0]);
  const staff = ['helpdesk', 'accounts', 'committee', 'admin'].includes(req.user.role);
  if (!p || (!staff && p.flat_id !== req.user.flat_id)) throw new HttpError(404, 'Receipt not found');
  const owner = await one("SELECT name FROM users WHERE flat_id = $1 AND active AND relation <> 'family' ORDER BY relation = 'tenant' LIMIT 1", [p.flat_id]);
  const s = await getSettings();
  // Balance as it stood right after this payment, so a re-downloaded receipt never changes.
  const after = await one(`SELECT COALESCE(SUM(debit - credit), 0) bal FROM ledger WHERE flat_id = $1
    AND (on_date < $2 OR (on_date = $2 AND id <= (SELECT id FROM ledger WHERE payment_id = $3)))`, [p.flat_id, p.paid_on, p.id]);
  return { ...p, society: s.societyName, residentName: owner?.name, balanceNow: Math.max(0, after.bal) };
}
r.get('/receipts/:id', h(async (req, res) => res.json(await receipt(req))));
r.get('/receipts/:id/pdf', h(async (req, res) => {
  const rec = await receipt(req);
  const pdf = await receiptPdfBuffer(rec);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${rec.receipt_no.replace(/\//g, '-')}.pdf"` }).send(pdf);
}));

// ---- Amenity booking ---------------------------------------------------------------
r.get('/amenities', resident, h(async (req, res) => res.json(await listAmenities())));
r.get('/amenities/:id/availability', resident, h(async (req, res) => res.json(await availability(Number(req.params.id) || 0, String(req.query.date || today())))));
r.get('/bookings', resident, h(async (req, res) => res.json(await flatBookings(req.user.flat_id))));
r.post('/bookings', resident, h(async (req, res) => res.json(await book(req.body, req.user))));
r.post('/bookings/:id/cancel', resident, h(async (req, res) => res.json(await cancelBooking(Number(req.params.id) || 0, req.user))));

// ---- Complaints -----------------------------------------------------------------
r.get('/complaints', resident, h(async (req, res) => res.json((await flatComplaints(req.user.flat_id)).map(complaintSummary))));
r.post('/complaints', resident, h(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (text.length < 5) throw new HttpError(400, 'Please describe the problem in a few words.');
  const recent = await val("SELECT COUNT(*) FROM complaints WHERE raised_by = $1 AND created_at > now() - interval '1 hour'", [req.user.id]);
  if (recent >= 10) throw new HttpError(429, 'You have raised many complaints in the last hour. Please call the help desk.');
  const photoKey = req.body.photo ? await savePhoto(req.body.photo, { ownerKind: 'complaint', flatId: req.user.flat_id, userId: req.user.id }) : null;
  res.json({ id: await createComplaint({ flatId: req.user.flat_id, userId: req.user.id, actor: req.user.name, text, photoKey }) });
}));

export async function complaintDetail(id) {
  const c = await one(`SELECT c.*, s.name assignee_name, s.phone assignee_phone FROM complaints c
    LEFT JOIN staff s ON s.id = c.assignee_id WHERE c.id = $1`, [id]);
  if (!c) return null;
  const rootId = c.duplicate_of || c.id;
  return {
    ...complaintSummary(c), photo_url: fileUrl(c.photo_key) || c.photo || null, feedback: c.feedback, ai_category: c.ai_category, ai_urgency: c.ai_urgency,
    ai_confidence: c.ai_confidence, category_changed_by: c.category_changed_by, escalation_reason: c.escalation_reason,
    assignee_phone: c.assignee_phone, assignee_id: c.assignee_id, closed_at: c.closed_at,
    raised_by: await one('SELECT name, phone FROM users WHERE id = $1', [c.raised_by]),
    events: await many('SELECT * FROM complaint_events WHERE complaint_id = $1 ORDER BY at, id', [id]),
    linked: await many('SELECT id, flat_id, status, created_at FROM complaints WHERE (duplicate_of = $1 OR id = $1) AND id <> $2 ORDER BY created_at', [rootId, id]),
  };
}
r.get('/complaints/:id', h(async (req, res) => {
  const c = await complaintDetail(Number(req.params.id) || 0);
  if (!c || (req.user.role === 'resident' && c.flat_id !== req.user.flat_id)) throw new HttpError(404, 'Complaint not found');
  if (req.user.role === 'resident') delete c.raised_by;
  res.json(c);
}));
r.post('/complaints/:id/reopen', resident, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  await tx(async () => {
    const c = await one('SELECT * FROM complaints WHERE id = $1 AND flat_id = $2 FOR UPDATE', [id, req.user.flat_id]);
    if (!c || c.status !== 'resolved') throw new HttpError(400, 'Only a resolved complaint can be reopened.');
    await q("UPDATE complaints SET status = 'assigned', resolved_at = NULL, reopen_count = reopen_count + 1 WHERE id = $1", [id]);
    await logEvent(id, req.user.name, 'reopened', String(req.body.note || 'Not fixed').slice(0, 300));
  });
  res.json(await complaintDetail(id));
}));
r.post('/complaints/:id/rate', resident, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const rating = Math.round(Number(req.body.rating));
  await tx(async () => {
    const c = await one('SELECT * FROM complaints WHERE id = $1 AND flat_id = $2 FOR UPDATE', [id, req.user.flat_id]);
    if (!c || c.status !== 'resolved' || !(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Rate a resolved complaint from 1 to 5.');
    const fb = String(req.body.feedback || '').trim().slice(0, 500) || null;
    await q("UPDATE complaints SET status = 'closed', closed_at = now(), rating = $2, feedback = $3 WHERE id = $1", [id, rating, fb]);
    await logEvent(id, req.user.name, 'rated', `Closed with ${rating}★${fb ? ` — “${fb}”` : ''}`);
  });
  res.json(await complaintDetail(id));
}));

// ---- Visitors ---------------------------------------------------------------------
r.get('/visitors', resident, h(async (req, res) => res.json({
  today: await todaysVisitors(req.user.flat_id),
  codes: await many('SELECT * FROM guest_codes WHERE flat_id = $1 AND valid_on >= $2 ORDER BY valid_on', [req.user.flat_id, today()]),
})));
r.post('/visitors/:id/decide', resident, h(async (req, res) => {
  const status = req.body.decision === 'approve' ? 'approved' : 'denied';
  const v = await one(`UPDATE visitors SET status = $3, decided_at = now(), decided_by = $4
    WHERE id = $1 AND flat_id = $2 AND status = 'waiting' RETURNING id`, [Number(req.params.id) || 0, req.user.flat_id, status, req.user.name]);
  if (!v) throw new HttpError(400, 'This visitor is no longer waiting.');
  res.json({ ok: true, status });
}));
r.post('/guest-codes', resident, h(async (req, res) => {
  const name = String(req.body.guestName || '').trim().slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) && req.body.date >= today() ? req.body.date : today();
  if (!name) throw new HttpError(400, 'Add the guest’s name.');
  const open = await val('SELECT COUNT(*) FROM guest_codes WHERE flat_id = $1 AND valid_on >= $2 AND used_at IS NULL', [req.user.flat_id, today()]);
  if (open >= 20) throw new HttpError(429, 'Too many unused guest codes. Use or let some expire first.');
  for (;;) {
    const code = String(crypto.randomInt(100000, 1000000));
    const row = await one(`INSERT INTO guest_codes (code, flat_id, guest_name, valid_on, created_by) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (code) DO NOTHING RETURNING code`, [code, req.user.flat_id, name, date, req.user.id]);
    if (row) return res.json({ code, guestName: name, validOn: date });
  }
}));

// ---- Household --------------------------------------------------------------------
r.get('/household', resident, h(async (req, res) => res.json(
  await many('SELECT id, name, phone, relation FROM users WHERE flat_id = $1 AND active ORDER BY relation, name', [req.user.flat_id]))));
r.post('/household', resident, h(async (req, res) => {
  if (req.user.relation === 'family') throw new HttpError(403, 'Only the owner or tenant can add members.');
  const phone = normalizePhone(req.body.phone);
  const name = String(req.body.name || '').trim().slice(0, 80);
  const relation = req.body.relation === 'tenant' && req.user.relation === 'owner' ? 'tenant' : 'family';
  if (!name || !/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a name and a valid 10-digit mobile number.');
  if (await one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new HttpError(409, 'This number is already registered.');
  await tx(async () => {
    const u = await one("INSERT INTO users (name, phone, role, flat_id, relation) VALUES ($1, $2, 'resident', $3, $4) RETURNING id", [name, phone, req.user.flat_id, relation]);
    await audit(req.user, 'household.added', 'user', u.id, { flatId: req.user.flat_id, relation });
  });
  res.json({ ok: true });
}));
r.delete('/household/:id', resident, h(async (req, res) => {
  if (req.user.relation === 'family') throw new HttpError(403, 'Only the owner or tenant can remove members.');
  const id = Number(req.params.id) || 0;
  if (id === req.user.id) throw new HttpError(400, 'You cannot remove yourself.');
  const u = await one(`UPDATE users SET active = false WHERE id = $1 AND flat_id = $2 AND (relation = 'family' OR $3 = 'owner') RETURNING id`, [id, req.user.flat_id, req.user.relation]);
  if (!u) throw new HttpError(404, 'Member not found.');
  await q('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit(req.user, 'household.removed', 'user', id, {});
  res.json({ ok: true });
}));
// ---- Alerts (web push) --------------------------------------------------------------
r.get('/push/key', (req, res) => res.json({ enabled: pushEnabled, key: env.VAPID_PUBLIC_KEY || null }));
r.post('/push/subscribe', h(async (req, res) => {
  try { await saveSubscription(req.user.id, req.body); } catch { throw new HttpError(400, 'Could not turn on alerts.'); }
  res.json({ ok: true });
}));
r.post('/push/unsubscribe', h(async (req, res) => { await removeSubscription(String(req.body.endpoint || ''), req.user.id); res.json({ ok: true }); }));

// ---- Your data (DPDP Act 2023) ----------------------------------------------------------
r.get('/me/export', resident, h(async (req, res) => {
  await audit(req.user, 'privacy.export', 'user', req.user.id, {});
  res.attachment(`my-data-${req.user.flat_id}.json`).json(await exportUserData(req.user));
}));
r.get('/me/data-requests', resident, h(async (req, res) => res.json(
  await many('SELECT id, kind, details, status, created_at, response FROM data_requests WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]))));
r.post('/me/data-requests', resident, h(async (req, res) => res.json(await createDataRequest(req.user, req.body.kind, req.body.details))));

r.get('/notices', h(async (req, res) => res.json(await many('SELECT * FROM notices ORDER BY posted_on DESC, id DESC LIMIT 50'))));

export default r;
