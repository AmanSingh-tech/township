import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env, isProd } from './env.js';
import { authenticate } from './lib/auth.js';
import { verifyWebhookSignature, settleOrder } from './lib/razorpay.js';
import { HttpError } from './lib/util.js';
import { checkFileUrl, readFile } from './lib/storage.js';
import { ROLES, allow, h } from './http.js';
import { ACCOUNTS, DEMO_LOGINS, GUARD_PIN } from './demo/accounts.js';
import * as Sentry from '@sentry/node';
import authRoutes from './routes/auth.js';
import residentRoutes from './routes/resident.js';
import deskRoutes from './routes/desk.js';
import gateRoutes from './routes/gate.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://checkout.razorpay.com",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com${env.SENTRY_DSN ? ` https://${new URL(env.SENTRY_DSN).host}` : ''}`,
        "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      ].join('; '),
    });
    if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Razorpay webhook needs the raw body for its signature, so it is mounted
  // before the JSON parser.
  app.post('/api/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), h(async (req, res) => {
    if (!verifyWebhookSignature(req.body, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'bad signature' });
    const event = JSON.parse(req.body.toString('utf8'));
    const p = event.payload?.payment?.entity;
    if (['payment.captured', 'order.paid'].includes(event.event) && p?.order_id) await settleOrder(p.order_id, p.id, 'webhook');
    res.json({ ok: true });
  }));

  app.use(express.json({ limit: '8mb' }));
  app.use(express.text({ type: 'text/csv', limit: '10mb' }));
  app.use('/api', (req, res, next) => { req.meta = { ip: req.ip, userAgent: req.get('user-agent') }; next(); });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/client-config', (req, res) => res.json({
    sentryDsn: env.SENTRY_DSN || null, environment: env.NODE_ENV,
    // Demo only: the sample township's logins, listed on the sign-in page.
    demoLogins: env.DEMO_DATA ? DEMO_LOGINS : null, guardLogin: env.DEMO_DATA ? { phone: ACCOUNTS.guard, pin: GUARD_PIN } : null,
  }));
  app.use('/api', authRoutes);
  app.get('/api/files/*', h(async (req, res) => {
    const key = req.params[0];
    if (!checkFileUrl(key, req.query.exp, req.query.sig)) throw new HttpError(403, 'This link has expired.');
    const f = await readFile(key);
    res.set({ 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=600', 'Content-Disposition': 'inline' }).send(f.body);
  }));

  app.use('/api', h(async (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    const user = await authenticate(token);
    if (!user) throw new HttpError(401, 'Please sign in again.');
    req.user = { ...user, ip: req.ip };
    req.token = token;
    next();
  }));
  app.use('/api', residentRoutes);
  app.use('/api/desk', deskRoutes);
  app.use('/api/gate', gateRoutes);
  app.use('/api/admin', allow(ROLES.admin), adminRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', setHeaders: (res, p) => p.endsWith('sw.js') && res.set('Cache-Control', 'no-cache') }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (!err.status || err.status >= 500) {
      console.error(err);
      if (env.SENTRY_DSN) Sentry.captureException(err, { user: req.user ? { id: String(req.user.id) } : undefined, tags: { path: req.path } });
    }
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' });
  });
  return app;
}
