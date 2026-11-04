import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { inr, date, rate as fmtRate } from '../../format.js';
import { useApi, Skeleton, Icon } from '../../ui.jsx';
import PaySheet from './PaySheet.jsx';

export default function Bills() {
  const { t } = useT();
  const { data, reload } = useApi('/bills');
  const [paying, setPaying] = useState(false);
  const [tab, setTab] = useState('bills');
  if (!data) return <div className="stack"><Skeleton h={120} /><Skeleton h={260} /></div>;
  const { status: st, flat, rate, interestRatePa, ledger, payments } = data;
  const bills = [...st.bills].reverse();

  return (
    <div className="stack-lg">
      <section className="card stack" style={{ gap: 14 }}>
        <div className="row between">
          <div>
            <div className="faint small">{flat.id} · {flat.area} sq ft × {fmtRate(rate)}</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }}>{inr(st.totalDue)}</div>
          </div>
          {st.totalDue > 0 && <button className="btn primary" onClick={() => setPaying(true)}>{t('payNow')}</button>}
        </div>
        {st.totalDue > 0 && (
          <div className="faint small">
            {inr(st.balance)} billed and unpaid{st.accruedInterest > 0 ? ` + ${inr(st.accruedInterest)} interest at ${interestRatePa * 100}% a year on overdue amounts, per bye-laws` : ''}.
          </div>
        )}
      </section>

      <div className="tabs" role="tablist">
        {[['bills', t('bills')], ['receipts', t('receipts')], ['ledger', t('ledger')]].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>{l}</button>
        ))}
      </div>

      {tab === 'bills' && (
        <div className="card flush list">
          {bills.map((b) => (
            <div key={b.id} className="list-item">
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{b.label}</div>
                <div className="faint tiny">Due {date(b.due_on)} · {b.area} sq ft × {fmtRate(b.rate)}</div>
              </div>
              <div className="right">
                <div className="num">{inr(b.amount)}</div>
                {b.unpaid === 0 ? <span className="pill ok">Paid</span>
                  : b.paid > 0 ? <span className="pill warn">{inr(b.unpaid)} left</span>
                  : b.overdueDays > 0 ? <span className="pill danger">{b.overdueDays} days late</span>
                  : <span className="pill">Unpaid</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="card flush list">
          {payments.map((p) => (
            <Link key={p.id} to={`/receipts/${p.id}`} className="list-item">
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{inr(p.amount)}</div>
                <div className="faint tiny">{date(p.paid_on, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.method === 'gateway' ? 'Online' : 'Bank transfer'} · {p.receipt_no}</div>
              </div>
              <Icon name="chevron" size={18} className="faint" />
            </Link>
          ))}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Entry</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="faint small" style={{ whiteSpace: 'nowrap' }}>{date(l.on_date)}</td>
                    <td className="small">{l.description}</td>
                    <td className="num small" style={{ color: l.credit ? 'var(--ok)' : undefined }}>{l.credit ? `−${inr(l.credit)}` : inr(l.debit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PaySheet open={paying} onClose={() => setPaying(false)} due={st.totalDue} onPaid={reload} />
    </div>
  );
}
