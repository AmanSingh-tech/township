import { useEffect, useState } from 'react';
import { pushState, turnOnPush } from '../../push.js';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { inr, date, ago, time } from '../../format.js';
import { useApi, usePoll, Skeleton, Empty, Icon, useToast, STATUS_TONE } from '../../ui.jsx';
import { CountUp, CategoryBadge, Avatar, LabelledSteps } from './parts.jsx';
import PaySheet from './PaySheet.jsx';
import InstallCard from './InstallCard.jsx';

export default function Home() {
  const { t } = useT();
  const toast = useToast();
  const { data, reload } = useApi('/home');
  const [paying, setPaying] = useState(false);
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState(null);
  const [deciding, setDeciding] = useState({});
  usePoll(reload, 15000);
  useEffect(() => { pushState().then(setPush); }, []);

  if (!data) return <div className="stack"><Skeleton h={190} /><Skeleton h={84} /><Skeleton h={120} /></div>;
  const { dues, complaints, visitors, notices } = data;

  async function decide(v, decision) {
    setDeciding((d) => ({ ...d, [v.id]: decision }));
    try {
      await api(`/visitors/${v.id}/decide`, { method: 'POST', body: { decision } });
      toast(decision === 'approve' ? `${v.name}: ${t('approved')}` : `${v.name}: ${t('denied')}`);
      setTimeout(reload, 650);
    } catch (e) { setDeciding((d) => ({ ...d, [v.id]: null })); toast(e.message); }
  }

  const quick = [
    { to: null, onClick: () => setPaying(true), icon: 'bill', label: t('quickPay'), tint: 'lilac', hide: dues.totalDue <= 0 },
    { to: '/complaints/new', icon: 'wrench', label: t('quickRaise'), tint: 'peach' },
    { to: '/visitors?new=1', icon: 'key', label: t('quickGuest'), tint: 'butter' },
    { to: '/book', icon: 'calendar', label: t('quickBook'), tint: 'sage' },
  ].filter((q) => !q.hide);

  return (
    <div className="home-grid">
      <div className="home-col stack-lg">
      {dues.totalDue > 0 ? (
        <section className="hero-dues">
          <div className="hero-dues-top">
            <span className="hd-label">{t('due')}</span>
            {dues.daysOverdue > 0
              ? <span className="hd-pill late"><span className="dot" />{t('overdueBy', { n: dues.daysOverdue })}</span>
              : <span className="hd-pill">{t('dueBy', { d: date(dues.dueOn) })}</span>}
          </div>
          <div className="hd-amount"><CountUp value={dues.totalDue} /></div>
          <button type="button" className="hd-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? t('hideDetails') : t('whatsInIt')}<Icon name="chevron" size={16} style={{ transform: `rotate(${open ? -90 : 90}deg)`, transition: 'transform .25s' }} />
          </button>
          <div className={`hd-break ${open ? 'open' : ''}`}>
            <div>
              {(dues.unpaid || []).map((b) => (
                <p key={b.label}><span>{b.label}{b.overdueDays > 0 ? ` · ${b.overdueDays}d` : ''}</span><b className="num">{inr(b.unpaid)}</b></p>
              ))}
              {dues.interest > 0 && <p><span>{t('interestLabel')}</span><b className="num">{inr(dues.interest)}</b></p>}
            </div>
          </div>
          <button className="hd-pay" onClick={() => setPaying(true)}>{t('payNow')} · {inr(dues.totalDue)}</button>
        </section>
      ) : (
        <section className="hero-dues paid">
          <div className="hero-dues-top"><span className="hd-label">{t('due')}</span></div>
          <div className="hd-amount row" style={{ gap: 10 }}><Icon name="check" size={34} stroke={2.4} />{t('allPaid')}</div>
          <p className="hd-sub">{dues.advance > 0 ? `${inr(dues.advance)} advance` : t('nothingDue')}</p>
          <Link to="/bills" className="hd-pay ghost">{t('bills')}</Link>
        </section>
      )}

      <nav className="quick" aria-label="Quick actions">
        {quick.map((q) => {
          const inner = <><span className={`quick-ic tint-${q.tint}`}><Icon name={q.icon} size={20} /></span><span>{q.label}</span></>;
          return q.to ? <Link key={q.label} to={q.to} className="quick-item">{inner}</Link>
            : <button key={q.label} type="button" className="quick-item" onClick={q.onClick}>{inner}</button>;
        })}
      </nav>

      <InstallCard />

      {push === 'off' && (
        <div className="card row between" style={{ gap: 12 }}>
          <div className="small"><b style={{ fontWeight: 500 }}>{t('alertsTitle')}</b><div className="faint tiny">{t('alertsBody')}</div></div>
          <button className="btn sm" onClick={() => turnOnPush().then(() => setPush('on')).catch((e) => toast(e.message))}>{t('turnOn')}</button>
        </div>
      )}

      </div>
      <div className="home-col stack-lg">
      <section>
        <div className="section-title">
          <h2>{t('openComplaints')}{complaints.length > 0 && <span className="count">{complaints.length}</span>}</h2>
          <Link to="/complaints/new" className="link small row" style={{ gap: 4 }}><Icon name="plus" size={16} />{t('raise')}</Link>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {complaints.length ? complaints.map((c) => (
            <Link key={c.id} to={`/complaints/${c.id}`} className="ccard">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <CategoryBadge category={c.category} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="ellipsis" style={{ fontWeight: 500 }}>{c.text}</span>
                    <span className={`pill ${c.escalated ? 'danger' : STATUS_TONE[c.status]}`}>{t(`status_${c.status}`)}</span>
                  </div>
                  <div className="faint tiny">{c.category} · #{c.id} · {ago(c.created_at)}{c.assignee ? ` · ${c.assignee}` : ''}</div>
                </div>
              </div>
              <LabelledSteps status={c.status} alert={c.escalated} t={t} />
            </Link>
          )) : <div className="card"><Empty>{t('noComplaints')}</Empty></div>}
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>{t('todaysVisitors')}</h2>
          <Link to="/visitors" className="link small">{t('guestCode')}</Link>
        </div>
        <div className="card flush list">
          {visitors.length ? visitors.map((v) => {
            const d = deciding[v.id];
            return (
              <div key={v.id} className={`list-item visitor ${d ? `decided ${d}` : ''}`}>
                <Avatar name={v.name} photo={v.photo} />
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{v.name}</div>
                  <div className="faint tiny">{v.purpose} · {v.gate} · {time(v.created_at)}</div>
                </div>
                {d ? <span className={`pill ${d === 'approve' ? 'ok' : 'danger'} pop`}><Icon name={d === 'approve' ? 'check' : 'x'} size={14} />{t(d === 'approve' ? 'approved' : 'denied')}</span>
                  : v.status === 'waiting' ? (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn sm danger" onClick={() => decide(v, 'deny')} aria-label={t('deny')}><Icon name="x" size={16} /></button>
                    <button className="btn sm primary" onClick={() => decide(v, 'approve')}>{t('approve')}</button>
                  </div>
                ) : <span className={`pill ${v.status === 'denied' ? 'danger' : v.status === 'left' ? '' : 'ok'}`}>{t(v.status)}</span>}
              </div>
            );
          }) : <Empty>{t('noVisitors')}</Empty>}
        </div>
      </section>

      {notices.length > 0 && (
        <section>
          <div className="section-title"><h2>{t('notices')}</h2></div>
          <div className="stack" style={{ gap: 10 }}>
            {notices.map((n, i) => (
              <div key={n.id} className={`notice-card tint-edge-${['sky', 'butter', 'sage'][i % 3]}`}>
                <div className="row between"><b style={{ fontWeight: 600 }}>{n.title}</b><span className="faint tiny">{date(n.posted_on)}</span></div>
                <p className="muted small" style={{ marginTop: 4 }}>{n.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
      <PaySheet open={paying} onClose={() => setPaying(false)} due={dues.totalDue} onPaid={reload} />
    </div>
  );
}
