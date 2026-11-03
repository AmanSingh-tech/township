import webpush from 'web-push';
import { env, pushEnabled } from '../env.js';
import { q, many } from '../db.js';

if (pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

// The server sends a request to each subscription's address, so only the
// browsers' own push services are accepted; anything else could point the
// server at internal addresses.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
export function validPushEndpoint(endpoint) {
  let u;
  try { u = new URL(String(endpoint)); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

export async function saveSubscription(userId, sub) {
  if (!validPushEndpoint(sub?.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid subscription');
  await q(`INSERT INTO push_subscriptions (endpoint, user_id, keys) VALUES ($1, $2, $3)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, keys = $3`, [sub.endpoint, userId, JSON.stringify(sub.keys)]);
}
export const removeSubscription = (endpoint, userId = null) =>
  q('DELETE FROM push_subscriptions WHERE endpoint = $1 AND ($2::int IS NULL OR user_id = $2)', [endpoint, userId]);

// Sends to every browser the person has turned alerts on in. Returns how many
// received it; subscriptions the push service says are gone are removed.
export async function pushToPhone(phone, body, data = {}) {
  if (!pushEnabled) return 0;
  const subs = await many('SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.phone = $1 AND u.active', [phone]);
  let sent = 0;
  const payload = JSON.stringify({ title: data.title || 'Township', body, url: data.url || '/' });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600, urgency: data.urgent ? 'high' : 'normal' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await removeSubscription(s.endpoint);
      else throw err;
    }
  }
  return sent;
}
