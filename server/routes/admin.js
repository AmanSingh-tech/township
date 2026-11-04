import { Router } from 'express';
import { h } from '../http.js';
import { q, one, many, tx } from '../db.js';
import { hashPin, createDevice, endAllSessions } from '../lib/auth.js';
import { getSettings, setSetting, DEFAULTS } from '../lib/settings.js';
import { CATEGORIES } from '../lib/classifier.js';
import { audit } from '../lib/audit.js';
import { listDataRequests, resolveDataRequest } from '../lib/privacy.js';
import { listAmenities, saveAmenity, addBlackout } from '../lib/amenities.js';
import { today, normalizePhone, HttpError } from '../lib/util.js';
import { resetDemo } from '../lib/demoReset.js';

const r = Router();
const STAFF_ROLES = ['helpdesk', 'accounts', 'committee', 'guard', 'admin'];

// ---- Staff accounts ----------------------------------------------------------------
r.get('/users', h(async (req, res) => res.json(await many(`SELECT id, name, phone, role, active, pin_hash IS NOT NULL has_pin, created_at
  FROM users WHERE role <> 'resident' ORDER BY active DESC, role, name`))));
r.post('/users', h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = normalizePhone(req.body.phone);
  const role = req.body.role;
  if (!name || !/^[6-9]\d{9}$/.test(phone) || !STAFF_ROLES.includes(role)) throw new HttpError(400, 'Enter a name, a valid mobile number and a role.');
  if (role === 'guard' && !req.body.pin) throw new HttpError(400, 'Guards need a PIN to sign in on the gate tablet.');
  if (await one('SELECT 1 FROM users WHERE phone = $1', [phone])) throw new HttpError(409, 'This number is already registered.');
  const pinHash = req.body.pin ? await hashPin(req.body.pin) : null;
  const u = await tx(async () => {
    const row = await one('INSERT INTO users (name, phone, role, pin_hash) VALUES ($1, $2, $3, $4) RETURNING id', [name, phone, role, pinHash]);
    await audit(req.user, 'user.created', 'user', row.id, { name, role });
    return row;
  });
  res.json(u);
}));
r.patch('/users/:id', h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const u = await one("SELECT * FROM users WHERE id = $1 AND role <> 'resident'", [id]);
  if (!u) throw new HttpError(404, 'Not found');
  await tx(async () => {
    if (req.body.role && STAFF_ROLES.includes(req.body.role) && req.body.role !== u.role) {
      if (id === req.user.id) throw new HttpError(400, 'You cannot change your own role.');
      await q('UPDATE users SET role = $2 WHERE id = $1', [id, req.body.role]);
      await endAllSessions(id);
    }
    if (req.body.pin) await q('UPDATE users SET pin_hash = $2 WHERE id = $1', [id, await hashPin(req.body.pin)]);
    if (typeof req.body.active === 'boolean' && req.body.active !== u.active) {
      if (id === req.user.id) throw new HttpError(400, 'You cannot deactivate yourself.');
      await q('UPDATE users SET active = $2 WHERE id = $1', [id, req.body.active]);
      if (!req.body.active) await endAllSessions(id);
    }
    await audit(req.user, 'user.updated', 'user', id, { role: req.body.role, active: req.body.active, pinChanged: !!req.body.pin });
  });
  res.json({ ok: true });
}));

// ---- Gate tablets --------------------------------------------------------------------
r.get('/devices', h(async (req, res) => res.json(await many(`SELECT id, name, gate, active, token_hash IS NOT NULL paired,
  pairing_expires_at, created_at, last_seen_at FROM devices ORDER BY active DESC, gate, name`))));
r.post('/devices', h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const gate = String(req.body.gate || '').trim().slice(0, 30);
  if (!name || !gate) throw new HttpError(400, 'Name the tablet and its gate.');
  res.json(await tx(() => createDevice({ name, gate }, req.user)));
}));
r.post('/devices/:id/revoke', h(async (req, res) => {
  await tx(async () => {
    const d = await one('UPDATE devices SET active = false, token_hash = NULL WHERE id = $1 RETURNING id', [req.params.id]);
    if (!d) throw new HttpError(404, 'Not found');
    await q('DELETE FROM sessions WHERE device_id = $1', [req.params.id]);
    await audit(req.user, 'device.revoked', 'device', req.params.id, {});
  });
  res.json({ ok: true });
}));

// ---- Technicians (complaint assignment) ------------------------------------------------
r.get('/staff', h(async (req, res) => res.json(await many('SELECT * FROM staff ORDER BY active DESC, skill, name'))));
r.post('/staff', h(async (req, res) => {
  const { name, phone, skill, towers = '' } = req.body;
  if (!String(name || '').trim() || ![...CATEGORIES, 'duty_manager'].includes(skill)) throw new HttpError(400, 'Enter a name and a skill.');
  const s = await one('INSERT INTO staff (name, phone, skill, towers) VALUES ($1, $2, $3, $4) RETURNING *',
    [String(name).trim(), normalizePhone(phone) || null, skill, String(towers).toUpperCase().replace(/\s/g, '')]);
  await audit(req.user, 'staff.created', 'staff', s.id, { name, skill });
  res.json(s);
}));
r.patch('/staff/:id', h(async (req, res) => {
  const s = await one('UPDATE staff SET active = COALESCE($2, active), towers = COALESCE($3, towers), phone = COALESCE($4, phone) WHERE id = $1 RETURNING *',
    [Number(req.params.id) || 0, typeof req.body.active === 'boolean' ? req.body.active : null,
      req.body.towers != null ? String(req.body.towers).toUpperCase().replace(/\s/g, '') : null, req.body.phone ? normalizePhone(req.body.phone) : null]);
  if (!s) throw new HttpError(404, 'Not found');
  await audit(req.user, 'staff.updated', 'staff', s.id, req.body);
  res.json(s);
}));

// ---- Settings ------------------------------------------------------------------------------
r.get('/settings', h(async (req, res) => res.json(await getSettings())));
r.put('/settings', h(async (req, res) => {
  const b = req.body;
  const checks = {
    societyName: (v) => typeof v === 'string' && v.trim().length > 1,
    ratePerSqft: (v) => typeof v === 'number' && v > 0 && v < 100,
    billDay: (v) => Number.isInteger(v) && v >= 1 && v <= 28,
    dueDay: (v) => Number.isInteger(v) && v >= 1 && v <= 28,
    // A sanity range for the demonstration, not a legal limit (TDD, A2).
    interestRatePa: (v) => typeof v === 'number' && v >= 0 && v <= 0.21,
    visitorPhotoRetentionDays: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
    bankDetails: (v) => v === null || (typeof v === 'object' && typeof v.accountNumber === 'string'),
    sla: (v) => v && ['critical', 'high', 'medium', 'low'].every((k) => Number.isInteger(v[k]) && v[k] > 0),
    match: (v) => v && Number.isInteger(v.autoPostScore) && Number.isInteger(v.minLead),
    tally: (v) => v && typeof v === 'object' && ['per-flat', 'single'].includes(v.memberMode)
      && ['bankLedger', 'gatewayLedger', 'maintenanceLedger', 'interestLedger', 'amenityLedger', 'adjustmentLedger'].every((k) => typeof v[k] === 'string' && v[k].trim()),
  };
  const changed = {};
  for (const [k, v] of Object.entries(b)) {
    if (!(k in DEFAULTS)) continue;
    if (!checks[k]?.(v)) throw new HttpError(400, `Invalid value for ${k}${k === 'interestRatePa' ? ' (0% to 21% a year here; confirm the rate in the federation\'s bye-laws)' : ''}.`);
    changed[k] = v;
  }
  await tx(async () => {
    for (const [k, v] of Object.entries(changed)) await setSetting(k, v, req.user.name);
    await audit(req.user, 'settings.updated', 'settings', null, changed);
  });
  res.json(await getSettings());
}));

// ---- Notices ---------------------------------------------------------------------------------
r.post('/notices', h(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!title || !body) throw new HttpError(400, 'A notice needs a title and text.');
  const n = await one('INSERT INTO notices (title, body, posted_on, posted_by) VALUES ($1, $2, $3, $4) RETURNING *', [title, body, today(), req.user.id]);
  await audit(req.user, 'notice.posted', 'notice', n.id, { title });
  res.json(n);
}));
r.delete('/notices/:id', h(async (req, res) => {
  await q('DELETE FROM notices WHERE id = $1', [Number(req.params.id) || 0]);
  await audit(req.user, 'notice.deleted', 'notice', req.params.id, {});
  res.json({ ok: true });
}));

// ---- Amenities -------------------------------------------------------------------------------
r.get('/amenities', h(async (req, res) => res.json(await listAmenities(true))));
r.post('/amenities', h(async (req, res) => res.json(await saveAmenity(null, req.body, req.user))));
r.patch('/amenities/:id', h(async (req, res) => res.json(await saveAmenity(Number(req.params.id) || 0, req.body, req.user))));
r.get('/amenities/:id/blackouts', h(async (req, res) => res.json(await many('SELECT * FROM amenity_blackouts WHERE amenity_id = $1 AND on_date >= $2 ORDER BY on_date', [Number(req.params.id) || 0, today()]))));
r.post('/amenities/:id/blackouts', h(async (req, res) => res.json(await addBlackout(Number(req.params.id) || 0, req.body.date, req.body.reason, req.user))));

// ---- Data requests (DPDP) -------------------------------------------------------------------
r.get('/data-requests', h(async (req, res) => res.json(await listDataRequests())));
r.post('/data-requests/:id/resolve', h(async (req, res) => res.json(await resolveDataRequest(Number(req.params.id) || 0, req.body.outcome, req.body.response, req.user))));

// ---- Audit and messages ---------------------------------------------------------------------
r.get('/audit', h(async (req, res) => res.json(await many('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200'))));
r.get('/messages', h(async (req, res) => res.json(await many('SELECT id, at, channel, to_addr, body, status, provider_ref, error FROM messages ORDER BY id DESC LIMIT 100'))));

// Demo mode only (404 otherwise): restore the sample township. See lib/demoReset.js.
r.post('/demo/reset', h(async (req, res) => res.json(await resetDemo(req.user, req.meta))));

export default r;
