import { many, q } from '../db.js';

// Society settings, editable by an admin. Defaults follow the Maharashtra
// model bye-laws: maintenance on carpet area, simple interest on arrears
// after the due date (21% a year is the ceiling; the society may adopt less).
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
