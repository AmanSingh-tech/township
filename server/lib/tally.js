import { q, one, many, tx } from '../db.js';
import { getSettings } from './settings.js';
import { audit } from './audit.js';
import { HttpError } from './util.js';
import { toCsv } from './csv.js';

// Tally Prime / ERP 9 XML import ("Import Data" envelope). Bills, interest,
// amenity charges and adjustments become Journal vouchers; payments become
// Receipt vouchers. Opening balances are not exported: Tally already has them.
export const TALLY_DEFAULTS = {
  company: '',
  memberMode: 'per-flat',            // 'per-flat' ledgers under memberGroup, or one 'single' ledger
  memberGroup: 'Sundry Debtors',
  singleMemberLedger: 'Members – Maintenance Receivable',
  bankLedger: 'Bank Account',
  gatewayLedger: 'Razorpay Clearing',
  maintenanceLedger: 'Maintenance Charges',
  interestLedger: 'Interest on Arrears',
  amenityLedger: 'Amenity Charges',
  adjustmentLedger: 'Maintenance Adjustments',
};

// Control characters are not allowed in XML and make Tally reject the file.
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tdate = (d) => d.replace(/-/g, '');
const money = (n) => n.toFixed(2);

// In Tally XML a debit is ISDEEMEDPOSITIVE=Yes with a negative amount.
const entry = (ledger, amount, debit) => `
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${esc(ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
       <AMOUNT>${money(debit ? -amount : amount)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;

const voucher = (v) => `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${v.type}" ACTION="Create">
      <DATE>${tdate(v.date)}</DATE>
      <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${esc(v.number)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>
      <NARRATION>${esc(v.narration)}</NARRATION>${v.entries.map((e) => entry(e.ledger, e.amount, e.debit)).join('')}
     </VOUCHER>
    </TALLYMESSAGE>`;

const ledgerMaster = (name, group) => `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <LEDGER NAME="${esc(name)}" ACTION="Create">
      <NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST>
      <PARENT>${esc(group)}</PARENT>
      <ISBILLWISEON>No</ISBILLWISEON>
     </LEDGER>
    </TALLYMESSAGE>`;

export async function buildVouchers(from, to) {
  const t = { ...TALLY_DEFAULTS, ...((await getSettings()).tally || {}) };
  const names = new Map((await many(`SELECT DISTINCT ON (flat_id) flat_id, name FROM users
    WHERE role = 'resident' AND relation <> 'family' ORDER BY flat_id, relation = 'owner' DESC, id`)).map((r) => [r.flat_id, r.name]));
  const memberLedger = (flatId) => (t.memberMode === 'single' ? t.singleMemberLedger : `${flatId} ${names.get(flatId) || ''}`.trim());
  const lines = await many(`SELECT l.*, p.receipt_no, p.method, p.utr, p.reference FROM ledger l
    LEFT JOIN payments p ON p.id = l.payment_id
    WHERE l.on_date BETWEEN $1 AND $2 AND l.kind <> 'opening' ORDER BY l.on_date, l.id`, [from, to]);
  const incomeLedger = { bill: t.maintenanceLedger, interest: t.interestLedger, amenity: t.amenityLedger, adjustment: t.adjustmentLedger };
  const vouchers = lines.map((l) => {
    const member = memberLedger(l.flat_id);
    if (l.kind === 'payment') {
      return {
        type: 'Receipt', date: l.on_date, number: l.receipt_no, party: member, flatId: l.flat_id, amount: l.credit,
        narration: `${l.description}${l.utr ? ` UTR ${l.utr}` : ''} · ${l.flat_id}`,
        entries: [{ ledger: l.method === 'gateway' ? t.gatewayLedger : t.bankLedger, amount: l.credit, debit: true }, { ledger: member, amount: l.credit, debit: false }],
      };
    }
    const amount = l.debit || l.credit;
    const charge = l.debit > 0; // charge to the member; a credit is a waiver or refund
    return {
      type: 'Journal', date: l.on_date, number: `TWP-${l.id}`, party: member, flatId: l.flat_id, amount,
      narration: `${l.description} · ${l.flat_id}`,
      entries: [{ ledger: member, amount, debit: charge }, { ledger: incomeLedger[l.kind], amount, debit: !charge }],
    };
  });
  return { t, vouchers, memberLedgers: [...new Set(vouchers.map((v) => v.party))] };
}

export function toTallyXml({ t, vouchers, memberLedgers }) {
  const masters = t.memberMode === 'per-flat' ? memberLedgers.map((n) => ledgerMaster(n, t.memberGroup)).join('') : '';
  return `<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>All Masters</REPORTNAME>
    <STATICVARIABLES>${t.company ? `<SVCURRENTCOMPANY>${esc(t.company)}</SVCURRENTCOMPANY>` : ''}</STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>${masters}${vouchers.map(voucher).join('')}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}

export function toDaybookCsv({ vouchers }) {
  const rows = [['Date', 'Voucher type', 'Number', 'Flat', 'Ledger', 'Debit', 'Credit', 'Narration']];
  for (const v of vouchers) for (const e of v.entries) rows.push([v.date, v.type, v.number, v.flatId, e.ledger, e.debit ? e.amount : '', e.debit ? '' : e.amount, v.narration]);
  return toCsv(rows);
}

export async function exportForTally(from, to, { confirmOverlap }, actor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(400, 'Choose a valid date range.');
  const overlap = await one(`SELECT e.*, u.name FROM tally_exports e JOIN users u ON u.id = e.exported_by
    WHERE e.from_date <= $2 AND e.to_date >= $1 ORDER BY e.exported_at DESC LIMIT 1`, [from, to]);
  if (overlap && !confirmOverlap) {
    throw new HttpError(409, `${overlap.from_date} to ${overlap.to_date} was already exported by ${overlap.name}. Importing the same vouchers twice duplicates them in Tally.`);
  }
  const built = await buildVouchers(from, to);
  return tx(async () => {
    const rec = await one('INSERT INTO tally_exports (from_date, to_date, vouchers, exported_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [from, to, built.vouchers.length, actor.id]);
    await audit(actor, 'tally.exported', 'tally_export', rec.id, { from, to, vouchers: built.vouchers.length, overlap: !!overlap });
    return { ...built, exportId: rec.id };
  });
}

export const listTallyExports = () => many(`SELECT e.*, u.name exported_by_name FROM tally_exports e
  JOIN users u ON u.id = e.exported_by ORDER BY e.exported_at DESC LIMIT 20`);
