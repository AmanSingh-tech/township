// Operations commands:
//   npm run cli -- migrate
//   npm run cli -- create-admin --name "Priya Patil" --phone 9876543210
//   npm run cli -- vapid-keys          (keys for push notifications; put them in .env)
//   npm run cli -- grant-app-role      (production: the app's own database role, from APP_DB_USER and APP_DB_PASSWORD)
//   npm run cli -- verify              (after a restore: the books add up and the safeguards are in place)
import { migrate, one, pool } from './db.js';
import { grantAppRole, verifyIntegrity } from './lib/dbroles.js';
import { audit } from './lib/audit.js';
import { normalizePhone } from './lib/util.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

try {
  // verify and vapid-keys only read, so they also work as the app's own role.
  if (!['verify', 'vapid-keys'].includes(cmd)) await migrate();
  if (cmd === 'vapid-keys') {
    const { default: webpush } = await import('web-push');
    const k = webpush.generateVAPIDKeys();
    console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
  } else if (cmd === 'create-admin') {
    const name = arg('name');
    const phone = normalizePhone(arg('phone'));
    if (!name || !/^[6-9]\d{9}$/.test(phone)) throw new Error('Usage: create-admin --name "Full Name" --phone 98XXXXXXXX');
    const u = await one(`INSERT INTO users (name, phone, role) VALUES ($1, $2, 'admin')
      ON CONFLICT (phone) DO UPDATE SET role = 'admin', active = true RETURNING id`, [name, phone]);
    await audit({ name: 'cli' }, 'user.created', 'user', u.id, { name, role: 'admin' });
    console.log(`Admin ${name} (${phone}) can now sign in with an SMS code.`);
  } else if (cmd === 'grant-app-role') {
    await grantAppRole(process.env.APP_DB_USER, process.env.APP_DB_PASSWORD);
    console.log(`Role ${process.env.APP_DB_USER} can read and write data, and cannot change the schema or append-only records.`);
  } else if (cmd === 'verify') {
    const checks = await verifyIntegrity();
    console.table(checks);
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  } else if (cmd !== 'migrate') {
    throw new Error('Commands: migrate, create-admin, vapid-keys, grant-app-role, verify');
  } else {
    console.log('Database is up to date.');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
