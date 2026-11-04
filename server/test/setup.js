// Every test file gets a freshly built database (township_test).
process.env.NODE_ENV = 'test';
process.env.TODAY = '2026-11-02';
process.env.RAZORPAY_KEY_ID ||= 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET ||= 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET ||= 'webhook_secret';
const fs = await import('node:fs');
const os = await import('node:os');
process.env.STORAGE_DIR ||= fs.mkdtempSync(`${os.tmpdir()}/township-files-`);

const fixtures = await import('../demo/fixtures.js');
export const { bankCsv, deviceToken, gatewayFlat } = await fixtures.loadFixtures();
export const { ACCOUNTS, GUARD_PIN, closePool } = fixtures;
