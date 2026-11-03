import { many, val } from '../db.js';
import { allFlatStatuses } from './billing.js';
import { getSettings } from './settings.js';
import { today, periodLabel } from './util.js';
import { toCsv } from './csv.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mins = (a, b) => (new Date(b) - new Date(a)) / 60000;

// Every figure is derived from the ledger, bank rows and complaint
// timestamps, so the committee can trace any number back to its entries.
export async function committeeReport(period, { fresh = false } = {}) {
  const asOf = today();
  const periods = (await many('SELECT period, MIN(due_on) due FROM bills GROUP BY period ORDER BY period'));
  const periodIds = periods.map((p) => p.period);
  period ||= periods.filter((p) => p.due <= asOf).pop()?.period || periodIds.at(-1) || asOf.slice(0, 7);
  const flats = await many(`SELECT f.id, (SELECT name FROM users u WHERE u.flat_id = f.id AND u.active AND u.relation <> 'family'
    ORDER BY u.relation = 'tenant' DESC LIMIT 1) AS name FROM flats f ORDER BY f.id`);
  const statuses = await allFlatStatuses({ fresh });
  const billIndex = new Map();
  for (const st of statuses.values()) for (const b of st.bills) billIndex.set(b.id, b);

  const periodStats = (p) => {
    const bills = [...billIndex.values()].filter((b) => b.period === p);
    if (!bills.length) return null;
    const billed = bills.reduce((s, b) => s + b.amount, 0);
    const collected = bills.reduce((s, b) => s + b.paid, 0);
    const onTime = bills.filter((b) => b.settledOn && b.settledOn <= b.due_on).length;
    return { period: p, label: periodLabel(p), flats: bills.length, billed, collected, collectionRate: collected / billed, onTimeRate: onTime / bills.length, onTime };
  };

  const buckets = [
    { key: 'current', label: 'Not yet due', min: -Infinity, max: 0 },
    { key: '1-30', label: '1–30 days', min: 1, max: 30 },
    { key: '31-60', label: '31–60 days', min: 31, max: 60 },
    { key: '61-90', label: '61–90 days', min: 61, max: 90 },
    { key: '90+', label: 'Over 90 days', min: 91, max: Infinity },
  ].map((b) => ({ ...b, amount: 0, flats: new Set() }));
  for (const st of statuses.values()) for (const b of st.bills) {
    if (b.unpaid <= 0) continue;
    const d = b.due_on > asOf ? 0 : b.overdueDays;
    const bk = buckets.find((x) => d >= x.min && d <= x.max);
    bk.amount += b.unpaid; bk.flats.add(st.flatId);
  }
  const defaulters = flats.map((f) => ({ f, st: statuses.get(f.id) })).filter(({ st }) => st.totalDue > 0)
    .sort((a, b) => b.st.totalDue - a.st.totalDue)
    .map(({ f, st }) => ({ flatId: f.id, name: f.name, due: st.totalDue, interest: st.accruedInterest, daysOverdue: st.daysOverdue }));

  const bank = await many('SELECT status, COUNT(*) n, COALESCE(SUM(amount), 0) amount FROM bank_rows GROUP BY status');
  const sumOf = (ss) => bank.filter((b) => ss.includes(b.status)).reduce((a, b) => ({ n: a.n + b.n, amount: a.amount + b.amount }), { n: 0, amount: 0 });
  const unidentified = sumOf(['queue', 'pending_approval']);
  const credits = sumOf(['posted', 'queue', 'pending_approval', 'resolved', 'reconciled']);
  const auto = sumOf(['posted', 'reconciled']);

  const since = new Date(Date.now() - 30 * 86400000);
  const cs = await many('SELECT * FROM complaints WHERE created_at >= $1', [since]);
  const responded = cs.filter((c) => c.first_response_at);
  const resolved = cs.filter((c) => c.resolved_at || c.closed_at);
  const rated = cs.filter((c) => c.rating);
  const byCategory = Object.entries(cs.reduce((m, c) => ((m[c.category] = (m[c.category] || 0) + 1), m), {}))
    .map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n);
  const { societyName } = await getSettings();

  return {
    society: societyName, asOf, period, periodLabel: periodLabel(period), periods: periodIds,
    current: periodStats(period),
    trend: periodIds.slice(-6).map(periodStats).filter(Boolean),
    outstanding: [...statuses.values()].reduce((s, x) => s + x.totalDue, 0),
    interestAccrued: [...statuses.values()].reduce((s, x) => s + x.accruedInterest, 0),
    ageing: buckets.map(({ key, label, amount, flats: f }) => ({ key, label, amount, flats: f.size })),
    defaulters,
    matching: { queueCount: unidentified.n, queueAmount: unidentified.amount, autoRate: credits.n ? auto.n / credits.n : null, totalCredits: credits.n },
    pendingApprovals: await val("SELECT COUNT(*) FROM approvals WHERE status = 'pending'"),
    complaints: {
      windowDays: 30, raised: cs.length,
      open: await val("SELECT COUNT(*) FROM complaints WHERE status NOT IN ('resolved','closed')"),
      breaching: await val("SELECT COUNT(*) FROM complaints WHERE first_response_at IS NULL AND status NOT IN ('resolved','closed') AND due_by < now()"),
      escalated: cs.filter((c) => c.escalated).length,
      medianFirstResponseMins: median(responded.map((c) => mins(c.created_at, c.first_response_at))),
      medianResolutionHours: median(resolved.map((c) => mins(c.created_at, c.resolved_at || c.closed_at) / 60)),
      slaRate: responded.length ? responded.filter((c) => c.first_response_at <= c.due_by).length / responded.length : null,
      reopenRate: resolved.length ? resolved.filter((c) => c.reopen_count > 0).length / resolved.length : null,
      avgRating: rated.length ? rated.reduce((s, c) => s + c.rating, 0) / rated.length : null,
      byCategory,
    },
  };
}

export function reportCsv(r) {
  const pct = (x) => (x == null ? '' : (x * 100).toFixed(1) + '%');
  const lines = [
    [`${r.society} committee report`, r.periodLabel, `as of ${r.asOf}`],
    [],
    ['Collections', 'Flats', 'Billed', 'Collected', 'Collection rate', 'Paid by due date'],
    ...r.trend.map((t) => [t.label, t.flats, t.billed, t.collected, pct(t.collectionRate), pct(t.onTimeRate)]),
    [],
    ['Dues ageing', 'Flats', 'Principal outstanding'],
    ...r.ageing.map((a) => [a.label, a.flats, a.amount]),
    ['Interest accrued, not yet posted', '', r.interestAccrued],
    ['Bank credits awaiting identification', r.matching.queueCount, r.matching.queueAmount],
    [],
    ['Complaints, last 30 days', 'Value'],
    ['Raised', r.complaints.raised],
    ['Open now', r.complaints.open],
    ['Median first response (min)', r.complaints.medianFirstResponseMins?.toFixed(0) ?? ''],
    ['Median resolution (hours)', r.complaints.medianResolutionHours?.toFixed(1) ?? ''],
    ['First response within target', pct(r.complaints.slaRate)],
    ['Reopened', pct(r.complaints.reopenRate)],
    ['Average rating', r.complaints.avgRating?.toFixed(2) ?? ''],
    [],
    ['Flat', 'Resident', 'Total due', 'Interest', 'Days overdue'],
    ...r.defaulters.map((d) => [d.flatId, d.name, d.due, d.interest, d.daysOverdue]),
  ];
  return toCsv(lines);
}

// ---- Sign-off ---------------------------------------------------------------------
// The committee signs a month's report; the figures are frozen as they were
// at that moment, with a fingerprint anyone can recompute to check them.
import crypto from 'node:crypto';
import { one as oneRow, many as manyRows, tx } from '../db.js';
import { audit } from './audit.js';
import { HttpError } from './util.js';

const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null));
const fingerprint = (data) => crypto.createHash('sha256').update(canonical(data)).digest('hex');

export async function signReport(period, note, actor) {
  const data = await committeeReport(period, { fresh: true });
  if (data.period !== period) throw new HttpError(400, 'No bills for that month.');
  return tx(async () => {
    if (await oneRow('SELECT 1 FROM report_signoffs WHERE period = $1', [period])) throw new HttpError(409, 'This month’s report is already signed.');
    const sha = fingerprint(data);
    const row = await oneRow(`INSERT INTO report_signoffs (period, data, sha256, signed_by, note) VALUES ($1, $2, $3, $4, $5) RETURNING id, signed_at`,
      [period, JSON.stringify(data), sha, actor.id, note || null]);
    await audit(actor, 'report.signed', 'report', period, { sha256: sha, note });
    return { ...row, sha256: sha };
  });
}

export const listSignoffs = () => manyRows(`SELECT s.period, s.sha256, s.signed_at, s.note, u.name signed_by_name
  FROM report_signoffs s JOIN users u ON u.id = s.signed_by ORDER BY s.period DESC`);

export async function getSignoff(period) {
  const s = await oneRow(`SELECT s.*, u.name signed_by_name FROM report_signoffs s JOIN users u ON u.id = s.signed_by WHERE s.period = $1`, [period]);
  if (!s) return null;
  return { ...s, verified: fingerprint(s.data) === s.sha256 };
}
