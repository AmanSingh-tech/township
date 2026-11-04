// Floors on the evaluations (npm run eval prints the full report). These are
// the promises the brief asks for, so a change that breaks one fails the suite.
import { closePool } from './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { evaluateComplaints } = await import('../eval/complaints.js');
const { evaluateMatching } = await import('../eval/matching.js');
after(closePool);

test('triage: every hazard escalates, no false alarms, never wrong while sure', async () => {
  const r = await evaluateComplaints();
  assert.equal(r.safety.caught, r.safety.n, `missed: ${r.safety.missed.join(' | ')}`);
  assert.equal(r.safety.falseAlarms.length, 0, JSON.stringify(r.safety.falseAlarms));
  assert.equal(r.wrongButSure.length, 0, JSON.stringify(r.wrongButSure));
  assert.ok(r.categoryAccuracy >= 78, `category accuracy ${r.categoryAccuracy}%`);
  for (const lang of ['hi', 'mr']) assert.ok(r.byLanguage[lang].categoryAccuracy >= 65, `${lang} ${r.byLanguage[lang].categoryAccuracy}%`);
});

test('matching: never posts to the wrong flat, and saves most of the work', async () => {
  const r = await evaluateMatching();
  assert.equal(r.wrongAutoPosts, 0, JSON.stringify(r.wrongAutoExamples));
  assert.equal(r.notMaintenancePosted, 0);
  assert.ok(r.autoPosted >= 50, `auto-posted ${r.autoPosted}%`);
  assert.ok(r.queuedRightInTop3 >= 95, `right flat in top three ${r.queuedRightInTop3}%`);
  assert.ok(r.minutes.saved >= 80, `time saved ${r.minutes.saved}% (brief's target: 80%)`);
});
