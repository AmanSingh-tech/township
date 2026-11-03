import { useState } from 'react';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { time, date } from '../../format.js';
import { useApi, usePoll, Skeleton, Empty, Icon, Sheet, useToast } from '../../ui.jsx';

const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export default function Visitors() {
  const { t } = useT();
  const toast = useToast();
  const { data, reload } = useApi('/visitors');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [day, setDay] = useState(todayIso());
  const [made, setMade] = useState(null);
  usePoll(reload, 10000);

  async function decide(v, decision) {
    try { await api(`/visitors/${v.id}/decide`, { method: 'POST', body: { decision } }); reload(); }
    catch (e) { toast(e.message); }
  }
  async function create(e) {
    e.preventDefault();
    try { setMade(await api('/guest-codes', { method: 'POST', body: { guestName: name, date: day } })); reload(); }
    catch (e) { toast(e.message); }
  }
  if (!data) return <Skeleton h={240} />;

  return (
    <div className="stack-lg">
      <button className="btn primary lg block" onClick={() => { setOpen(true); setMade(null); setName(''); }}><Icon name="key" size={18} />{t('newCode')}</button>

      <section>
        <div className="section-title"><h2>{t('todaysVisitors')}</h2></div>
        <div className="card flush list">
          {data.today.length ? data.today.map((v) => (
            <div key={v.id} className="list-item visitor">
              <div className="ph">{v.photo ? <img src={v.photo} alt="" /> : <Icon name="users" size={18} />}</div>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{v.name}</div>
                <div className="faint tiny">{v.purpose} · {v.gate} · {time(v.created_at)}{v.decided_by ? ` · ${v.decided_by}` : ''}</div>
              </div>
              {v.status === 'waiting' ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm danger" onClick={() => decide(v, 'deny')}>{t('deny')}</button>
                  <button className="btn sm primary" onClick={() => decide(v, 'approve')}>{t('approve')}</button>
                </div>
              ) : <span className={`pill ${v.status === 'denied' ? 'danger' : v.status === 'left' ? '' : 'ok'}`}>{t(v.status)}</span>}
            </div>
          )) : <Empty>{t('noVisitors')}</Empty>}
        </div>
      </section>

      {data.codes.length > 0 && (
        <section>
          <div className="section-title"><h2>{t('guestCode')}</h2></div>
          <div className="card flush list">
            {data.codes.map((g) => (
              <div key={g.code} className="list-item">
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{g.guest_name}</div>
                  <div className="faint tiny">{date(g.valid_on)}{g.used_at ? ` · used ${time(g.used_at)}` : ''}</div>
                </div>
                <span className="mono" style={{ fontSize: 17, letterSpacing: '0.12em', opacity: g.used_at ? 0.4 : 1 }}>{g.code}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="faint tiny">Visitor photos taken at the gate are deleted after 90 days (DPDP Act 2023).</p>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('newCode')} center>
        {made ? (
          <div className="stack" style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 40, letterSpacing: '0.2em', fontWeight: 600 }}>{made.code}</div>
            <p className="muted small">{made.guestName} · {date(made.validOn)}</p>
            <p className="faint small">{t('share')}</p>
            <button className="btn primary block" onClick={() => navigator.share
              ? navigator.share({ text: `Your entry code for ${made.validOn}: ${made.code}` }).catch(() => {})
              : navigator.clipboard?.writeText(made.code).then(() => toast('Copied'))}>Share</button>
          </div>
        ) : (
          <form className="stack" onSubmit={create}>
            <div className="field"><label>{t('guestName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div className="field"><label>{t('forDate')}</label><input className="input" type="date" value={day} min={todayIso()} onChange={(e) => setDay(e.target.value)} /></div>
            <button className="btn primary lg block" disabled={!name.trim()}>{t('newCode')}</button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
