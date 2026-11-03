import { Router } from 'express';
import { h, allow, ROLES } from '../http.js';
import { q, one, many, tx } from '../db.js';
import { flatStatus, flatStatuses, recordPayment } from '../lib/billing.js';
import { getSettings } from '../lib/settings.js';
import { readBankStatement } from '../lib/csv.js';
import { matchStatement } from '../lib/matcher.js';
import { logEvent, pickAssignee, dueBy } from '../lib/complaints.js';
import { CATEGORIES, URGENCIES } from '../lib/classifier.js';
import { committeeReport, reportCsv, signReport, listSignoffs, getSignoff } from '../lib/report.js';
import { prepareBillRun, listBillRuns, decideBillRun } from '../lib/billruns.js';
import { correctResident } from '../lib/privacy.js';
import { readRegister, planImport, commitImport, templateWorkbook } from '../lib/register.js';
import { exportForTally, toTallyXml, toDaybookCsv, listTallyExports } from '../lib/tally.js';
import { bookingsOn, cancel as cancelBooking } from '../lib/amenities.js';
import { requestBankPost, requestBankIgnore, requestAdjustment, listApprovals, decideApproval } from '../lib/approvals.js';
import { send } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/util.js';
import { complaintDetail } from './resident.js';

const r = Router();
const complaintsRole = allow(ROLES.complaints);
const money = allow(ROLES.money);
const report = allow(ROLES.report);
r.use(allow(ROLES.staff));

// ---- Complaints ------------------------------------------------------------------
r.get('/complaints', complaintsRole, h(async (req, res) => {
  const rows = await many(`SELECT c.id, c.flat_id, c.text, c.category, c.urgency, c.status, c.created_at, c.due_by, c.first_response_at,
      c.resolved_at, c.escalated, c.duplicate_of, c.rating, c.reopen_count, c.ai_category, c.ai_confidence, s.name assignee,
      (SELECT COUNT(*) FROM complaints d WHERE d.duplicate_of = c.id) linked_count
    FROM complaints c LEFT JOIN staff s ON s.id = c.assignee_id
    WHERE c.status <> 'closed' OR c.closed_at > now() - interval '30 days' ORDER BY c.created_at DESC LIMIT 500`);
  res.json(rows);
}));
r.get('/staff', complaintsRole, h(async (req, res) => res.json(await many('SELECT * FROM staff WHERE active ORDER BY skill, name'))));
r.get('/meta', h(async (req, res) => res.json({ categories: CATEGORIES, urgencies: URGENCIES, sla: (await getSettings()).sla })));

r.patch('/complaints/:id', complaintsRole, h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const who = req.user.name;
  const b = req.body;
  await tx(async () => {
    const c = await one('SELECT * FROM complaints WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw new HttpError(404, 'Not found');
    const touch = () => !c.first_response_at && q('UPDATE complaints SET first_response_at = now() WHERE id = $1', [id]);
    if (b.category && b.category !== c.category && CATEGORIES.includes(b.category)) {
      const a = c.escalated ? null : await pickAssignee(b.category, c.flat_id.slice(0, 3), false);
      await q('UPDATE complaints SET category = $2, category_changed_by = $3, assignee_id = COALESCE($4, assignee_id) WHERE id = $1', [id, b.category, who, a?.id ?? null]);
      await logEvent(id, who, 'category', `Category changed from ${c.category} to ${b.category}${a ? `, reassigned to ${a.name}` : ''}`);
    }
    if (b.urgency && b.urgency !== c.urgency && URGENCIES.includes(b.urgency)) {
      if (c.escalated && b.urgency !== 'critical') throw new HttpError(400, 'Safety escalations stay critical. Resolve it once the duty manager confirms it is safe.');
      await q('UPDATE complaints SET urgency = $2, due_by = $3 WHERE id = $1', [id, b.urgency, await dueBy(c.created_at, b.urgency)]);
      await logEvent(id, who, 'note', `Urgency changed to ${b.urgency}`);
    }
    if (b.assigneeId && Number(b.assigneeId) !== c.assignee_id) {
      const s = await one('SELECT * FROM staff WHERE id = $1 AND active', [Number(b.assigneeId)]);
      if (s) {
        await q("UPDATE complaints SET assignee_id = $2, status = CASE status WHEN 'open' THEN 'assigned' ELSE status END WHERE id = $1", [id, s.id]);
        await logEvent(id, who, 'assigned', `Assigned to ${s.name}`);
      }
    }
    const note = b.note ? String(b.note).slice(0, 500) : '';
    if (b.status && b.status !== c.status && ['assigned', 'in_progress', 'resolved'].includes(b.status)) {
      if (c.status === 'closed') throw new HttpError(400, 'This complaint is closed.');
      await touch();
      await q('UPDATE complaints SET status = $2, resolved_at = $3 WHERE id = $1', [id, b.status, b.status === 'resolved' ? new Date() : null]);
      const label = { assigned: 'Back in the queue', in_progress: 'Work started', resolved: 'Marked resolved' }[b.status];
      await logEvent(id, who, 'status', note ? `${label}: ${note}` : label);
      // Linked duplicates follow the main complaint but are never closed for
      // the resident; each flat confirms and rates its own.
      if (b.status !== 'assigned') {
        const dups = await many("SELECT id, raised_by FROM complaints WHERE duplicate_of = $1 AND status NOT IN ('resolved','closed')", [id]);
        for (const d of dups) {
          await q('UPDATE complaints SET status = $2, resolved_at = $3, first_response_at = COALESCE(first_response_at, now()) WHERE id = $1', [d.id, b.status, b.status === 'resolved' ? new Date() : null]);
          await logEvent(d.id, who, 'status', `${label} (with linked complaint #${id})`);
        }
      }
      const raiser = await one('SELECT phone FROM users WHERE id = $1', [c.raised_by]);
      if (raiser) await send('push', raiser.phone, `Complaint #${id}: ${label}`);
    } else if (note) {
      await touch();
      await logEvent(id, who, 'note', note);
    }
    if (b.unlink && c.duplicate_of) {
      await q('UPDATE complaints SET duplicate_of = NULL WHERE id = $1', [id]);
      await logEvent(id, who, 'linked', `Unlinked from #${c.duplicate_of}`);
    }
  });
  res.json(await complaintDetail(id));
}));

// ---- Bank matching ------------------------------------------------------------------
const parseRow = (x) => x;
async function importSummary(id) {
  const imp = await one('SELECT * FROM bank_imports WHERE id = $1', [id]);
  const rows = await many('SELECT * FROM bank_rows WHERE import_id = $1 ORDER BY txn_date, id', [id]);
  const count = (s) => rows.filter((x) => x.status === s).length;
  return { ...imp, rows: rows.map(parseRow), counts: Object.fromEntries(['posted', 'queue', 'pending_approval', 'resolved', 'duplicate', 'reconciled', 'ignored'].map((s) => [s, count(s)])), total: rows.length };
}

r.post('/bank/import', money, h(async (req, res) => {
  const csv = typeof req.body === 'string' ? req.body : req.body.csv;
  let rows;
  try { rows = readBankStatement(String(csv || '')); } catch (e) { throw new HttpError(400, e.message); }
  if (!rows.length) throw new HttpError(400, 'No transactions found in this file.');
  if (rows.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.date))) throw new HttpError(400, 'Some rows have dates that could not be read.');
  const filename = String(req.query.filename || 'statement.csv').slice(0, 120);
  const id = await tx(async () => {
    await q('SELECT pg_advisory_xact_lock(777)'); // one import at a time
    const imp = await one('INSERT INTO bank_imports (filename, uploaded_by) VALUES ($1, $2) RETURNING id', [filename, req.user.name]);
    const results = await matchStatement(rows, {
      post: async (flatId, row, sig) => (await recordPayment({ flatId, amount: row.amount, paidOn: row.date, method: 'bank',
        reference: row.reference || row.narration.slice(0, 40), utr: sig.utr, postedBy: 'auto-match' }, req.user)).id,
    });
    await q(`INSERT INTO bank_rows (import_id, txn_date, narration, reference, utr, amount, status, flat_id, score, reasons, candidates, payment_id)
      SELECT $1, x.date, x.narration, x.reference, x.utr, x.amount, x.status, x."flatId", x.score, x.reasons, x.candidates, x."paymentId"
      FROM jsonb_to_recordset($2::jsonb) x(date date, narration text, reference text, utr text, amount int, status text, "flatId" text,
        score int, reasons jsonb, candidates jsonb, "paymentId" int, n int)
      ORDER BY x.n`, [imp.id, JSON.stringify(results.map((x, n) => ({ ...x, n, reference: x.reference || null })))]);
    await audit(req.user, 'bank.imported', 'bank_import', imp.id, { filename, rows: rows.length, posted: results.filter((x) => x.status === 'posted').length });
    return imp.id;
  });
  res.json(await importSummary(id));
}));
r.get('/bank/imports', money, h(async (req, res) => {
  const ids = await many('SELECT id FROM bank_imports ORDER BY id DESC LIMIT 10');
  res.json(await Promise.all(ids.map((x) => importSummary(x.id))));
}));
r.get('/bank/queue', money, h(async (req, res) => res.json(await many("SELECT * FROM bank_rows WHERE status = 'queue' ORDER BY txn_date, id"))));
r.post('/bank/rows/:id/post', money, h(async (req, res) => {
  res.json({ approvalId: await requestBankPost(Number(req.params.id) || 0, req.body.flatId, req.body.rememberVpa, req.user) });
}));
r.post('/bank/rows/:id/ignore', money, h(async (req, res) => {
  res.json({ approvalId: await requestBankIgnore(Number(req.params.id) || 0, req.body.reason, req.user) });
}));

// ---- Approvals (maker-checker) ----------------------------------------------------------
r.get('/approvals', money, h(async (req, res) => res.json(await listApprovals(req.query.status === 'decided' ? 'approved' : 'pending'))));
r.post('/approvals/:id/approve', money, h(async (req, res) => res.json(await decideApproval(Number(req.params.id) || 0, true, req.body.note, req.user))));
r.post('/approvals/:id/reject', money, h(async (req, res) => res.json(await decideApproval(Number(req.params.id) || 0, false, req.body.note, req.user))));

// ---- Flats, ledgers, bill runs ---------------------------------------------------------------
r.get('/flats', allow(ROLES.money, ROLES.complaints), h(async (req, res) => {
  const term = `%${String(req.query.q || '').trim()}%`;
  const flats = await many(`SELECT f.id, f.area, string_agg(u.name, ', ' ORDER BY u.relation) names FROM flats f
    LEFT JOIN users u ON u.flat_id = f.id AND u.active
    WHERE f.id ILIKE $1 OR u.name ILIKE $1 GROUP BY f.id ORDER BY f.id LIMIT 25`, [term]);
  const st = await flatStatuses(flats.map((f) => f.id));
  res.json(flats.map((f) => ({ ...f, due: st.get(f.id).totalDue })));
}));
r.get('/flats/:id', money, h(async (req, res) => {
  const f = await one('SELECT * FROM flats WHERE id = $1', [req.params.id]);
  if (!f) throw new HttpError(404, 'Not found');
  res.json({
    ...f, status: await flatStatus(f.id),
    residents: await many('SELECT id, name, phone, relation FROM users WHERE flat_id = $1 AND active ORDER BY relation', [f.id]),
    ledger: await many('SELECT * FROM ledger WHERE flat_id = $1 ORDER BY on_date DESC, id DESC', [f.id]),
    pending: await many("SELECT id, summary, requested_at FROM approvals WHERE flat_id = $1 AND status = 'pending'", [f.id]),
  });
}));
r.post('/flats/:id/adjustments', money, h(async (req, res) => {
  res.json({ approvalId: await requestAdjustment({ flatId: req.params.id, ...req.body }, req.user) });
}));
// Bill runs: accounts prepares, the committee approves and issues.
const committee = allow(ROLES.committee);
r.get('/bill-runs', allow(ROLES.money, ROLES.committee), h(async (req, res) => res.json(await listBillRuns())));
r.post('/bill-runs', money, h(async (req, res) => res.json(await prepareBillRun(req.body.period, req.user))));
r.post('/bill-runs/:id/approve', committee, h(async (req, res) => res.json(await decideBillRun(Number(req.params.id) || 0, true, req.body.note, req.user))));
r.post('/bill-runs/:id/reject', committee, h(async (req, res) => res.json(await decideBillRun(Number(req.params.id) || 0, false, req.body.note, req.user))));

// Correcting a resident's details (DPDP right to correction).
r.patch('/residents/:id', allow(ROLES.complaints, ROLES.money), h(async (req, res) => res.json(await correctResident(Number(req.params.id) || 0, req.body, req.user))));
r.get('/residents', allow(ROLES.complaints, ROLES.money), h(async (req, res) => {
  const term = `%${String(req.query.q || '').trim()}%`;
  res.json(await many(`SELECT id, name, phone, flat_id, relation, active FROM users WHERE role = 'resident'
    AND (name ILIKE $1 OR phone LIKE $1 OR flat_id ILIKE $1) ORDER BY flat_id, relation LIMIT 25`, [term]));
}));

// ---- Register import (flats, residents, opening balances) --------------------------
const upload = (req) => {
  const filename = String(req.body.filename || '').slice(0, 120);
  const data = String(req.body.data || '');
  if (!filename || !data) throw new HttpError(400, 'Choose a file.');
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'The file is larger than 5 MB.');
  return { filename, buf };
};
r.get('/register/template', money, h(async (req, res) => {
  res.attachment('flat-register-template.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await templateWorkbook()));
}));
r.post('/register/preview', money, h(async (req, res) => {
  const { filename, buf } = upload(req);
  const rows = await readRegister(filename, buf);
  if (!rows.length) throw new HttpError(400, 'The sheet has no rows under the headings.');
  res.json({ rows: rows.length, ...(await planImport(rows)) });
}));
r.post('/register/commit', money, h(async (req, res) => {
  const { filename, buf } = upload(req);
  res.json(await commitImport(filename, await readRegister(filename, buf), req.body.balanceDate, req.user));
}));
r.get('/register/imports', money, h(async (req, res) => res.json(await many(`SELECT i.*, u.name imported_by_name FROM register_imports i
  JOIN users u ON u.id = i.imported_by ORDER BY i.imported_at DESC LIMIT 20`))));

// ---- Tally ------------------------------------------------------------------------------
r.get('/tally/exports', money, h(async (req, res) => res.json(await listTallyExports())));
r.post('/tally/export', money, h(async (req, res) => {
  const { from, to, format = 'xml', confirmOverlap = false } = req.body;
  const out = await exportForTally(from, to, { confirmOverlap }, req.user);
  if (format === 'csv') return res.attachment(`tally-daybook-${from}-to-${to}.csv`).type('text/csv').send(toDaybookCsv(out));
  res.attachment(`tally-import-${from}-to-${to}.xml`).type('application/xml').send(toTallyXml(out));
}));

// ---- Bookings ----------------------------------------------------------------------------
r.get('/bookings', allow(ROLES.complaints, ROLES.money), h(async (req, res) => res.json(await bookingsOn(String(req.query.date || '')))));
r.post('/bookings/:id/cancel', allow(ROLES.complaints, ROLES.money), h(async (req, res) => res.json(await cancelBooking(Number(req.params.id) || 0, req.user, { staff: true }))));

// ---- Report -----------------------------------------------------------------------------------
r.get('/report', report, h(async (req, res) => res.json(await committeeReport(req.query.period))));
r.get('/report/signoffs', report, h(async (req, res) => res.json(await listSignoffs())));
r.get('/report/signoffs/:period', report, h(async (req, res) => {
  const s = await getSignoff(req.params.period);
  if (!s) throw new HttpError(404, 'Not signed');
  res.json(s);
}));
r.post('/report/:period/signoff', allow(ROLES.committee), h(async (req, res) => res.json(await signReport(req.params.period, req.body.note, req.user))));
r.get('/report.csv', report, h(async (req, res) => {
  const signed = req.query.period && await getSignoff(req.query.period);
  const rep = signed ? signed.data : await committeeReport(req.query.period);
  res.attachment(`committee-report-${rep.period}.csv`).type('text/csv').send(reportCsv(rep));
}));

export default r;
