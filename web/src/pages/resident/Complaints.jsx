import { Link } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { ago } from '../../format.js';
import { useApi, Skeleton, Empty, Icon, Steps, STATUS_TONE } from '../../ui.jsx';

export default function Complaints() {
  const { t } = useT();
  const { data } = useApi('/complaints');
  return (
    <div className="stack-lg">
      <Link to="/complaints/new" className="btn primary lg block"><Icon name="plus" size={18} />{t('raise')}</Link>
      {!data ? <Skeleton h={200} /> : (
        <div className="card flush list">
          {data.length ? data.map((c) => (
            <Link key={c.id} to={`/complaints/${c.id}`} className="list-item" style={{ display: 'block' }}>
              <div className="row between">
                <span className="ellipsis grow" style={{ fontWeight: 500 }}>{c.text}</span>
                <span className={`pill ${c.escalated && c.status !== 'closed' ? 'danger' : STATUS_TONE[c.status]}`}>{t(`status_${c.status}`)}</span>
              </div>
              {c.status !== 'closed' && <Steps status={c.status} alert={c.escalated} />}
              <div className="faint tiny" style={{ marginTop: 6 }}>{c.category} · #{c.id} · {ago(c.created_at)}{c.rating ? ` · ${'★'.repeat(c.rating)}` : ''}</div>
            </Link>
          )) : <Empty>{t('noComplaints')}</Empty>}
        </div>
      )}
    </div>
  );
}
