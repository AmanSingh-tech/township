import { useEffect, useState } from 'react';
import { pushState, turnOnPush } from '../../push.js';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { inr, date, ago, time } from '../../format.js';
import { useApi, usePoll, Skeleton, Empty, Icon, Steps, useToast, STATUS_TONE } from '../../ui.jsx';
import PaySheet from './PaySheet.jsx';

export default function Home() {
  const { t } = useT();
  const toast = useToast();
  const { data, reload } = useApi('/home');
  const [paying, setPaying] = useState(false);
  const [push, setPush] = useState(null);
  usePoll(reload, 15000);
  useEffect(() => { pushState().then(setPush); }, []);

  if (!data) return <div className="stack"><Skeleton h={150} /><Skeleton h={120} /><Skeleton h={120} /></div>;
  const { dues, complaints, visitors, notices } = data;

  async function decide(v, decision) {
    try {
      await api(`/visitors/${v.id}/decide`, { method: 'POST', body: { decision } });
      toast(decision === 'approve' ? `${v.name}: ${t('approved')}` : `${v.name}: ${t('denied')}`);
      reload();
    } catch (e) { toast(e.message); }
  }

  return (
    <div className="stack-lg">
      {dues.totalDue > 0 ? (
        <section className="dues">
          <div className="faint small">{t('due')}</div>
          <div className="amount">{inr(dues.totalDue)}</div>
          <div className="meta">
            {dues.daysOverdue > 0
              ? <span className="pill danger"><span className="dot" />{t('overdueBy', { n: dues.daysOverdue })}</span>
              : <span className="pill">{t('dueBy', { d: date(dues.dueOn) })}</span>}
            {dues.interest > 0 && <span className="faint small">{t('inclInterest', { a: inr(dues.interest) })}</span>}
          </div>
          <button className="btn primary lg block" style={{ marginTop: 18 }} onClick={() => setPaying(true)}>{t('payNow')}</button>
        </section>
      ) : (
        <section className="dues paid row between">
          <div>
            <div className="amount row" style={{ gap: 8 }}><Icon name="check" size={26} stroke={2.2} />{t('allPaid')}</div>
            <div className="faint small" style={{ marginTop: 4 }}>{dues.advance > 0 ? `${inr(dues.advance)} advance` : t('nothingDue')}</div>
          </div>
          <Link to="/bills" className="btn sm">{t('bills')}</Link>
        </section>
      )}

      {push === 'off' && (
        <div className="card row between" style={{ gap: 12 }}>
          <div className="small"><b style={{ fontWeight: 500 }}>{t('alertsTitle')}</b><div className="faint tiny">{t('alertsBody')}</div></div>
          <button className="btn sm primary" onClick={() => turnOnPush().then(() => setPush('on')).catch((e) => toast(e.message))}>{t('turnOn')}</button>
        </div>
      )}

      <section>
        <div className="section-title">
          <h2>{t('openComplaints')}</h2>
          <Link to="/complaints/new" className="link small row" style={{ gap: 4 }}><Icon name="plus" size={16} />{t('raise')}</Link>
        </div>
        <div className="card flush list">
          {complaints.length ? complaints.map((c) => (
            <Link key={c.id} to={`/complaints/${c.id}`} className="list-item" style={{ display: 'block' }}>
              <div className="row between">
                <span className="ellipsis grow" style={{ fontWeight: 500 }}>{c.text}</span>
                <span className={`pill ${c.escalated ? 'danger' : STATUS_TONE[c.status]}`}>{t(`status_${c.status}`)}</span>
              </div>
              <Steps status={c.status} alert={c.escalated} />
              <div className="faint tiny" style={{ marginTop: 6 }}>{c.category} · #{c.id} · {ago(c.created_at)}{c.assignee ? ` · ${c.assignee}` : ''}</div>
            </Link>
          )) : <Empty>{t('noComplaints')}</Empty>}
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>{t('todaysVisitors')}</h2>
          <Link to="/visitors" className="link small">{t('guestCode')}</Link>
        </div>
        <div className="card flush list">
          {visitors.length ? visitors.map((v) => (
            <div key={v.id} className="list-item visitor">
              <div className="ph">{v.photo ? <img src={v.photo} alt="" /> : <Icon name="users" size={18} />}</div>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{v.name}</div>
                <div className="faint tiny">{v.purpose} · {v.gate} · {time(v.created_at)}</div>
              </div>
              {v.status === 'waiting' ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm danger" onClick={() => decide(v, 'deny')} aria-label={t('deny')}><Icon name="x" size={16} /></button>
                  <button className="btn sm primary" onClick={() => decide(v, 'approve')}>{t('approve')}</button>
                </div>
              ) : <span className={`pill ${v.status === 'denied' ? 'danger' : v.status === 'left' ? '' : 'ok'}`}>{t(v.status)}</span>}
            </div>
          )) : <Empty>{t('noVisitors')}</Empty>}
        </div>
      </section>

      {notices.length > 0 && (
        <section>
          <div className="section-title"><h2>{t('notices')}</h2></div>
          <div className="card flush list">
            {notices.map((n) => (
              <div key={n.id} className="list-item" style={{ display: 'block' }}>
                <div className="row between"><b style={{ fontWeight: 500 }}>{n.title}</b><span className="faint tiny">{date(n.posted_on)}</span></div>
                <p className="muted small" style={{ marginTop: 2 }}>{n.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <PaySheet open={paying} onClose={() => setPaying(false)} due={dues.totalDue} onPaid={reload} />
    </div>
  );
}
