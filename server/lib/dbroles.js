import { q, one, many } from '../db.js';

// Tables whose rows are never changed once written. The app's role may only
// add to them; the triggers in 001_init.sql also stop their owner.
export const APPEND_ONLY = ['ledger', 'payments', 'audit_log', 'report_signoffs'];

// Creates or updates the role the app connects as in production. It can read
// and write data but cannot alter tables or switch off the append-only
// triggers, and cannot update or delete append-only rows at all. Run as the
// schema owner after every migration (npm run cli -- grant-app-role).
export async function grantAppRole(user, password) {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(user || '')) throw new Error('APP_DB_USER must be a plain lower-case name.');
  if (!password || password.length < 24) throw new Error('APP_DB_PASSWORD must be at least 24 characters.');
  const sql = async (template, ...args) => q((await one(`SELECT format(${template}) s`, args)).s);
  if (!(await one('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]))) await sql("'CREATE ROLE %I LOGIN', $1::text", user);
  await sql("'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', $1::text, $2::text", user, password);
  await sql("'GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text", user);
  await sql("'REVOKE CREATE ON SCHEMA public FROM PUBLIC, %I', $1::text", user);
  await sql("'GRANT USAGE ON SCHEMA public TO %I', $1::text", user);
  await sql("'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', $1::text", user);
  await sql("'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', $1::text", user);
  await sql("'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', $1::text", user);
  await sql("'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', $1::text", user);
  for (const t of APPEND_ONLY) await sql("'REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM %I', $1::text, $2::text", t, user);
  await sql("'REVOKE ALL ON schema_migrations FROM %I', $1::text", user);
  await sql("'GRANT SELECT ON schema_migrations TO %I', $1::text", user);
}

// Checks run after a restore, or any time: the books add up and nothing that
// should be immutable can be changed.
export async function verifyIntegrity() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ check: name, ok, detail });
  const triggers = await many(`SELECT c.relname t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
    WHERE g.tgname LIKE '%append_only' AND g.tgenabled = 'O'`);
  const missing = APPEND_ONLY.filter((t) => !triggers.some((x) => x.t === t));
  check('Append-only triggers on and enabled', !missing.length, missing.join(', '));
  const pay = await one(`SELECT COUNT(*) n FROM payments p WHERE (SELECT COUNT(*) FROM ledger l
    WHERE l.payment_id = p.id AND l.credit = p.amount AND l.kind = 'payment') <> 1`);
  check('Every payment has exactly one matching ledger credit', pay.n === 0, pay.n ? `${pay.n} payments` : '');
  const bills = await one(`SELECT COUNT(*) n FROM bills b WHERE (SELECT COUNT(*) FROM ledger l
    WHERE l.bill_id = b.id AND l.kind = 'bill' AND l.debit = b.amount) <> 1`);
  check('Every bill has exactly one matching ledger debit', bills.n === 0, bills.n ? `${bills.n} bills` : '');
  const gaps = await many(`SELECT c.fy, c.last, COUNT(p.id) n FROM receipt_counters c
    LEFT JOIN payments p ON p.receipt_no LIKE 'RCT/' || c.fy || '/%' GROUP BY c.fy, c.last HAVING COUNT(p.id) <> c.last`);
  check('Receipt numbers have no gaps', !gaps.length, gaps.map((g) => `${g.fy}: ${g.n} receipts, counter ${g.last}`).join('; '));
  const { getSignoff, listSignoffs } = await import('./report.js');
  const bad = [];
  for (const s of await listSignoffs()) if (!(await getSignoff(s.period)).verified) bad.push(s.period);
  check('Signed reports match their fingerprints', !bad.length, bad.join(', '));
  return checks;
}
