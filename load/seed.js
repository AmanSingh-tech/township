// Builds a full-size township in a local database for load testing:
// 2,400 flats in 28 towers, ~4,200 residents, a year of bills and payments,
// complaints, 90 days of gate entries and message history. It also writes
// session tokens for the load run to tmp/load-sessions.json.
//
//   DATABASE_URL=postgres://township:township@localhost:5440/township_load node load/seed.js
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../server/env.js';

if (env.NODE_ENV === 'production' || !/@(localhost|127\.0\.0\.1)[:/].*_load$/.test(env.DATABASE_URL)) {
  console.error('The load seed only runs against a local database whose name ends in _load.');
  process.exit(1);
}
const { q, one, many, val, pool, migrate } = await import('../server/db.js');
const { raiseBills } = await import('../server/lib/billing.js');
const { setSetting, clearSettingsCache } = await import('../server/lib/settings.js');
const { hashPin, createDevice, pairDevice } = await import('../server/lib/auth.js');
const { today, addDays, financialYear } = await import('../server/lib/util.js');

const T = today();
const sys = { name: 'load-seed' };
const t0 = Date.now();
const step = (msg) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

await q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await migrate();
clearSettingsCache();
await setSetting('societyName', 'Load test township', 'load-seed');
await setSetting('bankDetails', { accountName: 'Township Residents Federation', accountNumber: '50200012345678', ifsc: 'HDFC0001234', upiId: 'township@hdfcbank' }, 'load-seed');

// ---- Flats and people ----------------------------------------------------------------
// 28 towers × 21 floors × 4 flats, plus a 22nd floor in towers 1–12: 2,400 flats.
await q(`INSERT INTO flats (id, tower, area)
  SELECT format('T%s-%s%s', lpad(t::text, 2, '0'), lpad(fl::text, 2, '0'), lpad(u::text, 2, '0')), 'T' || lpad(t::text, 2, '0'),
    (ARRAY[650, 980, 980, 1150, 1150, 1380, 1640])[1 + (t * 31 + fl * 7 + u) % 7]
  FROM generate_series(1, 28) t, generate_series(1, 22) fl, generate_series(1, 4) u
  WHERE fl <= 21 OR t <= 12`);
const NAMES = `ARRAY['Rohan','Priya','Sanjay','Meera','Vikram','Anjali','Rahul','Kavita','Suresh','Neha','Amit','Pooja','Ajay','Sneha',
  'Nitin','Deepa','Kiran','Asha','Manoj','Shruti','Vivek','Gauri','Harish','Leena','Farhan','Zoya','Arjun','Ritu']`;
const LAST = `ARRAY['Deshpande','Patil','Mehta','Gokhale','Bhosale','Iyer','Pawar','Kale','Sathe','Chavan','Naik','Rao','Jadhav','Bapat',
  'Khan','Shinde','Apte','Mane','Ranade','Gupta','Dixit','Kamble','Wagh','Phadke']`;
const people = (relation, base, filter) => q(`WITH f AS (SELECT id, row_number() OVER (ORDER BY id) n FROM flats)
  INSERT INTO users (name, phone, role, flat_id, relation, consent_at)
  SELECT (${NAMES})[1 + (n * ${base % 7 + 3}) % 28] || ' ' || (${LAST})[1 + (n * 7) % 24], (${base} + n)::text, 'resident', id, '${relation}', now()
  FROM f WHERE ${filter}`);
await people('owner', 7000000000, 'true');
await people('tenant', 7100000000, 'n % 4 = 0');
await people('family', 7200000000, 'n % 2 = 0');
await q(`INSERT INTO upi_handles (vpa, flat_id)
  SELECT lower(split_part(name, ' ', 1)) || '.' || lower(left(split_part(name, ' ', 2), 4)) || id || '@' || (ARRAY['oksbi','okhdfcbank','okicici','ybl','paytm','okaxis'])[1 + id % 6], flat_id
  FROM users WHERE relation = 'owner' AND id % 5 < 3`);

const staff = [
  ['helpdesk', 3], ['accounts', 2], ['committee', 3], ['admin', 1], ['guard', 12],
];
const pin = await hashPin('2468');
let sn = 0;
for (const [role, count] of staff) {
  for (let i = 0; i < count; i++) {
    sn++;
    await q('INSERT INTO users (name, phone, role, pin_hash, consent_at) VALUES ($1, $2, $3, $4, now())',
      [`${role} ${i + 1}`, String(9000000000 + sn), role, role === 'guard' ? pin : null]);
  }
}
for (const [skill, n] of [['Plumbing', 4], ['Electrical', 3], ['Lift', 1], ['Security', 2], ['Housekeeping', 3], ['Civil', 2],
  ['Pest control', 1], ['Parking', 1], ['Noise', 1], ['Common areas', 2], ['Other', 1], ['duty_manager', 1]]) {
  for (let i = 0; i < n; i++) await q('INSERT INTO staff (name, phone, skill) VALUES ($1, $2, $3)', [`${skill} ${i + 1}`, String(9100000000 + ++sn), skill]);
}
step(`${await val('SELECT COUNT(*) FROM flats')} flats, ${await val("SELECT COUNT(*) FROM users WHERE role = 'resident'")} residents`);

// ---- A year of bills and payments --------------------------------------------------------
// Payment habit per flat: 62% pay early, 16% late, 8% half, 8% stopped three months ago, 6% never.
const flats = (await many('SELECT id, area, row_number() OVER (ORDER BY id) n FROM flats')).map((f) => {
  const h = (Number(f.n) * 2654435761) % 100;
  return { ...f, habit: h < 62 ? 'early' : h < 78 ? 'late' : h < 86 ? 'partial' : h < 94 ? 'stopped' : 'chronic' };
});
const [y, m] = T.split('-').map(Number);
const periods = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 13 + i, 1)).toISOString().slice(0, 7));
const counters = new Map();
let utr = 500000000000;
let rnd = 11;
const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
for (const [pi, p] of periods.entries()) {
  const s = Date.now();
  await raiseBills(p, sys);
  const rows = [];
  for (const f of flats) {
    const bill = Math.round(f.area * 6.5);
    const day = (d) => `${p}-${String(d).padStart(2, '0')}`;
    let amount = 0, on = null;
    if (f.habit === 'early') { amount = bill; on = day(1 + Math.floor(rand() * 9)); }
    else if (f.habit === 'late' && rand() < 0.85) { amount = bill; on = day(14 + Math.floor(rand() * 14)); }
    else if (f.habit === 'partial') { amount = Math.round(bill / 200) * 100; on = day(5 + Math.floor(rand() * 5)); }
    else if (f.habit === 'stopped' && pi < 9) { amount = bill; on = day(6); }
    if (!amount || on >= T) continue;
    const fy = financialYear(on);
    counters.set(fy, (counters.get(fy) || 0) + 1);
    rows.push({ flat: f.id, amount, on, utr: String(utr += 7919), receipt: `RCT/${fy}/${String(counters.get(fy)).padStart(5, '0')}` });
  }
  const col = (k) => rows.map((r) => r[k]);
  await q(`WITH p AS (
      INSERT INTO payments (flat_id, amount, paid_on, method, reference, utr, receipt_no, posted_by)
      SELECT f, a, d, 'bank', 'UPI', u, r, 'auto-match' FROM unnest($1::text[], $2::int[], $3::date[], $4::text[], $5::text[]) x(f, a, d, u, r)
      RETURNING id, flat_id, amount, paid_on, utr)
    INSERT INTO ledger (flat_id, on_date, kind, description, credit, payment_id, created_by)
    SELECT flat_id, paid_on, 'payment', 'Bank credit ' || utr, amount, id, 'auto-match' FROM p`,
  [col('flat'), col('amount'), col('on'), col('utr'), col('receipt')]);
  const imp = await one('INSERT INTO bank_imports (filename, uploaded_by) VALUES ($1, $2) RETURNING id', [`statement-${p}.csv`, 'accounts 1']);
  await q(`INSERT INTO bank_rows (import_id, txn_date, narration, utr, amount, status, flat_id, score, payment_id)
    SELECT $1, p.paid_on, 'UPI/CR/' || p.utr || '/' || p.flat_id, p.utr, p.amount, 'posted', p.flat_id, 100, p.id
    FROM payments p WHERE p.paid_on BETWEEN $2::date AND ($2::date + interval '1 month' - interval '1 day')`, [imp.id, `${p}-01`]);
  step(`bills ${p}: bill run ${((Date.now() - s) / 1000).toFixed(1)}s, ${rows.length} payments`);
}
for (const [fy, last] of counters) await q('INSERT INTO receipt_counters (fy, last) VALUES ($1, $2)', [fy, last]);

// ---- Complaints: ~6,000 over the year, the last month busier and partly open ----------------
await q(`INSERT INTO complaints (flat_id, raised_by, text, category, urgency, ai_category, ai_urgency, ai_confidence, ai_source,
    status, assignee_id, created_at, first_response_at, resolved_at, closed_at, rating, due_by)
  SELECT f.id, (SELECT id FROM users u WHERE u.flat_id = f.id AND u.relation = 'owner' LIMIT 1),
    c.text, c.cat, c.urg, c.cat, c.urg, 0.8, 'local',
    CASE WHEN age < interval '2 days' THEN (ARRAY['open','assigned','in_progress'])[1 + g % 3] WHEN age < interval '5 days' THEN 'resolved' ELSE 'closed' END,
    (SELECT id FROM staff s WHERE s.skill = c.cat LIMIT 1),
    now() - age, now() - age + interval '40 minutes',
    CASE WHEN age >= interval '2 days' THEN now() - age + interval '9 hours' END,
    CASE WHEN age >= interval '5 days' THEN now() - age + interval '30 hours' END,
    CASE WHEN age >= interval '5 days' THEN 3 + g % 3 END,
    now() - age + interval '8 hours'
  FROM generate_series(1, 6000) g
  CROSS JOIN LATERAL (SELECT (SELECT id FROM flats ORDER BY id OFFSET (g * 7919) % 2400 LIMIT 1) id) f
  CROSS JOIN LATERAL (SELECT CASE WHEN g % 8 = 0 THEN random() * interval '30 days' ELSE random() * interval '365 days' END age) a
  CROSS JOIN LATERAL (SELECT (ARRAY['Kitchen sink blocked','Bathroom tap leaking','Corridor light not working','MCB tripping',
      'Garbage not collected','Car parked in my slot','Cockroaches in duct','Seepage on wall','Loud music at night','Lift making noise'])[1 + g % 10] text,
    (ARRAY['Plumbing','Plumbing','Electrical','Electrical','Housekeeping','Parking','Pest control','Civil','Noise','Lift'])[1 + g % 10] cat,
    (ARRAY['medium','medium','low','high','low','low','low','medium','low','medium'])[1 + g % 10] urg) c`);
await q(`INSERT INTO complaint_events (complaint_id, at, actor, kind, note)
  SELECT id, created_at, 'resident', 'created', 'Complaint raised' FROM complaints
  UNION ALL SELECT id, first_response_at, 'Help desk', 'status', 'Work started' FROM complaints
  UNION ALL SELECT id, resolved_at, 'Help desk', 'status', 'Marked resolved' FROM complaints WHERE resolved_at IS NOT NULL`);
step(`${await val('SELECT COUNT(*) FROM complaints')} complaints`);

// ---- Gate entries: 90 days at ~1.8 a flat a day, and today's so far --------------------------
await q(`INSERT INTO visitors (flat_id, name, purpose, gate, status, created_at, decided_at, decided_by)
  SELECT f.id, (ARRAY['Amazon delivery','Swiggy','Zomato','House help','Plumber','Guest','Courier','Flipkart'])[1 + g % 8],
    (ARRAY['Delivery','Delivery','Delivery','Daily help','Service','Guest','Delivery','Delivery'])[1 + g % 8],
    'Gate ' || (1 + g % 6), 'left', t, t + interval '1 minute', 'resident'
  FROM generate_series(1, 390000) g
  CROSS JOIN LATERAL (SELECT 'T' || lpad((1 + g % 28)::text, 2, '0') || '-' || lpad((1 + (g / 28) % 21)::text, 2, '0') || lpad((1 + (g / 588) % 4)::text, 2, '0') id) f
  CROSS JOIN LATERAL (SELECT now() - interval '1 day' - random() * interval '89 days' t) x`);
await q(`INSERT INTO visitors (flat_id, name, purpose, gate, status, created_at)
  SELECT 'T' || lpad((1 + g % 28)::text, 2, '0') || '-' || lpad((1 + (g / 28) % 21)::text, 2, '0') || '01', 'Delivery', 'Delivery',
    'Gate ' || (1 + g % 6), (ARRAY['left','inside','approved','left'])[1 + g % 4], date_trunc('day', now()) + random() * (now() - date_trunc('day', now()))
  FROM generate_series(1, 3000) g`);
step(`${await val('SELECT COUNT(*) FROM visitors')} gate entries`);

// ---- History tables that grow with use -------------------------------------------------------
await q(`INSERT INTO messages (at, channel, to_addr, body, status)
  SELECT now() - random() * interval '365 days', 'push', (7000000000 + g % 2400)::text, 'Visitor at the gate', (ARRAY['sent','skipped'])[1 + g % 2]
  FROM generate_series(1, 150000) g`);
await q(`INSERT INTO audit_log (at, user_name, action, entity, entity_id, details)
  SELECT now() - random() * interval '365 days', 'accounts 1', 'payment.recorded', 'payment', g::text, '{}'
  FROM generate_series(1, 100000) g`);
for (const a of [
  ['Clubhouse hall', 'Party hall', '10:00', '22:00', 240, 1, 2000, 1, 1, 30, 48, 'No loud music after 10 pm.'],
  ['Badminton courts', 'Two indoor courts', '06:00', '22:00', 60, 2, 0, 2, 4, 7, 2, 'Non-marking shoes only.'],
  ['Tennis court', 'Floodlit court', '06:00', '21:00', 60, 1, 150, 2, 3, 7, 12, 'Lights on after 6:30 pm.'],
]) {
  await q(`INSERT INTO amenities (name, description, open_time, close_time, slot_minutes, capacity, fee, max_slots_per_booking, max_bookings_per_week, advance_days, cancel_hours, rules)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, a);
}

// ---- Sessions for the load run -------------------------------------------------------------
const admin = await one("SELECT * FROM users WHERE role = 'admin'");
const devices = [];
for (let g = 1; g <= 6; g++) {
  const d = await createDevice({ name: `Gate ${g} tablet`, gate: `Gate ${g}` }, admin);
  const { deviceToken } = await pairDevice(d.pairingCode, '127.0.0.1');
  devices.push({ id: d.id, gate: `Gate ${g}`, deviceToken });
}
const sessions = { residents: [], staff: {}, guards: [] };
const session = async (u, deviceId = null) => {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (token_hash, user_id, device_id, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')`, [sha(token), u.id, deviceId]);
  return token;
};
for (const u of await many("SELECT id, flat_id FROM users WHERE role = 'resident' AND relation <> 'family' ORDER BY random() LIMIT 2000")) {
  sessions.residents.push({ token: await session(u), flatId: u.flat_id });
}
for (const u of await many("SELECT id, role FROM users WHERE role IN ('helpdesk', 'accounts', 'committee', 'admin') ORDER BY id")) {
  (sessions.staff[u.role] ||= []).push(await session(u));
}
for (const [i, u] of (await many("SELECT id FROM users WHERE role = 'guard' ORDER BY id LIMIT 6")).entries()) {
  sessions.guards.push({ token: await session(u, devices[i].id), deviceToken: devices[i].deviceToken, gate: devices[i].gate });
}
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/load-sessions.json', JSON.stringify(sessions));
await q('ANALYZE');
const size = await val('SELECT pg_size_pretty(pg_database_size(current_database()))');
step(`done: ${await val('SELECT COUNT(*) FROM bills')} bills, ${await val('SELECT COUNT(*) FROM ledger')} ledger lines, database ${size}`);
await pool.end();
