// Reads and validates configuration from the environment once, at startup.
// Paid services are optional: without their credentials the app runs on free
// placeholders, each clearly labelled where people see it and logged at start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dotenv = path.join(root, process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
if (fs.existsSync(dotenv)) {
  for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const e = process.env;
const bool = (v) => /^(1|true|yes)$/i.test(v || '');
// On AWS the database password comes from the secret RDS manages and rotates,
// as separate PG* variables; DATABASE_URL is built from them.
if (!e.DATABASE_URL && e.PGHOST && e.PGPASSWORD) {
  e.DATABASE_URL = `postgres://${encodeURIComponent(e.PGUSER || 'township')}:${encodeURIComponent(e.PGPASSWORD)}@${e.PGHOST}:${e.PGPORT || 5432}/${e.PGDATABASE || 'township'}`;
}

export const env = {
  NODE_ENV: e.NODE_ENV || 'development',
  PORT: Number(e.PORT) || 4000,
  PUBLIC_URL: e.PUBLIC_URL || 'http://localhost:5173',
  DATABASE_URL: e.DATABASE_URL || (e.NODE_ENV === 'test'
    ? 'postgres://township:township@localhost:5440/township_test'
    : 'postgres://township:township@localhost:5440/township'),
  DATABASE_SSL: bool(e.DATABASE_SSL),
  // Certificates the database server is checked against; defaults to Amazon RDS's bundle.
  DATABASE_SSL_CA: e.DATABASE_SSL_CA || path.join(root, 'server', 'assets', 'rds-global-bundle.pem'),
  DB_POOL_MAX: Number(e.DB_POOL_MAX) || 10,
  // false where the app connects as a role that cannot change the schema;
  // migrations then run as a separate step (npm run cli -- migrate).
  MIGRATE_ON_START: e.MIGRATE_ON_START ? bool(e.MIGRATE_ON_START) : true,
  TRUST_PROXY: bool(e.TRUST_PROXY),
  TODAY: e.TODAY || null,
  // Loads the sample township on first start, only into a database with no users.
  DEMO_DATA: bool(e.DEMO_DATA),

  SMS_PROVIDER: e.SMS_PROVIDER || '',            // 'msg91'
  MSG91_AUTH_KEY: e.MSG91_AUTH_KEY || '',
  MSG91_OTP_TEMPLATE_ID: e.MSG91_OTP_TEMPLATE_ID || '',
  MSG91_ALERT_TEMPLATE_ID: e.MSG91_ALERT_TEMPLATE_ID || '',

  RAZORPAY_KEY_ID: e.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: e.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: e.RAZORPAY_WEBHOOK_SECRET || '',

  STORAGE: e.STORAGE || 'local',               // 'local' (development) or 's3'
  STORAGE_DIR: e.STORAGE_DIR || path.join(root, 'uploads'),
  S3_BUCKET: e.S3_BUCKET || '',
  AWS_REGION: e.AWS_REGION || 'ap-south-1',
  FILE_URL_SECRET: e.FILE_URL_SECRET || (e.NODE_ENV === 'production' ? '' : 'dev-only-file-url-secret'),

  VAPID_PUBLIC_KEY: e.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: e.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: e.VAPID_SUBJECT || 'mailto:office@example.com',

  SENTRY_DSN: e.SENTRY_DSN || '',
  ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY || '',
  CLASSIFIER: e.CLASSIFIER || '',
};

export const isProd = env.NODE_ENV === 'production';
export const smsEnabled = env.SMS_PROVIDER === 'msg91' && !!env.MSG91_AUTH_KEY && !!env.MSG91_OTP_TEMPLATE_ID;
export const paymentsEnabled = !!env.RAZORPAY_KEY_ID && !!env.RAZORPAY_KEY_SECRET;
export const pushEnabled = !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
// Placeholders: login codes shown on the sign-in screen instead of sent by
// SMS; online payments through a test gateway that moves no money.
export const loginCodeOnScreen = !smsEnabled;
export const paymentProvider = paymentsEnabled ? 'razorpay' : 'placeholder';

export function checkProductionConfig() {
  if (!isProd) return;
  const missing = [];
  if (!e.DATABASE_URL) missing.push('DATABASE_URL (or PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
  if (!env.FILE_URL_SECRET || env.FILE_URL_SECRET.length < 32) missing.push('FILE_URL_SECRET (32+ random characters)');
  if (paymentsEnabled && !env.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET (needed with Razorpay keys)');
  if (env.STORAGE === 's3' && !env.S3_BUCKET) missing.push('S3_BUCKET (needed with STORAGE=s3)');
  if (missing.length) {
    console.error(`Refusing to start in production. Missing configuration:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  const placeholders = [
    !smsEnabled && 'SMS: not set up; login codes are shown on the sign-in screen',
    !paymentsEnabled && 'Payments: Razorpay not set up; online payment uses the test gateway (no money moves)',
    env.STORAGE !== 's3' && `Photos: stored on this server's disk (${env.STORAGE_DIR})`,
    !pushEnabled && 'Push alerts: off (npm run cli -- vapid-keys)',
    env.DEMO_DATA && 'Demo data: the sample township loads into an empty database',
  ].filter(Boolean);
  if (placeholders.length) console.warn(`Running with placeholders:\n  ${placeholders.join('\n  ')}`);
}
