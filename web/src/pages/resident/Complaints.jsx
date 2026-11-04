import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { ago } from '../../format.js';
import { useApi, Skeleton, Empty, Icon, STATUS_TONE } from '../../ui.jsx';
import { CategoryBadge, LabelledSteps } from './parts.jsx';

const isDone = (c) => c.status === 'resolved' || c.status === 'closed';

export default function Complaints() {
  const { t } = useT();
  const { data } = useApi('/complaints');
  const [filter, setFilter] = useState('open');
  const list = (data || []).filter((c) => (filter === 'all' ? true : filter === 'open' ? !isDone(c) : isDone(c)));
  const counts = data ? { open: data.filter((c) => !isDone(c)).length, done: data.filter(isDone).length, all: data.length } : {};

  return (
    <div className="stack-lg">
      <Link to="/complaints/new" className="btn primary lg block"><Icon name="plus" size={18} />{t('raise')}</Link>
      {data && (
        <div className="seg" role="tablist" aria-label="Filter">
          {[['open', t('filterOpen')], ['done', t('filterDone')], ['all', t('filterAll')]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}<span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
      )}
      {!data ? <Skeleton h={200} /> : (
        <div className="stack" style={{ gap: 10 }}>
          {list.length ? list.map((c) => (
            <Link key={c.id} to={`/complaints/${c.id}`} className="ccard">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <CategoryBadge category={c.category} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="ellipsis" style={{ fontWeight: 500 }}>{c.text}</span>
                    <span className={`pill ${c.escalated && c.status !== 'closed' ? 'danger' : STATUS_TONE[c.status]}`}>{t(`status_${c.status}`)}</span>
                  </div>
                  <div className="faint tiny">{c.category} · #{c.id} · {ago(c.created_at)}</div>
                </div>
              </div>
              {c.status === 'closed'
                ? <div className="stars" aria-label={c.rating ? `${c.rating} of 5` : 'Not rated'}>{[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={15} className={i <= (c.rating || 0) ? 'on' : ''} />)}</div>
                : <LabelledSteps status={c.status} alert={c.escalated} t={t} />}
            </Link>
          )) : <div className="card"><Empty>{filter === 'open' ? t('noComplaints') : 'Nothing here yet.'}</Empty></div>}
        </div>
      )}
    </div>
  );
}
