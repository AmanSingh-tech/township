// Demo mode only: put the sample township back as it was on first start, so
// every reviewer starts from the same data. Admins only (the admin router).
//
// - Everyone else is paused while it runs (lib/maintenance.js); the pause is
//   always lifted afterwards, success or failure, and the background workers
//   carry on by themselves, since they check the pause on every run.
// - The whole rebuild is one PostgreSQL transaction, schema included. If any
//   step fails, all of it is undone and the township is exactly as it was.
//   The failure is then recorded in the audit log and the server log, and the
//   admin is told that nothing was changed.
// - Loading the sample data rebuilds the database, which would also erase the
//   audit log, so earlier resets are read first and written back with this
//   one, failed attempts included: a reset never erases its own trail. It is also logged to the server
//   log, outside the database.
// - Sessions are rebuilt with the data, so everyone signs in again; the app
//   sends people to the sign-in page when their session ends.
import { env } from '../env.js';
import { many, q, tx } from '../db.js';
import { HttpError } from './util.js';
import { withMaintenance } from './maintenance.js';
import { setSetting, clearSettingsCache } from './settings.js';

const insertAudit = (e) => q('INSERT INTO audit_log (at, user_name, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  [e.at, e.user_name, e.action, e.entity, e.entity_id, JSON.stringify(e.details || {}), e.ip]);

// `load` is the step that rebuilds the data; tests pass one that fails part-way.
export async function resetDemo(actor, meta = {}, { load } = {}) {
  if (!env.DEMO_DATA) throw new HttpError(404, 'Not found');
  return withMaintenance('Resetting demo data', async () => {
    const at = new Date().toISOString();
    const who = { user_name: actor.name, entity: 'demo', entity_id: null, ip: meta.ip || null };
    try {
      const trail = await tx(async () => {
        const earlier = await many("SELECT at, user_name, action, entity, entity_id, details, ip FROM audit_log WHERE action IN ('demo.reset', 'demo.reset_failed') ORDER BY id");
        const { bankCsv } = await (load || (await import('../demo/fixtures.js')).loadFixtures)();
        await setSetting('demoBankStatement', bankCsv, 'demo');
        const all = [...earlier, { ...who, at, action: 'demo.reset', details: { role: actor.role, phone: actor.phone } }];
        for (const e of all) await insertAudit(e);
        return all;
      });
      clearSettingsCache();
      console.log(`Demo data reset by ${actor.name} (${actor.role}) at ${at}`);
      return { ok: true, at, resets: trail.length };
    } catch (err) {
      // Rolled back: the earlier data and its audit log are intact, so record it there.
      clearSettingsCache();
      console.error(`Demo data reset by ${actor.name} failed at ${at}; nothing was changed:`, err);
      await insertAudit({ ...who, at, action: 'demo.reset_failed', details: { role: actor.role, phone: actor.phone, error: String(err.message || err).slice(0, 300) } })
        .catch((e) => console.error('Could not record the failed reset:', e));
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, 'Reset failed; nothing was changed. Please try again.');
    }
  });
}
