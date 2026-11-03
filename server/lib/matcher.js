import { many } from '../db.js';
import { getSettings } from './settings.js';
import { flatStatuses, allFlatStatuses } from './billing.js';

// Signals pulled from a bank narration. Indian UPI and NEFT narrations look
// like "UPI/CR/430112345678/AAMIR SHAIKH/aamir.s@okicici/T21-1601 maint".
export function extractSignals({ narration, reference }) {
  const text = `${narration} ${reference || ''}`;
  const vpa = (text.match(/[a-z0-9._-]{2,}@[a-z]{2,}/i) || [])[0]?.toLowerCase() || null;
  const utr = (narration.match(/(?:UPI|IMPS)\/(?:CR|P2A|P2M)?\/?(\d{12})/i) || [])[1]
    || (text.match(/\b([A-Z]{4}[RHN]\d{9,16})\b/) || [])[1]   // NEFT/RTGS UTR
    || (text.match(/\b(\d{12})\b/) || [])[1]
    || (reference || null);
  const flats = new Set();
  const flatRe = /\bT(?:OWER)?[\s-]?(\d{1,2})[\s\/-]?(?:FLAT[\s-]?)?(\d{3,4})\b/gi;
  for (const m of text.matchAll(flatRe)) flats.add(`T${m[1].padStart(2, '0')}-${m[2].padStart(4, '0')}`);
  const words = text.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  return { vpa, utr, flats: [...flats], words: new Set(words) };
}

async function loadDirectory() {
  const flats = new Map((await many('SELECT * FROM flats')).map((f) => [f.id, { ...f, names: [] }]));
  for (const u of await many("SELECT name, flat_id FROM users WHERE role = 'resident' AND active")) {
    flats.get(u.flat_id)?.names.push(...u.name.toUpperCase().replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => w.length >= 4));
  }
  // Name word -> flats, so a row is checked against its own words, not every flat.
  const byName = new Map();
  for (const f of flats.values()) {
    f.names = [...new Set(f.names)];
    for (const n of f.names) (byName.get(n) || byName.set(n, []).get(n)).push(f.id);
  }
  const vpas = new Map((await many('SELECT vpa, flat_id FROM upi_handles')).map((r) => [r.vpa, r.flat_id]));
  return { flats, vpas, byName };
}

// Amount -> flats for which that amount is the full dues, the balance or one
// unpaid month's bill. Kept current as postings change a flat's dues.
export class AmountIndex {
  constructor(statuses) {
    this.byAmount = new Map();
    this.keys = new Map();
    for (const st of statuses.values()) this.set(st);
  }
  set(st) {
    for (const k of this.keys.get(st.flatId) || []) this.byAmount.get(k)?.delete(st.flatId);
    const keys = new Set([st.totalDue, st.balance, ...st.bills.filter((b) => b.unpaid > 0).map((b) => b.amount)]);
    for (const k of keys) (this.byAmount.get(k) || this.byAmount.set(k, new Set()).get(k)).add(st.flatId);
    this.keys.set(st.flatId, keys);
  }
  flats(amount) { return this.byAmount.get(amount) || new Set(); }
}

// Score every plausible flat for one bank credit. Each signal adds evidence;
// the reasons are kept so the accounts team can see why a row was matched.
export function scoreRow(row, dir, statusOf, amounts) {
  const sig = extractSignals(row);
  const cands = new Map();
  const add = (flatId, pts, why, strong = false) => {
    if (!dir.flats.has(flatId)) return;
    const c = cands.get(flatId) || { flatId, score: 0, reasons: [], strong: false };
    c.score += pts; c.reasons.push(why); c.strong ||= strong;
    cands.set(flatId, c);
  };
  for (const f of sig.flats) add(f, 60, `Flat ${f} written in the narration`, true);
  if (sig.vpa && dir.vpas.has(sig.vpa)) add(dir.vpas.get(sig.vpa), 50, `UPI ID ${sig.vpa} is registered to this flat`, true);
  const nameHits = new Map();
  for (const w of sig.words) for (const id of dir.byName.get(w) || []) (nameHits.get(id) || nameHits.set(id, []).get(id)).push(w);
  for (const [id, hit] of nameHits) add(id, 15, `Payer name matches ${dir.flats.get(id).names.filter((n) => hit.includes(n)).join(' ')}`);
  // Amount is only checked for flats that already have other evidence, plus
  // a short list of exact-due matches shown as suggestions. It never posts alone.
  const dueThis = amounts.flats(row.amount); // flats whose dues, balance or an unpaid month equal the amount
  for (const [id] of cands) {
    const st = statusOf(id);
    const exact = row.amount === st.totalDue || row.amount === st.balance;
    const monthly = !exact && dueThis.has(id);
    if (exact) add(id, 30, `Amount equals dues of ₹${st.totalDue}`);
    else if (monthly) add(id, 20, 'Amount equals one month’s bill');
    else if (row.amount < st.totalDue) add(id, 5, `Part payment of ₹${st.totalDue} due`);
    else if (st.totalDue > 0 && row.amount > st.totalDue * 3) add(id, -40, 'Amount is far above dues');
  }
  const amountMatches = [...dueThis].filter((id) => !cands.has(id));
  if (amountMatches.length && amountMatches.length <= 5) {
    for (const id of amountMatches) add(id, 20, amountMatches.length === 1 ? 'Only flat with this exact amount due' : `One of ${amountMatches.length} flats with this amount due`);
  }
  const ranked = [...cands.values()].sort((a, b) => b.score - a.score);
  return { sig, ranked, amountOnlyCount: amountMatches.length };
}

export function decide(ranked, match = { autoPostScore: 80, minLead: 30 }) {
  const [top, second] = ranked;
  if (!top) return { post: false, why: 'No flat could be identified' };
  const lead = top.score - (second?.score || 0);
  const rival = ranked.slice(1).find((c) => c.strong);
  if (top.strong && rival) return { post: false, why: `Narration points to ${top.flatId} and ${rival.flatId}` };
  if (!top.strong) return { post: false, why: 'Only name or amount matched; needs a person to confirm' };
  if (top.score < match.autoPostScore) {
    const odd = top.reasons.find((r) => r.startsWith('Amount is far'));
    return { post: false, why: odd ? `${odd}; needs a person to confirm` : 'Evidence too weak to post automatically' };
  }
  if (second && lead < match.minLead) return { post: false, why: `Conflicting evidence between ${top.flatId} and ${second.flatId}` };
  return { post: true, why: 'Matched' };
}

// Match a whole statement. Rows are processed in date order, and each posting
// refreshes that flat's dues before the next row is scored.
export async function matchStatement(rows, { post }) {
  const { match } = await getSettings();
  const dir = await loadDirectory();
  const statuses = new Map(await allFlatStatuses());
  const statusOf = (id) => statuses.get(id);
  const amounts = new AmountIndex(statuses);
  const results = [];
  const batchUtrs = new Set();
  // UTRs already imported, and online payments, looked up once for the whole statement.
  const utrs = [...new Set(rows.map((r) => extractSignals(r).utr).filter(Boolean))];
  const seen = new Set((await many(`SELECT DISTINCT utr FROM bank_rows WHERE utr = ANY($1) AND status NOT IN ('duplicate','ignored')`, [utrs])).map((x) => x.utr));
  const gateway = new Map((await many(`SELECT utr, id, flat_id FROM payments WHERE utr = ANY($1) AND method = 'gateway'`, [utrs])).map((x) => [x.utr, x]));
  let n = 0;
  for (const row of [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (++n % 25 === 0) await new Promise((r) => setImmediate(r)); // keep other requests moving
    const base = { ...row, utr: null, flatId: null, score: 0, reasons: [], candidates: [], paymentId: null };
    if (row.amount <= 0) { results.push({ ...base, status: 'ignored', reasons: ['Debit or zero amount, not a maintenance receipt'] }); continue; }
    const { sig, ranked } = scoreRow(row, dir, statusOf, amounts);
    base.utr = sig.utr;
    if (sig.utr && (batchUtrs.has(sig.utr) || seen.has(sig.utr))) {
      results.push({ ...base, status: 'duplicate', reasons: [`UTR ${sig.utr} was already imported`] }); continue;
    }
    if (sig.utr) batchUtrs.add(sig.utr);
    // Razorpay pays out in batches; those payments were recorded when residents paid.
    if (/RAZORPAY|\bRZP\b/i.test(row.narration)) {
      results.push({ ...base, status: 'reconciled', score: 100, reasons: ['Razorpay settlement; the payments in it were recorded when residents paid online'] });
      continue;
    }
    const gw = sig.utr && gateway.get(sig.utr);
    if (gw) {
      results.push({ ...base, status: 'reconciled', flatId: gw.flat_id, paymentId: gw.id, score: 100, reasons: ['Settlement of an online payment already recorded in the app'] });
      continue;
    }
    const d = decide(ranked, match);
    const top = ranked[0];
    const candidates = ranked.slice(0, 3).map((c) => ({ flatId: c.flatId, score: c.score, reasons: c.reasons }));
    if (d.post) {
      const paymentId = await post(top.flatId, row, sig);
      statuses.set(top.flatId, (await flatStatuses([top.flatId])).get(top.flatId));
      amounts.set(statuses.get(top.flatId));
      results.push({ ...base, status: 'posted', flatId: top.flatId, score: Math.min(100, top.score), reasons: top.reasons, candidates, paymentId });
    } else {
      results.push({ ...base, status: 'queue', score: top ? Math.min(100, top.score) : 0, reasons: [d.why], candidates });
    }
  }
  return results;
}
