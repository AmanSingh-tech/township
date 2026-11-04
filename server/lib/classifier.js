import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

export const CATEGORIES = ['Plumbing', 'Electrical', 'Lift', 'Safety', 'Security', 'Housekeeping', 'Parking', 'Pest control', 'Civil', 'Noise', 'Common areas', 'Other'];
// Below this, the desk shows the category as unsure and asks a person to check it.
export const UNSURE_BELOW = 0.6;
export const URGENCIES = ['low', 'medium', 'high', 'critical'];

// Safety words escalate to the duty manager by rule, whatever any model says.
// English, Hindi and Marathi (Devanagari and common romanised spellings).
// Each hazard also fixes the category, since a keyword model can misread it
// ("smell of gas" looks like Housekeeping).
const SAFETY = [
  [/\bfire\b|\bsmoke\b|\bburning\b|आग|धुआं|धूर|\baag\b/i, 'fire or smoke', 'Safety'],
  [/\bgas\b.*\b(leak|smell)|\b(leak|smell)\w*\b.*\bgas\b|गैस|गॅस|\bgas leak/i, 'gas leak', 'Safety'],
  [/\b(lift|elevator)\b.*\b(stuck|trapped|struck)\b|\b(stuck|trapped)\b.*\b(lift|elevator)\b|लिफ्ट.*(फंस|अटक|बंद)/i, 'person stuck in lift', 'Lift'],
  [/\bshock\b|\bcurrent\s+(lag|aa|is coming)|\bspark(s|ing)?\b|\bshort[- ]?circuit\b|करंट|झटका|शॉक/i, 'electric shock or sparking', 'Electrical'],
];

export function safetyCheck(text) {
  for (const [re, label] of SAFETY) if (re.test(text)) return label;
  return null;
}
export const safetyCategory = (label) => SAFETY.find((s) => s[1] === label)?.[2] || null;

const LEXICON = {
  Plumbing: ['leak', 'leaking', 'tap', 'pipe', 'drain', 'flush', 'toilet', 'water', 'geyser', 'clog', 'blocked', 'overflow', 'नल', 'पानी', 'पाणी', 'गळती', 'nal', 'paani'],
  Electrical: ['light', 'power', 'electric', 'switch', 'socket', 'mcb', 'fuse', 'wiring', 'fan', 'bulb', 'meter', 'बिजली', 'वीज', 'लाइट'],
  Lift: ['lift', 'elevator', 'लिफ्ट'],
  Security: ['guard', 'gate', 'theft', 'stolen', 'stranger', 'cctv', 'security', 'suspicious', 'चोरी'],
  Housekeeping: ['garbage', 'dirty', 'clean', 'sweep', 'trash', 'waste', 'smell', 'dustbin', 'कचरा', 'सफाई'],
  Parking: ['parking', 'parked', 'car', 'bike', 'vehicle', 'slot', 'पार्किंग'],
  'Pest control': ['cockroach', 'rat', 'rats', 'mosquito', 'termite', 'pest', 'bees', 'snake', 'मच्छर', 'चूहे', 'उंदीर'],
  Civil: ['seepage', 'crack', 'plaster', 'damp', 'tile', 'ceiling', 'wall', 'paint', 'window', 'door', 'दरार', 'ओल'],
  Noise: ['noise', 'loud', 'music', 'party', 'barking', 'construction', 'शोर', 'आवाज'],
  'Common areas': ['clubhouse', 'gym', 'pool', 'garden', 'park', 'corridor', 'lobby', 'staircase', 'terrace', 'playground'],
};
const HIGH = /\bno water\b|\bflood|\boverflow|\bno power\b|\bnot working\b|\bbroken\b|\bburst\b|\bsince \d+ days\b|\burgent\b|\bimmediately\b|\bchild\b|\belderly\b|\bsenior\b/i;
const LOW = /\brequest\b|\bsuggest|\bwhen possible\b|\bminor\b|\bpaint\b|\bkindly\b.*\bschedule\b/i;

export function classifyLocal(text) {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const [cat, keys] of Object.entries(LEXICON)) {
    for (const k of keys) if (words.includes(k) || (k.length > 4 && text.toLowerCase().includes(k))) scores[cat] += 1;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const [category, top] = ranked[0][1] > 0 ? ranked[0] : ['Other', 0];
  let urgency = 'medium';
  if (HIGH.test(text) || category === 'Lift') urgency = 'high';
  else if (LOW.test(text) || ['Noise', 'Parking', 'Civil'].includes(category)) urgency = 'low';
  // Share of the matched keywords, discounted when there is little evidence:
  // one keyword alone is a guess (about 50%), not "100% sure".
  const confidence = total ? (top / total) * (1 - 0.5 ** top) : 0.2;
  return { category, urgency, confidence: +confidence.toFixed(2), source: 'local' };
}

let client;
const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    urgency: { type: 'string', enum: URGENCIES },
    confidence: { type: 'number' },
  },
  required: ['category', 'urgency', 'confidence'],
  additionalProperties: false,
};
const SYSTEM = `You triage maintenance complaints from residents of a gated township in Pune, India.
Complaints may be in English, Hindi, Marathi or a mix. Pick the single best category and an urgency:
critical = danger to people now; high = a flat has lost an essential service (water, power, lift) or there is active damage;
medium = something is broken but usable; low = cosmetic, requests or neighbour disputes.
confidence is your probability (0 to 1) that the category is right.`;

// Uses Claude when ANTHROPIC_API_KEY is set; falls back to the local model on
// any error or timeout so a complaint is never blocked on the network.
export async function classify(text) {
  if (!env.ANTHROPIC_API_KEY || env.NODE_ENV === 'test' || env.CLASSIFIER === 'local') return classifyLocal(text);
  client ||= new Anthropic({ timeout: 8000, maxRetries: 1 });
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text.slice(0, 2000) }],
    });
    if (res.stop_reason === 'refusal') return classifyLocal(text);
    const block = res.content.find((b) => b.type === 'text');
    const out = JSON.parse(block.text);
    if (!CATEGORIES.includes(out.category) || !URGENCIES.includes(out.urgency)) return classifyLocal(text);
    return { ...out, confidence: Math.max(0, Math.min(1, +out.confidence || 0)), source: 'claude' };
  } catch (err) {
    console.warn('Claude classification failed, using local model:', err.message);
    return classifyLocal(text);
  }
}

// Token overlap used for linking duplicates (ten flats reporting one lift).
export function similarity(a, b) {
  const set = (s) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const A = set(a), B = set(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / (new Set([...A, ...B]).size || 1);
}
