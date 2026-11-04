import { bankCsv, closePool } from './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { extractSignals, decide, matchStatement } = await import('../lib/matcher.js');
const { readBankStatement } = await import('../lib/csv.js');
const { recordPayment, flatStatus } = await import('../lib/billing.js');
const { tx } = await import('../db.js');
after(closePool);

test('flat numbers are read in the forms residents write them', () => {
  const flats = (s) => extractSignals({ narration: s, reference: '' }).flats;
  assert.deepEqual(flats('UPI/CR/1/X/a@b/T21-1601 maint'), ['T21-1601']);
  assert.deepEqual(flats('IMPS/P2A/1/SWATI J/flat T12 0408 sep'), ['T12-0408']);
  assert.deepEqual(flats('NEFT CR-SBIN-MEERA-TOWER 2 FLAT 1301'), ['T02-1301']);
  assert.deepEqual(flats('neft t7/902 oct'), ['T07-0902']);
});

test('UPI ID and UTR are extracted from a UPI narration', () => {
  const s = extractSignals({ narration: 'UPI/CR/431100007919/AAMIR SHAIKH/aamir.shaikh@okicici/T21-1601', reference: '' });
  assert.equal(s.vpa, 'aamir.shaikh@okicici');
  assert.equal(s.utr, '431100007919');
});

test('amount or name alone never posts, however high the score', () => {
  assert.equal(decide([{ flatId: 'T01-0101', score: 95, strong: false, reasons: [] }]).post, false);
});

test('two strong signals pointing at different flats go to the queue', () => {
  const d = decide([{ flatId: 'A', score: 120, strong: true, reasons: [] }, { flatId: 'B', score: 60, strong: true, reasons: [] }]);
  assert.equal(d.post, false);
  assert.match(d.why, /points to A and B/);
});

test('statement: every case lands where it should', async () => {
  const before = (await flatStatus('T21-1601')).totalDue;
  const res = await tx(() => matchStatement(readBankStatement(bankCsv), {
    post: async (flatId, row, sig) => (await recordPayment({ flatId, amount: row.amount, paidOn: row.date, method: 'bank', utr: sig.utr, postedBy: 'auto' }, { name: 'test' })).id,
  }));
  const by = (re) => res.find((r) => re.test(r.narration) && r.status !== 'duplicate');
  assert.equal(by(/AAMIR/).status, 'posted');
  assert.equal(by(/AAMIR/).flatId, 'T21-1601');
  assert.equal(res.filter((r) => /AAMIR/.test(r.narration) && r.status === 'duplicate').length, 1, 'repeated UTR is a duplicate');
  assert.equal(by(/SWATI J/).flatId, 'T12-0408');
  assert.equal(by(/MR S JOSHI/).status, 'queue', 'name and amount alone must not post');
  assert.equal(by(/rahul99/).status, 'queue', 'unknown payer');
  assert.equal(by(/advance 3 months/).status, 'queue', 'amount far above dues');
  assert.equal(by(/MSEDCL/).status, 'ignored', 'debits are not receipts');
  assert.equal(by(/RAZORPAY SOFTWARE/).status, 'reconciled', 'Razorpay settlement is not posted to a flat');
  assert.equal(res.filter((r) => r.status === 'queue' && /\/T\d\d-\d{4} maintenance/.test(r.narration)).length, 1, 'conflicting flat number and UPI ID');
  assert.ok(res.some((r) => r.status === 'reconciled' && /\/(T\d\d-\d{4})$/.test(r.narration)), 'credit with an in-app payment UTR is reconciled');
  assert.ok((await flatStatus('T21-1601')).totalDue < before, 'posting reduced Aamir’s dues');
});

test('matching time: the committee report and the evaluation share one model', async () => {
  const { matchingTime, MINUTES } = await import('../lib/matchtime.js');
  const r = matchingTime([
    { status: 'posted', flatId: 'T07-1203', topSuggestion: 'T07-1203' },        // posted by the app: 0 min
    { status: 'reconciled', flatId: 'T21-1601', topSuggestion: null },          // online payment already recorded: 0
    { status: 'resolved', flatId: 'T12-0408', topSuggestion: 'T12-0408' },      // a person confirmed the right suggestion: 0.5
    { status: 'resolved', flatId: 'T12-0408', topSuggestion: 'T21-1601' },      // the suggestion was wrong: 2
    { status: 'queue', flatId: null, topSuggestion: 'T07-1203' },               // still waiting: counted as the worst case, 2
    { status: 'duplicate', flatId: null, topSuggestion: null },                 // not a credit to match
    { status: 'ignored', flatId: null, topSuggestion: null },                   // not maintenance
  ]);
  assert.equal(MINUTES.manual, 2);
  assert.equal(r.credits, 5);
  assert.deepEqual(r.minutes, { manual: 10, withApp: 4.5 });
  assert.equal(r.share, 0.45);
  assert.equal(r.autoRate, 0.4);
});
