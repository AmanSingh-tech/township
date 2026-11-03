// Placeholder payment gateway, used when Razorpay is not set up. It follows
// the same steps as the real one (an order on the server, a checkout, the
// server recording the result once) but no money moves. Payments made this
// way are marked as test payments on receipts and ledgers.
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { completeOrder } from './razorpay.js';
import { HttpError } from './util.js';

const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
export const isTestPayment = (gatewayPaymentId) => String(gatewayPaymentId || '').startsWith('test_pay_');

export async function createTestOrder({ flatId, userId, amount }) {
  const orderId = id('test_order');
  await q('INSERT INTO payment_orders (id, flat_id, user_id, amount) VALUES ($1, $2, $3, $4)', [orderId, flatId, userId, amount]);
  return { orderId, amount };
}

export async function finishTestOrder(orderId, outcome, user) {
  const order = await one('SELECT * FROM payment_orders WHERE id = $1', [String(orderId || '')]);
  if (!order || !order.id.startsWith('test_order_') || order.flat_id !== user.flat_id) throw new HttpError(404, 'Payment not found.');
  if (outcome !== 'success') {
    await q("UPDATE payment_orders SET status = 'failed' WHERE id = $1 AND status = 'created'", [order.id]);
    return { ok: false, status: 'failed' };
  }
  return completeOrder(order.id, {
    amountPaise: order.amount * 100, gatewayPaymentId: id('test_pay'), source: 'test gateway',
    provider: 'Test gateway', reference: 'Test payment (placeholder gateway, no money moved)',
  });
}
