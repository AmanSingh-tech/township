import { ACCOUNTS, GUARD_PIN, deviceToken, closePool } from './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { createApp } = await import('../app.js');
const { testOtps } = await import('../lib/auth.js');
const { one, q } = await import('../db.js');

// Razorpay's API is stubbed; everything else goes to the real app.
const realFetch = globalThis.fetch;
const rzp = { payments: new Map(), orders: 0 };
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com')) return realFetch(url, opts);
  const path = String(url).replace('https://api.razorpay.com/v1', '');
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/orders') return json({ id: `order_${++rzp.orders}`, ...JSON.parse(opts.body) });
  const m = path.match(/^\/payments\/([^/]+)$/);
  if (m) return rzp.payments.has(m[1]) ? json(rzp.payments.get(m[1])) : json({ error: { description: 'not found' } }, 404);
  return json({ error: { description: 'unexpected' } }, 400);
};

let server, base;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); globalThis.fetch = realFetch; await closePool(); });

async function call(path, { token, body, method, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function login(phone) {
  await call('/auth/otp', { body: { phone } });
  const r = await call('/auth/verify', { body: { phone, code: testOtps.get(phone) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

test('OTP login works and the code is single-use', async () => {
  await call('/auth/otp', { body: { phone: ACCOUNTS.neeraj } });
  const code = testOtps.get(ACCOUNTS.neeraj);
  assert.match(code, /^\d{6}$/);
  const ok = await call('/auth/verify', { body: { phone: ACCOUNTS.neeraj, code } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.flat_id, 'T07-1203');
  assert.equal((await call('/auth/verify', { body: { phone: ACCOUNTS.neeraj, code } })).status, 401);
});

test('unknown numbers get the same reply and no code', async () => {
  const r = await call('/auth/otp', { body: { phone: '9123456789' } });
  assert.equal(r.status, 200);
  assert.equal(testOtps.has('9123456789'), false);
});

test('five wrong codes lock the code', async () => {
  await call('/auth/otp', { body: { phone: ACCOUNTS.swati } });
  const good = testOtps.get(ACCOUNTS.swati);
  const bad = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await call('/auth/verify', { body: { phone: ACCOUNTS.swati, code: bad } });
  assert.equal((await call('/auth/verify', { body: { phone: ACCOUNTS.swati, code: good } })).status, 401);
});

test('at most three codes an hour go to one number', async () => {
  const phone = '9822010013';
  for (let i = 0; i < 3; i++) assert.equal((await call('/auth/otp', { body: { phone } })).status, 200);
  assert.equal((await call('/auth/otp', { body: { phone } })).status, 429);
});

test('expired and revoked sessions are refused', async () => {
  const token = await login(ACCOUNTS.aamir);
  assert.equal((await call('/home', { token })).status, 200);
  await q("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [token]);
  assert.equal((await call('/home', { token })).status, 401);
});

test('roles only reach their own areas', async () => {
  const resident = await login(ACCOUNTS.aamir);
  const helpdesk = await login(ACCOUNTS.helpdesk);
  const committee = await login(ACCOUNTS.committee);
  assert.equal((await call('/desk/complaints', { token: resident })).status, 403);
  assert.equal((await call('/desk/complaints', { token: helpdesk })).status, 200);
  assert.equal((await call('/desk/bank/queue', { token: helpdesk })).status, 403, 'help desk does not handle money');
  assert.equal((await call('/desk/report', { token: committee })).status, 200);
  assert.equal((await call('/admin/users', { token: committee })).status, 403);
  assert.equal((await call('/gate/visitors', { token: helpdesk })).status, 403);
});

test('manual bank postings need a second person', async () => {
  const accounts = await login(ACCOUNTS.accounts);
  const admin = await login(ACCOUNTS.admin);
  const { bankCsv } = await import('./setup.js');
  const imp = await call('/desk/bank/import?filename=t.csv', { token: accounts, body: bankCsv, headers: { 'content-type': 'text/csv' } });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const row = imp.body.rows.find((r) => /MR S JOSHI/.test(r.narration));
  assert.equal(row.status, 'queue');
  const req = await call(`/desk/bank/rows/${row.id}/post`, { token: accounts, body: { flatId: 'T12-0408' } });
  assert.equal(req.status, 200);
  const self = await call(`/desk/approvals/${req.body.approvalId}/approve`, { token: accounts, body: {} });
  assert.equal(self.status, 403, 'requester cannot approve their own posting');
  const before = await one("SELECT COUNT(*) n FROM payments WHERE flat_id = 'T12-0408'");
  const ok = await call(`/desk/approvals/${req.body.approvalId}/approve`, { token: admin, body: {} });
  assert.equal(ok.status, 200);
  assert.match(ok.body.receiptNo, /^RCT\//);
  assert.equal((await one("SELECT COUNT(*) n FROM payments WHERE flat_id = 'T12-0408'")).n, before.n + 1);
  assert.equal((await one('SELECT status FROM bank_rows WHERE id = $1', [row.id])).status, 'resolved');
  const again = await call('/desk/bank/import?filename=t2.csv', { token: accounts, body: bankCsv, headers: { 'content-type': 'text/csv' } });
  assert.equal(again.body.counts.posted, 0, 're-importing the same statement posts nothing');
});

test('gate needs a paired tablet and a guard PIN', async () => {
  const wrong = await call('/auth/pin', { body: { phone: ACCOUNTS.guard, pin: '0000' }, headers: { 'x-device-token': deviceToken } });
  assert.equal(wrong.status, 401);
  const noDevice = await call('/auth/pin', { body: { phone: ACCOUNTS.guard, pin: GUARD_PIN } });
  assert.equal(noDevice.status, 401);
  const ok = await call('/auth/pin', { body: { phone: ACCOUNTS.guard, pin: GUARD_PIN }, headers: { 'x-device-token': deviceToken } });
  assert.equal(ok.status, 200);
  const entry = { clientId: 'c-1', flatId: 'T12-0408', name: 'Courier', purpose: 'Delivery', gate: 'Gate 1' };
  const a = await call('/gate/visitors', { token: ok.body.token, body: entry });
  const b = await call('/gate/visitors', { token: ok.body.token, body: entry });
  assert.equal(a.body.id, b.body.id, 'offline retries do not create duplicates');
  assert.equal(a.body.status, 'waiting');
  assert.equal((await call('/auth/otp', { body: { phone: ACCOUNTS.guard } })).status, 200);
  assert.equal(testOtps.has(ACCOUNTS.guard), false, 'guards cannot sign in by SMS');
});

test('online payment: signature checked, amount from Razorpay, recorded once', async () => {
  const token = await login(ACCOUNTS.aamir);
  const order = await call('/pay/order', { token, body: {} });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  const { orderId, amount } = order.body;
  rzp.payments.set('pay_A', { id: 'pay_A', order_id: orderId, amount: amount * 100, status: 'captured', method: 'upi', acquirer_data: { rrn: '612345678901' } });
  const forged = await call('/pay/verify', { token, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_A', razorpay_signature: 'x'.repeat(64) } });
  assert.equal(forged.status, 400);
  const sig = crypto.createHmac('sha256', 'test_secret').update(`${orderId}|pay_A`).digest('hex');
  const ok = await call('/pay/verify', { token, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_A', razorpay_signature: sig } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.ok, true);
  // The webhook for the same payment arrives later and must not record it again.
  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_A', order_id: orderId } } } });
  const hook = await fetch(base + '/payments/razorpay/webhook', {
    method: 'POST', body: event,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', 'webhook_secret').update(event).digest('hex') },
  });
  assert.equal(hook.status, 200);
  assert.equal((await one("SELECT COUNT(*) n FROM payments WHERE gateway_payment_id = 'pay_A'")).n, 1);
  assert.equal((await call('/home', { token })).body.dues.totalDue, 0);
  const badHook = await fetch(base + '/payments/razorpay/webhook', { method: 'POST', body: event, headers: { 'x-razorpay-signature': 'nope' } });
  assert.equal(badHook.status, 400);
});
