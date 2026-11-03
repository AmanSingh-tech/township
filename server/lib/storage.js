import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../env.js';
import { q, one } from '../db.js';
import { HttpError } from './util.js';

// Photos are kept in object storage (S3 in ap-south-1 in production, a local
// folder in development). The database keeps only the key, and photos are
// served through short-lived signed links issued after a permission check.
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'jpg'],
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png'],
  ['image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', 'webp'],
];

let s3;
const client = () => (s3 ||= new S3Client({ region: env.AWS_REGION }));
const localPath = (key) => {
  const p = path.resolve(env.STORAGE_DIR, key);
  if (!p.startsWith(path.resolve(env.STORAGE_DIR) + path.sep)) throw new HttpError(400, 'Bad key');
  return p;
};

// Accepts a data URL from the app; checks it is really an image.
export function decodeImage(dataUrl) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'The photo could not be read.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'The photo is too large.');
  const type = TYPES.find(([, test]) => test(buf));
  if (!type) throw new HttpError(400, 'Only JPEG, PNG or WebP photos are accepted.');
  return { buf, contentType: type[0], ext: type[2] };
}

export async function savePhoto(dataUrl, { ownerKind, flatId, userId }) {
  const { buf, contentType, ext } = decodeImage(dataUrl);
  const day = new Date().toISOString().slice(0, 7).replace('-', '/');
  const key = `${ownerKind}/${day}/${crypto.randomUUID()}.${ext}`;
  if (env.STORAGE === 's3') {
    // Encrypted with the bucket's default key (the township's KMS key).
    await client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buf, ContentType: contentType }));
  } else {
    await fs.mkdir(path.dirname(localPath(key)), { recursive: true });
    await fs.writeFile(localPath(key), buf);
  }
  await q('INSERT INTO files (key, content_type, bytes, owner_kind, flat_id, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [key, contentType, buf.length, ownerKind, flatId, userId || null]);
  return key;
}

export async function readFile(key) {
  const meta = await one('SELECT * FROM files WHERE key = $1', [key]);
  if (!meta) throw new HttpError(404, 'Not found');
  if (env.STORAGE === 's3') {
    const out = await client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return { body: Buffer.from(await out.Body.transformToByteArray()), contentType: meta.content_type };
  }
  return { body: await fs.readFile(localPath(key)), contentType: meta.content_type };
}

export async function deleteFile(key) {
  if (env.STORAGE === 's3') await client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  else await fs.rm(localPath(key), { force: true });
  await q('DELETE FROM files WHERE key = $1', [key]);
}

// Signed links: valid for 15 minutes, tied to one key.
const sign = (key, exp) => crypto.createHmac('sha256', env.FILE_URL_SECRET).update(`${key}|${exp}`).digest('base64url');
export function fileUrl(key) {
  if (!key) return null;
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  return `/api/files/${key}?exp=${exp}&sig=${sign(key, exp)}`;
}
export function checkFileUrl(key, exp, sig) {
  if (!(Number(exp) > Date.now() / 1000)) return false;
  const want = sign(key, exp);
  return typeof sig === 'string' && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
