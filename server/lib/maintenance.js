// A pause for operations that rebuild the data, such as the demo reset.
// While it is on, API requests get a 503 with a retry hint (except the health
// check) and the background workers stand still. Requests already running are
// allowed to finish first, so nothing is cut off half-way.
//
// The flag lives in this process, which is right for the demo's single
// process. With several app processes it would live in the database.
import { HttpError } from './util.js';

let reason = null;
let inflight = 0;

export const isPaused = () => reason !== null;

export function maintenanceGate(req, res, next) {
  if (req.path === '/health') return next();
  if (reason) {
    res.set('Retry-After', '15');
    return res.status(503).json({ error: `${reason}. Please try again in a moment.` });
  }
  inflight++;
  let done = false;
  const end = () => { if (!done) { done = true; inflight--; } };
  res.on('finish', end);
  res.on('close', end);
  next();
}

// Runs fn with everything else paused. The caller's own request is one of the
// requests in flight, so it waits until it is the only one left.
export async function withMaintenance(why, fn, { drainMs = 15000 } = {}) {
  if (reason) throw new HttpError(409, 'A reset is already running.');
  reason = why;
  try {
    const until = Date.now() + drainMs;
    while (inflight > 1 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (inflight > 1) throw new HttpError(503, 'Other requests did not finish in time, so nothing was changed. Try again.');
    return await fn();
  } finally {
    reason = null;
  }
}
