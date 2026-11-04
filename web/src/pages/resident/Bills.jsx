import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { inr, date, rate as fmtRate } from '../../format.js';
import { useApi, Skeleton, Icon } from '../../ui.jsx';
import { CountUp } from './parts.jsx';
import PaySheet from './PaySheet.jsx';

const stateOf = (b) => (b.unpaid === 0 ? 'paid' : b.paid > 0 ? 'part' : b.overdueDays > 0 ? 'late' : 'open');

export default function Bills() {
  const { t } = useT();
  const { data, reload } = useApi('/bills');
  const [paying, setPaying] = useState(false);
  const [tab, setTab] = useState('bills');
  const [sel, setSel] = useState(null);
  const [expanded, setExpanded] = useState(null);
  if (!data) return <div className="stack"><Skeleton h={250} /><Skeleton h={260} /></div>;
  const { status: st, flat, rate, interestRatePa, ledger, payments } = data;
  const bills = [...st.bills].reverse();
  const recent = st.bills.slice(-6);
  const max = Math.max(...recent.map((b) => b.amount), 1);
  const picked = recent.find((b) => b.id === sel) || recent.at(-1);

  return (
    <div className="stack-lg">
      <section className="card stack" style={{ gap: 14 }}>
        <div className="row between">
          <div>
            <div className="faint small">{flat.id} · {flat.area} sq ft × {fmtRate(rate)}</div>
            <div className="num" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em' }}><CountUp value={st.totalDue} /></div>
          </div>
          {st.totalDue > 0 && <button className="btn primary" onClick={() => setPaying(true)}>{t('payNow')}</button>}
        </div>
        {st.totalDue > 0 && (
          <div className="faint small">
            {inr(st.balance)} billed and unpaid{st.accruedInterest > 0 ? ` + ${inr(st.accruedInterest)} interest at ${interestRatePa * 100}% a year on overdue amounts, per bye-laws` : ''}.
          </div>
        )}

        {recent.length > 1 && (
          <div className="mchart">
            <div className="mchart-head faint tiny">{t('last6')}</div>
            <div className="mchart-bars" role="group" aria-label={t('last6')}>
              {recent.map((b) => {
                const s = stateOf(b);
                return (
                  <button key={b.id} type="button" className={`mbar ${s} ${picked?.id === b.id ? 'on' : ''}`} onClick={() => setSel(b.id)}
                    aria-pressed={picked?.id === b.id} aria-label={`${b.label}: ${inr(b.amount)}, ${s === 'paid' ? 'paid' : `${inr(b.unpaid)} unpaid`}`}>
                    <span className="mbar-track"><span className="mbar-fill" style={{ height: `${(b.amount / max) * 100}%` }}><span className="mbar-paid" style={{ height: `${(b.paid / b.amount) * 100 || 0}%` }} /></span></span>
                    <span className="mbar-l">{b.label.slice(0, 3)}</span>
                  </button>
                );
              })}
            </div>
            {picked && (
              <div className="mchart-detail" key={picked.id}>
                <div><b>{picked.label}</b><span className="faint tiny"> · due {date(picked.due_on)}</span></div>
                <div className="faint tiny">{picked.area} sq ft × {fmtRate(picked.rate)} = {inr(picked.amount)} · paid {inr(picked.paid)}{picked.unpaid ? ` · ${inr(picked.unpaid)} left` : ''}</div>
              </div>
            )}
            <div className="mchart-key tiny faint"><span><i className="k paid" />Paid</span><span><i className="k late" />Unpaid</span></div>
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
          {bills.map((b) => {
            const s = stateOf(b), isOpen = expanded === b.id;
            return (
              <div key={b.id} className={`bill-row ${isOpen ? 'open' : ''}`}>
                <button type="button" className="list-item" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : b.id)}>
                  <span className={`bill-dot ${s}`} aria-hidden="true" />
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{b.label}</div>
                    <div className="faint tiny">Due {date(b.due_on)}</div>
                  </div>
                  <div className="right">
                    <div className="num">{inr(b.amount)}</div>
                    {s === 'paid' ? <span className="pill ok">Paid</span>
                      : s === 'part' ? <span className="pill warn">{inr(b.unpaid)} left</span>
                      : s === 'late' ? <span className="pill danger">{b.overdueDays} days late</span>
                      : <span className="pill">Unpaid</span>}
                  </div>
                </button>
                <div className="bill-more"><div>
                  <p><span>{b.area} sq ft × {fmtRate(b.rate)}</span><b className="num">{inr(b.amount)}</b></p>
                  <p><span>Paid</span><b className="num">{inr(b.paid)}</b></p>
                  <p><span>Left to pay</span><b className="num">{inr(b.unpaid)}</b></p>
                  {b.overdueDays > 0 && <p className="faint tiny">Interest of {interestRatePa * 100}% a year runs on the unpaid part from the due date.</p>}
                </div></div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="card flush list">
          {payments.length ? payments.map((p) => (
            <Link key={p.id} to={`/receipts/${p.id}`} className="list-item">
              <span className="receipt-ic tint-sage" aria-hidden="true"><Icon name="check" size={16} stroke={2.2} /></span>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{inr(p.amount)}</div>
                <div className="faint tiny">{date(p.paid_on, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.method === 'gateway' ? 'Online' : 'Bank transfer'} · {p.receipt_no}</div>
              </div>
              <Icon name="chevron" size={18} className="faint" />
            </Link>
          )) : <div className="empty">No payments yet.</div>}
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
