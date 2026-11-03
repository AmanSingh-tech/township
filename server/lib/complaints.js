import { q, one, many, tx } from '../db.js';
import { getSettings } from './settings.js';
import { classify, safetyCheck, similarity } from './classifier.js';
import { send } from './notify.js';

// Assets shared by a whole tower: one fault is reported by many flats.
const SHARED = new Set(['Lift', 'Security', 'Common areas', 'Housekeeping']);

export const logEvent = (id, actor, kind, note, at = new Date()) =>
  q('INSERT INTO complaint_events (complaint_id, at, actor, kind, note) VALUES ($1, $2, $3, $4, $5)', [id, at, actor, kind, note]);

export async function dueBy(createdAt, urgency) {
  const { sla } = await getSettings();
  return new Date(new Date(createdAt).getTime() + sla[urgency] * 60000);
}

// Least-loaded active technician for the category who covers the tower.
export async function pickAssignee(category, tower, escalated) {
  if (escalated) return one("SELECT * FROM staff WHERE skill = 'duty_manager' AND active ORDER BY id LIMIT 1");
  const pool = (await many(`SELECT s.*, (SELECT COUNT(*) FROM complaints c WHERE c.assignee_id = s.id
      AND c.status IN ('open','assigned','in_progress')) AS load FROM staff s WHERE s.skill = $1 AND s.active`, [category]))
    .filter((s) => !s.towers || s.towers.split(',').includes(tower));
  pool.sort((a, b) => a.load - b.load || a.id - b.id);
  return pool[0] || one("SELECT * FROM staff WHERE skill = 'Other' AND active ORDER BY id LIMIT 1");
}

export async function findDuplicate({ flatId, category, text, createdAt }) {
  const since = new Date(new Date(createdAt).getTime() - 48 * 3600000);
  const open = await many(`SELECT * FROM complaints WHERE category = $1 AND substr(flat_id, 1, 3) = $2
      AND status <> 'closed' AND created_at >= $3 AND flat_id <> $4 ORDER BY created_at`, [category, flatId.slice(0, 3), since, flatId]);
  const hit = open.find((c) => SHARED.has(category) || similarity(c.text, text) >= 0.3);
  return hit ? (hit.duplicate_of || hit.id) : null;
}

export async function createComplaint({ flatId, userId, actor, text, photoKey, at }) {
  const createdAt = at ? new Date(at) : new Date();
  const ai = await classify(text); // outside the transaction: may call Claude
  return tx(async () => {
    const hazard = safetyCheck(text);
    const urgency = hazard ? 'critical' : ai.urgency;
    const parent = await findDuplicate({ flatId, category: ai.category, text, createdAt });
    const assignee = await pickAssignee(ai.category, flatId.slice(0, 3), !!hazard);
    const c = await one(`INSERT INTO complaints
      (flat_id, raised_by, text, photo_key, category, urgency, ai_category, ai_urgency, ai_confidence, ai_source,
       escalated, escalation_reason, status, assignee_id, duplicate_of, created_at, due_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, [
      flatId, userId, text, photoKey || null, ai.category, urgency, ai.category, ai.urgency, ai.confidence, ai.source,
      !!hazard, hazard, assignee ? 'assigned' : 'open', assignee?.id || null, parent, createdAt, await dueBy(createdAt, urgency)]);
    const id = c.id;
    await logEvent(id, actor, 'created', `Raised from ${flatId}`, createdAt);
    await logEvent(id, 'System', 'category', `Classified as ${ai.category}, ${ai.urgency} urgency (${Math.round(ai.confidence * 100)}% sure, ${ai.source === 'claude' ? 'Claude' : 'keyword model'})`, createdAt);
    if (hazard) {
      await logEvent(id, 'System', 'escalated', `Safety rule: “${hazard}”. Escalated to duty manager ${assignee?.name || '(none on duty)'}`, createdAt);
      if (assignee?.phone) await send('sms-alert', assignee.phone, `URGENT ${flatId}: ${hazard}. Complaint #${id}: ${text.slice(0, 80)}`);
    } else if (assignee) {
      await logEvent(id, 'System', 'assigned', `Assigned to ${assignee.name}`, createdAt);
    }
    if (parent) {
      await logEvent(id, 'System', 'linked', `Linked to #${parent}, the same issue reported by another flat`, createdAt);
      await logEvent(parent, 'System', 'linked', `Also reported by ${flatId} (#${id})`, createdAt);
    }
    return id;
  });
}
