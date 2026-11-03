import ExcelJS from 'exceljs';
import { q, one, many, tx } from '../db.js';
import { parseCsv } from './csv.js';
import { audit } from './audit.js';
import { normalizePhone, today, HttpError } from './util.js';

// Imports the society's flat register: one row per person, with the flat's
// area and opening balance on (at least) one of its rows. Columns are found by
// their headings, so an existing Excel sheet usually works as it is.
const COLUMNS = {
  flat: [/^(flat|unit|apartment|flat no|flat number)/i],
  area: [/area|sq\.? ?ft|carpet/i],
  name: [/^(name|member|resident|owner name|full name)/i],
  phone: [/mobile|phone|contact/i],
  relation: [/relation|type|owner.*tenant|occupancy/i],
  balance: [/opening|balance|arrears|outstanding|dues/i],
  upi: [/upi|vpa/i],
};
export const TEMPLATE_HEADERS = ['Flat', 'Carpet area (sq ft)', 'Name', 'Mobile', 'Relation', 'Opening balance', 'UPI ID'];

export function normalizeFlat(raw) {
  const s = String(raw || '').trim().toUpperCase();
  const m = s.match(/^T(?:OWER)?\s*-?\s*(\d{1,2})\s*[-/ ]?\s*(?:FLAT\s*)?(\d{3,4})$/);
  return m ? `T${m[1].padStart(2, '0')}-${m[2].padStart(4, '0')}` : null;
}
const toNumber = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]|Rs\.?|INR/gi, '');
  const neg = /^\(.*\)$/.test(s) || /cr$/i.test(s);
  const n = parseFloat(s.replace(/[()]|cr$|dr$/gi, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};
const cellText = (v) => (v && typeof v === 'object' ? (v.text ?? v.result ?? v.richText?.map((r) => r.text).join('') ?? '') : v ?? '');

export async function readRegister(filename, buffer) {
  let rows;
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch { throw new HttpError(400, 'This Excel file could not be opened. Save it as .xlsx or CSV.'); }
    const ws = wb.worksheets[0];
    rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map(cellText)));
  } else if (/\.csv$/i.test(filename)) {
    rows = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  } else {
    throw new HttpError(400, 'Upload an Excel (.xlsx) or CSV file.');
  }
  const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.flat[0].test(String(c).trim())));
  if (headerAt < 0) throw new HttpError(400, 'Could not find a heading row with a "Flat" column.');
  const headers = rows[headerAt].map((h) => String(h).trim());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, res]) => [k, headers.findIndex((h) => res.some((re) => re.test(h)))]));
  if (col.name < 0 || col.phone < 0) throw new HttpError(400, 'The sheet needs Name and Mobile columns.');
  return rows.slice(headerAt + 1).map((r, i) => ({
    line: headerAt + i + 2,
    flatRaw: String(r[col.flat] ?? '').trim(),
    area: col.area >= 0 ? toNumber(r[col.area]) : null,
    areaRaw: col.area >= 0 ? String(r[col.area] ?? '').trim() : '',
    name: String(r[col.name] ?? '').trim(),
    phone: normalizePhone(r[col.phone]),
    phoneRaw: String(r[col.phone] ?? '').trim(),
    relation: String(r[col.relation] ?? '').trim().toLowerCase(),
    balance: col.balance >= 0 ? toNumber(r[col.balance]) : null,
    upi: col.upi >= 0 ? String(r[col.upi] ?? '').trim().toLowerCase() : '',
  })).filter((r) => r.flatRaw || r.name || r.phoneRaw);
}

// Builds the full plan without changing anything; commit applies the same plan.
export async function planImport(rows) {
  const existingFlats = new Map((await many('SELECT id, area FROM flats')).map((f) => [f.id, f]));
  const phones = new Map((await many('SELECT phone, flat_id, role, name FROM users')).map((u) => [u.phone, u]));
  const flatsWithLedger = new Set((await many('SELECT DISTINCT flat_id FROM ledger')).map((r) => r.flat_id));
  const vpas = new Map((await many('SELECT vpa, flat_id FROM upi_handles')).map((r) => [r.vpa, r.flat_id]));
  const flats = new Map();
  const people = [];
  const errors = [];
  const seenPhones = new Set();
  const err = (r, msg) => errors.push({ line: r.line, message: msg });

  for (const r of rows) {
    const flatId = normalizeFlat(r.flatRaw);
    if (!flatId) { err(r, `Flat "${r.flatRaw}" is not in the form T07-1203`); continue; }
    const f = flats.get(flatId) || { id: flatId, area: null, balance: null, upi: new Set(), existing: existingFlats.get(flatId) };
    flats.set(flatId, f);
    if (r.area != null) {
      if (Number.isNaN(r.area)) err(r, `Area "${r.areaRaw}" is not a number`);
      else if (!(r.area > 100 && r.area < 20000)) err(r, `Area ${r.area} sq ft looks wrong`);
      else if (f.area != null && f.area !== Math.round(r.area)) err(r, `${flatId} has two different areas`);
      else f.area = Math.round(r.area);
    }
    if (r.balance != null) {
      if (Number.isNaN(r.balance)) err(r, 'Opening balance is not a number');
      else if (f.balance != null && f.balance !== Math.round(r.balance)) err(r, `${flatId} has two different opening balances`);
      else f.balance = Math.round(r.balance);
    }
    if (r.upi) {
      if (!/^[a-z0-9._-]{2,}@[a-z]{2,}$/.test(r.upi)) err(r, `UPI ID "${r.upi}" is not valid`);
      else if (vpas.has(r.upi) && vpas.get(r.upi) !== flatId) err(r, `UPI ID ${r.upi} is already registered to ${vpas.get(r.upi)}`);
      else f.upi.add(r.upi);
    }
    if (!r.name && !r.phoneRaw) continue; // a flat-only row
    if (!r.name) { err(r, 'Name is missing'); continue; }
    if (!/^[6-9]\d{9}$/.test(r.phone)) { err(r, `Mobile "${r.phoneRaw}" is not a valid 10-digit number`); continue; }
    if (seenPhones.has(r.phone)) { err(r, `Mobile ${r.phone} appears twice in the file`); continue; }
    seenPhones.add(r.phone);
    const relation = /tenant|rent/.test(r.relation) ? 'tenant' : /family|spouse|son|daughter|wife|husband|father|mother/.test(r.relation) ? 'family' : 'owner';
    const existing = phones.get(r.phone);
    if (existing && existing.flat_id !== flatId) { err(r, `Mobile ${r.phone} is already registered${existing.flat_id ? ` to ${existing.flat_id}` : ' to a staff member'}`); continue; }
    people.push({ line: r.line, flatId, name: r.name, phone: r.phone, relation, action: existing ? 'exists' : 'create' });
  }
  for (const f of flats.values()) {
    if (!f.existing && f.area == null) errors.push({ line: null, message: `${f.id} is new but has no area` });
    if (f.balance && flatsWithLedger.has(f.id)) errors.push({ line: null, message: `${f.id} already has transactions; its opening balance can only be changed by an adjustment` });
    f.action = !f.existing ? 'create' : f.area != null && f.area !== f.existing.area ? 'update' : 'unchanged';
  }
  const list = [...flats.values()].map((f) => ({ id: f.id, area: f.area ?? f.existing?.area, previousArea: f.existing?.area ?? null, action: f.action, balance: f.balance || 0, upi: [...f.upi] }));
  return {
    errors,
    flats: list,
    people,
    summary: {
      flatsNew: list.filter((f) => f.action === 'create').length,
      flatsAreaChanged: list.filter((f) => f.action === 'update').length,
      residentsNew: people.filter((p) => p.action === 'create').length,
      residentsExisting: people.filter((p) => p.action === 'exists').length,
      balances: list.filter((f) => f.balance).length,
      balanceTotal: list.reduce((s, f) => s + f.balance, 0),
    },
  };
}

export async function commitImport(filename, rows, balanceDate, actor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(balanceDate || '') || balanceDate > today()) throw new HttpError(400, 'Choose the date the opening balances are as of (not in the future).');
  return tx(async () => {
    await q('SELECT pg_advisory_xact_lock(778)');
    const plan = await planImport(rows);
    if (plan.errors.length) throw new HttpError(400, `Fix the ${plan.errors.length} problem${plan.errors.length > 1 ? 's' : ''} in the file first.`);
    for (const f of plan.flats) {
      if (f.action === 'create') await q('INSERT INTO flats (id, tower, area) VALUES ($1, $2, $3)', [f.id, f.id.slice(0, 3), f.area]);
      if (f.action === 'update') await q('UPDATE flats SET area = $2 WHERE id = $1', [f.id, f.area]);
      for (const vpa of f.upi) await q('INSERT INTO upi_handles (vpa, flat_id) VALUES ($1, $2) ON CONFLICT (vpa) DO NOTHING', [vpa, f.id]);
      if (f.balance) {
        await q(`INSERT INTO ledger (flat_id, on_date, kind, description, debit, credit, created_by) VALUES ($1, $2, 'opening', $3, $4, $5, $6)`,
          [f.id, balanceDate, f.balance > 0 ? 'Opening balance brought forward' : 'Opening advance brought forward',
            Math.max(0, f.balance), Math.max(0, -f.balance), actor.name]);
      }
    }
    for (const p of plan.people.filter((x) => x.action === 'create')) {
      await q("INSERT INTO users (name, phone, role, flat_id, relation) VALUES ($1, $2, 'resident', $3, $4)", [p.name, p.phone, p.flatId, p.relation]);
    }
    const s = plan.summary;
    const rec = await one(`INSERT INTO register_imports (filename, flats_created, flats_updated, residents_created, balances_posted, imported_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [filename, s.flatsNew, s.flatsAreaChanged, s.residentsNew, s.balances, actor.id]);
    await audit(actor, 'register.imported', 'register_import', rec.id, { filename, ...s, balanceDate });
    return { id: rec.id, ...s };
  });
}

export async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register');
  ws.addRow(TEMPLATE_HEADERS).font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = [12, 20, 28, 14, 12, 18, 28][i]; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const notes = wb.addWorksheet('How to fill');
  [
    ['One row per person who should be able to sign in. Repeat the flat on each of its rows.'],
    ['Flat: tower and flat number, e.g. T07-1203 (T7-1203 and T07 1203 also work).'],
    ['Carpet area: in square feet. Needed once per flat.'],
    ['Mobile: 10-digit number; the person signs in with a code sent to it.'],
    ['Relation: owner, tenant or family. Blank means owner.'],
    ['Opening balance: once per flat. Positive = amount the flat owes; negative = advance paid. Leave blank if nil.'],
    ['UPI ID: optional; helps match bank credits to the flat automatically.'],
  ].forEach((r) => notes.addRow(r));
  notes.getColumn(1).width = 110;
  return wb.xlsx.writeBuffer();
}
