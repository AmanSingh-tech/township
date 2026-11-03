// Small RFC 4180 parser: quoted fields, escaped quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const pick = (headers, ...patterns) =>
  headers.findIndex((h) => patterns.some((p) => p.test(h)));

const money = (s) => {
  const n = parseFloat(String(s || '').replace(/[₹,\s]|INR|Cr|Dr/gi, ''));
  return Number.isFinite(n) ? n : 0;
};

// Accepts Indian bank exports: DD/MM/YYYY or YYYY-MM-DD dates, and either
// separate Withdrawal/Deposit columns or one Amount column with Cr/Dr.
function isoDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}

export function readBankStatement(text) {
  const all = parseCsv(text);
  const headerAt = all.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /narration|description|particulars|remarks/i.test(c)));
  if (headerAt < 0) throw new Error('Could not find a header row with Date and Narration columns');
  const headers = all[headerAt].map((h) => h.trim().toLowerCase());
  const col = {
    date: pick(headers, /^(txn |transaction )?date/, /date/),
    narration: pick(headers, /narration|description|particulars|remarks/),
    ref: pick(headers, /ref|chq|cheque|utr/),
    deposit: pick(headers, /deposit|credit/),
    withdrawal: pick(headers, /withdrawal|debit/),
    amount: pick(headers, /^amount/),
    drcr: pick(headers, /^(dr|cr|dr\/cr|type)$/),
  };
  const out = [];
  for (const r of all.slice(headerAt + 1)) {
    const narration = (r[col.narration] || '').trim();
    if (!narration && !r[col.date]) continue;
    let amount;
    if (col.deposit >= 0) amount = money(r[col.deposit]) - (col.withdrawal >= 0 ? money(r[col.withdrawal]) : 0);
    else {
      amount = money(r[col.amount]);
      const flag = `${r[col.drcr] || ''} ${r[col.amount] || ''}`;
      if (/\bdr\b/i.test(flag)) amount = -amount;
    }
    const reference = col.ref >= 0 ? (r[col.ref] || '').trim() : '';
    out.push({ date: isoDate(r[col.date]), narration, reference, amount: Math.round(amount) });
  }
  return out;
}

// Writes CSV for spreadsheets. Text that Excel or Sheets would run as a
// formula (=, +, -, @, tab, CR first) gets a leading apostrophe: names and
// bank narrations come from residents and payers, and a UPI note such as
// "=HYPERLINK(...)" must never execute on the treasurer's computer.
const cell = (c) => {
  if (c == null) return '';
  if (typeof c === 'number') return String(c);
  let s = String(c);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n');
