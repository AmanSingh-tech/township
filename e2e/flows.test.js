// End-to-end: the built app in headless Chrome against the test database.
// Run with `npm run test:e2e` (builds first). Set CHROME_PATH if Chrome is
// not at /usr/bin/google-chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const { bankCsv, deviceToken, ACCOUNTS, GUARD_PIN, closePool } = await import('../server/test/setup.js');
const { createApp } = await import('../server/app.js');
const { testOtps } = await import('../server/lib/auth.js');
const { one } = await import('../server/db.js');

let server, base, browser;
const errors = [];
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
});
after(async () => { await browser?.close(); server.close(); await closePool(); });

async function open(who, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'E2E note' : undefined));
  if (who) {
    await page.goto(base + '/login');
    await page.fill('input[aria-label="Mobile number"]', ACCOUNTS[who]);
    await page.click('button:has-text("Send code")');
    await page.waitForSelector('input[aria-label="Code"]');
    await page.fill('input[aria-label="Code"]', testOtps.get(ACCOUNTS[who]));
    await page.click('button:has-text("Sign in")');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return page;
}
const phone = { width: 390, height: 844 };

test('resident raises a complaint, help desk resolves it, resident rates it', async () => {
  const swati = await open('swati', phone);
  await swati.getByText('Overdue by 47 days', { exact: false }).waitFor();
  await swati.click('text=Raise a complaint');
  await swati.fill('textarea', 'Balcony door lock is broken and will not close');
  await swati.click('button:has-text("Submit")');
  await swati.getByText('Classified as', { exact: false }).waitFor();
  const id = Number(swati.url().split('/').pop());

  const desk = await open('helpdesk');
  await desk.click(`text=Balcony door lock is broken`);
  await desk.click('button:has-text("Mark resolved")');
  await desk.getByText('Marked resolved', { exact: false }).first().waitFor();

  await swati.reload();
  await swati.getByText('How was the fix?').waitFor();
  await swati.locator('button[aria-label="4"]').click();
  await swati.click('button:has-text("Confirm and close")');
  await swati.getByText('Closed with 4★').waitFor();
  assert.equal((await one('SELECT status, rating FROM complaints WHERE id = $1', [id])).rating, 4);
});

test('bank statement: manual posting needs a second person', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'statement.csv');
  fs.writeFileSync(file, bankCsv);
  const accounts = await open('accounts');
  await accounts.goto(base + '/desk/matching');
  await accounts.setInputFiles('input[type=file]', file);
  await accounts.getByText('Posted automatically').waitFor();
  await accounts.locator('.card', { hasText: 'MR S JOSHI' }).first().locator('button:has-text("Post here")').first().click();
  await accounts.goto(base + '/desk/approvals');
  await accounts.getByText('Waiting for someone else to approve').waitFor();

  const admin = await open('admin');
  await admin.goto(base + '/desk/approvals');
  await admin.locator('.card button:has-text("Approve")').click();
  await admin.getByText('Nothing waiting').waitFor();
  assert.equal((await one("SELECT COUNT(*) n FROM approvals WHERE status = 'approved'")).n, 1);
});

test('bills: accounts prepares, committee approves, then signs the report', async () => {
  const accounts = await open('accounts');
  await accounts.goto(base + '/desk/flats');
  await accounts.click('button:has-text("Prepare bills")');
  await accounts.getByText('Waiting for committee').waitFor();

  const committee = await open('committee');
  await committee.goto(base + '/desk/report');
  await committee.click('button:has-text("Approve and issue")');
  await committee.getByText('Bills waiting for your approval').waitFor({ state: 'detached' });
  await committee.click('button:has-text("Sign off")');
  await committee.getByText('Figures unchanged since signing').waitFor();
});

test('resident books the tennis court; the fee is added to dues', async () => {
  const aamir = await open('aamir', phone);
  const before = (await one("SELECT COALESCE(SUM(debit - credit), 0) n FROM ledger WHERE flat_id = 'T21-1601'")).n;
  await aamir.goto(base + '/book');
  await aamir.click('.chip:has-text("Tennis court")');
  const days = aamir.locator('.row .chip');
  await days.nth(2).click();
  await aamir.locator('button.chip:not([disabled])', { hasText: '07:00' }).click();
  await aamir.click('button:has-text("Book 07:00")');
  await aamir.getByText('Your bookings').waitFor();
  await aamir.locator('.list-item', { hasText: 'Tennis court' }).waitFor();
  const afterBal = (await one("SELECT COALESCE(SUM(debit - credit), 0) n FROM ledger WHERE flat_id = 'T21-1601'")).n;
  assert.equal(afterBal - before, 150);
});

test('guard logs a visitor on the tablet; the resident approves from the phone', async () => {
  const gate = await open(null, { width: 1180, height: 820 });
  await gate.goto(base + '/gate');
  await gate.evaluate((t) => localStorage.setItem('township.device', JSON.stringify({ deviceToken: t, name: 'Gate 1 tablet', gate: 'Gate 1' })), deviceToken);
  await gate.goto(base + '/gate');
  for (const d of ACCOUNTS.guard + GUARD_PIN) await gate.click(`.g-keys button[aria-label="${d}"]`);
  await gate.click('button:has-text("Sign in")');
  await gate.click('button:has-text("New visitor")');
  await gate.fill('input[placeholder="Visitor name"]', 'Courier Ravi');
  for (const d of '12' + '0408') await gate.click(`.g-keys button[aria-label="${d}"]`);
  await gate.click('button:has-text("Ask flat to approve")');
  await gate.locator('.g-visitor', { hasText: 'Courier Ravi' }).getByText('Waiting for flat').waitFor();

  const swati = await open('swati', phone);
  await swati.locator('.visitor', { hasText: 'Courier Ravi' }).locator('button:has-text("Approve")').click();
  await gate.locator('.g-visitor', { hasText: 'Courier Ravi' }).getByText('Let in').waitFor({ timeout: 10000 });

  await gate.click('button:has-text("मराठी")');
  await gate.getByText('नवीन पाहुणा').waitFor();
});

test('no browser errors on any page', () => {
  assert.deepEqual(errors, []);
});
