// Load test against the full-size township from load/seed.js. Starts the
// API on its own port and drives resident, gate and desk traffic two ways:
//  - at fixed arrival rates (requests a second), the way real users arrive;
//    the target is set against this;
//  - with N users clicking without pause, to find one server's capacity.
// Then it times the heavy jobs: committee report, bill run for every flat, a
// month's bank statement, Tally export and register preview, and how long a
// visitor alert waits behind a bill run's alerts.
// Writes tmp/load-report.json and exits 1 if any target is missed.
//
//   DATABASE_URL=postgres://township:township@localhost:5440/township_load node load/run.js
//     [--rates 20,40,80] [--steps 50,100] [--seconds 30] [--no-jobs] [--profile]
//
// Sizing: 4,200 residents. On bill day perhaps 30% open the app within ten
// minutes, about four requests each: ~8 requests a second, plus ~1 from six
// gate tablets. The target rate, 40 a second, is five times that peak.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { env } from '../server/env.js';

if (!/@(localhost|127\.0\.0\.1)[:/].*_load$/.test(env.DATABASE_URL)) {
  console.error('Run against the local _load database built by load/seed.js.');
  process.exit(1);
}
const { many, one, pool } = await import('../server/db.js');
const { today } = await import('../server/lib/util.js');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const RATES = arg('rates', '20,40,80').split(',').map(Number);
const STEPS = arg('steps', '50,100').split(',').map(Number);
const SECONDS = Number(arg('seconds', 30));
const PORT = 4100;
const BASE = `http://127.0.0.1:${PORT}`;
const S = JSON.parse(fs.readFileSync('tmp/load-sessions.json', 'utf8'));
const T = today();

// Targets. Interactive screens must stay quick under peak load; jobs must
// finish well inside the load balancer's request timeout.
const TARGETS = { targetRate: 40, interactiveP95: 300, interactiveErrors: 0.001, reportMs: 5000, billRunMs: 30000, bankImportMs: 30000, alertWaitMs: 10000 };

// ---- Server -----------------------------------------------------------------------
fs.mkdirSync('tmp', { recursive: true });
const log = fs.openSync('tmp/load-server.log', 'w');
const PROFILE = process.argv.includes('--profile');
const server = spawn(process.execPath, [...(PROFILE ? ['--cpu-prof', '--cpu-prof-dir=tmp/prof'] : []), 'server/index.js'], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' }, stdio: ['ignore', log, log],
});
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);
for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
  if (i > 100) throw new Error('API did not start; see tmp/load-server.log');
  await new Promise((r) => setTimeout(r, 200));
}

// ---- Request helper and stats --------------------------------------------------------
const stats = new Map();
const record = (label, ms, status) => {
  const s = stats.get(label) || { label, times: [], errors: 0, client: 0 };
  s.times.push(ms);
  if (status >= 500 || status === 0) s.errors++;
  else if (status >= 400) s.client++;
  stats.set(label, s);
};
async function call(label, token, path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const t = performance.now();
  let status = 0, data = null;
  try {
    const res = await fetch(BASE + path, {
      method, headers: { authorization: `Bearer ${token}`, ...(body && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body && (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    status = res.status;
    data = raw ? await res.arrayBuffer() : await res.json().catch(() => null);
  } catch { status = 0; }
  const ms = performance.now() - t;
  if (label) record(label, ms, status);
  return { status, data, ms };
}
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// ---- Traffic mix -----------------------------------------------------------------------
// Each loop is one person opening a screen. 85% residents, 10% gate, 5% desk.
let seq = 0;
async function residentVisit() {
  const r = pick(S.residents);
  const x = Math.random();
  if (x < 0.40) return call('resident home', r.token, '/api/home');
  if (x < 0.60) {
    const b = await call('resident bills', r.token, '/api/bills');
    const p = b.data?.payments?.[0];
    if (p && Math.random() < 0.15) await call('receipt pdf', r.token, `/api/receipts/${p.id}/pdf`, { raw: true });
    return;
  }
  if (x < 0.72) return call('resident complaints', r.token, '/api/complaints');
  if (x < 0.84) return call('resident visitors', r.token, '/api/visitors');
  if (x < 0.90) return call('amenity slots', r.token, `/api/amenities/${1 + (seq % 3)}/availability?date=${T}`);
  if (x < 0.96) return call('notices', r.token, '/api/notices');
  if (x < 0.98) return call('new complaint', r.token, '/api/complaints', { method: 'POST', body: { text: pick(['Bathroom tap leaking', 'Corridor light not working', 'Garbage not collected']) } });
  return call('guest code', r.token, '/api/guest-codes', { method: 'POST', body: { guestName: 'Load guest', validOn: T } });
}
async function gateVisit() {
  const g = pick(S.guards);
  if (Math.random() < 0.6) return call('gate list', g.token, '/api/gate/visitors');
  return call('gate new visitor', g.token, '/api/gate/visitors', { method: 'POST', body: {
    flatId: pick(S.residents).flatId, name: 'Delivery', purpose: 'Delivery', gate: g.gate, clientId: `load-${process.pid}-${++seq}` } });
}
async function deskVisit() {
  const x = Math.random();
  if (x < 0.5) return call('desk complaints', pick(S.staff.helpdesk), '/api/desk/complaints');
  if (x < 0.8) return call('desk flat search', pick(S.staff.accounts), `/api/desk/flats?q=T${String(1 + (seq++ % 28)).padStart(2, '0')}`);
  return call('desk flat ledger', pick(S.staff.accounts), `/api/desk/flats/${pick(S.residents).flatId}`);
}
const visit = () => { const x = Math.random(); return x < 0.85 ? residentVisit() : x < 0.95 ? gateVisit() : deskVisit(); };

const results = { at: new Date().toISOString(), rates: [], steps: [], jobs: {}, targets: TARGETS, failures: [] };
function summarise(extra) {
  const all = [...stats.values()];
  const times = all.flatMap((s) => s.times);
  const errors = all.reduce((a, s) => a + s.errors, 0);
  return {
    ...extra, requests: times.length, rps: Math.round(times.length / SECONDS),
    p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), p99: Math.round(pct(times, 99)), errorRate: errors / times.length,
    routes: all.map((s) => ({ route: s.label, n: s.times.length, p50: Math.round(pct(s.times, 50)), p95: Math.round(pct(s.times, 95)), max: Math.round(Math.max(...s.times)), errors: s.errors, client: s.client }))
      .sort((a, b) => b.p95 - a.p95),
  };
}
const line = (head, x) => console.log(`\n${head}: ${x.rps} req/s, p50 ${x.p50} ms, p95 ${x.p95} ms, p99 ${x.p99} ms, errors ${(x.errorRate * 100).toFixed(2)}%`);

// Open loop: people arrive at a steady rate whether or not the server keeps up.
for (const rate of RATES) {
  stats.clear();
  const inflight = [];
  const start = Date.now();
  for (let i = 0; i < rate * SECONDS; i++) {
    const due = start + (i * 1000) / rate;
    if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now()));
    inflight.push(visit());
  }
  await Promise.all(inflight);
  const x = summarise({ rate });
  results.rates.push(x);
  line(`${rate} arrivals a second`, x);
  console.table(x.routes);
}
// Closed loop: N users clicking without pause, to find the ceiling.
for (const vus of STEPS) {
  stats.clear();
  const until = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: vus }, async () => { while (Date.now() < until) await visit(); }));
  const x = summarise({ vus });
  results.steps.push(x);
  line(`${vus} users without pause (capacity)`, x);
}

// ---- Heavy jobs, one at a time ------------------------------------------------------------
// They change the data (a bill run, a statement), so reseed before running them again.
if (process.argv.includes('--no-jobs')) {
  fs.writeFileSync('tmp/load-report.json', JSON.stringify(results, null, 2));
  server.on('exit', () => process.exit(0));
  stop();
  await pool.end();
  await new Promise(() => {});
}
const job = async (name, fn) => {
  const t = performance.now();
  const out = await fn();
  const ms = Math.round(performance.now() - t);
  results.jobs[name] = { ms, ...(out || {}) };
  console.log(`${name.padEnd(34)} ${String(ms).padStart(7)} ms  ${out ? JSON.stringify(out) : ''}`);
  return out;
};
const committee = S.staff.committee[0];
const accounts = S.staff.accounts[0];
console.log('\nJobs');
await job('committee report', async () => ({ status: (await call(null, committee, '/api/desk/report')).status }));
await job('committee report ×5 at once', async () => ({ statuses: [...new Set((await Promise.all(Array.from({ length: 5 }, () => call(null, committee, '/api/desk/report')))).map((r) => r.status))] }));
await job('report CSV', async () => ({ status: (await call(null, committee, '/api/desk/report.csv', { raw: true })).status }));

const period = T.slice(0, 7);
const prepared = await job('bill run: prepare', async () => {
  const r = await call(null, accounts, '/api/desk/bill-runs', { method: 'POST', body: { period } });
  return { status: r.status, id: r.data?.id, flats: r.data?.flat_count, error: r.data?.error };
});
if (prepared.id) {
  await job('bill run: approve and issue', async () => {
    const r = await call(null, committee, `/api/desk/bill-runs/${prepared.id}/approve`, { method: 'POST', body: { note: 'load test' } });
    return { status: r.status, created: r.data?.created, error: r.data?.error };
  });
  // A visitor arrives just after the bill alerts were queued.
  await job('visitor alert wait after bill run', async () => {
    const g = S.guards[0];
    const flat = S.residents[0].flatId;
    const queuedAhead = Number((await one("SELECT COUNT(*) n FROM messages WHERE status = 'queued'")).n);
    const v = await call(null, g.token, '/api/gate/visitors', { method: 'POST', body: { flatId: flat, name: 'Alert probe', gate: g.gate, clientId: `probe-${Date.now()}` } });
    const since = new Date(Date.now() - 1000);
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const m = await one(`SELECT status FROM messages WHERE body LIKE 'Alert probe is at%' AND at >= $1 ORDER BY id LIMIT 1`, [since]);
      if (m && m.status !== 'queued') return { status: v.status, queuedAhead, handled: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { status: v.status, queuedAhead, handled: false, note: 'still queued after 60 s' };
  });
}

// A month-end statement: one credit per flat that owes, in the styles banks use.
const owing = await many(`SELECT b.flat_id, b.amount, u.name, h.vpa FROM bills b
  JOIN users u ON u.flat_id = b.flat_id AND u.relation = 'owner'
  LEFT JOIN LATERAL (SELECT vpa FROM upi_handles x WHERE x.flat_id = b.flat_id LIMIT 1) h ON true
  WHERE b.period = $1 ORDER BY b.flat_id`, [period]);
let utr = 900000000000;
const [yy, mm, dd] = T.split('-');
const csv = ['Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance', ...owing.map((o, i) => {
  const u = String(utr += 7919);
  const n = i % 4 === 0 ? `NEFT CR-HDFC0001234-${o.name.toUpperCase()}-${o.flat_id} MAINT`
    : o.vpa && i % 4 !== 3 ? `UPI/CR/${u}/${o.name.toUpperCase()}/${o.vpa}/Maintenance`
      : `IMPS/P2A/${u}/${o.name.toUpperCase().split(' ')[0]}/HDFC/maint`;
  return [`${dd}/${mm}/${yy}`, `"${n}"`, i % 4 === 0 ? `N3${u.slice(-10)}` : '', '', o.amount, 1000000 + i].join(',');
})].join('\n');
await job(`bank statement (${owing.length} rows)`, async () => {
  const r = await call(null, accounts, '/api/desk/bank/import?filename=load.csv', { method: 'POST', body: csv, headers: { 'content-type': 'text/csv' } });
  return { status: r.status, ...(r.data?.counts || { error: r.data?.error }) };
});
await job('Tally export (last month)', async () => {
  const from = `${new Date(Date.UTC(+yy, +mm - 2, 1)).toISOString().slice(0, 7)}-01`;
  const to = new Date(Date.UTC(+yy, +mm - 1, 0)).toISOString().slice(0, 10);
  const r = await call(null, accounts, '/api/desk/tally/export', { method: 'POST', body: { from, to, confirmOverlap: true }, raw: true });
  return { status: r.status, kb: Math.round(r.data.byteLength / 1024) };
});
const register = ['Flat,Carpet area (sq ft),Name,Mobile,Relation', ...(await many(`SELECT f.id, f.area, u.name, u.phone, u.relation FROM flats f
  JOIN users u ON u.flat_id = f.id ORDER BY f.id, u.id`)).map((x) => [x.id, x.area, x.name, x.phone, x.relation].join(','))].join('\n');
await job('register preview (all residents)', async () => {
  const r = await call(null, accounts, '/api/desk/register/preview', { method: 'POST', body: { filename: 'register.csv', data: Buffer.from(register).toString('base64') } });
  return { status: r.status, rows: r.data?.rows, error: r.data?.error };
});
await job('admin audit log', async () => ({ status: (await call(null, S.staff.admin[0], '/api/admin/audit')).status }));
await job('admin messages', async () => ({ status: (await call(null, S.staff.admin[0], '/api/admin/messages')).status }));

// ---- Verdict ------------------------------------------------------------------------------
const peak = results.rates.find((s) => s.rate === TARGETS.targetRate);
const fail = (cond, msg) => cond && results.failures.push(msg);
if (peak) {
  fail(peak.p95 > TARGETS.interactiveP95, `p95 ${peak.p95} ms at ${peak.rate} requests a second (target ${TARGETS.interactiveP95} ms)`);
  fail(peak.errorRate > TARGETS.interactiveErrors, `error rate ${(peak.errorRate * 100).toFixed(2)}% at ${peak.rate} requests a second`);
}
for (const s of results.steps) fail(s.errorRate > TARGETS.interactiveErrors, `error rate ${(s.errorRate * 100).toFixed(2)}% with ${s.vus} users at capacity`);
const J = results.jobs;
fail(J['committee report'].ms > TARGETS.reportMs, `committee report ${J['committee report'].ms} ms`);
fail(J['committee report ×5 at once'].statuses.some((s) => s !== 200), 'committee report failed under concurrency');
fail(!J['bill run: approve and issue'] || J['bill run: approve and issue'].status !== 200, 'bill run did not issue');
fail(J['bill run: approve and issue']?.ms > TARGETS.billRunMs, `bill run ${J['bill run: approve and issue']?.ms} ms`);
const alert = J['visitor alert wait after bill run'];
fail(alert && (!alert.handled || alert.ms > TARGETS.alertWaitMs), `visitor alert waited ${alert?.handled ? alert.ms + ' ms' : 'over 60 s'} behind ${alert?.queuedAhead} bill alerts`);
const bank = Object.entries(J).find(([k]) => k.startsWith('bank statement'))[1];
fail(bank.status !== 200 || bank.ms > TARGETS.bankImportMs, `bank statement ${bank.ms} ms (status ${bank.status})`);
for (const [k, v] of Object.entries(J)) fail(v.status && v.status !== 200, `${k} returned ${v.status}`);

fs.writeFileSync('tmp/load-report.json', JSON.stringify(results, null, 2));
console.log(results.failures.length ? `\nMISSED TARGETS:\n  ${results.failures.join('\n  ')}` : '\nAll targets met.');
stop();
await pool.end();
process.exit(results.failures.length ? 1 : 0);
