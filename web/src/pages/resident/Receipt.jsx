import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { inr, date } from '../../format.js';
import { useApi, Skeleton, Icon } from '../../ui.jsx';
import { api } from '../../api.js';
import { LOGO } from '../../brand.js';

export default function Receipt() {
  const { t } = useT();
  const { id } = useParams();
  const [q] = useSearchParams();
  const { data: r } = useApi(`/receipts/${id}`);
  if (!r) return <Skeleton h={320} />;
  return (
    <div className="stack-lg">
      {q.get('new') && (
        <div className="notice ok row" style={{ gap: 8 }}><Icon name="check" size={18} stroke={2.2} />{t('paySuccess')}</div>
      )}
      <article className="receipt">
        <div className="row between">
          <div className="brand"><img src={LOGO} alt="" /><span>{t('receipt')}</span></div>
          <span className="mono faint">{r.receipt_no}</span>
        </div>
        <div style={{ marginTop: 22 }}>
          <div className="faint small">{r.society}</div>
          <div className="num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>{inr(r.amount)}</div>
        </div>
        <dl>
          <dt>Flat</dt><dd>{r.flat_id}</dd>
          <dt>Received from</dt><dd>{r.residentName}</dd>
          <dt>Date</dt><dd>{date(r.paid_on, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
          <dt>Mode</dt><dd>{r.method !== 'gateway' ? 'Bank transfer' : String(r.gateway_payment_id).startsWith('test_pay_') ? 'Online (test payment, no money moved)' : 'Online (Razorpay)'}</dd>
          {r.reference && <><dt>Reference</dt><dd className="mono">{r.reference}</dd></>}
          {r.utr && <><dt>UTR</dt><dd className="mono">{r.utr}</dd></>}
          <dt>Balance after this payment</dt><dd>{inr(r.balanceNow)}</dd>
        </dl>
        <p className="faint tiny" style={{ marginTop: 18 }}>Towards maintenance charges. Computer-generated receipt; no signature required.</p>
      </article>
      <div className="row no-print">
        <Link to="/bills" className="btn grow">{t('bills')}</Link>
        <button className="btn grow" onClick={async () => {
          const res = await api(`/receipts/${id}/pdf`, { raw: true });
          const url = URL.createObjectURL(await res.blob());
          Object.assign(document.createElement('a'), { href: url, download: `${r.receipt_no.replace(/\//g, '-')}.pdf` }).click();
          URL.revokeObjectURL(url);
        }}><Icon name="download" size={18} />PDF</button>
      </div>
    </div>
  );
}
