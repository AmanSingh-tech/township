// npm run eval: scores complaint triage and bank matching, prints the results
// and writes docs/evaluation.md. Uses the test database (township_test),
// rebuilt from the sample township; nothing it posts is kept.
//   npm run eval -- --claude    also scores Claude (needs ANTHROPIC_API_KEY; costs a few cents)
import fs from 'node:fs';
const { closePool } = await import('../test/setup.js');
const { evaluateComplaints } = await import('./complaints.js');
const { evaluateMatching, MIX, MINUTES } = await import('./matching.js');

const models = process.argv.includes('--claude') ? ['local', 'claude'] : ['local'];
const triage = [];
for (const m of models) triage.push(await evaluateComplaints({ model: m }));
const match = await evaluateMatching();
await closePool();

const L = [];
L.push('# Evaluation', '', `Run with \`npm run eval\` on ${new Date().toISOString().slice(0, 10)}. Both evaluations use the sample township and change nothing.`, '');
L.push('## Complaint triage', '', `${triage[0].n} labelled complaints in English, Hindi, Marathi and Hinglish (\`server/eval/complaints.json\`), scored on the path a real complaint takes: the safety rule first, then the classifier.`, '');
L.push('| Measure | ' + triage.map((t) => (t.model === 'local' ? 'Local model' : 'Claude')).join(' | ') + ' |', '|---|' + triage.map(() => '---|').join(''));
const row = (label, f) => L.push(`| ${label} | ${triage.map(f).join(' | ')} |`);
row('Category right', (t) => `${t.categoryAccuracy}%`);
row('Urgency exact / within one level', (t) => `${t.urgencyExact}% / ${t.urgencyWithinOne}%`);
row('Flagged "AI unsure" to the help desk', (t) => `${t.flaggedUnsure}%`);
row('Category right when sure / when unsure', (t) => `${t.accuracyWhenSure}% / ${t.accuracyWhenUnsure}%`);
row('Wrong but not flagged', (t) => String(t.wrongButSure.length));
row('Safety hazards caught', (t) => `${t.safety.caught} of ${t.safety.n}`);
row('Safety false alarms', (t) => String(t.safety.falseAlarms.length));
L.push('', 'By language (category right, local model): ' + Object.entries(triage[0].byLanguage).map(([k, v]) => `${k} ${v.categoryAccuracy}% (${v.n})`).join(', ') + '.', '');
if (triage[0].safety.falseAlarms.length) L.push('Safety false alarms (local): ' + triage[0].safety.falseAlarms.map((f) => `"${f.text}" (${f.rule})`).join('; ') + '.', '');
if (triage[0].wrongButSure.length) L.push('Wrong but sure (local): ' + triage[0].wrongButSure.map((e) => `"${e.text}" → ${e.got}, expected ${e.expected}`).join('; ') + '.', '');

L.push('What the first run found, and what was fixed: Devanagari vowel signs split words apart, so Hindi and Marathi keywords never matched (category right was 50% in both; the tokenizer now keeps them); the safety rule missed the Marathi "अडकले" (stuck), and raised false alarms on "लिफ्ट बंद" (the lift is off) and "fire lane". Before the fixes: category right 71.1%, hazards caught 13 of 14, 3 false alarms, 1 wrong but sure.', '');
L.push('## Bank matching', '', `${match.statements} statements, ${match.credits} maintenance credits and ${match.notMaintenance} rows that are not maintenance. Each credit's true flat is known.`, '');
L.push('| Measure | Result |', '|---|---|');
L.push(`| Posted automatically | ${match.autoPosted}% |`, `| **Posted to the wrong flat** | **${match.wrongAutoPosts}** |`,
  `| Sent to the review queue | ${match.queued}% |`, `| Queue: top suggestion is the right flat | ${match.queuedTopSuggestionRight}% (right flat in the top three: ${match.queuedRightInTop3}%) |`,
  `| Non-maintenance rows posted to a flat | ${match.notMaintenancePosted} |`,
  `| Time: by hand vs with the app | ${match.minutes.manual} min vs ${match.minutes.withApp} min, **${match.minutes.saved}% less** |`, '');
L.push('By style (credits, posted, queued, wrong):', '');
for (const [k, v] of Object.entries(match.byStyle)) L.push(`- ${k}: ${v.n}, ${v.auto} posted, ${v.queued} queued, ${v.wrong} wrong`);
L.push('', `Assumptions: the style mix (${MIX.map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(', ')}); and minutes per credit: ${MINUTES.manual} by hand, ${MINUTES.reviewWithRightSuggestion} to confirm a right suggestion, ${MINUTES.reviewWithout} when the suggestion is wrong, 0 when posted automatically.`, '');

const text = L.join('\n');
fs.writeFileSync(new URL('../../docs/evaluation.md', import.meta.url), text + '\n');
console.log(text);
if (match.wrongAutoExamples.length) console.log('\nWrong posts:', match.wrongAutoExamples);
console.log('\nTriage errors (local):', triage[0].errors);
