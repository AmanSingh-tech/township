// The demo reset: admins only, demo mode only, everyone else paused while it
// runs, the sample township restored, and its own audit trail kept.
process.env.DEMO_DATA = 'true';
const { ACCOUNTS, closePool } = await import('./setup.js');
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { createApp } = await import('../app.js');
const { testOtps } = await import('../lib/auth.js');
const { env } = await import('../env.js');
const { one, many } = await import('../db.js');
const { flatStatus, recordPayment } = await import('../lib/billing.js');
const { resetDemo } = await import('../lib/demoReset.js');
const { loadFixtures } = await import('../demo/fixtures.js');

let server, base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.close(); await closePool(); });

async function call(path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login(phone) {
  await call('/auth/otp', { body: { phone } });
  return (await call('/auth/verify', { body: { phone, code: testOtps.get(phone) } })).body.token;
}

test('only an admin can reset, and only in demo mode', async () => {
  const accounts = await login(ACCOUNTS.accounts);
  assert.equal((await call('/admin/demo/reset', { token: accounts, body: {} })).status, 403);
  const admin = await login(ACCOUNTS.admin);
  env.DEMO_DATA = false;
  try { assert.equal((await call('/admin/demo/reset', { token: admin, body: {} })).status, 404); }
  finally { env.DEMO_DATA = true; }
});

test('a reset restores the sample township and signs everyone out', async () => {
  const resident = await login(ACCOUNTS.aamir);
  await recordPayment({ flatId: 'T21-1601', amount: 5719, paidOn: '2026-11-02', method: 'bank', reference: 'CHANGED', postedBy: 'test' }, { name: 'test' });
  assert.equal((await flatStatus('T21-1601')).totalDue, 0, 'the demo data was changed');

  const admin = await login(ACCOUNTS.admin);
  const r = await call('/admin/demo/reset', { token: admin, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // The brief's three flats are back as in its table.
  const [n, s, a] = await Promise.all(['T07-1203', 'T12-0408', 'T21-1601'].map((f) => flatStatus(f)));
  assert.equal(n.totalDue, 0);
  assert.equal(s.daysOverdue, 47);
  assert.equal(a.daysOverdue, 18);
  assert.equal(a.totalDue, 5660 + 59);
  assert.equal((await one("SELECT COUNT(*)::int n FROM payments WHERE reference = 'CHANGED'")).n, 0);
  // Sessions from before the reset no longer work: the app sends people to sign in.
  assert.equal((await call('/home', { token: resident })).status, 401);
});

test('the audit trail of resets survives each reset', async () => {
  const admin = await login(ACCOUNTS.admin);
  assert.equal((await call('/admin/demo/reset', { token: admin, body: {} })).status, 200);
  const resets = await many("SELECT user_name, details FROM audit_log WHERE action = 'demo.reset' ORDER BY id");
  assert.equal(resets.length, 2, 'the reset in the previous test is still recorded, with this one');
  assert.ok(resets.every((x) => x.user_name && x.details.role === 'admin'), 'each says who reset it');
});

test('a reset that fails part-way changes nothing, is recorded, and lifts the pause', async () => {
  // A change made since the last reset; a failed reset must leave it in place.
  await recordPayment({ flatId: 'T21-1601', amount: 1000, paidOn: '2026-11-02', method: 'bank', reference: 'KEPT', postedBy: 'test' }, { name: 'test' });
  const before = await one('SELECT (SELECT COUNT(*) FROM payments)::int payments, (SELECT COUNT(*) FROM flats)::int flats, (SELECT COUNT(*) FROM audit_log)::int audit');
  const due = (await flatStatus('T21-1601')).totalDue;

  // The schema is dropped and rebuilt with the sample data, then a step fails.
  const failing = async () => { await loadFixtures(); throw new Error('disk full (simulated)'); };
  await assert.rejects(resetDemo({ name: 'Admin', role: 'admin', phone: ACCOUNTS.admin }, {}, { load: failing }),
    (e) => e.status === 500 && /nothing was changed/.test(e.message));

  const now = await one('SELECT (SELECT COUNT(*) FROM payments)::int payments, (SELECT COUNT(*) FROM flats)::int flats, (SELECT COUNT(*) FROM audit_log)::int audit');
  assert.equal(now.payments, before.payments, 'every payment is still there');
  assert.equal(now.flats, before.flats);
  assert.equal((await one("SELECT COUNT(*)::int n FROM payments WHERE reference = 'KEPT'")).n, 1, 'the change made before the reset survives');
  assert.equal((await flatStatus('T21-1601')).totalDue, due);
  assert.equal((await many("SELECT 1 FROM audit_log WHERE action = 'demo.reset'")).length, 2, 'earlier resets are still recorded');
  const failed = await many("SELECT user_name, details FROM audit_log WHERE action = 'demo.reset_failed'");
  assert.equal(failed.length, 1, 'the failure is recorded');
  assert.match(failed[0].details.error, /disk full/);
  assert.equal(now.audit, before.audit + 1, 'and nothing else changed in the audit log');

  // The pause is lifted: people can use the app, and the next reset works and keeps the record.
  const resident = await login(ACCOUNTS.swati);
  assert.equal((await call('/home', { token: resident })).status, 200);
  assert.equal((await call('/admin/demo/reset', { token: await login(ACCOUNTS.admin), body: {} })).status, 200);
  assert.equal((await many("SELECT 1 FROM audit_log WHERE action = 'demo.reset_failed'")).length, 1, 'a later reset keeps the failure on record');
  assert.equal((await one("SELECT COUNT(*)::int n FROM payments WHERE reference = 'KEPT'")).n, 0, 'and that reset does restore the sample data');
});

test('while a reset runs, other requests are told to wait and a second reset is refused', async () => {
  const admin = await login(ACCOUNTS.admin);
  const resident = await login(ACCOUNTS.swati);
  const running = call('/admin/demo/reset', { token: admin, body: {} });
  await new Promise((r) => setTimeout(r, 150));
  const during = await call('/home', { token: resident });
  const second = await call('/admin/demo/reset', { token: admin, body: {} });
  const health = await call('/health');
  const done = await running;
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(during.status, 503, 'a resident request waits with a clear message');
  assert.match(during.body.error, /Resetting demo data/);
  assert.equal(second.status, 503, 'a second request during the reset is held off too');
  assert.equal(health.status, 200, 'the health check still answers');
  // Afterwards the app answers normally again.
  const fresh = await login(ACCOUNTS.swati);
  assert.equal((await call('/home', { token: fresh })).status, 200);
});
