import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { inr } from '../../format.js';
import { Sheet, Icon, useToast } from '../../ui.jsx';

// Razorpay Checkout. The browser only starts the payment; the server checks
// the signature and fetches the payment from Razorpay before recording it.
// Without Razorpay keys the server runs a placeholder gateway instead: the
// same order and recording steps, shown as a clearly marked test checkout.
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not reach the payment page. Check your connection.'));
    document.body.appendChild(s);
  });
}

export default function PaySheet({ open, onClose, due, onPaid }) {
  const { t } = useT();
  const toast = useToast();
  const nav = useNavigate();
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('full');
  const [other, setOther] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testOrder, setTestOrder] = useState(null);

  useEffect(() => {
    if (!open) return;
    setMode('full'); setOther(''); setError(''); setTestOrder(null); setBusy(false);
    api('/pay/config').then(setConfig).catch((e) => setError(e.message));
  }, [open]);
  const amount = mode === 'full' ? due : Math.round(Number(other) || 0);

  function paid(r) {
    onPaid?.(r); onClose();
    nav(`/receipts/${r.paymentId}?new=1`);
  }

  async function finishTest(outcome) {
    setError(''); setBusy(true);
    try {
      const r = await api('/pay/test-complete', { method: 'POST', body: { orderId: testOrder.orderId, outcome } });
      if (!r.ok) { setError('The test payment was declined. No money was taken.'); setTestOrder(null); setBusy(false); return; }
      paid(r);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  async function pay() {
    setError(''); setBusy(true);
    try {
      if (config.provider === 'placeholder') {
        setTestOrder(await api('/pay/order', { method: 'POST', body: { amount } }));
        setBusy(false);
        return;
      }
      await loadCheckout();
      const order = await api('/pay/order', { method: 'POST', body: { amount } });
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount * 100,
        currency: 'INR',
        name: config.societyName,
        description: 'Maintenance',
        prefill: order.prefill,
        theme: { color: '#7b3f80' },
        handler: async (resp) => {
          try {
            const r = await api('/pay/verify', { method: 'POST', body: resp });
            if (!r.ok) throw new Error('The payment did not go through. No money was taken.');
            paid(r);
          } catch (e) {
            // The webhook still records a captured payment; tell the resident to check back.
            toast(e.message || 'We are confirming your payment. Check your receipts in a minute.');
            onPaid?.(); onClose();
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (r) => { setError(r.error?.description || 'Payment failed. No money was taken.'); setBusy(false); });
      rzp.open();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const bank = config?.bankDetails;
  return (
    <Sheet open={open} onClose={onClose} title={t('payTitle')} center>
      {!config ? <p className="faint">…</p> : testOrder ? (
        <div className="stack">
          <p className="notice warn small" role="status">
            Test payment gateway (placeholder). Online payment is not connected, so <b>no money moves</b>. The payment is
            recorded and marked as a test on the receipt.
          </p>
          <div className="receipt" style={{ padding: 16 }}>
            <dl style={{ margin: 0 }}>
              <dt>Amount</dt><dd>{inr(testOrder.amount)}</dd>
              <dt>Order</dt><dd className="mono tiny">{testOrder.orderId}</dd>
            </dl>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary lg block" disabled={busy} onClick={() => finishTest('success')}>Complete test payment</button>
          <button className="btn block" disabled={busy} onClick={() => finishTest('failure')}>Decline (test a failed payment)</button>
        </div>
      ) : config.online ? (
        <div className="stack">
          <div className="chips">
            <button className={`chip ${mode === 'full' ? 'on' : ''}`} onClick={() => setMode('full')}>{t('payFull')} · {inr(due)}</button>
            <button className={`chip ${mode === 'other' ? 'on' : ''}`} onClick={() => setMode('other')}>{t('payOther')}</button>
          </div>
          {mode === 'other' && (
            <input className="input" inputMode="numeric" placeholder="₹" value={other} onChange={(e) => setOther(e.target.value.replace(/\D/g, ''))} autoFocus aria-label={t('amount')} />
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn primary lg block" disabled={busy || amount <= 0} onClick={pay}>{t('payNow')} {amount > 0 ? inr(amount) : ''}</button>
          <p className="faint tiny row" style={{ gap: 6, justifyContent: 'center' }}><Icon name="shield" size={14} />
            {config.provider === 'placeholder' ? 'Test gateway: no real money moves' : 'UPI, cards and net banking via Razorpay'}</p>
          {bank && (
            <details className="small muted">
              <summary>Pay by UPI or bank transfer instead</summary>
              <p>Write your flat number <b>in the remarks</b>; it is matched to your flat automatically.</p>
              <dl style={{ margin: 0 }}>
                {bank.upiId && <><dt>UPI ID</dt><dd className="mono">{bank.upiId}</dd></>}
                <dt>Account</dt><dd>{bank.accountName} · <span className="mono">{bank.accountNumber}</span> · IFSC <span className="mono">{bank.ifsc}</span></dd>
              </dl>
            </details>
          )}
        </div>
      ) : (
        <div className="stack">
          <p className="muted small">Online payment is not available yet. Pay {inr(due)} by UPI or bank transfer and write your flat number <b>in the remarks</b>; it is matched to your flat automatically.</p>
          {bank ? (
            <div className="receipt" style={{ padding: 16 }}>
              <dl style={{ margin: 0 }}>
                {bank.upiId && <><dt>UPI ID</dt><dd className="mono">{bank.upiId}</dd></>}
                <dt>Account name</dt><dd>{bank.accountName}</dd>
                <dt>Account number</dt><dd className="mono">{bank.accountNumber}</dd>
                <dt>IFSC</dt><dd className="mono">{bank.ifsc}</dd>
              </dl>
            </div>
          ) : <p className="notice small">Ask the society office for the bank details.</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
