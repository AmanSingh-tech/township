import { q } from '../db.js';

// Append-only record of who did what. Runs inside the caller's transaction,
// so an action and its audit entry are saved together or not at all.
export async function audit(actor, action, entity, entityId, details = {}) {
  await q(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [actor?.id ?? null, actor?.name ?? 'system', action, entity, entityId == null ? null : String(entityId), JSON.stringify(details), actor?.ip ?? null]);
}
