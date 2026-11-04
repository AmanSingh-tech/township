import { env, checkProductionConfig } from './env.js';
import * as Sentry from '@sentry/node';
import { migrate, pendingMigrations, pool, one } from './db.js';
import { createApp } from './app.js';
import { startOutboxWorker } from './lib/notify.js';
import { housekeeping } from './lib/housekeeping.js';

checkProductionConfig();
// Error reporting; personal data (phone numbers, names) is not sent.
if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, sendDefaultPii: false, tracesSampleRate: 0 });
if (env.MIGRATE_ON_START) await migrate();
else {
  const pending = await pendingMigrations();
  if (pending.length) {
    console.error(`Refusing to start: migrations not applied (${pending.join(', ')}). Run: npm run cli -- migrate`);
    process.exit(1);
  }
}

// Reviewer demo: the brief's sample flats and a populated township, loaded
// only when nobody has been set up yet, so it can never replace real data.
if (env.DEMO_DATA && !(await one('SELECT 1 FROM users LIMIT 1'))) {
  const { loadFixtures } = await import('./demo/fixtures.js');
  const { setSetting } = await import('./lib/settings.js');
  const { bankCsv } = await loadFixtures();
  await setSetting('demoBankStatement', bankCsv, 'demo');
  console.log('Demo data loaded: sample township, logins in deployment.md.');
}

const { isPaused } = await import('./lib/maintenance.js');
const run = () => (isPaused() ? Promise.resolve({}) : housekeeping())
  .then((r) => r.photosDeleted && console.log(`Deleted ${r.photosDeleted} visitor photos past retention`))
  .catch((e) => console.error('Housekeeping:', e.message));
await run();
setInterval(run, 6 * 3600000).unref();
const outbox = startOutboxWorker();

const server = createApp().listen(env.PORT, () => console.log(`Township API on http://localhost:${env.PORT} (${env.NODE_ENV})`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => outbox.stop() || server.close(() => pool.end().then(() => process.exit(0))));
}
