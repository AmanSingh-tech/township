// Scores bank-statement matching on statements whose answers are known.
// Each statement is a month of credits for the sample township, one per flat
// that owes, in the mix of styles real statements carry, plus rows that are
// not maintenance at all. Every row records the flat it truly belongs to.
// It runs inside a transaction that is rolled back, so nothing is kept.
import { many, tx } from '../db.js';
import { flatStatus } from '../lib/billing.js';
import { recordPayment } from '../lib/billing.js';
import { matchStatement } from '../lib/matcher.js';
import { readBankStatement } from '../lib/csv.js';
import { MINUTES, matchingTime } from '../lib/matchtime.js';

// Assumed share of each style in a month's credits (labelled in the TDD).
export const MIX = [
  ['upi-registered', 0.33], ['upi-registered+flat', 0.12], ['neft-flat', 0.15], ['family-unregistered', 0.10],
  ['imps-name-only', 0.08], ['part-payment', 0.07], ['typo-flat', 0.05], ['pays-for-neighbour', 0.05], ['advance-12-months', 0.05],
];
export { MINUTES };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FLAT_FORMATS = [
  (t, f) => `T${t}-${f}`, (t, f) => `T${t} ${f}`, (t, f) => `TOWER ${Number(t)} FLAT ${Number(f)}`, (t, f) => `T${t}/${f}`, (t, f) => `FLAT ${Number(f)} T${t}`,
];

async function directory() {
  const flats = await many(`SELECT f.id, (SELECT name FROM users u WHERE u.flat_id = f.id AND u.role = 'resident' ORDER BY u.relation = 'owner' DESC, u.id LIMIT 1) AS name,
    (SELECT vpa FROM upi_handles h WHERE h.flat_id = f.id LIMIT 1) AS vpa FROM flats f ORDER BY f.id`);
  const out = [];
  for (const f of flats) {
    if (!f.name) continue;
    const st = await flatStatus(f.id);
    if (st.totalDue > 0) out.push({ ...f, due: st.totalDue, bill: st.bills.find((b) => b.unpaid > 0)?.amount || st.totalDue });
  }
  return { owing: out, ids: new Set(flats.map((f) => f.id)) };
}

export function buildStatement({ owing, ids }, seed) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  let utr = 432200000000 + seed * 100000;
  const u = () => String(utr += 7919);
  const rows = [];
  const style = () => { let x = r(); for (const [k, w] of MIX) { if ((x -= w) < 0) return k; } return MIX[0][0]; };
  const ref = (id) => pick(FLAT_FORMATS)(id.slice(1, 3), id.slice(4));
  for (const f of owing) {
    let s = style();
    if (!f.vpa && ['upi-registered', 'upi-registered+flat', 'advance-12-months'].includes(s)) s = 'neft-flat';
    const NAME = f.name.toUpperCase().replace(/\(.*?\)/g, '').trim();
    const surname = NAME.split(/\s+/).at(-1);
    const amount = r() < 0.15 ? f.bill : f.due;
    let narration, amt = amount, truth = f.id;
    switch (s) {
      case 'upi-registered': narration = `UPI/CR/${u()}/${NAME}/${f.vpa}/${pick(['Maintenance', 'Payment', 'Nov maint', 'society', 'UPI'])}`; break;
      case 'upi-registered+flat': narration = `UPI/CR/${u()}/${NAME}/${f.vpa}/${ref(f.id)} maintenance`; break;
      case 'neft-flat': narration = `NEFT CR-${pick(['HDFC0001234', 'SBIN0004567', 'ICIC0000321'])}-${NAME}-${ref(f.id)} MAINT`; break;
      case 'family-unregistered': narration = `UPI/CR/${u()}/${pick(['PRIYA', 'ROHAN', 'ANITA', 'VIKRAM'])} ${surname}/${pick(['priya', 'rohan', 'anita', 'vikram'])}.${surname.toLowerCase()}${Math.floor(r() * 90)}@okaxis/maintenance`; break;
      case 'imps-name-only': narration = `IMPS/P2A/${u()}/${NAME.split(/\s+/)[0][0]} ${surname}/HDFC/maint`; break;
      case 'part-payment': amt = Math.round(f.due / 2); narration = f.vpa ? `UPI/CR/${u()}/${NAME}/${f.vpa}/part payment` : `NEFT CR-HDFC0001234-${NAME}-${ref(f.id)} PART`; break;
      case 'typo-flat': {
        // One digit off; it may name another real flat, or none.
        const id = f.id.slice(0, 4) + f.id.slice(4, 6) + f.id[7] + f.id[6];
        narration = `NEFT CR-SBIN0004567-${NAME}-${ref(id === f.id ? f.id.slice(0, 6) + ((Number(f.id[7]) + 1) % 10) + f.id[7] : id)} MAINT`; break;
      }
      case 'pays-for-neighbour': {
        const other = pick(owing.filter((o) => o.id !== f.id));
        narration = f.vpa ? `UPI/CR/${u()}/${NAME}/${f.vpa}/${other.id} maintenance` : `NEFT CR-HDFC0001234-${NAME}-${other.id} MAINT`;
        truth = other.id; amt = other.due; break;
      }
      case 'advance-12-months': narration = `UPI/CR/${u()}/${NAME}/${f.vpa}/advance 1 year`; amt = f.bill * 12; break;
      default: narration = `UPI/CR/${u()}/${NAME}/${f.vpa}/Maintenance`;
    }
    rows.push({ narration, amount: amt, truth, style: s });
  }
  // Not maintenance: these must never land on a flat.
  for (const [narration, amount, debit] of [
    ['NEFT DR-MSEDCL PUNE-COMMON AREA ELECTRICITY', 184520, true], [`NEFT CR-RAZORPAY SOFTWARE PVT LTD-SETL${u().slice(-8)}`, 48210],
    ['INT.PD:01-10-2026 TO 31-10-2026', 9214], [`UPI/CR/${u()}/RAHUL/rahul99@ybl/rent nov`, 15000],
    [`NEFT CR-ASIAN PAINTS LTD-REFUND INV 4471`, 12600], [`UPI/CR/${u()}/AMIT/amit.k@ybl/maintenance`, 6370],
  ]) rows.push({ narration, amount, debit: !!debit, truth: null, style: 'not-maintenance' });
  void ids;
  const csv = ['Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    ...rows.map((x) => ['02/11/2026', `"${x.narration}"`, '', x.debit ? x.amount : '', x.debit ? '' : x.amount, 0].join(','))].join('\n') + '\n';
  return { rows, csv };
}

const ROLLBACK = Symbol('rollback');
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export async function evaluateMatching({ seeds = [1, 2, 3, 4, 5] } = {}) {
  const dir = await directory();
  const tally = { credits: 0, auto: 0, wrongAuto: [], queued: 0, rightTop: 0, rightTop3: 0, notMaint: 0, notMaintPosted: [], misrouted: 0, byStyle: {} };
  const timed = []; // each maintenance credit as the report would see it, once a person has decided it
  for (const seed of seeds) {
    const { rows, csv } = buildStatement(dir, seed);
    let res;
    try {
      await tx(async () => {
        res = await matchStatement(readBankStatement(csv), {
          post: async (flatId, row, sig) => (await recordPayment({ flatId, amount: row.amount, paidOn: row.date, method: 'bank', utr: sig.utr, postedBy: 'eval' }, { name: 'eval' })).id,
        });
        throw ROLLBACK;
      });
    } catch (e) { if (e !== ROLLBACK) throw e; }
    rows.forEach((x, i) => {
      const got = res[i];
      const st = (tally.byStyle[x.style] ||= { n: 0, auto: 0, queued: 0, wrong: 0 });
      st.n++;
      if (x.truth === null) {
        tally.notMaint++;
        if (got.status === 'posted') { tally.notMaintPosted.push(x.narration); st.wrong++; } else if (got.status === 'queue') st.queued++;
        return;
      }
      tally.credits++;
      // A queued credit is decided to its true flat, as the person reviewing it would.
      timed.push({ status: got.status === 'queue' ? 'resolved' : got.status, flatId: got.status === 'queue' ? x.truth : got.flatId, topSuggestion: got.candidates?.[0]?.flatId });
      if (got.status === 'posted') {
        tally.auto++; st.auto++;
        if (got.flatId !== x.truth) { tally.wrongAuto.push({ narration: x.narration, truth: x.truth, posted: got.flatId }); st.wrong++; }
      } else if (got.status === 'queue') {
        tally.queued++; st.queued++;
        if (got.candidates?.[0]?.flatId === x.truth) tally.rightTop++;
        if (got.candidates?.some((c) => c.flatId === x.truth)) tally.rightTop3++;
      } else tally.misrouted++;
    });
  }
  const time = matchingTime(timed);
  const manual = time.minutes.manual, withApp = time.minutes.withApp;
  return {
    statements: seeds.length, credits: tally.credits, notMaintenance: tally.notMaint,
    autoPosted: pct(tally.auto, tally.credits), wrongAutoPosts: tally.wrongAuto.length, wrongAutoExamples: tally.wrongAuto.slice(0, 5),
    queued: pct(tally.queued, tally.credits), queuedTopSuggestionRight: pct(tally.rightTop, tally.queued), queuedRightInTop3: pct(tally.rightTop3, tally.queued),
    notMaintenancePosted: tally.notMaintPosted.length, misrouted: tally.misrouted,
    minutes: { manual, withApp, saved: pct(manual - withApp, manual), share: pct(withApp, manual) },
    byStyle: tally.byStyle,
  };
}
