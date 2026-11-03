import { ACCOUNTS, closePool } from './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../app.js');
const { testOtps } = await import('../lib/auth.js');
const { one, q } = await import('../db.js');
const { drainOutbox } = await import('../lib/notify.js');
const { housekeeping } = await import('../lib/housekeeping.js');

let server, base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await closePool(); });

async function call(path, { token, body, method } = {}) {
  const res = await fetch(base + '/api' + path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
const tokens = {};
async function login(who) {
  if (tokens[who]) return tokens[who];
  const phone = ACCOUNTS[who];
  await call('/auth/otp', { body: { phone } });
  const r = await call('/auth/verify', { body: { phone, code: testOtps.get(phone) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (tokens[who] = r.body.token);
}
const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from('ffd8ffe000104a46494600', 'hex'), Buffer.alloc(64, 1)]).toString('base64');

test('bills are issued only after a committee member approves, at the approved rate', async () => {
  const accounts = await login('accounts');
  const committee = await login('committee');
  const admin = await login('admin');
  const draft = await call('/desk/bill-runs', { token: accounts, body: { period: '2026-11' } });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.status, 'draft');
  assert.equal(await one("SELECT COUNT(*) n FROM bills WHERE period = '2026-11'").then((r) => r.n), 0, 'nothing issued yet');
  assert.equal((await call('/desk/bill-runs', { token: accounts, body: { period: '2026-11' } })).status, 409, 'one draft per month');
  assert.equal((await call('/desk/bill-runs', { token: accounts, body: { period: '2026-12' } })).status, 400, 'not before the bill date');
  assert.equal((await call(`/desk/bill-runs/${draft.body.id}/approve`, { token: accounts, body: {} })).status, 403, 'accounts cannot approve');
  // A rate change after preparing must not change what the committee approved.
  await call('/admin/settings', { token: admin, method: 'PUT', body: { ratePerSqft: 7 } });
  const ok = await call(`/desk/bill-runs/${draft.body.id}/approve`, { token: committee, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.created, draft.body.flat_count);
  const aamir = await one("SELECT amount, bill_run_id FROM bills WHERE flat_id = 'T21-1601' AND period = '2026-11'");
  assert.equal(aamir.amount, 10660, '1640 sq ft × ₹6.50, the rate when prepared');
  assert.equal(aamir.bill_run_id, draft.body.id);
  const pushes = await one("SELECT COUNT(*) n FROM messages WHERE channel = 'push' AND body LIKE '%November 2026 maintenance bill%'");
  assert.ok(pushes.n >= draft.body.flat_count, 'every resident is told');
  await drainOutbox(500);
  assert.equal((await one("SELECT COUNT(*) n FROM messages WHERE channel = 'push' AND status = 'sent'")).n, 0, 'no alerts turned on, so none counted as sent');
});

test('a signed report is frozen and its fingerprint checks out', async () => {
  const committee = await login('committee');
  const helpdesk = await login('helpdesk');
  assert.equal((await call('/desk/report/2026-10/signoff', { token: helpdesk, body: {} })).status, 403);
  const s = await call('/desk/report/2026-10/signoff', { token: committee, body: { note: 'MC meeting 5 Nov' } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.sha256, /^[0-9a-f]{64}$/);
  assert.equal((await call('/desk/report/2026-10/signoff', { token: committee, body: {} })).status, 409);
  const got = await call('/desk/report/signoffs/2026-10', { token: helpdesk });
  assert.equal(got.body.verified, true);
  assert.equal(got.body.data.period, '2026-10');
  await assert.rejects(q("UPDATE report_signoffs SET note = 'x'"), /append-only/);
});

test('photos are stored as files and served only through signed links', async () => {
  const swati = await login('swati');
  const c = await call('/complaints', { token: swati, body: { text: 'Bathroom tile cracked near the drain', photo: JPEG } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const d = await call(`/complaints/${c.body.id}`, { token: swati });
  assert.match(d.body.photo_url, /^\/api\/files\/complaint\/.+\?exp=\d+&sig=/);
  const img = await fetch(base + d.body.photo_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(base + d.body.photo_url.replace(/sig=.{4}/, 'sig=AAAA'))).status, 403, 'tampered link refused');
  const bad = await call('/complaints', { token: swati, body: { text: 'Not really a photo here', photo: 'data:image/jpeg;base64,' + Buffer.from('<script>').toString('base64') } });
  assert.equal(bad.status, 400);
});

test('visitor photos are deleted after the retention period', async () => {
  const { savePhoto } = await import('../lib/storage.js');
  const key = await savePhoto(JPEG, { ownerKind: 'visitor', flatId: 'T07-1203' });
  await q("INSERT INTO visitors (flat_id, name, status, photo_key, created_at) VALUES ('T07-1203', 'Old visitor', 'left', $1, now() - interval '91 days')", [key]);
  await q("INSERT INTO guest_codes (code, flat_id, guest_name, valid_on) VALUES ('100001', 'T07-1203', 'Old guest', current_date - 91)");
  const r = await housekeeping();
  assert.equal(await one("SELECT 1 FROM guest_codes WHERE code = '100001'"), null, 'old guest codes and names are cleared');
  assert.ok(r.photosDeleted >= 1);
  assert.equal(await one('SELECT 1 FROM files WHERE key = $1', [key]), null);
  assert.equal((await one("SELECT photo_key FROM visitors WHERE name = 'Old visitor'")).photo_key, null);
});

test('residents can download their data and ask for erasure', async () => {
  const neeraj = await login('neeraj');
  const admin = await login('admin');
  const ex = await call('/me/export', { token: neeraj });
  assert.equal(ex.status, 200);
  assert.equal(ex.body.profile.phone, ACCOUNTS.neeraj);
  assert.ok(ex.body.ledger.length > 0 && ex.body.payments.length > 0);
  assert.match(ex.headers.get('content-disposition'), /my-data-T07-1203\.json/);
  const req = await call('/me/data-requests', { token: neeraj, body: { kind: 'erasure' } });
  assert.equal(req.status, 200);
  const done = await call(`/admin/data-requests/${req.body.id}/resolve`, { token: admin, body: { outcome: 'done', response: 'Account closed; accounts kept as the law requires' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await call('/home', { token: neeraj })).status, 401, 'signed out everywhere');
  assert.equal((await one("SELECT active FROM users WHERE phone = $1", [ACCOUNTS.neeraj])).active, false);
  assert.ok((await one("SELECT COUNT(*) n FROM payments WHERE flat_id = 'T07-1203'")).n > 0, 'financial records are kept');
});

test('help desk can correct a resident’s details, with before and after audited', async () => {
  const helpdesk = await login('helpdesk');
  const u = await one("SELECT id FROM users WHERE name = 'Mohan Deshmukh'");
  const r = await call(`/desk/residents/${u.id}`, { token: helpdesk, method: 'PATCH', body: { name: 'Mohan R. Deshmukh' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = await one("SELECT details FROM audit_log WHERE action = 'resident.corrected' AND entity_id = $1", [String(u.id)]);
  assert.equal(a.details.before.name, 'Mohan Deshmukh');
  assert.equal(a.details.after.name, 'Mohan R. Deshmukh');
});

test('a resident’s login number changes only after a second person approves', async () => {
  const helpdesk = await login('helpdesk');
  const accounts = await login('accounts');
  const u = await one("SELECT id, phone FROM users WHERE name = 'Sana Shaikh'");
  const r = await call(`/desk/residents/${u.id}`, { token: helpdesk, method: 'PATCH', body: { phone: '9822077777' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.approvalId);
  assert.equal((await one('SELECT phone FROM users WHERE id = $1', [u.id])).phone, u.phone, 'unchanged until approved');
  assert.equal((await call(`/desk/residents/${u.id}`, { token: helpdesk, method: 'PATCH', body: { phone: '9822077778' } })).status, 409, 'one pending change at a time');
  const ok = await call(`/desk/approvals/${r.body.approvalId}/approve`, { token: accounts, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await one('SELECT phone FROM users WHERE id = $1', [u.id])).phone, '9822077777');
});

test('push subscriptions are validated', async () => {
  const swati = await login('swati');
  assert.equal((await call('/push/subscribe', { token: swati, body: { endpoint: 'http://insecure', keys: {} } })).status, 400);
  const ok = await call('/push/subscribe', { token: swati, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } } });
  assert.equal(ok.status, 200);
  assert.ok(await one("SELECT 1 FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'"));
});

test('a visitor alert goes out before a backlog of bill alerts', async () => {
  const { send, drainOutbox } = await import('../lib/notify.js');
  for (let i = 0; i < 120; i++) await send('push', '9822010002', `Bulk notice ${i}`);
  await send('push', '9822010002', 'Priority probe is at Gate 1', { urgent: true });
  await drainOutbox(5);
  const probe = await one("SELECT status FROM messages WHERE body = 'Priority probe is at Gate 1'");
  assert.notEqual(probe.status, 'queued', 'handled in the first batch');
  assert.ok((await one("SELECT COUNT(*) n FROM messages WHERE body LIKE 'Bulk notice%' AND status = 'queued'")).n >= 115);
});

test('the production app role cannot change append-only records or switch off their triggers', async () => {
  const { grantAppRole, verifyIntegrity } = await import('../lib/dbroles.js');
  const { env } = await import('../env.js');
  const pg = (await import('pg')).default;
  await grantAppRole('township_app_test', 'test-only-password-0123456789');
  const url = new URL(env.DATABASE_URL);
  url.username = 'township_app_test';
  url.password = 'test-only-password-0123456789';
  const app = new pg.Client({ connectionString: url.toString() });
  await app.connect();
  try {
    assert.ok((await app.query('SELECT COUNT(*) FROM ledger')).rows[0].count > 0, 'it can read');
    await app.query("INSERT INTO audit_log (action) VALUES ('role.test')");
    await assert.rejects(app.query('UPDATE ledger SET credit = 0'), /permission denied/);
    await assert.rejects(app.query('DELETE FROM payments'), /permission denied/);
    await assert.rejects(app.query('ALTER TABLE ledger DISABLE TRIGGER ALL'), /must be owner/);
    await assert.rejects(app.query('CREATE TABLE sneaky (x int)'), /permission denied/);
    await assert.rejects(app.query("INSERT INTO schema_migrations (name) VALUES ('999_fake.sql')"), /permission denied/);
  } finally {
    await app.end();
  }
  const checks = await verifyIntegrity();
  assert.deepEqual(checks.filter((c) => !c.ok), [], 'the books add up');
});

test('alerts only go to real browser push services, never an address a resident chooses', async () => {
  const { validPushEndpoint } = await import('../lib/push.js');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QH4', 'https://wns2-pn1p.notify.windows.com/w/?token=x']) assert.ok(validPushEndpoint(ok), ok);
  for (const bad of ['https://169.254.169.254/latest/meta-data', 'https://internal-township-alb.ap-south-1.elb.amazonaws.com/api',
    'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'http://fcm.googleapis.com/x', 'not a url'])
    assert.equal(validPushEndpoint(bad), false, bad);
});

test('CSV exports cannot smuggle spreadsheet formulas', async () => {
  const { toCsv, parseCsv } = await import('../lib/csv.js');
  const out = toCsv([['Name', 'Due'], ['=HYPERLINK("http://x","click")', 5660], ['+91 cmd', -40], ['@SUM(A1)', 0], ['Plain, with comma', 1]]);
  const rows = parseCsv(out);
  assert.equal(rows[1][0], `'=HYPERLINK("http://x","click")`);
  assert.equal(rows[2][0], "'+91 cmd");
  assert.equal(rows[2][1], '-40', 'numbers are left alone, negative ones too');
  assert.equal(rows[3][0], "'@SUM(A1)");
  assert.equal(rows[4][0], 'Plain, with comma');
});
