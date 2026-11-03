import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fonts = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'assets', 'fonts');
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ');

// Indian numbering: 5,660 -> "Five Thousand Six Hundred Sixty"; 12,34,567 -> lakh, crore.
export function rupeesInWords(amount) {
  let n = Math.round(amount);
  if (n === 0) return 'Rupees Zero only';
  const parts = [];
  for (const [size, word] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
    if (n >= size) { parts.push(`${size === 10000000 ? rupeesInWords(Math.floor(n / size)).replace(/^Rupees | only$/g, '') : two(Math.floor(n / size))} ${word}`); n %= size; }
  }
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(' ')} only`;
}
const inr = (n) => Math.round(n).toLocaleString('en-IN');

// A5 receipt, set in Noto Sans (bundled; it has the ₹ sign).
export function receiptPdf(r) {
  const doc = new PDFDocument({ size: 'A5', margin: 40, info: { Title: `Receipt ${r.receipt_no}`, Author: r.society } });
  doc.registerFont('r', path.join(fonts, 'NotoSans-Regular.ttf'));
  doc.registerFont('b', path.join(fonts, 'NotoSans-Bold.ttf'));
  const ink = '#17181a', muted = '#6b7078', line = '#e4e4e0', accent = '#1f5f4a';
  const W = doc.page.width - 80;
  const amount = (n, x, y, size, bold, opts = {}) => doc.font(bold ? 'b' : 'r').fontSize(size).fillColor(ink).text(`₹${inr(n)}`, x, y, opts);

  doc.rect(40, 40, 6, 22).fill(accent);
  doc.font('b').fontSize(13).fillColor(ink).text(r.society, 54, 41, { width: W - 14 });
  doc.font('r').fontSize(9).fillColor(muted).text('Maintenance receipt', 54, doc.y + 1);
  doc.font('r').fontSize(9).fillColor(muted).text(r.receipt_no, 40, 44, { width: W, align: 'right' });

  doc.moveTo(40, 92).lineTo(40 + W, 92).strokeColor(line).lineWidth(1).stroke();
  doc.font('r').fontSize(9).fillColor(muted).text('Amount received', 40, 108);
  amount(r.amount, 40, 122, 28, true);
  doc.font('r').fontSize(9.5).fillColor(muted).text(rupeesInWords(r.amount), 40, doc.y + 4, { width: W });

  let y = doc.y + 18;
  const row = (label, value, mono) => {
    doc.font('r').fontSize(9.5).fillColor(muted).text(label, 40, y, { width: 120 });
    doc.font(mono ? 'r' : 'b').fontSize(9.5).fillColor(ink).text(value, 160, y, { width: W - 120, align: 'right' });
    y = Math.max(doc.y, y + 14) + 6;
    doc.moveTo(40, y - 3).lineTo(40 + W, y - 3).strokeColor(line).lineWidth(0.5).stroke();
  };
  row('Received from', r.residentName || '—');
  row('Flat', r.flat_id);
  row('Date', new Date(r.paid_on + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
  row('Mode', r.method === 'gateway' ? 'Online (Razorpay)' : r.method === 'bank' ? 'Bank transfer' : 'Other');
  if (r.reference) row('Reference', r.reference, true);
  if (r.utr) row('UTR', r.utr, true);
  row('Towards', 'Maintenance charges');
  doc.font('r').fontSize(9.5).fillColor(muted).text('Balance after this payment', 40, y);
  amount(r.balanceNow, 160, y, 9.5, true, { width: W - 120, align: 'right' });

  doc.font('r').fontSize(8).fillColor(muted).text('This is a computer-generated receipt and needs no signature.', 40, doc.page.height - 60, { width: W, align: 'center' });
  doc.end();
  return doc;
}

// Rendering takes ~50 ms of CPU, so it runs on a worker thread, and recent
// receipts are kept in memory. The cache key covers everything printed, so a
// changed name never serves a stale copy.
const cache = new Map();
const CACHE_MAX = 500;
let worker = null;
const waiting = new Map();
let nextId = 0;
function render(receipt) {
  if (!worker) {
    worker = new Worker(new URL('./receiptWorker.js', import.meta.url));
    worker.on('message', ({ id, pdf, error }) => {
      const w = waiting.get(id);
      waiting.delete(id);
      if (!waiting.size) worker.unref(); // idle: don't hold the process open
      if (error) w.reject(new Error(error)); else w.resolve(Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength));
    });
    worker.on('error', (err) => {
      for (const w of waiting.values()) w.reject(err);
      waiting.clear();
      worker = null;
    });
  }
  if (!waiting.size) worker.ref();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, receipt });
  });
}

export async function receiptPdfBuffer(r) {
  const key = crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const buf = await render(r);
  cache.set(key, buf);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return buf;
}
