// Scores complaint triage on a labelled set (complaints.json): the same path a
// real complaint takes — the safety rule first, then the classifier.
// Labels follow the urgency rules given to the model (lib/classifier.js), not
// the keyword lists, so the local model is not graded on its own vocabulary.
import fs from 'node:fs';
import { classify, classifyLocal, safetyCheck, safetyCategory, UNSURE_BELOW, URGENCIES } from '../lib/classifier.js';

export const SET = JSON.parse(fs.readFileSync(new URL('./complaints.json', import.meta.url), 'utf8'));

export async function triage(text, { model = 'local' } = {}) {
  const ai = model === 'claude' ? await classify(text) : classifyLocal(text);
  const hazard = safetyCheck(text);
  return {
    category: hazard ? safetyCategory(hazard) : ai.category,
    urgency: hazard ? 'critical' : ai.urgency,
    confidence: ai.confidence, hazard, aiCategory: ai.category, source: ai.source,
  };
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export async function evaluateComplaints({ model = 'local', set = SET } = {}) {
  const rows = [];
  for (const item of set) rows.push({ ...item, got: await triage(item.text, { model }) });
  const ok = (r) => r.got.category === r.category;
  const urgOk = (r) => r.got.urgency === r.urgency;
  const near = (r) => Math.abs(URGENCIES.indexOf(r.got.urgency) - URGENCIES.indexOf(r.urgency)) <= 1;
  const sure = rows.filter((r) => r.got.confidence >= UNSURE_BELOW || r.got.hazard);
  const unsure = rows.filter((r) => !(r.got.confidence >= UNSURE_BELOW || r.got.hazard));
  const hazards = rows.filter((r) => r.safety);
  const byLang = {};
  for (const r of rows) (byLang[r.lang] ||= []).push(r);

  return {
    model, n: rows.length,
    categoryAccuracy: pct(rows.filter(ok).length, rows.length),
    urgencyExact: pct(rows.filter(urgOk).length, rows.length),
    urgencyWithinOne: pct(rows.filter(near).length, rows.length),
    // What the help desk sees: "AI unsure" is shown below the threshold.
    flaggedUnsure: pct(unsure.length, rows.length),
    accuracyWhenSure: pct(sure.filter(ok).length, sure.length),
    accuracyWhenUnsure: pct(unsure.filter(ok).length, unsure.length),
    // Wrong and not flagged: the case that costs a technician a wasted trip.
    wrongButSure: sure.filter((r) => !ok(r)).map((r) => ({ text: r.text, expected: r.category, got: r.got.category })),
    safety: {
      n: hazards.length,
      caught: hazards.filter((r) => r.got.hazard).length,
      missed: hazards.filter((r) => !r.got.hazard).map((r) => r.text),
      falseAlarms: rows.filter((r) => !r.safety && r.got.hazard).map((r) => ({ text: r.text, rule: r.got.hazard })),
    },
    byLanguage: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, { n: v.length, categoryAccuracy: pct(v.filter(ok).length, v.length) }])),
    errors: rows.filter((r) => !ok(r)).map((r) => ({ text: r.text, expected: r.category, got: r.got.category, confidence: r.got.confidence })),
  };
}
