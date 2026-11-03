import crypto from 'node:crypto';
import { env } from '../env.js';

// All dates are calendar days in India Standard Time. Formatters are built
// once: constructing one costs more than the rest of a typical request.
const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export function today() {
  if (env.TODAY) return env.TODAY;
  return IST_DAY.format(new Date());
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayNumbers = new Map();
const dayNumber = (d) => {
  let n = dayNumbers.get(d);
  if (n === undefined) {
    n = Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
    if (dayNumbers.size > 20000) dayNumbers.clear();
    dayNumbers.set(d, n);
  }
  return n;
};
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomDigits = (n) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
export const normalizePhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Indian financial year runs April to March: 2026-11-02 -> "2026-27".
export function financialYear(date) {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
