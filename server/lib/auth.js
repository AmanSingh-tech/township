import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, one, val, tx } from '../db.js';
import { env, smsEnabled } from '../env.js';
import { randomToken, randomDigits, sha256, normalizePhone, HttpError } from './util.js';
import { sendOtpSms } from './sms.js';
import { audit } from './audit.js';

const scrypt = promisify(crypto.scrypt);
const OTP_TTL_MIN = 5;
const OTP_MAX_TRIES = 5;
const LIMITS = {
  'otp-phone': { max: 3, minutes: 60 },     // codes sent to one number
  'otp-ip': { max: 20, minutes: 60 },       // codes requested from one address
  'verify-ip': { max: 30, minutes: 15 },    // wrong codes from one address
  'pin-user': { max: 5, minutes: 15 },      // wrong PINs for one guard
};
export const SESSION_HOURS = { resident: 24 * 30, guard: 12, helpdesk: 12, accounts: 12, committee: 12, admin: 12 };

// Codes are only exposed to the test suite, never over HTTP.
export const testOtps = new Map();

async function limited(kind, key) {
  const { max, minutes } = LIMITS[kind];
  const n = await val(`SELECT COUNT(*) FROM auth_attempts WHERE kind = $1 AND key = $2 AND at > now() - make_interval(mins => $3)`, [kind, key, minutes]);
  return n >= max;
}
const note = (kind, key) => q('INSERT INTO auth_attempts (kind, key) VALUES ($1, $2)', [kind, key]);
const codeHash = (phone, code) => sha256(`${phone}:${code}`);

export async function requestOtp(rawPhone, ip) {
  const phone = normalizePhone(rawPhone);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  if (await limited('otp-ip', ip)) throw new HttpError(429, 'Too many requests. Please try again later.');
  await note('otp-ip', ip);
  const user = await one("SELECT * FROM users WHERE phone = $1 AND active AND role <> 'guard'", [phone]);
  // Same reply whether or not the number is registered, so the endpoint
  // cannot be used to discover who lives here.
  if (!user) return;
  if (await limited('otp-phone', phone)) throw new HttpError(429, 'Too many codes sent to this number. Please try again in an hour.');
  await note('otp-phone', phone);
  const code = randomDigits(6);
  await q(`INSERT INTO otps (phone, code_hash, expires_at, attempts) VALUES ($1, $2, now() + make_interval(mins => $3), 0)
    ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = now() + make_interval(mins => $3), attempts = 0`, [phone, codeHash(phone, code), OTP_TTL_MIN]);
  if (env.NODE_ENV === 'test') { testOtps.set(phone, code); return; }
  if (smsEnabled) {
    await sendOtpSms(phone, code);
  } else if (env.NODE_ENV === 'development') {
    console.log(`\n  Login code for ${phone}: ${code}  (SMS not configured; development only)\n`);
  } else {
    throw new HttpError(503, 'Login by SMS is not available right now.');
  }
}

export async function verifyOtp(rawPhone, code, meta) {
  const phone = normalizePhone(rawPhone);
  if (await limited('verify-ip', meta.ip)) throw new HttpError(429, 'Too many attempts. Please try again later.');
  // Redeeming is one atomic statement, so a code works once even if two
  // requests race. Failed checks are counted outside any transaction so a
  // rollback can never undo them.
  const redeemed = await one(`DELETE FROM otps WHERE phone = $1 AND code_hash = $2 AND expires_at > now() AND attempts < $3 RETURNING phone`,
    [phone, codeHash(phone, String(code || '')), OTP_MAX_TRIES]);
  if (!redeemed) {
    const otp = await one('UPDATE otps SET attempts = attempts + 1 WHERE phone = $1 RETURNING attempts', [phone]);
    await note('verify-ip', meta.ip);
    throw new HttpError(401, otp && otp.attempts >= OTP_MAX_TRIES ? 'Too many wrong codes. Request a new one.' : 'That code is not right or has expired.');
  }
  const user = await one("SELECT * FROM users WHERE phone = $1 AND active AND role <> 'guard'", [phone]);
  if (!user) throw new HttpError(401, 'This number is not registered.');
  return tx(() => createSession(user, meta));
}

export async function createSession(user, { ip, userAgent, deviceId = null }) {
  const token = randomToken();
  const hours = SESSION_HOURS[user.role] || 12;
  await q(`INSERT INTO sessions (token_hash, user_id, device_id, expires_at, ip, user_agent)
    VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`, [sha256(token), user.id, deviceId, hours, ip, (userAgent || '').slice(0, 200)]);
  await audit({ ...user, ip }, 'auth.login', 'user', user.id, { role: user.role, deviceId });
  return { token, user: publicUser(user), expiresInHours: hours };
}

export const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, flat_id: u.flat_id, relation: u.relation, lang: u.lang, consent_at: u.consent_at });

export async function authenticate(token) {
  if (!token) return null;
  const s = await one(`SELECT u.*, s.token_hash, s.device_id, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [sha256(token)]);
  if (s && Date.now() - new Date(s.last_seen_at) > 5 * 60000) {
    await q('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [s.token_hash]);
  }
  return s;
}

export const endSession = (token) => q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
export const endAllSessions = (userId) => q('DELETE FROM sessions WHERE user_id = $1', [userId]);

// ---- PINs for guards ---------------------------------------------------------
export async function hashPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin))) throw new HttpError(400, 'PIN must be 4 to 8 digits.');
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pin), salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function checkPin(pin, stored) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const key = await scrypt(String(pin), Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

// ---- Gate tablets: paired once, then guards sign in with phone + PIN ---------
export async function createDevice({ name, gate }, actor) {
  const code = randomDigits(8);
  const d = await one(`INSERT INTO devices (name, gate, pairing_code_hash, pairing_expires_at, created_by)
    VALUES ($1, $2, $3, now() + interval '24 hours', $4) RETURNING id, name, gate`, [name, gate, sha256(code), actor.id]);
  await audit(actor, 'device.created', 'device', d.id, { name, gate });
  return { ...d, pairingCode: code };
}

export async function pairDevice(code, ip) {
  if (await limited('verify-ip', ip)) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const d = await one('SELECT * FROM devices WHERE pairing_code_hash = $1 AND pairing_expires_at > now() AND active', [sha256(String(code))]);
  if (!d) { await note('verify-ip', ip); throw new HttpError(401, 'That pairing code is not valid.'); }
  const token = randomToken();
  await q('UPDATE devices SET token_hash = $2, pairing_code_hash = NULL, pairing_expires_at = NULL, last_seen_at = now() WHERE id = $1', [d.id, sha256(token)]);
  await audit({ name: d.name, ip }, 'device.paired', 'device', d.id, {});
  return { deviceToken: token, name: d.name, gate: d.gate };
}

export async function deviceFromToken(token) {
  if (!token) return null;
  return one('SELECT * FROM devices WHERE token_hash = $1 AND active', [sha256(token)]);
}

export async function pinLogin(rawPhone, pin, deviceToken, meta) {
  const device = await deviceFromToken(deviceToken);
  if (!device) throw new HttpError(401, 'This tablet is not registered. Ask the office to pair it.');
  const phone = normalizePhone(rawPhone);
  if (await limited('pin-user', phone)) throw new HttpError(429, 'Too many wrong PINs. Try again in 15 minutes.');
  const user = await one("SELECT * FROM users WHERE phone = $1 AND active AND role = 'guard'", [phone]);
  if (!user || !(await checkPin(pin, user.pin_hash))) {
    await note('pin-user', phone);
    throw new HttpError(401, 'Phone number or PIN is not right.');
  }
  await q('UPDATE devices SET last_seen_at = now() WHERE id = $1', [device.id]);
  return { ...(await createSession(user, { ...meta, deviceId: device.id })), gate: device.gate, deviceName: device.name };
}
