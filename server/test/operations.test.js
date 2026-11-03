import { ACCOUNTS, closePool } from './setup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

const { createApp } = await import('../app.js');
const { testOtps } = await import('../lib/auth.js');
const { one, q } = await import('../db.js');
const { rupeesInWords } = await import('../lib/receiptPdf.js');
const { addDays, today } = await import('../lib/util.js');

let server, base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { server.close(); await closePool(); });
async function call(path, { token, body, method } = {}) {
  const res = await fetch(base + path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const tokens = {};
async function login(who) {
  if (tokens[who]) return tokens[who];
  await call('/auth/otp', { body: { phone: ACCOUNTS[who] } });
  const r = await call('/auth/verify', { body: { phone: ACCOUNTS[who], code: testOtps.get(ACCOUNTS[who]) } });
  return (tokens[who] = r.body.token);
}
const csvUpload = (text, filename = 'register.csv') => ({ filename, data: Buffer.from(text).toString('base64') });

test('register import: preview shows problems, nothing changes until committed', async () => {
  const token = await login('accounts');
  const csv = [
    'Flat,Carpet area (sq ft),Name,Mobile,Relation,Opening balance,UPI ID',
    'T29-0101,1150,Ravi Kulkarni,98765 43210,Owner,"4,500",ravi.k@oksbi',
    'T29-0101,,Smita Kulkarni,9876543211,Spouse,,',
    'T29-0102,980,Imran Shaikh,9876543212,tenant,-1200,',
    'T29-0103,abc,No Area,9876543213,,,',
    'XYZ,1000,Bad Flat,9876543214,,,',
    'T29-0104,1000,Dup Phone,9822010003,,,',
  ].join('\n');
  const p = await call('/desk/register/preview', { token, body: csvUpload(csv) });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const msgs = p.body.errors.map((e) => e.message).join(' | ');
  assert.match(msgs, /Area .* looks wrong|abc/);
  assert.match(msgs, /"XYZ" is not in the form/);
  assert.match(msgs, /already registered to T21-1601/);
  assert.equal(await one("SELECT 1 FROM flats WHERE id = 'T29-0101'"), null, 'preview changed nothing');
  const blocked = await call('/desk/register/commit', { token, body: { ...csvUpload(csv), balanceDate: '2026-10-31' } });
  assert.equal(blocked.status, 400, 'cannot commit a file with problems');
  const good = csv.split('\n').slice(0, 4).join('\n');
  const ok = await call('/desk/register/commit', { token, body: { ...csvUpload(good), balanceDate: '2026-10-31' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.flatsNew, ok.body.residentsNew, ok.body.balances], [2, 3, 2]);
  assert.equal((await one("SELECT relation FROM users WHERE phone = '9876543211'")).relation, 'family');
  assert.equal((await one("SELECT relation FROM users WHERE phone = '9876543212'")).relation, 'tenant');
  assert.equal((await one("SELECT debit FROM ledger WHERE flat_id = 'T29-0101' AND kind = 'opening'")).debit, 4500);
  assert.equal((await one("SELECT credit FROM ledger WHERE flat_id = 'T29-0102' AND kind = 'opening'")).credit, 1200);
  assert.ok(await one("SELECT 1 FROM upi_handles WHERE vpa = 'ravi.k@oksbi' AND flat_id = 'T29-0101'"));
  const again = await call('/desk/register/preview', { token, body: csvUpload(good) });
  assert.match(again.body.errors.map((e) => e.message).join(' '), /already has transactions/, 'opening balances cannot be loaded twice');
});

test('register import reads Excel files and the template downloads', async () => {
  const token = await login('accounts');
  const tpl = await call('/desk/register/template', { token });
  assert.equal(tpl.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.body);
  const ws = wb.worksheets[0];
  ws.addRow(['T29-0201', 1380, 'Anita Rao', '9876500001', 'owner', 0, '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const p = await call('/desk/register/preview', { token, body: { filename: 'register.xlsx', data: buf.toString('base64') } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.errors.length, 0);
  assert.equal(p.body.summary.flatsNew, 1);
});

test('Tally export: journals for charges, receipts for payments, overlap needs confirming', async () => {
  const token = await login('accounts');
  const res = await call('/desk/tally/export', { token, body: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(res.status, 200);
  const xml = res.body.toString();
  assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Journal" ACTION="Create">/);
  assert.match(xml, /<VOUCHER VCHTYPE="Receipt" ACTION="Create">/);
  assert.match(xml, /<LEDGER NAME="T21-1601 Aamir Shaikh" ACTION="Create">/);
  assert.match(xml, /<VOUCHERNUMBER>RCT\/2026-27\/\d{5}<\/VOUCHERNUMBER>/);
  // Every voucher balances: debits equal credits.
  for (const v of xml.split('<VOUCHER ').slice(1)) {
    const amounts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
    assert.equal(amounts.reduce((a, b) => a + b, 0).toFixed(2), '0.00');
  }
  const again = await call('/desk/tally/export', { token, body: { from: '2026-10-15', to: '2026-11-02' } });
  assert.equal(again.status, 409, 'overlapping export warns');
  const forced = await call('/desk/tally/export', { token, body: { from: '2026-10-15', to: '2026-11-02', format: 'csv', confirmOverlap: true } });
  assert.equal(forced.status, 200);
  assert.match(forced.body.toString(), /^Date,Voucher type,Number,Flat,Ledger,Debit,Credit,Narration/);
});

test('PDF receipt with the amount in words', async () => {
  assert.equal(rupeesInWords(5660), 'Rupees Five Thousand Six Hundred Sixty only');
  assert.equal(rupeesInWords(1234567), 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven only');
  const token = await login('aamir');
  const p = await one("SELECT id FROM payments WHERE flat_id = 'T21-1601' ORDER BY id DESC LIMIT 1");
  const pdf = await call(`/receipts/${p.id}/pdf`, { token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  const other = await one("SELECT id FROM payments WHERE flat_id <> 'T21-1601' LIMIT 1");
  assert.equal((await call(`/receipts/${other.id}/pdf`, { token })).status, 404, 'another flat’s receipt is hidden');
});

test('amenity booking: fee charged, capacity and weekly limits, refund on time', async () => {
  const aamir = await login('aamir');
  const swati = await login('swati');
  const hall = await one("SELECT * FROM amenities WHERE name = 'Clubhouse hall'");
  const day = addDays(today(), 5);
  const avail = await call(`/amenities/${hall.id}/availability?date=${day}`, { token: aamir });
  assert.equal(avail.body.slots.length, 3, '10:00–22:00 in 4-hour slots');
  const before = (await call('/home', { token: aamir })).body.dues.totalDue;
  const b = await call('/bookings', { token: aamir, body: { amenityId: hall.id, date: day, start: '18:00', slots: 1 } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.fee, 2000);
  assert.equal((await call('/home', { token: aamir })).body.dues.totalDue, before + 2000, 'fee added to dues');
  assert.equal((await call('/bookings', { token: swati, body: { amenityId: hall.id, date: day, start: '18:00', slots: 1 } })).status, 409, 'slot is full');
  assert.equal((await call('/bookings', { token: aamir, body: { amenityId: hall.id, date: day, start: '10:00', slots: 1 } })).status, 409, 'one hall booking a week');
  assert.equal((await call('/bookings', { token: aamir, body: { amenityId: hall.id, date: addDays(today(), 40), start: '10:00' } })).status, 400, 'beyond advance window');
  const c = await call(`/bookings/${b.body.id}/cancel`, { token: aamir, body: {} });
  assert.equal(c.body.refunded, true, 'cancelled 5 days ahead: refunded');
  assert.equal((await call('/home', { token: aamir })).body.dues.totalDue, before);
});

test('closing an amenity for a day cancels and refunds its bookings', async () => {
  const swati = await login('swati');
  const admin = await login('admin');
  const tennis = await one("SELECT * FROM amenities WHERE name = 'Tennis court'");
  const day = addDays(today(), 3);
  const b = await call('/bookings', { token: swati, body: { amenityId: tennis.id, date: day, start: '07:00', slots: 2 } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.fee, 300);
  const close = await call(`/admin/amenities/${tennis.id}/blackouts`, { token: admin, body: { date: day, reason: 'Resurfacing' } });
  assert.equal(close.body.cancelled, 1);
  assert.equal((await one('SELECT status, refunded FROM bookings WHERE id = $1', [b.body.id])).refunded, true);
  assert.equal((await call('/bookings', { token: swati, body: { amenityId: tennis.id, date: day, start: '09:00' } })).status, 409, 'closed day cannot be booked');
  assert.ok(await one("SELECT 1 FROM messages WHERE body LIKE 'Tennis court is closed%'"));
});
