import { closePool } from './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { flatStatus, recordPayment, postAdjustment } = await import('../lib/billing.js');
const { q, one } = await import('../db.js');
after(closePool);
const sys = { name: 'test' };

test('the brief’s three flats match its sample table', async () => {
  const n = await flatStatus('T07-1203'), s = await flatStatus('T12-0408'), a = await flatStatus('T21-1601');
  assert.equal(n.totalDue, 0);
  assert.equal(n.bills.at(-1).amount, 7475); // 1150 sq ft × ₹6.50
  assert.equal(s.daysOverdue, 47);
  assert.equal(s.bills.find((b) => b.period === '2026-09').amount, 6370);
  assert.equal(a.daysOverdue, 18);
  assert.equal(a.bills.at(-1).amount, 10660);
  assert.equal(a.bills.at(-1).paid, 5000);
});

test('interest is simple interest at 21% a year on overdue principal', async () => {
  const a = await flatStatus('T21-1601');
  assert.equal(a.accruedInterest, 59); // 5660 × 0.21 × 18 / 365 = 58.6
  assert.equal(a.totalDue, 5660 + 59);
});

test('a payment settles interest first, then the oldest bill', async () => {
  await recordPayment({ flatId: 'T12-0408', amount: 6370, paidOn: '2026-11-02', method: 'bank', postedBy: 'test' }, sys);
  const s = await flatStatus('T12-0408');
  const sep = s.bills.find((b) => b.period === '2026-09');
  const oct = s.bills.find((b) => b.period === '2026-10');
  assert.ok(sep.unpaid > 0 && sep.unpaid < 400, 'September is nearly settled after interest was taken first');
  assert.equal(oct.paid, 0, 'October is untouched until September is clear');
});

test('receipts are numbered per financial year without gaps', async () => {
  const a = await recordPayment({ flatId: 'T07-1203', amount: 100, paidOn: '2026-11-02', method: 'bank', postedBy: 'test' }, sys);
  const b = await recordPayment({ flatId: 'T07-1203', amount: 100, paidOn: '2026-11-02', method: 'bank', postedBy: 'test' }, sys);
  assert.match(a.receipt_no, /^RCT\/2026-27\/\d{5}$/);
  assert.equal(Number(b.receipt_no.slice(-5)), Number(a.receipt_no.slice(-5)) + 1);
});

test('a credit adjustment reduces dues and is audited', async () => {
  const before = (await flatStatus('T21-1601')).balance;
  await postAdjustment({ flatId: 'T21-1601', amount: 59, direction: 'credit', reason: 'Interest waived, MC resolution 14/2026' }, { id: null, name: 'test' });
  assert.equal((await flatStatus('T21-1601')).balance, before - 59);
  assert.ok(await one("SELECT 1 FROM audit_log WHERE action = 'ledger.adjustment' AND entity_id = 'T21-1601'"));
});

test('ledger, payments and audit log cannot be edited or deleted', async () => {
  await assert.rejects(q('UPDATE ledger SET credit = 0'), /append-only/);
  await assert.rejects(q('DELETE FROM payments'), /append-only/);
  await assert.rejects(q('DELETE FROM audit_log'), /append-only/);
});

test('bill amounts round half up exactly, without floating-point error', async () => {
  const { billAmount } = await import('../lib/billing.js');
  assert.equal(billAmount(650, 6.27), 4076, '₹4,075.50 rounds up; 650 × 6.27 in floating point is 4075.4999…');
  assert.equal(billAmount(1150, 6.5), 7475);
  assert.equal(billAmount(980, 6.5), 6370);
});

test('a bill run posts interest on arrears up to the bill date, for every flat at once', async () => {
  const { raiseBills } = await import('../lib/billing.js');
  const { many: all } = await import('../db.js');
  const expected = new Map();
  for (const f of await all('SELECT id FROM flats')) {
    const st = await flatStatus(f.id, '2026-11-01');
    const sum = st.bills.reduce((s, b) => s + Math.round(b.accruedInterest), 0);
    if (sum) expected.set(f.id, sum);
  }
  assert.ok(expected.size > 5, 'several flats are in arrears');
  const lastLine = (await one('SELECT MAX(id) m FROM ledger')).m;
  const r = await raiseBills('2026-11', sys);
  assert.equal(r.created, Number((await one('SELECT COUNT(*) n FROM flats')).n));
  const posted = new Map((await all(`SELECT flat_id, SUM(debit) s FROM ledger WHERE kind = 'interest' AND id > $1 GROUP BY flat_id`, [lastLine]))
    .map((x) => [x.flat_id, x.s]));
  assert.deepEqual(posted, expected);
  // Nothing accrues twice: right after the run, only interest from the bill date on is outstanding.
  assert.equal((await flatStatus('T12-0408', '2026-11-01')).accruedInterest, 0);
  const again = await raiseBills('2026-11', sys);
  assert.equal(again.created, 0, 'a second run for the same month raises nothing');
});

test('whole-township dues are shared between callers but never stale', async () => {
  const { allFlatStatuses } = await import('../lib/billing.js');
  const [a, b] = await Promise.all([allFlatStatuses(), allFlatStatuses()]);
  assert.equal(a, b, 'concurrent callers share one replay');
  await recordPayment({ flatId: 'T21-1601', amount: 250, paidOn: '2026-11-02', method: 'bank', postedBy: 'test' }, sys);
  const c = await allFlatStatuses();
  assert.notEqual(c, a);
  assert.deepEqual(c.get('T21-1601'), await flatStatus('T21-1601'), 'a new payment shows at once');
  assert.ok(c.get('T21-1601').balance < a.get('T21-1601').balance);
});
