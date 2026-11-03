import { q, one, many, tx, inTransaction } from '../db.js';
import { getSettings } from './settings.js';
import { today, daysBetween, financialYear, periodLabel } from './util.js';
import { audit } from './audit.js';

// Replays each flat's ledger in date order. A payment settles what is open at
// that moment: interest first, then bills oldest first (bye-laws). Surplus is
// held as an advance against the next charge. Interest not yet posted accrues
// daily on each bill's unpaid principal from its due date, or from the last
// date interest was posted for it.
//
// One flat (the common case: a screen, a payment) is read in a single round
// trip, optionally locking the flat so concurrent payments queue up.
export async function flatStatuses(flatIds, asOf = today(), { lock = false } = {}) {
  if (!flatIds.length) return new Map();
  const { interestRatePa } = await getSettings();
  let bills, lines;
  if (flatIds.length === 1) {
    const r = await one(`SELECT
        (SELECT COALESCE(json_agg(b ORDER BY b.issued_on, b.id), '[]') FROM bills b WHERE b.flat_id = f.id AND b.issued_on <= $2) bills,
        (SELECT COALESCE(json_agg(json_build_object('flat_id', l.flat_id, 'on_date', l.on_date, 'kind', l.kind, 'debit', l.debit,
          'credit', l.credit, 'booking_id', l.booking_id) ORDER BY l.on_date, l.id), '[]') FROM ledger l WHERE l.flat_id = f.id AND l.on_date <= $2) lines
      FROM flats f WHERE f.id = $1 ${lock ? 'FOR UPDATE OF f' : ''}`, [flatIds[0], asOf]);
    ({ bills, lines } = r || { bills: [], lines: [] });
  } else {
    if (lock) throw new Error('Only one flat can be locked at a time');
    [bills, lines] = await Promise.all([
      many('SELECT * FROM bills WHERE flat_id = ANY($1) AND issued_on <= $2 ORDER BY issued_on, id', [flatIds, asOf]),
      many(`SELECT flat_id, on_date, kind, debit, credit, booking_id FROM ledger
        WHERE flat_id = ANY($1) AND on_date <= $2 ORDER BY on_date, id`, [flatIds, asOf]),
    ]);
  }
  const byFlat = new Map(flatIds.map((id) => [id, { bills: [], lines: [] }]));
  for (const b of bills) byFlat.get(b.flat_id).bills.push(b);
  for (const l of lines) byFlat.get(l.flat_id).lines.push(l);

  const out = new Map();
  let done = 0;
  for (const [flatId, { bills: fb, lines: fl }] of byFlat) {
    // A whole-township replay is CPU work; let other requests through.
    if (++done % 200 === 0) await new Promise((r) => setImmediate(r));
    const debitTotal = fl.reduce((s, l) => s + l.debit, 0);
    const creditTotal = fl.reduce((s, l) => s + l.credit, 0);
    // Bills come from the bills table (with their issue dates); other debits
    // (interest, opening balances, debit adjustments) from the ledger.
    const events = [
      ...fl.filter((l) => l.debit && l.kind !== 'bill').map((l) => ({ date: l.on_date, order: 0, debit: { amount: l.debit, first: l.kind === 'interest', bookingId: l.booking_id } })),
      ...fb.map((b) => ({ date: b.issued_on, order: 1, debit: { amount: b.amount, bill: b } })),
      ...fl.filter((l) => l.credit).map((l) => ({ date: l.on_date, order: 2, credit: l.credit, bookingId: l.booking_id })),
    ].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.order - y.order));
    // Open items in settlement order: interest first, then oldest first.
    const open = [];
    const paid = new Map(fb.map((b) => [b.id, 0]));
    const settledOn = new Map();
    let advance = 0;
    for (const e of events) {
      if (e.debit) {
        const item = { ...e.debit, paid: 0 };
        if (item.first) open.splice(open.findIndex((x) => !x.first) >>> 0, 0, item); else open.push(item);
      } else if (e.bookingId) {
        // A booking refund cancels its own charge first, not the oldest bill.
        const charge = open.find((x) => x.bookingId === e.bookingId);
        const use = charge ? Math.min(charge.amount - charge.paid, e.credit) : 0;
        if (charge) charge.paid += use;
        advance += e.credit - use;
      } else advance += e.credit;
      for (const item of open) {
        if (advance <= 0) break;
        const pay = Math.min(item.amount - item.paid, advance);
        item.paid += pay; advance -= pay;
      }
      for (let i = open.length - 1; i >= 0; i--) {
        const item = open[i];
        if (item.bill) {
          paid.set(item.bill.id, item.paid);
          if (item.paid >= item.amount && !settledOn.has(item.bill.id)) settledOn.set(item.bill.id, e.date);
        }
        if (item.paid >= item.amount) open.splice(i, 1);
      }
    }
    const rows = fb.map((b) => {
      const p = paid.get(b.id);
      const unpaid = b.amount - p;
      const overdueDays = unpaid > 0 ? Math.max(0, daysBetween(b.due_on, asOf)) : 0;
      const from = b.interest_through && b.interest_through > b.due_on ? b.interest_through : b.due_on;
      const accrual = unpaid > 0 ? Math.max(0, daysBetween(from, asOf)) : 0;
      return {
        ...b, label: periodLabel(b.period), paid: p, unpaid, overdueDays,
        settledOn: settledOn.get(b.id) || null,
        accruedInterest: (unpaid * interestRatePa * accrual) / 365,
      };
    });
    const balance = debitTotal - creditTotal; // negative means advance
    const accruedInterest = Math.round(rows.reduce((s, b) => s + b.accruedInterest, 0));
    const oldest = rows.find((b) => b.unpaid > 0);
    out.set(flatId, {
      flatId, balance, accruedInterest,
      totalDue: Math.max(0, balance + accruedInterest),
      advance: balance < 0 ? -balance : 0,
      daysOverdue: oldest ? oldest.overdueDays : 0,
      bills: rows,
    });
  }
  return out;
}

// The whole township's dues, for the committee report and the bank matcher.
// Replaying every ledger takes seconds of CPU at 2,400 flats, so one result is
// shared (also by concurrent callers) until something that affects dues
// changes: a ledger line or bill (append-only ids), the date, the interest
// rate, or interest being posted. Callers must not modify the returned Map.
// Inside a transaction a fresh replay is not cached, as it may roll back.
let interestPostings = 0;
const shared = { key: null, promise: null };
export async function allFlatStatuses({ fresh = false } = {}) {
  const asOf = today();
  const { interestRatePa } = await getSettings();
  const v = await one('SELECT (SELECT max(id) FROM ledger) l, (SELECT max(id) FROM bills) b, (SELECT count(*) FROM flats) f');
  const key = `${asOf}|${interestRatePa}|${v.l}|${v.b}|${v.f}|${interestPostings}`;
  if (!fresh && shared.key === key) return shared.promise;
  const promise = many('SELECT id FROM flats ORDER BY id').then((fl) => flatStatuses(fl.map((f) => f.id), asOf));
  if (!inTransaction()) {
    Object.assign(shared, { key, promise });
    promise.catch(() => { if (shared.key === key) shared.key = null; });
  }
  return promise;
}

export async function flatStatus(flatId, asOf = today()) {
  return (await flatStatuses([flatId], asOf)).get(flatId);
}

const insertLedger = (l) => q(`INSERT INTO ledger (flat_id, on_date, kind, description, debit, credit, bill_id, payment_id, created_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
[l.flatId, l.onDate, l.kind, l.description, l.debit || 0, l.credit || 0, l.billId || null, l.paymentId || null, l.by || 'system']);

// Turns accrued interest into ledger lines so payments and reports see it:
// one read (locking the flat if asked) and at most one write.
export async function postInterest(flatId, asOf = today(), { lock = false } = {}) {
  const { interestRatePa } = await getSettings();
  const st = (await flatStatuses([flatId], asOf, { lock })).get(flatId);
  const due = st.bills.map((b) => ({ b, amt: Math.round(b.accruedInterest) })).filter((x) => x.amt > 0);
  const unpaid = st.bills.filter((b) => b.unpaid > 0).map((b) => b.id);
  if (due.length || unpaid.length) {
    const pct = +(interestRatePa * 100).toFixed(2);
    await q(`WITH lines AS (
        INSERT INTO ledger (flat_id, on_date, kind, description, debit, bill_id, created_by)
        SELECT $1, $2, 'interest', 'Interest @ ' || $3 || '% p.a. on ' || l || ' arrears', a, b, 'system'
        FROM unnest($4::int[], $5::int[], $6::text[]) x(b, a, l))
      UPDATE bills SET interest_through = $2 WHERE id = ANY($7)`,
    [flatId, asOf, String(pct), due.map((x) => x.b.id), due.map((x) => x.amt), due.map((x) => x.b.label), unpaid]);
  }
  interestPostings++;
}

// Records a payment, its receipt number, ledger credit and audit entry. The
// flat is locked first so two payments for one flat never interleave their
// interest postings. Three round trips in all: a bank statement posts
// thousands of these in one go.
export async function recordPayment(p, actor) {
  return tx(async () => {
    await postInterest(p.flatId, p.paidOn, { lock: true });
    const description = p.method === 'gateway' ? `Online payment ${p.gatewayPaymentId || p.reference}`
      : p.method === 'opening' ? 'Opening credit' : `Bank credit ${p.utr || p.reference || ''}`.trim();
    return one(`WITH c AS (
        INSERT INTO receipt_counters (fy, last) VALUES ($1, 1) ON CONFLICT (fy) DO UPDATE SET last = receipt_counters.last + 1 RETURNING last
      ), pay AS (
        INSERT INTO payments (flat_id, amount, paid_on, method, reference, utr, gateway_order_id, gateway_payment_id, receipt_no, posted_by)
        SELECT $2, $3, $4, $5, $6, $7, $8, $9, 'RCT/' || $1 || '/' || lpad(c.last::text, greatest(5, length(c.last::text)), '0'), $10 FROM c
        RETURNING id, receipt_no
      ), line AS (
        INSERT INTO ledger (flat_id, on_date, kind, description, credit, payment_id, created_by)
        SELECT $2, $4, 'payment', $11, $3, pay.id, $10 FROM pay
      ), log AS (
        INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip)
        SELECT $12, $13, 'payment.recorded', 'payment', pay.id::text,
          jsonb_build_object('flatId', $2::text, 'amount', $3::int, 'method', $5::text, 'receiptNo', pay.receipt_no), $14 FROM pay
      )
      SELECT id, receipt_no FROM pay`,
    [financialYear(p.paidOn), p.flatId, p.amount, p.paidOn, p.method, p.reference || null, p.utr || null, p.gatewayOrderId || null,
      p.gatewayPaymentId || null, p.postedBy, description, actor?.id ?? null, actor?.name ?? 'system', actor?.ip ?? null]);
  });
}

// Debit or credit adjustment, e.g. waiving interest by committee resolution.
export async function postAdjustment({ flatId, amount, direction, reason, onDate = today() }, actor) {
  return tx(async () => {
    await insertLedger({
      flatId, onDate, kind: 'adjustment', by: actor.name,
      debit: direction === 'debit' ? amount : 0, credit: direction === 'credit' ? amount : 0,
      description: `Adjustment: ${reason}`,
    });
    await audit(actor, 'ledger.adjustment', 'flat', flatId, { amount, direction, reason });
  });
}

// Area × rate in whole rupees, rounding half up. Worked in paise so floating
// point never turns 650 sq ft × ₹6.27 (₹4,075.50) into ₹4,075.
export const billAmount = (area, rate) => Math.floor((area * Math.round(rate * 100) + 50) / 100);

// Raises one month's maintenance bills for every flat: area × rate. A bill
// run fixes the rate and dates the committee approved; without one, the
// current settings are used (tests and fixtures only). Works in bulk: one
// ledger replay for all flats, then set-based inserts, so a 2,400-flat run
// takes seconds however much history there is.
export async function raiseBills(period, actor, run = null) {
  const s = await getSettings();
  const rate = run ? Number(run.rate) : s.ratePerSqft;
  const issuedOn = run?.issued_on || `${period}-${String(s.billDay).padStart(2, '0')}`;
  const dueOn = run?.due_on || `${period}-${String(s.dueDay).padStart(2, '0')}`;
  return tx(async () => {
    const flats = await many('SELECT * FROM flats f WHERE NOT EXISTS (SELECT 1 FROM bills b WHERE b.flat_id = f.id AND b.period = $1) ORDER BY id FOR UPDATE', [period]);
    // Interest on arrears is posted up to the bill date first, as the
    // bye-laws require; never with a date in the future.
    if (flats.length && issuedOn <= today()) {
      const statuses = await flatStatuses(flats.map((f) => f.id), issuedOn);
      const lines = [], through = [];
      for (const st of statuses.values()) {
        for (const b of st.bills) {
          const amt = Math.round(b.accruedInterest);
          if (amt > 0) lines.push({ flatId: st.flatId, billId: b.id, amt, label: b.label });
          if (b.unpaid > 0) through.push(b.id);
        }
      }
      const pct = +(s.interestRatePa * 100).toFixed(2);
      await q(`INSERT INTO ledger (flat_id, on_date, kind, description, debit, bill_id, created_by)
        SELECT f, $1, 'interest', 'Interest @ ' || $2 || '% p.a. on ' || l || ' arrears', a, b, 'system'
        FROM unnest($3::text[], $4::int[], $5::int[], $6::text[]) x(f, b, a, l)`,
      [issuedOn, String(pct), lines.map((x) => x.flatId), lines.map((x) => x.billId), lines.map((x) => x.amt), lines.map((x) => x.label)]);
      await q('UPDATE bills SET interest_through = $2 WHERE id = ANY($1)', [through, issuedOn]);
      interestPostings++;
    }
    const bills = await many(`INSERT INTO bills (flat_id, period, area, rate, amount, issued_on, due_on, bill_run_id)
      SELECT f, $1, a, $2, amt, $3, $4, $5 FROM unnest($6::text[], $7::int[], $8::int[]) x(f, a, amt)
      ON CONFLICT (flat_id, period) DO NOTHING RETURNING id, flat_id, area, amount`,
    [period, rate, issuedOn, dueOn, run?.id || null, flats.map((f) => f.id), flats.map((f) => f.area), flats.map((f) => billAmount(f.area, rate))]);
    await q(`INSERT INTO ledger (flat_id, on_date, kind, description, debit, bill_id, created_by)
      SELECT f, $1, 'bill', 'Maintenance ' || $2 || ' · ' || a || ' sq ft × ₹' || $3, amt, b, 'system'
      FROM unnest($4::text[], $5::int[], $6::int[], $7::int[]) x(f, a, amt, b)`,
    [issuedOn, periodLabel(period), String(rate), bills.map((b) => b.flat_id), bills.map((b) => b.area), bills.map((b) => b.amount), bills.map((b) => b.id)]);
    const total = bills.reduce((sum, b) => sum + b.amount, 0);
    await audit(actor, 'bills.raised', 'period', period, { created: bills.length, total, rate, issuedOn, dueOn, billRunId: run?.id || null });
    return { created: bills.length, total, issuedOn, dueOn };
  });
}
