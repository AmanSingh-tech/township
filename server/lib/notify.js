import { q, many } from '../db.js';
import { env } from '../env.js';
import { sendAlertSms, SmsUnavailable } from './sms.js';
import { pushToPhone } from './push.js';
import { isPaused } from './maintenance.js';

// Outbox: send() records the message inside the caller's transaction, and a
// worker delivers it after commit. A message is never lost because a request
// failed halfway, and never sent for an action that was rolled back.
// Urgent messages (a visitor waiting at the gate, a safety alert) jump ahead
// of bulk ones such as a month's bill alerts.
export const URGENT = 0;
const NORMAL = 5;
export async function send(channel, to, body, data = null) {
  const priority = channel === 'sms-alert' || data?.urgent ? URGENT : NORMAL;
  await q('INSERT INTO messages (channel, to_addr, body, data, priority) VALUES ($1, $2, $3, $4, $5)',
    [channel, to, body, data && JSON.stringify(data), priority]);
}

async function deliver(m) {
  if (m.channel === 'sms-alert' && m.to_addr) return sendAlertSms(m.to_addr, m.body);
  if (m.channel === 'push' && m.to_addr) {
    const n = await pushToPhone(m.to_addr, m.body, m.data || {});
    if (!n) throw new SmsUnavailable('Alerts not turned on for this person');
    return `${n} device${n > 1 ? 's' : ''}`;
  }
  throw new SmsUnavailable(`No provider for ${m.channel}`);
}

// Claims a batch in a short transaction, then delivers it outside any
// transaction, several at a time, so slow providers never hold locks. A claim
// left by a worker that died mid-batch is retried after five minutes.
export async function drainOutbox(limit = 50, parallel = 10) {
  const batch = await many(`UPDATE messages SET status = 'sending', claimed_at = now() WHERE id IN (
      SELECT id FROM messages WHERE status = 'queued' OR (status = 'sending' AND claimed_at < now() - interval '5 minutes')
      ORDER BY priority, id LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [limit]);
  batch.sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, batch.length) }, async () => {
    while (next < batch.length) {
      const m = batch[next++];
      let status = 'sent', ref = null, error = null;
      try { ref = await deliver(m); } catch (err) {
        status = err instanceof SmsUnavailable ? 'skipped' : 'failed';
        error = err.message;
      }
      await q('UPDATE messages SET status = $2, provider_ref = $3, error = $4 WHERE id = $1', [m.id, status, ref, error]);
      if (env.NODE_ENV === 'development' && batch.length < 20) console.log(`[${m.channel} → ${m.to_addr}] ${status}: ${m.body}`);
    }
  }));
  return batch.length;
}

// Keeps draining while there is work; checks for new messages every second.
export function startOutboxWorker(idleMs = 1000) {
  let stopped = false, timer = null;
  const loop = async () => {
    try { while (!stopped && !isPaused() && (await drainOutbox()) > 0); } catch (e) { console.error('Outbox:', e.message); }
    if (!stopped) timer = setTimeout(loop, idleMs).unref();
  };
  loop();
  return { stop: () => { stopped = true; clearTimeout(timer); } };
}
