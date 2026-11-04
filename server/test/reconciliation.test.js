// Reconciliation safety: what happens with duplicate, ambiguous and failed
// money operations. Each test checks the database itself, not just a reply.
import { ACCOUNTS, bankCsv, closePool } from './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../app.js');
const { testOtps } = await import('../lib/auth.js');
const { one, tx } = await import('../db.js');
const { recordPayment } = await import('../lib/billing.js');

let server, base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.close(); await closePool(); });

async function call(path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login(phone) {
  await call('/auth/otp', { body: { phone } });
  return (await call('/auth/verify', { body: { phone, code: testOtps.get(phone) } })).body.token;
}
const counts = async () => one(`SELECT (SELECT COUNT(*) FROM payments)::int payments, (SELECT COUNT(*) FROM ledger)::int ledger,
  (SELECT COALESCE(SUM(credit), 0) FROM ledger)::int credited, (SELECT COUNT(*) FROM audit_log WHERE action = 'payment.recorded')::int audited`);

test('importing the same statement twice creates no payments or ledger lines', async () => {
  const accounts = await login(ACCOUNTS.accounts);
  const first = await call('/desk/bank/import?filename=a.csv', { token: accounts, body: bankCsv, headers: { 'content-type': 'text/csv' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.counts.posted > 0, 'the first import posts the confident credits');
  const afterFirst = await counts();

  const again = await call('/desk/bank/import?filename=a-again.csv', { token: accounts, body: bankCsv, headers: { 'content-type': 'text/csv' } });
  assert.equal(again.status, 200);
  assert.deepEqual(await counts(), afterFirst, 'no payment, ledger line, credit or audit entry was added');
  assert.equal(again.body.counts.posted, 0);
  assert.equal(again.body.counts.queue, 0, 'nothing is queued a second time either');
  for (const r of again.body.rows) assert.ok(['duplicate', 'ignored', 'reconciled'].includes(r.status), `${r.narration}: ${r.status}`);
});

test('ambiguous credits wait for a person, and a person cannot approve their own post', async () => {
  const rows = (await call('/desk/bank/queue', { token: await login(ACCOUNTS.accounts) })).body;
  assert.ok(rows.length > 0, 'the sample statement leaves credits for review');
  for (const r of rows) {
    assert.equal(r.payment_id ?? null, null, 'a queued credit has no payment');
    assert.ok(r.reasons.length > 0, 'and says why it was not posted');
  }
  // The database itself refuses self-approval, whatever the app does.
  const a = await one("SELECT id, requested_by FROM approvals WHERE status = 'pending' LIMIT 1")
    || await tx(async () => one(`INSERT INTO approvals (kind, amount, summary, requested_by) SELECT 'adjustment', 100, 'test', id FROM users WHERE phone = $1 RETURNING id, requested_by`, [ACCOUNTS.accounts]));
  await assert.rejects(one("UPDATE approvals SET status = 'approved', decided_by = requested_by, decided_at = now() WHERE id = $1 RETURNING id", [a.id]), /check/i);
});

test('a payment that fails half-way leaves nothing behind, and receipt numbers have no gap', async () => {
  // Receipt numbers come from a counter row updated in the payment's own
  // transaction (not a PostgreSQL sequence), so a rollback also returns the number.
  const fy = (await one("SELECT fy FROM receipt_counters ORDER BY fy DESC LIMIT 1"))?.fy;
  const counterBefore = fy ? (await one('SELECT last FROM receipt_counters WHERE fy = $1', [fy])).last : 0;
  const before = await counts();

  await assert.rejects(tx(async () => {
    await recordPayment({ flatId: 'T07-1203', amount: 999, paidOn: '2026-11-02', method: 'bank', reference: 'WILL-FAIL', postedBy: 'test' }, { name: 'test' });
    throw new Error('failure after the payment was written');
  }), /failure after the payment/);

  assert.deepEqual(await counts(), before, 'no payment, ledger line or audit entry remains');
  assert.equal((await one("SELECT COUNT(*)::int n FROM payments WHERE reference = 'WILL-FAIL'")).n, 0);
  if (fy) assert.equal((await one('SELECT last FROM receipt_counters WHERE fy = $1', [fy])).last, counterBefore, 'the receipt counter is unchanged');

  const ok = await recordPayment({ flatId: 'T07-1203', amount: 100, paidOn: '2026-11-02', method: 'bank', reference: 'AFTER', postedBy: 'test' }, { name: 'test' });
  assert.equal(Number(ok.receipt_no.slice(-5)), counterBefore + 1, 'the next receipt takes the very next number');
});

test('every manual money decision leaves an audit trail', async () => {
  const accounts = await login(ACCOUNTS.accounts);
  const admin = await login(ACCOUNTS.admin);
  const row = (await call('/desk/bank/queue', { token: accounts })).body.find((r) => r.candidates?.length);
  const req = await call(`/desk/bank/rows/${row.id}/post`, { token: accounts, body: { flatId: row.candidates[0].flatId } });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  const ok = await call(`/desk/approvals/${req.body.approvalId}/approve`, { token: admin, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const paymentId = String((await one('SELECT id FROM payments WHERE receipt_no = $1', [ok.body.receiptNo])).id);
  const audited = async (action, id) => (await one('SELECT COUNT(*)::int n FROM audit_log WHERE action = $1 AND entity_id = $2', [action, id])).n;
  const trail = {
    requested: await audited('approval.requested', String(req.body.approvalId)),
    approved: await audited('approval.approved', String(req.body.approvalId)),
    recorded: await audited('payment.recorded', paymentId),
  };
  assert.equal(trail.requested, 1, 'the request is audited');
  assert.equal(trail.approved, 1, 'the approval is audited');
  assert.equal(trail.recorded, 1, 'the payment is audited');
  // And the audit log itself cannot be edited.
  await assert.rejects(one("UPDATE audit_log SET action = 'x' WHERE action = 'approval.approved' RETURNING id"), /append-only/);
});
