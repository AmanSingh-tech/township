// Demo mode only: put the sample township back as it was on first start, so
// every reviewer starts from the same data. Admins only (the admin router).
//
// - Everyone else is paused while it runs (lib/maintenance.js).
// - Loading the sample data rebuilds the database, which would also erase the
//   audit log, so earlier resets are read first and written back with this
//   one: a reset never erases its own trail. It is also logged to the server
//   log, outside the database.
// - Sessions are rebuilt with the data, so everyone signs in again; the app
//   sends people to the sign-in page when their session ends.
import { env } from '../env.js';
import { many, q } from '../db.js';
import { HttpError } from './util.js';
import { withMaintenance } from './maintenance.js';
import { setSetting, clearSettingsCache } from './settings.js';

export async function resetDemo(actor, meta = {}) {
  if (!env.DEMO_DATA) throw new HttpError(404, 'Not found');
  return withMaintenance('Resetting demo data', async () => {
    const at = new Date().toISOString();
    const earlier = await many("SELECT at, user_name, action, entity, entity_id, details, ip FROM audit_log WHERE action = 'demo.reset' ORDER BY id");
    const { loadFixtures } = await import('../demo/fixtures.js');
    const { bankCsv } = await loadFixtures();
    await setSetting('demoBankStatement', bankCsv, 'demo');
    clearSettingsCache();
    const trail = [...earlier, { at, user_name: actor.name, action: 'demo.reset', entity: 'demo', entity_id: null, details: { role: actor.role, phone: actor.phone }, ip: meta.ip || null }];
    for (const e of trail) {
      await q('INSERT INTO audit_log (at, user_name, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [e.at, e.user_name, e.action, e.entity, e.entity_id, JSON.stringify(e.details || {}), e.ip]);
    }
    console.log(`Demo data reset by ${actor.name} (${actor.role}) at ${at}`);
    return { ok: true, at, resets: trail.length };
  });
}
