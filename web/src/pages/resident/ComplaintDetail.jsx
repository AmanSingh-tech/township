import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { ago, time, date } from '../../format.js';
import { useApi, usePoll, Skeleton, Icon, Steps, STATUS_TONE, useToast } from '../../ui.jsx';

export default function ComplaintDetail() {
  const { t } = useT();
  const toast = useToast();
  const { id } = useParams();
  const { data: c, setData, reload } = useApi(`/complaints/${id}`);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  usePoll(reload, 15000);
  if (!c) return <Skeleton h={300} />;

  const act = async (path, body) => {
    try { setData(await api(`/complaints/${id}/${path}`, { method: 'POST', body })); }
    catch (e) { toast(e.message); }
  };
  const others = c.linked.length;

  return (
    <div className="stack-lg">
      <Link to="/complaints" className="link small row" style={{ gap: 4 }}><Icon name="back" size={16} />{t('complaints')}</Link>
      <section className="card stack">
        <div className="row between">
          <span className="faint small">#{c.id} · {c.category}</span>
          <span className={`pill ${c.escalated && c.status !== 'closed' ? 'danger' : STATUS_TONE[c.status]}`}>{t(`status_${c.status}`)}</span>
        </div>
        <p style={{ fontSize: 16 }}>{c.text}</p>
        {c.photo_url && <img src={c.photo_url} alt="" style={{ borderRadius: 12, maxHeight: 240, objectFit: 'cover' }} />}
        <Steps status={c.status} alert={c.escalated} />
        <div className="stack" style={{ gap: 4 }}>
          {c.escalated && <span className="pill danger" style={{ width: 'fit-content' }}><Icon name="alert" size={14} />{t('escalated')}</span>}
          {c.assignee && <span className="muted small">{t('assignedTo', { n: c.assignee })}</span>}
          {!c.first_response_at && c.status !== 'closed' && <span className="faint small">{t('respondBy', { t: `${date(c.due_by)} ${time(c.due_by)}` })}</span>}
        </div>
      </section>

      {others > 0 && <p className="notice small row" style={{ gap: 8 }}><Icon name="link" size={16} />{t('linked', { n: others })}</p>}

      {c.status === 'resolved' && (
        <section className="card stack">
          <h3>{t('rateIt')}</h3>
          <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label={t('rateIt')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={`chip ${rating >= n ? 'on' : ''}`} style={{ width: 46, padding: 0, fontSize: 17 }} onClick={() => setRating(n)} aria-label={`${n}`}>★</button>
            ))}
          </div>
          {rating > 0 && <input className="input" placeholder="Anything to add? (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />}
          <button className="btn primary block" disabled={!rating} onClick={() => act('rate', { rating, feedback })}>{t('close')}</button>
          <button className="btn block" onClick={() => act('reopen', { note: 'Not fixed' })}>{t('reopen')}</button>
        </section>
      )}

      <section>
        <div className="section-title"><h2>Updates</h2></div>
        <div className="card">
          <div className="timeline">
            {[...c.events].reverse().map((e) => (
              <div key={e.id} className={`ev k-${e.kind}`}>
                <div className="small">{e.note}</div>
                <div className="faint tiny">{e.actor} · {ago(e.at)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
