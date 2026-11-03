// Test and local-development fixtures. Never loaded by the application.
// Rebuilds the schema and fills it with a township that exercises every
// case: the brief's three sample flats, payment habits, complaints, linked
// lift reports, a safety escalation, visitors and a bank statement.
import { q, one, many, pool, migrate } from '../db.js';
import { raiseBills, recordPayment, flatStatus } from '../lib/billing.js';
import { createComplaint, logEvent } from '../lib/complaints.js';
import { setSetting, clearSettingsCache } from '../lib/settings.js';
import { hashPin, createDevice, pairDevice } from '../lib/auth.js';
import { today, addDays } from '../lib/util.js';

export const ACCOUNTS = {
  aamir: '9822010003', swati: '9822010002', neeraj: '9822010001',
  helpdesk: '9000000001', accounts: '9000000004', committee: '9000000002', admin: '9000000005', guard: '9000000003',
};
export const GUARD_PIN = '2468';

export async function loadFixtures() {
  await q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  clearSettingsCache();
  await setSetting('societyName', 'Company A Township, Pune', 'fixtures');
  await setSetting('bankDetails', { accountName: 'Company A Township Residents Federation', accountNumber: '50200012345678', ifsc: 'HDFC0001234', upiId: 'companyatownship@hdfcbank' }, 'fixtures');

  const T = today();
  const sys = { name: 'fixtures' };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];

  const SAMPLE = [
    { flat: 'T07-1203', name: 'Neeraj Kulkarni', relation: 'owner', area: 1150, phone: ACCOUNTS.neeraj, vpa: 'neeraj.kulkarni@oksbi' },
    { flat: 'T12-0408', name: 'Swati Joshi', relation: 'tenant', area: 980, phone: ACCOUNTS.swati, vpa: null },
    { flat: 'T21-1601', name: 'Aamir Shaikh', relation: 'owner', area: 1640, phone: ACCOUNTS.aamir, vpa: 'aamir.shaikh@okicici' },
  ];
  const FIRST = ['Rohan', 'Priya', 'Sanjay', 'Meera', 'Vikram', 'Anjali', 'Rahul', 'Kavita', 'Suresh', 'Neha', 'Amit', 'Pooja', 'Ajay', 'Sneha', 'Nitin', 'Deepa', 'Kiran', 'Asha', 'Manoj', 'Shruti', 'Vivek', 'Gauri', 'Harish', 'Leena', 'Farhan', 'Zoya', 'Arjun', 'Ritu'];
  const LAST = ['Deshpande', 'Patil', 'Mehta', 'Gokhale', 'Bhosale', 'Iyer', 'Pawar', 'Kale', 'Sathe', 'Chavan', 'Naik', 'Rao', 'Jadhav', 'Bapat', 'Khan', 'Shinde', 'Apte', 'Mane', 'Ranade', 'Gupta', 'Dixit', 'Kamble', 'Wagh', 'Phadke'];
  const AREAS = [650, 980, 980, 1150, 1150, 1380, 1640];
  const BANKS = ['oksbi', 'okhdfcbank', 'okicici', 'ybl', 'paytm', 'okaxis'];
  const addUser = (name, phone, role, flatId = null, relation = null, pinHash = null) =>
    one('INSERT INTO users (name, phone, role, flat_id, relation, pin_hash, consent_at) VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING *', [name, phone, role, flatId, relation, pinHash]);

  const flats = [];
  for (const s of SAMPLE) {
    await q('INSERT INTO flats (id, tower, area) VALUES ($1, $2, $3)', [s.flat, s.flat.slice(0, 3), s.area]);
    await addUser(s.name, s.phone, 'resident', s.flat, s.relation);
    if (s.vpa) await q('INSERT INTO upi_handles (vpa, flat_id) VALUES ($1, $2)', [s.vpa, s.flat]);
    flats.push({ id: s.flat, area: s.area, sample: s });
  }
  await addUser('Mohan Deshmukh', '9822010012', 'resident', 'T12-0408', 'owner');
  await addUser('Sana Shaikh', '9822010013', 'resident', 'T21-1601', 'family');
  await addUser('Asha Kulkarni', '9822010011', 'resident', 'T07-1203', 'family');

  let n = 0;
  for (let t = 1; t <= 28; t++) {
    for (let k = 0; k < 2; k++) {
      const floor = 1 + Math.floor(rand() * 18);
      const id = `T${String(t).padStart(2, '0')}-${String(floor).padStart(2, '0')}0${1 + Math.floor(rand() * 8)}`;
      if (flats.some((f) => f.id === id)) continue;
      const area = pickOne(AREAS);
      const name = `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`;
      await q('INSERT INTO flats (id, tower, area) VALUES ($1, $2, $3)', [id, id.slice(0, 3), area]);
      await addUser(name, `98500${String(10000 + n).slice(-5)}`, 'resident', id, rand() < 0.2 ? 'tenant' : 'owner');
      const vpa = rand() < 0.6 ? `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase().slice(0, 4)}${n}@${pickOne(BANKS)}` : null;
      if (vpa) await q('INSERT INTO upi_handles (vpa, flat_id) VALUES ($1, $2)', [vpa, id]);
      flats.push({ id, area, name, vpa });
      n++;
    }
  }
  await addUser('Priya Patil', ACCOUNTS.helpdesk, 'helpdesk');
  await addUser('Meena Kulkarni', ACCOUNTS.accounts, 'accounts');
  await addUser('Rajan Gokhale', ACCOUNTS.committee, 'committee');
  const admin = await addUser('Office Admin', ACCOUNTS.admin, 'admin');
  await addUser('Ramesh Pawar', ACCOUNTS.guard, 'guard', null, null, await hashPin(GUARD_PIN));
  for (const s of [
    ['Sunil More', '9000000101', 'Plumbing', 'T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,T11,T12,T13,T14'],
    ['Ganesh Kadam', '9000000102', 'Plumbing', 'T15,T16,T17,T18,T19,T20,T21,T22,T23,T24,T25,T26,T27,T28'],
    ['Imran Sayyed', '9000000103', 'Electrical', ''], ['Prakash Jagtap', '9000000104', 'Electrical', ''],
    ['Lift AMC desk', '9000000105', 'Lift', ''], ['Vijay Salunkhe', '9000000106', 'Security', ''],
    ['Lata Gaikwad', '9000000107', 'Housekeeping', ''], ['Mahesh Thorat', '9000000108', 'Civil', ''],
    ['Pest control vendor', '9000000109', 'Pest control', ''], ['Help desk', '9000000001', 'Parking', ''],
    ['Help desk', '9000000001', 'Noise', ''], ['Anil Sawant', '9000000110', 'Common areas', ''],
    ['Help desk', '9000000001', 'Other', ''], ['Kedar Joshi', '9000000099', 'duty_manager', ''],
  ]) await q('INSERT INTO staff (name, phone, skill, towers) VALUES ($1, $2, $3, $4)', s);

  // ---- Bills and payments, four months ---------------------------------------
  const habit = new Map(flats.filter((f) => !f.sample && !f.lateJoiner).map((f) => {
    const r = rand();
    return [f.id, r < 0.62 ? 'early' : r < 0.78 ? 'late' : r < 0.86 ? 'partial' : r < 0.94 ? 'stopped' : 'chronic'];
  }));
  for (const f of flats.filter((x) => !x.sample && !x.lateJoiner).slice(20, 22)) habit.set(f.id, 'chronic');
  const year = Number(T.slice(0, 4)), month = Number(T.slice(5, 7));
  const periods = [4, 3, 2, 1].map((back) => {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    return d.toISOString().slice(0, 7);
  });
  const lastP = periods.at(-1), prevP = periods.at(-2);
  const pay = (flatId, amount, date, f) => recordPayment({
    flatId, amount, paidOn: date, method: 'bank', postedBy: 'auto-match',
    reference: f?.vpa ? `UPI ${f.vpa}` : 'NEFT', utr: String(400000000000 + Math.floor(rand() * 99999999999)),
  }, sys);

  for (const p of periods) {
    if (p === lastP) {
      // Two flats handed over recently: they only have the latest bill.
      for (const [id, name] of [['T07-0902', 'Kavya Ranade'], ['T07-0405', 'Om Bapat']]) {
        await q('INSERT INTO flats (id, tower, area) VALUES ($1, $2, $3)', [id, 'T07', id === 'T07-0902' ? 980 : 1150]);
        await addUser(name, id === 'T07-0902' ? '9850099901' : '9850099902', 'resident', id, 'owner');
        flats.push({ id, area: id === 'T07-0902' ? 980 : 1150, name, lateJoiner: true });
      }
    }
    await raiseBills(p, sys);
    // The brief's flats are pinned to its "days overdue" figures.
    if (p === prevP) await q("UPDATE bills SET due_on = $1 WHERE flat_id = 'T12-0408' AND period = $2", [addDays(T, -47), p]);
    if (p === lastP) await q("UPDATE bills SET due_on = $1 WHERE flat_id = 'T21-1601' AND period = $2", [addDays(T, -18), p]);
    const pays = [];
    const day = (d) => `${p}-${String(d).padStart(2, '0')}`;
    for (const f of flats) {
      const bill = Math.round(f.area * 6.5);
      if (f.sample) {
        if (f.id === 'T07-1203') pays.push([f.id, bill, day(3 + Math.floor(rand() * 5)), f]);
        if (f.id === 'T12-0408' && p < prevP) pays.push([f.id, bill, day(8), f]);
        if (f.id === 'T21-1601') pays.push([f.id, p === lastP ? 5000 : bill, p === lastP ? addDays(T, -20) : day(6), f]);
        continue;
      }
      if (f.lateJoiner) { if (p === lastP) pays.push([f.id, bill, day(5), f]); continue; }
      const hb = habit.get(f.id);
      if (hb === 'early') pays.push([f.id, bill, day(1 + Math.floor(rand() * 9)), f]);
      else if (hb === 'late') { if (p !== lastP || rand() < 0.4) pays.push([f.id, bill, day(14 + Math.floor(rand() * 14)), f]); }
      else if (hb === 'partial') pays.push([f.id, Math.round(bill / 2 / 100) * 100, day(5 + Math.floor(rand() * 5)), f]);
      else if (hb === 'stopped') { if (p < prevP) pays.push([f.id, bill, day(6), f]); }
    }
    for (const x of pays.sort((a, b) => a[2].localeCompare(b[2])).filter((x) => x[2] < T)) await pay(...x);
  }

  // ---- Complaints -------------------------------------------------------------------
  const residentOf = (flat) => one("SELECT * FROM users WHERE flat_id = $1 AND relation <> 'family' ORDER BY id LIMIT 1", [flat]);
  const hoursAgo = (hrs) => new Date(Date.now() - hrs * 3600000);
  const later = (d, mins) => new Date(d.getTime() + mins * 60000);
  async function complaint(flat, text, o) {
    const u = await residentOf(flat);
    const at = hoursAgo(o.ago);
    const id = await createComplaint({ flatId: flat, userId: u.id, actor: u.name, text, at });
    if (o.respond != null) {
      await q("UPDATE complaints SET first_response_at = $2, status = 'in_progress' WHERE id = $1", [id, later(at, o.respond)]);
      await logEvent(id, 'Help desk', 'status', 'Work started', later(at, o.respond));
    }
    if (o.reopen) {
      await logEvent(id, 'Help desk', 'status', 'Marked resolved', later(at, o.respond + 240));
      await logEvent(id, u.name, 'reopened', 'Still not fixed', later(at, o.respond + 540));
      await q('UPDATE complaints SET reopen_count = 1 WHERE id = $1', [id]);
    }
    if (o.resolve != null) {
      await q("UPDATE complaints SET resolved_at = $2, status = 'resolved' WHERE id = $1", [id, later(at, o.resolve)]);
      await logEvent(id, 'Help desk', 'status', 'Marked resolved', later(at, o.resolve));
    }
    if (o.close != null) {
      await q("UPDATE complaints SET closed_at = $2, status = 'closed', rating = $3, feedback = $4 WHERE id = $1", [id, later(at, o.close), o.rating, o.feedback || null]);
      await logEvent(id, u.name, 'rated', `Closed with ${o.rating}★`, later(at, o.close));
    }
    return id;
  }
  const gen = flats.filter((f) => !f.sample && !f.lateJoiner).map((f) => f.id);
  const history = ['Kitchen sink drain is blocked, water not going down', 'Bathroom tap leaking continuously since yesterday',
    'Corridor light on 9th floor not working', 'MCB keeps tripping in bedroom', 'Garbage not collected from our floor for two days',
    'Someone parked in my slot again, car number MH12 AB 1234', 'Cockroaches in the duct area, need pest control',
    'Seepage on bedroom wall after rain', 'Loud music from flat above after 11 pm', 'Gym treadmill is broken',
    'Geyser not heating water', 'Stair lights in wing B flickering'];
  for (let i = 0; i < 22; i++) {
    const respond = 20 + Math.floor(rand() * 300);
    const resolve = respond + 120 + Math.floor(rand() * 1800);
    const reopen = i % 6 === 0;
    await complaint(gen[(i * 5) % gen.length], history[i % history.length], {
      ago: 30 + Math.floor(rand() * 26 * 24), respond, resolve: resolve + (reopen ? 900 : 0),
      close: resolve + 600 + (reopen ? 900 : 0), rating: reopen ? 3 : [5, 4, 5, 4, 3, 5][i % 6], reopen,
    });
  }
  await complaint(gen[3], 'Smell of gas near the meter room on ground floor', { ago: 200, respond: 6, resolve: 90, close: 400, rating: 5, feedback: 'Very quick response' });
  await complaint(gen[8], 'Water leakage from ceiling in the master bathroom', { ago: 50, respond: 45 });
  await complaint(gen[11], 'Main door lock is jammed, please send carpenter', { ago: 30, respond: 600, resolve: 900 });
  await complaint('T12-0408', 'Water leak under the kitchen sink, cabinet is getting damaged', { ago: 26 });
  const t07 = gen.find((f) => f.startsWith('T07')) || 'T07-0902';
  await complaint(t07, 'Lift in tower 7 is not working, stuck at 4th floor with doors closed', { ago: 1.5 });
  await complaint('T07-0902', 'Tower 7 lift not working since morning', { ago: 1.2 });
  await complaint('T07-0405', 'lift band hai T7, elderly parents cannot climb', { ago: 1 });
  await complaint('T07-1203', 'The lift is not working again in our tower', { ago: 0.6 });
  await complaint('T21-1601', 'Request to repaint the parking lane markings near B wing', { ago: 70, respond: 300 });

  // ---- Visitors, guest code, notices, gate tablet -------------------------------------
  const v = (flat, name, purpose, gate, status, hrs, by) => q(`INSERT INTO visitors (flat_id, name, purpose, gate, status, created_at, decided_at, decided_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [flat, name, purpose, gate, status, hoursAgo(hrs), by ? hoursAgo(hrs) : null, by]);
  await v('T07-1203', 'Amazon delivery', 'Delivery', 'Gate 1', 'left', 5, 'Neeraj Kulkarni');
  await v('T07-1203', 'Sunita (house help)', 'Daily help', 'Gate 2', 'inside', 3, 'Guest code');
  await v('T12-0408', 'Rakesh, plumber', 'Service', 'Gate 1', 'waiting', 0, null);
  await v('T21-1601', 'Swiggy delivery', 'Delivery', 'Gate 3', 'approved', 1, 'Aamir Shaikh');
  await q("INSERT INTO guest_codes (code, flat_id, guest_name, valid_on) VALUES ('482915', 'T21-1601', 'Farah Shaikh', $1)", [T]);
  for (const [title, body, back] of [
    ['Water tank cleaning, Tower 1–14', 'Water supply will be off from 10 am to 2 pm on Saturday. Please store water.', 1],
    ['Annual general meeting', 'The AGM is on 23 November at the clubhouse, 6 pm. Agenda has been emailed to members.', 3],
  ]) await q('INSERT INTO notices (title, body, posted_on, posted_by) VALUES ($1, $2, $3, $4)', [title, body, addDays(T, -back), admin.id]);
  for (const a of [
    ['Clubhouse hall', 'Party hall for 80 guests', '10:00', '22:00', 240, 1, 2000, 1, 1, 30, 48, 'No loud music after 10 pm. Leave the hall clean; damages are charged.'],
    ['Badminton courts', 'Two indoor courts', '06:00', '22:00', 60, 2, 0, 2, 4, 7, 2, 'Non-marking shoes only.'],
    ['Tennis court', 'Floodlit synthetic court', '06:00', '21:00', 60, 1, 150, 2, 3, 7, 12, 'Lights on after 6:30 pm.'],
  ]) {
    await q(`INSERT INTO amenities (name, description, open_time, close_time, slot_minutes, capacity, fee, max_slots_per_booking, max_bookings_per_week, advance_days, cancel_hours, rules)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, a);
  }
  const device = await createDevice({ name: 'Gate 1 tablet', gate: 'Gate 1' }, admin);
  const { deviceToken } = await pairDevice(device.pairingCode, '127.0.0.1');

  // ---- Bank statement --------------------------------------------------------------------
  const owing = [];
  for (const id of gen) {
    const st = await flatStatus(id);
    if (st.totalDue > 0) owing.push({ id, ...st, f: flats.find((x) => x.id === id) });
  }
  const withVpa = owing.filter((s) => s.f.vpa);
  const noVpa = owing.filter((s) => !s.f.vpa);
  const d = (k) => { const [y, m, dd] = addDays(T, -k).split('-'); return `${dd}/${m}/${y}`; };
  let utr = 431100000000;
  const u = () => String(utr += 7919);
  const nm = (s) => s.f.name.toUpperCase();
  const gw = withVpa[5];
  const gwUtr = u();
  await recordPayment({ flatId: gw.id, amount: gw.totalDue, paidOn: addDays(T, -1), method: 'gateway', reference: 'UPI via Razorpay',
    utr: gwUtr, gatewayOrderId: 'order_fixture', gatewayPaymentId: 'pay_fixture', postedBy: gw.f.name }, sys);
  const rows = [
    [d(4), `UPI/CR/${u()}/AAMIR SHAIKH/aamir.shaikh@okicici/T21-1601 balance`, '', '', '5660'],
    [d(3), `NEFT CR-HDFC0001234-${nm(noVpa[0])}-${noVpa[0].id} MAINT`, `N30726${u().slice(-8)}`, '', String(noVpa[0].totalDue)],
    [d(3), `UPI/CR/${u()}/${nm(withVpa[0])}/${withVpa[0].f.vpa}/Maintenance`, '', '', String(withVpa[0].totalDue)],
    [d(3), `UPI/CR/${u()}/${nm(withVpa[1])}/${withVpa[1].f.vpa}/Payment`, '', '', String(withVpa[1].bills.find((b) => b.unpaid > 0).amount)],
    [d(2), `IMPS/P2A/${u()}/SWATI J/HDFC/flat T12 0408 sep`, '', '', '6370'],
    [d(2), `IMPS/P2A/${u()}/MR S JOSHI/HDFC/maint`, '', '', '6370'],
    [d(2), `UPI/CR/${u()}/${nm(withVpa[2])}/${withVpa[2].f.vpa}/${withVpa[3].id} maintenance`, '', '', String(withVpa[2].totalDue)],
    [d(1), `UPI/CR/${u()}/RAHUL/rahul99@ybl/rent nov`, '', '', '15000'],
    [d(1), `NEFT CR-SBIN0004567-${nm(noVpa[1])}-TOWER ${Number(noVpa[1].id.slice(1, 3))} FLAT ${Number(noVpa[1].id.slice(4))}`, `N30727${u().slice(-8)}`, '', String(noVpa[1].totalDue)],
    [d(1), 'NEFT DR-MSEDCL PUNE-COMMON AREA ELECTRICITY OCT', `N30727${u().slice(-8)}`, '184520', ''],
    [d(0), `UPI/CR/${u()}/${nm(withVpa[4])}/${withVpa[4].f.vpa}/advance 3 months`, '', '', String(withVpa[4].bills[0].amount * 12)],
    [d(0), `UPI/CR/${gwUtr}/${nm(gw)}/${gw.f.vpa}/${gw.id}`, '', '', String(gw.totalDue)],
    [d(0), `NEFT CR-RAZORPAY SOFTWARE PVT LTD-SETL${u().slice(-8)}`, `N30728${u().slice(-8)}`, '', '48210'],
  ];
  rows.push(rows[0].slice());
  let bal = 4826310;
  const bankCsv = ['Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    ...rows.map((r) => { bal += (+r[4] || 0) - (+r[3] || 0); return [r[0], `"${r[1]}"`, r[2], r[3], r[4], bal].join(','); })].join('\n') + '\n';
  return { bankCsv, deviceToken, gatewayFlat: gw.id };
}

export const closePool = () => pool.end();
