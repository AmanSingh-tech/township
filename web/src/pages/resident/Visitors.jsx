import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { time, date } from '../../format.js';
import { useApi, usePoll, Skeleton, Empty, Icon, Sheet, useToast } from '../../ui.jsx';
import { Avatar, useNow, untilEndOfIstDay } from './parts.jsx';

const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

function CodeDigits({ code, big }) {
  return <span className={`code-digits ${big ? 'big' : ''}`} aria-label={code.split('').join(' ')}>{code.split('').map((d, i) => <i key={i}>{d}</i>)}</span>;
}

export default function Visitors() {
  const { t } = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, reload } = useApi('/visitors');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [day, setDay] = useState(todayIso());
  const [made, setMade] = useState(null);
  const [deciding, setDeciding] = useState({});
  const now = useNow(30000);
  usePoll(reload, 10000);

  // Opened from the home screen's "Guest code" shortcut.
  useEffect(() => {
    if (params.get('new')) { setOpen(true); setMade(null); setName(''); setParams({}, { replace: true }); }
  }, [params, setParams]);

  async function decide(v, decision) {
    setDeciding((d) => ({ ...d, [v.id]: decision }));
    try { await api(`/visitors/${v.id}/decide`, { method: 'POST', body: { decision } }); setTimeout(reload, 650); }
    catch (e) { setDeciding((d) => ({ ...d, [v.id]: null })); toast(e.message); }
  }
  async function create(e) {
    e.preventDefault();
    try { setMade(await api('/guest-codes', { method: 'POST', body: { guestName: name, date: day } })); reload(); }
    catch (e) { toast(e.message); }
  }
  const copy = (code) => navigator.clipboard?.writeText(code).then(() => toast(t('copied'))).catch(() => {});
  if (!data) return <Skeleton h={240} />;

  return (
    <div className="stack-lg">
      <button className="btn primary lg block" onClick={() => { setOpen(true); setMade(null); setName(''); }}><Icon name="key" size={18} />{t('newCode')}</button>

      <section>
        <div className="section-title"><h2>{t('todaysVisitors')}{data.today.length > 0 && <span className="count">{data.today.length}</span>}</h2></div>
        {data.today.length ? (
          <ol className="vtimeline">
            {data.today.map((v) => {
              const d = deciding[v.id];
              const status = d ? (d === 'approve' ? 'approved' : 'denied') : v.status;
              return (
                <li key={v.id} className={`vt-item s-${status} ${d ? 'decided' : ''}`}>
                  <span className="vt-time faint tiny">{time(v.created_at)}</span>
                  <div className="vt-card">
                    <Avatar name={v.name} photo={v.photo} />
                    <div className="grow">
                      <div style={{ fontWeight: 500 }}>{v.name}</div>
                      <div className="faint tiny">{v.purpose} · {v.gate}{v.decided_by ? ` · ${v.decided_by}` : ''}</div>
                    </div>
                    {status === 'waiting' ? (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn sm danger" onClick={() => decide(v, 'deny')}>{t('deny')}</button>
                        <button className="btn sm primary" onClick={() => decide(v, 'approve')}>{t('approve')}</button>
                      </div>
                    ) : <span className={`pill ${status === 'denied' ? 'danger' : status === 'left' ? '' : 'ok'} ${d ? 'pop' : ''}`}>{t(status)}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <div className="card"><Empty>{t('noVisitors')}</Empty></div>}
      </section>

      {data.codes.length > 0 && (
        <section>
          <div className="section-title"><h2>{t('guestCode')}</h2></div>
          <div className="stack" style={{ gap: 10 }}>
            {data.codes.map((g) => {
              const left = !g.used_at && untilEndOfIstDay(String(g.valid_on).slice(0, 10), now);
              const future = String(g.valid_on).slice(0, 10) > todayIso();
              return (
                <div key={g.code} className={`gcode ${g.used_at ? 'used' : ''}`}>
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{g.guest_name}</div>
                    <div className="faint tiny">
                      {g.used_at ? `Used ${time(g.used_at)}` : future ? date(g.valid_on) : left?.label ? t('validFor', { t: left.label }) : t('expiredCode')}
                    </div>
                  </div>
                  <CodeDigits code={g.code} />
                  {!g.used_at && <button type="button" className="btn sm ghost" onClick={() => copy(g.code)} aria-label={t('copy')}><Icon name="copy" size={16} /></button>}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <p className="faint tiny">Visitor photos taken at the gate are deleted after 90 days (DPDP Act 2023).</p>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('newCode')} center>
        {made ? (
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center' }}>
            <CodeDigits code={made.code} big />
            <p className="muted small">{made.guestName} · {date(made.validOn)}</p>
            <p className="faint small">{t('share')}</p>
            <div className="row" style={{ gap: 8, width: '100%' }}>
              <button className="btn block" onClick={() => copy(made.code)}><Icon name="copy" size={16} />{t('copy')}</button>
              <button className="btn primary block" onClick={() => navigator.share
                ? navigator.share({ text: `Your entry code for ${made.validOn}: ${made.code}` }).catch(() => {})
                : copy(made.code)}>Share</button>
            </div>
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
