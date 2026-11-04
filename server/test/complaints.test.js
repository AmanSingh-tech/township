import { closePool } from './setup.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { safetyCheck, classifyLocal } = await import('../lib/classifier.js');
const { createComplaint } = await import('../lib/complaints.js');
const { one, many } = await import('../db.js');
after(closePool);

test('safety words escalate in English, Hindi and Marathi', () => {
  for (const s of ['There is a fire in the meter room', 'gas smell in kitchen', 'smell of gas near lift lobby', 'my son is stuck in the lift',
    'got a shock from the switch', 'sparking from the DB box', 'रसोई में गैस की बदबू', 'लिफ्ट में फंसे हैं', 'मीटरजवळ आग लागली', 'स्विचला करंट आहे']) {
    assert.ok(safetyCheck(s), s);
  }
});

test('ordinary complaints do not trip the safety rule', () => {
  for (const s of ['lift band hai T7', 'Lift not working since morning', 'Gas cylinder delivery not allowed in', 'tap leaking', 'stuck drain in balcony']) {
    assert.equal(safetyCheck(s), null, s);
  }
});

test('local classifier picks sensible categories', () => {
  assert.equal(classifyLocal('Water leak under the kitchen sink').category, 'Plumbing');
  assert.equal(classifyLocal('Corridor light not working').category, 'Electrical');
  assert.equal(classifyLocal('Cockroaches in the duct').category, 'Pest control');
  assert.equal(classifyLocal('Someone parked in my slot').category, 'Parking');
});

test('a safety complaint is escalated to the duty manager and an alert is queued', async () => {
  const u = await one("SELECT id FROM users WHERE flat_id = 'T21-1601' AND relation = 'owner'");
  const id = await createComplaint({ flatId: 'T21-1601', userId: u.id, actor: 'test', text: 'Sparks coming from the switchboard in hall' });
  const c = await one('SELECT c.*, s.skill FROM complaints c JOIN staff s ON s.id = c.assignee_id WHERE c.id = $1', [id]);
  assert.equal(c.escalated, true);
  assert.equal(c.urgency, 'critical');
  assert.equal(c.skill, 'duty_manager');
  assert.ok(await one("SELECT 1 FROM messages WHERE channel = 'sms-alert' AND body LIKE $1", [`%Complaint #${id}%`]));
});

test('the same lift reported by several flats is linked, never closed', async () => {
  const lift = await many("SELECT * FROM complaints WHERE category = 'Lift' AND flat_id LIKE 'T07%' ORDER BY id");
  const root = lift.find((c) => !c.duplicate_of);
  const dups = lift.filter((c) => c.duplicate_of === root.id);
  assert.ok(dups.length >= 3);
  assert.ok(dups.every((c) => c.status !== 'closed'));
});

test('a hazard sets the category by rule, and the model\'s guess is kept for the record', async () => {
  const { createComplaint } = await import('../lib/complaints.js');
  const { one: row } = await import('../db.js');
  const u = await row("SELECT * FROM users WHERE phone = '9822010003'");
  const id = await createComplaint({ flatId: u.flat_id, userId: u.id, actor: u.name, text: 'Strong smell of gas near the kitchen pipeline since morning' });
  const c = await row('SELECT * FROM complaints WHERE id = $1', [id]);
  assert.equal(c.category, 'Safety');
  assert.equal(c.urgency, 'critical');
  assert.equal(c.escalated, true);
  assert.equal(c.ai_category, 'Housekeeping', 'the keyword model read "smell" as housekeeping; the rule overrides it');
});

test('one keyword is a guess, not certainty', async () => {
  const one = classifyLocal('Bad smell in the corridor');
  assert.ok(one.confidence <= 0.6, `confidence ${one.confidence}`);
  const many = classifyLocal('Kitchen tap leaking and the drain pipe is blocked, water overflow');
  assert.equal(many.category, 'Plumbing');
  assert.ok(many.confidence > 0.9, `confidence ${many.confidence}`);
});
