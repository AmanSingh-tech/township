import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

// DATE columns stay 'YYYY-MM-DD' strings; counts and sums come back as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  // TLS with the server's certificate verified, so nothing in between can pose as the database.
  ssl: env.DATABASE_SSL ? { ca: fs.readFileSync(env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true } : undefined,
});

// Queries inside tx() run on that transaction's client automatically, so
// helpers like recordPayment() join whatever transaction their caller opened.
const als = new AsyncLocalStorage();
const runner = () => als.getStore() || pool;
export const inTransaction = () => !!als.getStore();

export const q = (sql, params = []) => runner().query(sql, params);
export const many = async (sql, params) => (await q(sql, params)).rows;
export const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
export const val = async (sql, params) => {
  const row = await one(sql, params);
  return row ? Object.values(row)[0] : null;
};

export async function tx(fn) {
  if (als.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await als.run(client, fn);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationFiles = () => fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

// Migrations not yet applied. Read-only, so the app's own role can check it.
export async function pendingMigrations() {
  const exists = (await pool.query("SELECT to_regclass('schema_migrations') t")).rows[0].t;
  const done = new Set(exists ? (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name) : []);
  return migrationFiles().filter((f) => !done.has(f));
}

// Applies migrations/NNN_name.sql in order, once each, under an advisory lock
// so two app instances starting together cannot both migrate.
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(4242)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of migrationFiles()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        if (env.NODE_ENV !== 'test') console.log(`Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(4242)').catch(() => {});
    client.release();
  }
}
