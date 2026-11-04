import { many, q } from '../db.js';

// Society settings, editable by an admin. Maintenance is billed on carpet area,
// with simple interest on arrears after the due date. The 21% a year default is
// a configurable demonstration rate: the actual applicable rate must be
// confirmed against the federation's adopted bye-laws before production
// (TDD, assumption A2).
export const DEFAULTS = {
  societyName: 'Township',
  ratePerSqft: 6.5,
  billDay: 1,
  dueDay: 10,
  interestRatePa: 0.21,
  match: { autoPostScore: 80, minLead: 30 },
  sla: { critical: 15, high: 120, medium: 480, low: 1440 },
  visitorPhotoRetentionDays: 90,
  bankDetails: null, // { accountName, accountNumber, ifsc, upiId } shown to residents for direct transfers
  tally: null,       // ledger names in the society's Tally company; see lib/tally.js
  demoBankStatement: null, // demo only: the sample statement made with the sample data
};

let cache = null;
let cachedAt = 0;

export async function getSettings() {
  if (cache && Date.now() - cachedAt < 30000) return cache;
  const rows = await many('SELECT key, value FROM settings');
  cache = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  cachedAt = Date.now();
  return cache;
}

export async function setSetting(key, value, by) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting ${key}`);
  await q(`INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3`, [key, JSON.stringify(value), by]);
  cache = null;
}
export const clearSettingsCache = () => { cache = null; };
