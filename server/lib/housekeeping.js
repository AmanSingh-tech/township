import { q, many } from '../db.js';
import { getSettings } from './settings.js';
import { deleteFile } from './storage.js';

// DPDP Act 2023: visitor photos are deleted after the retention period.
// Also clears expired sessions, codes and rate-limit records, and guest codes
// 90 days past their date (they hold guests' names, and six-digit codes are
// unique, so old ones would slowly use up the space).
export async function housekeeping() {
  const { visitorPhotoRetentionDays: days } = await getSettings();
  const old = await many('SELECT photo_key FROM visitors WHERE photo_key IS NOT NULL AND created_at < now() - make_interval(days => $1)', [days]);
  for (const v of old) await deleteFile(v.photo_key);
  await q('UPDATE visitors SET photo = NULL WHERE photo IS NOT NULL AND created_at < now() - make_interval(days => $1)', [days]);
  await q('DELETE FROM sessions WHERE expires_at < now()');
  await q("DELETE FROM otps WHERE expires_at < now() - interval '1 day'");
  await q("DELETE FROM auth_attempts WHERE at < now() - interval '2 days'");
  await q("DELETE FROM guest_codes WHERE valid_on < current_date - 90");
  return { photosDeleted: old.length };
}
