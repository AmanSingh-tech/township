const KEY = 'township.session';
const DEVICE = 'township.device';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
export function setSession(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export function getDevice() {
  try { return JSON.parse(localStorage.getItem(DEVICE)) || null; } catch { return null; }
}
export function setDevice(d) {
  try { d ? localStorage.setItem(DEVICE, JSON.stringify(d)) : localStorage.removeItem(DEVICE); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const s = getSession();
  const opts = { method, headers: { ...headers } };
  if (s?.token) opts.headers.Authorization = `Bearer ${s.token}`;
  const d = getDevice();
  if (d?.deviceToken) opts.headers['X-Device-Token'] = d.deviceToken;
  if (body !== undefined) {
    if (typeof body === 'string') opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch('/api' + path, opts); } catch { throw new ApiError('You seem to be offline. Please try again.', 0); }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && s) { const guard = s.user?.role === 'guard'; setSession(null); location.href = guard ? '/gate' : '/login'; }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong', res.status);
  return data;
}
