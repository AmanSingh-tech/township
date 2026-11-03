import crypto from 'node:crypto';
import { env, paymentsEnabled } from '../env.js';
import { q, one, tx } from '../db.js';
import { recordPayment } from './billing.js';
import { send } from './notify.js';
import { today, HttpError } from './util.js';

const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  if (!paymentsEnabled) throw new HttpError(503, 'Online payments are not set up yet.');
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, data?.error?.description || `Payment provider error (${res.status})`);
  return data;
}

const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function verifyCheckoutSignature(orderId, paymentId, signature) {
  return safeEqual(hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), String(signature || ''));
}
export function verifyWebhookSignature(rawBody, signature) {
  return !!env.RAZORPAY_WEBHOOK_SECRET && safeEqual(hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody), String(signature || ''));
}

export async function createOrder({ flatId, userId, amount }) {
  const order = await call('POST', '/orders', {
    amount: amount * 100,
    currency: 'INR',
    receipt: `${flatId}-${Date.now()}`.slice(0, 40),
    notes: { flat_id: flatId, user_id: String(userId) },
  });
  await q('INSERT INTO payment_orders (id, flat_id, user_id, amount) VALUES ($1, $2, $3, $4)', [order.id, flatId, userId, amount]);
  return { orderId: order.id, amount, keyId: env.RAZORPAY_KEY_ID };
}

// Records a captured payment against its order exactly once, whichever of
// the checkout callback or the webhook arrives first. The payment is fetched
// from Razorpay so the amount and status never come from the browser.
export async function settleOrder(orderId, paymentId, source) {
  const payment = await call('GET', `/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== orderId) throw new HttpError(400, 'Payment does not belong to this order.');
  let p = payment;
  if (p.status === 'authorized') p = await call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: p.amount, currency: 'INR' });
  if (p.status !== 'captured') {
    if (p.status === 'failed') await q("UPDATE payment_orders SET status = 'failed' WHERE id = $1 AND status = 'created'", [orderId]);
    return { ok: false, status: p.status };
  }
  return tx(async () => {
    const order = await one('SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!order) throw new HttpError(404, 'Unknown order');
    if (order.status === 'paid') {
      const existing = await one('SELECT id, receipt_no FROM payments WHERE id = $1', [order.payment_id]);
      return { ok: true, paymentId: existing.id, receiptNo: existing.receipt_no, already: true };
    }
    if (p.amount !== order.amount * 100) throw new HttpError(400, 'Paid amount does not match the order.');
    const user = await one('SELECT * FROM users WHERE id = $1', [order.user_id]);
    const rec = await recordPayment({
      flatId: order.flat_id, amount: order.amount, paidOn: today(), method: 'gateway',
      reference: p.method ? `${p.method.toUpperCase()} via Razorpay` : 'Razorpay',
      utr: p.acquirer_data?.rrn || p.acquirer_data?.upi_transaction_id || null,
      gatewayOrderId: orderId, gatewayPaymentId: p.id, postedBy: user?.name || 'Razorpay',
    }, { id: user?.id, name: `${user?.name || 'resident'} (${source})` });
    await q("UPDATE payment_orders SET status = 'paid', payment_id = $2 WHERE id = $1", [orderId, rec.id]);
    if (user) await send('push', user.phone, `Received ₹${order.amount} for ${order.flat_id}. Receipt ${rec.receipt_no}.`);
    return { ok: true, paymentId: rec.id, receiptNo: rec.receipt_no };
  });
}
