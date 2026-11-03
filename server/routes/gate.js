import { Router } from 'express';
import { h, allow } from '../http.js';
import { q, one, many, tx } from '../db.js';
import { send } from '../lib/notify.js';
import { savePhoto, fileUrl } from '../lib/storage.js';
import { today, HttpError } from '../lib/util.js';

// Guards only, and only from a paired tablet.
const r = Router();
r.use(allow('guard'), (req, res, next) => (req.user.device_id ? next() : next(new HttpError(403, 'Use a registered gate tablet.'))));
const startOfToday = () => new Date(today() + 'T00:00:00+05:30');

r.get('/flats', h(async (req, res) => res.json((await many('SELECT id FROM flats ORDER BY id')).map((f) => f.id))));
r.get('/visitors', h(async (req, res) => {
  const rows = await many(`SELECT id, flat_id, name, purpose, gate, status, created_at, client_id, photo_key
    FROM visitors WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 60`, [startOfToday()]);
  res.json(rows.map(({ photo_key: k, ...v }) => ({ ...v, photo: fileUrl(k) })));
}));

// Idempotent on client_id: the tablet retries entries it saved while offline.
r.post('/visitors', h(async (req, res) => {
  const b = req.body;
  const clientId = String(b.clientId || '').slice(0, 64) || null;
  const existing = clientId && await one('SELECT * FROM visitors WHERE client_id = $1', [clientId]);
  if (existing) return res.json(existing);
  if (!(await one('SELECT 1 FROM flats WHERE id = $1', [b.flatId]))) throw new HttpError(400, 'Unknown flat');
  const name = String(b.name || '').trim().slice(0, 80) || 'Visitor';
  const photoKey = b.photo ? await savePhoto(b.photo, { ownerKind: 'visitor', flatId: b.flatId, userId: req.user.id }) : null;
  const createdAt = b.createdAt && Math.abs(Date.now() - Date.parse(b.createdAt)) < 24 * 3600000 ? new Date(b.createdAt) : new Date();
  const row = await tx(async () => {
    let status = 'waiting', decidedBy = null, code = null;
    if (b.guestCode) {
      const g = await one(`UPDATE guest_codes SET used_at = now() WHERE code = $1 AND flat_id = $2 AND valid_on = $3 AND used_at IS NULL RETURNING code`,
        [String(b.guestCode), b.flatId, today()]);
      if (!g) throw new HttpError(400, 'Code not valid for this flat today');
      status = 'inside'; decidedBy = 'Guest code'; code = g.code;
    }
    const v = await one(`INSERT INTO visitors (flat_id, name, purpose, phone, photo_key, gate, status, guest_code, created_at, decided_at, decided_by, logged_by, device_id, client_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (client_id) DO NOTHING RETURNING *`,
    [b.flatId, name, String(b.purpose || '').slice(0, 40) || null, String(b.phone || '').slice(0, 15) || null, photoKey,
      String(b.gate || '').slice(0, 30) || null, status, code, createdAt, code ? createdAt : null, decidedBy, req.user.id, req.user.device_id, clientId]);
    if (v && status === 'waiting') {
      for (const u of await many('SELECT phone FROM users WHERE flat_id = $1 AND active', [b.flatId])) {
        await send('push', u.phone, `${name} is at ${b.gate || 'the gate'}. Tap to approve or deny.`, { title: 'Visitor at the gate', url: '/visitors', urgent: true });
      }
    }
    return v || one('SELECT * FROM visitors WHERE client_id = $1', [clientId]);
  });
  res.json({ ...row, photo: fileUrl(row.photo_key) });
}));
r.post('/code', h(async (req, res) => {
  const g = await one('SELECT * FROM guest_codes WHERE code = $1 AND valid_on = $2 AND used_at IS NULL', [String(req.body.code), today()]);
  if (!g) throw new HttpError(404, 'Code not valid today');
  res.json({ flatId: g.flat_id, guestName: g.guest_name, code: g.code });
}));
r.post('/visitors/:id/:action(enter|exit)', h(async (req, res) => {
  const [from, to] = req.params.action === 'enter' ? ['approved', 'inside'] : ['inside', 'left'];
  const v = await one('UPDATE visitors SET status = $3 WHERE id = $1 AND status = $2 RETURNING id', [Number(req.params.id) || 0, from, to]);
  if (!v) throw new HttpError(409, 'Status has changed. Refresh the list.');
  res.json({ ok: true, status: to });
}));
export default r;
