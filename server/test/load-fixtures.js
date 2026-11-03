// Loads fixtures into the local development database. Refuses anywhere else.
import fs from 'node:fs';
import { env } from '../env.js';

if (env.NODE_ENV === 'production' || !/@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL)) {
  console.error('Fixtures only load into a local development database.');
  process.exit(1);
}
const { loadFixtures, closePool, ACCOUNTS, GUARD_PIN } = await import('./fixtures.js');
const { bankCsv, deviceToken } = await loadFixtures();
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/bank-statement.csv', bankCsv);
fs.writeFileSync('tmp/gate-device-token.txt', deviceToken);
console.log('Development fixtures loaded. Sign in with these numbers; codes print in the API log.');
console.table(ACCOUNTS);
console.log(`Guard PIN: ${GUARD_PIN}. Bank statement: tmp/bank-statement.csv`);
await closePool();
