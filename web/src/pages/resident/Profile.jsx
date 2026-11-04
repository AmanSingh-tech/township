import { useEffect, useState } from 'react';
import { pushState, turnOnPush, turnOffPush } from '../../push.js';
import { useNavigate } from 'react-router-dom';
import { api, getSession, setSession } from '../../api.js';
import { useT, LANGS } from '../../i18n.jsx';
import { useApi, useToast, Icon, Sheet } from '../../ui.jsx';
import { ThemeSwitch } from '../../theme.jsx';
import { date } from '../../format.js';

export default function Profile() {
  const { t, lang, setLang } = useT();
  const toast = useToast();
  const nav = useNavigate();
  const me = getSession().user;
  const { data: members, reload } = useApi('/household');
  const [form, setForm] = useState({ name: '', phone: '', relation: 'family' });
  const [adding, setAdding] = useState(false);
  const [push, setPush] = useState(null);
  const [ask, setAsk] = useState(null);
  const [details, setDetails] = useState('');
  const { data: requests, reload: reloadRequests } = useApi('/me/data-requests');
  useEffect(() => { pushState().then(setPush); }, []);

  async function togglePush() {
    try {
      if (push === 'on') { await turnOffPush(); setPush('off'); } else { await turnOnPush(); setPush('on'); }
    } catch (e) { toast(e.message); }
  }
  async function download() {
    const res = await api('/me/export', { raw: true });
    if (!res.ok) return toast('Could not prepare your data. Try again.');
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `my-data-${me.flat_id}.json` }).click();
    URL.revokeObjectURL(url);
  }
  async function sendRequest(e) {
    e.preventDefault();
    try {
      await api('/me/data-requests', { method: 'POST', body: { kind: ask, details } });
      setAsk(null); setDetails(''); reloadRequests();
      toast('Request sent to the society office');
    } catch (err) { toast(err.message); }
  }

  const changeLang = (l) => { setLang(l); api('/me', { method: 'PATCH', body: { lang: l } }).catch(() => {}); };
  async function add(e) {
    e.preventDefault();
    try { await api('/household', { method: 'POST', body: form }); setForm({ name: '', phone: '', relation: 'family' }); setAdding(false); reload(); toast('Added'); }
    catch (e) { toast(e.message); }
  }
  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
    nav('/login', { replace: true });
  }

  return (
    <div className="stack-lg">
      <section className="card">
        <div style={{ fontWeight: 600, fontSize: 17 }}>{me.name}</div>
        <div className="faint small">{me.flat_id} · {me.relation} · {me.phone}</div>
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <span className="label">{t('language')}</span>
        <div className="chips">{LANGS.map(([k, l]) => <button key={k} className={`chip ${lang === k ? 'on' : ''}`} onClick={() => changeLang(k)}>{l}</button>)}</div>
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <span className="label">{t('theme')}</span>
        <ThemeSwitch />
      </section>
      <section>
        <div className="section-title">
          <h2>{t('household')}</h2>
          {me.relation !== 'family' && <button className="link small row" style={{ gap: 4 }} onClick={() => setAdding((v) => !v)}><Icon name="plus" size={16} />Add</button>}
        </div>
        <div className="card flush list">
          {(members || []).map((m) => (
            <div key={m.id} className="list-item">
              <div className="grow"><div style={{ fontWeight: 500 }}>{m.name}</div><div className="faint tiny">{m.phone}</div></div>
              <span className="pill">{m.relation}</span>
            </div>
          ))}
        </div>
        {adding && (
          <form className="card stack" style={{ marginTop: 12 }} onSubmit={add}>
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Mobile number" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {me.relation === 'owner' && (
              <div className="chips">
                {['family', 'tenant'].map((r) => <button type="button" key={r} className={`chip ${form.relation === r ? 'on' : ''}`} onClick={() => setForm({ ...form, relation: r })}>{r}</button>)}
              </div>
            )}
            <button className="btn primary block">Add member</button>
          </form>
        )}
      </section>
      {push && push !== 'unsupported' && push !== 'unavailable' && (
        <section className="card row between">
          <div><div style={{ fontWeight: 500 }}>{t('alerts')}</div><div className="faint tiny">{push === 'blocked' ? 'Blocked in browser settings' : t('alertsBody')}</div></div>
          {push !== 'blocked' && <button className="btn sm" onClick={togglePush}>{push === 'on' ? 'Turn off' : t('turnOn')}</button>}
        </section>
      )}

      <section>
        <div className="section-title"><h2>{t('yourData')}</h2></div>
        <div className="card flush list">
          <button className="list-item" onClick={download}><Icon name="download" size={18} /><span className="grow">{t('downloadData')}</span></button>
          <button className="list-item" onClick={() => setAsk('correction')}><Icon name="wrench" size={18} /><span className="grow">{t('askCorrect')}</span></button>
          <button className="list-item" onClick={() => setAsk('erasure')}><Icon name="x" size={18} /><span className="grow">{t('askErase')}</span></button>
        </div>
        {requests?.length > 0 && (
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            {requests.map((r) => (
              <p key={r.id} className="faint small">{r.kind === 'erasure' ? 'Erasure' : 'Correction'} request, {date(r.created_at)}: <b>{r.status === 'open' ? 'with the office' : r.status}</b>{r.response ? ` — ${r.response}` : ''}</p>
            ))}
          </div>
        )}
      </section>

      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ask === 'erasure' ? t('askErase') : t('askCorrect')} center>
        <form className="stack" onSubmit={sendRequest}>
          {ask === 'erasure' ? (
            <p className="muted small">Your account will be closed and your complaint photos and notes deleted. Bills, payments and receipts for the flat are kept, because the society must keep its accounts by law.</p>
          ) : <p className="muted small">Tell the office what is wrong, for example a misspelt name or a changed mobile number.</p>}
          <textarea className="input" value={details} onChange={(e) => setDetails(e.target.value)} placeholder={ask === 'erasure' ? 'Anything to add (optional)' : 'What should be corrected?'} />
          <button className="btn primary block" disabled={ask === 'correction' && !details.trim()}>Send request</button>
        </form>
      </Sheet>

      <button className="btn block" onClick={signOut}><Icon name="logout" size={18} />{t('signOut')}</button>
    </div>
  );
}
