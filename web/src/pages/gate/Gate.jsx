import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setSession, getSession, getDevice, setDevice } from '../../api.js';
import { compressImage, time } from '../../format.js';
import { Icon } from '../../ui.jsx';
import { useT, LANGS } from '../../i18n.jsx';

// Entries are saved on the tablet first and sent when the network allows, so
// the gate keeps working through drops. Each has a client id, which makes
// retries safe: the server stores an entry once.
const QKEY = 'township.gate.queue';
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const PURPOSES = ['Delivery', 'Guest', 'Cab', 'Service', 'Daily help'];

function Keypad({ onKey }) {
  return (
    <div className="g-keys">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} aria-label={k}>{k === 'del' ? '⌫' : k === 'clear' ? 'C' : k}</button>
      ))}
    </div>
  );
}

function NewVisitor({ gate, flats, onSave, onCancel }) {
  const { t } = useT();
  const file = useRef();
  const [photo, setPhoto] = useState(null);
  const [tower, setTower] = useState('');
  const [unit, setUnit] = useState('');
  const [focus, setFocus] = useState('tower');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('Delivery');
  const flatId = tower && unit ? `T${tower.padStart(2, '0')}-${unit.padStart(4, '0')}` : '';
  const known = !flats.length || flats.includes(flatId);

  const key = (k) => {
    const [val, set, max] = focus === 'tower' ? [tower, setTower, 2] : [unit, setUnit, 4];
    if (k === 'del') set(val.slice(0, -1));
    else if (k === 'clear') set('');
    else if (val.length < max) {
      set(val + k);
      if (focus === 'tower' && val.length + 1 === 2) setFocus('unit');
    }
  };

  return (
    <div className="g-grid">
      <div className="stack" style={{ gap: 16 }}>
        <input ref={file} type="file" accept="image/*" capture="user" hidden onChange={async (e) => e.target.files[0] && setPhoto(await compressImage(e.target.files[0], 640, 0.6))} />
        <button type="button" className="g-photo" onClick={() => file.current.click()}>
          {photo ? <img src={photo} alt="Visitor" /> : <span className="row" style={{ gap: 12 }}><Icon name="camera" size={34} />{t('g_takePhoto')}</span>}
        </button>
        <input className="g-input" placeholder={t('g_name')} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="g-chips">{PURPOSES.map((p) => <button key={p} type="button" className={`g-chip ${purpose === p ? 'on' : ''}`} onClick={() => setPurpose(p)}>{t(`g_purpose_${p}`)}</button>)}</div>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <button type="button" className="g-input" style={{ textAlign: 'left', borderColor: focus === 'tower' ? 'var(--g-accent)' : undefined }} onClick={() => setFocus('tower')}>
            <span className="g-muted" style={{ fontSize: 16, display: 'block', lineHeight: 1 }}>{t('g_tower')}</span>{tower || '—'}
          </button>
          <button type="button" className="g-input" style={{ textAlign: 'left', borderColor: focus === 'unit' ? 'var(--g-accent)' : undefined }} onClick={() => setFocus('unit')}>
            <span className="g-muted" style={{ fontSize: 16, display: 'block', lineHeight: 1 }}>{t('g_flat')}</span>{unit || '—'}
          </button>
        </div>
        <div className="g-muted" style={{ minHeight: 26 }}>{flatId ? (known ? flatId : t('g_notFlat', { f: flatId })) : t('g_enterFlat')}</div>
        <Keypad onKey={key} />
        <div className="row" style={{ gap: 12 }}>
          <button type="button" className="g-btn" onClick={onCancel}>{t('g_cancel')}</button>
          <button type="button" className="g-btn primary grow" disabled={!flatId || !known || !name.trim()}
            onClick={() => onSave({ flatId, name: name.trim(), purpose, photo, gate })}>{t('g_ask')}</button>
        </div>
      </div>
    </div>
  );
}

function GuestCode({ gate, onSave, onCancel }) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  async function check(c) {
    setError('');
    try { setFound(await api('/gate/code', { method: 'POST', body: { code: c } })); }
    catch (e) { setError(e.status === 0 ? 'No network. Ask the resident to call the gate.' : e.message); }
  }
  const key = (k) => {
    const v = k === 'del' ? code.slice(0, -1) : k === 'clear' ? '' : code.length < 6 ? code + k : code;
    setCode(v); setFound(null);
    if (v.length === 6) check(v);
  };
  return (
    <div className="g-grid">
      <div className="stack" style={{ gap: 16 }}>
        <div className="g-input" style={{ display: 'flex', alignItems: 'center', fontSize: 44, letterSpacing: '0.3em', height: 96 }}>{code || <span className="g-muted" style={{ fontSize: 24, letterSpacing: 0 }}>{t('g_code')}</span>}</div>
        {found && (
          <div className="g-card stack" style={{ gap: 6 }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{found.guestName}</div>
            <div className="g-muted">{t('g_guestOf', { f: found.flatId })}</div>
          </div>
        )}
        {error && <div className="g-banner off">{error}</div>}
        {found && <button className="g-big primary" onClick={() => onSave({ flatId: found.flatId, name: found.guestName, purpose: 'Guest', guestCode: found.code, gate })}><Icon name="check" size={34} stroke={2.5} />{t('g_letIn')}</button>}
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <Keypad onKey={key} />
        <button className="g-btn" onClick={onCancel}>{t('g_cancel')}</button>
      </div>
    </div>
  );
}

function GateConsole({ device, onSignOut }) {
  const { t, lang, setLang } = useT();
  const [mode, setMode] = useState('home');
  const gate = device.gate;
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState(() => store.get(QKEY, []));
  const [list, setList] = useState(() => store.get('township.gate.list', []));
  const [flats, setFlats] = useState(() => store.get('township.gate.flats', []));
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const v = await api('/gate/visitors');
      setList(v); store.set('township.gate.list', v.map(({ photo, ...rest }) => rest)); setOnline(true);
    } catch { setOnline(false); }
  }, []);
  const flush = useCallback(async () => {
    let q = store.get(QKEY, []);
    for (const entry of q) {
      try {
        await api('/gate/visitors', { method: 'POST', body: entry });
        q = q.filter((e) => e.clientId !== entry.clientId);
        store.set(QKEY, q); setQueue(q);
      } catch (e) {
        if (e.status === 0) { setOnline(false); break; }
        q = q.filter((x) => x.clientId !== entry.clientId); // rejected by server: drop and tell the guard
        store.set(QKEY, q); setQueue(q); setMsg(`${entry.name}: ${e.message}`);
      }
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    api('/gate/flats').then((f) => { setFlats(f); store.set('township.gate.flats', f); }).catch(() => {});
    flush();
    const id = setInterval(flush, 5000);
    const on = () => { setOnline(true); flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { clearInterval(id); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [flush]);

  function save(entry) {
    const e = { ...entry, clientId: crypto.randomUUID?.() || String(Date.now() + Math.random()), createdAt: new Date().toISOString() };
    const q = [...store.get(QKEY, []), e];
    store.set(QKEY, q); setQueue(q); setMode('home');
    setMsg(entry.guestCode ? t('g_goIn', { n: entry.name }) : t('g_asked', { f: entry.flatId, n: entry.name }));
    flush();
  }
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(''), 5000); return () => clearTimeout(id); }, [msg]);

  const rows = [
    ...queue.map((q) => ({ ...q, id: q.clientId, status: 'queued', flat_id: q.flatId, created_at: q.createdAt })),
    ...list.filter((v) => !queue.some((q) => q.clientId === v.client_id)),
  ];

  return (
    <div className="gate">
      <div className="g-head">
        <div className="row" style={{ gap: 14 }}>
          <div className="g-title">{gate}</div>
          <span className="g-muted">{getSession()?.user?.name}</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {!online && <span className="g-banner off row" style={{ gap: 8, padding: '8px 14px' }}><Icon name="wifi" size={20} />{t('g_offline', { n: queue.length })}</span>}
          {LANGS.map(([k, l]) => <button key={k} className={`g-chip ${lang === k ? 'on' : ''}`} style={{ height: 48, fontSize: 16 }} onClick={() => setLang(k)}>{l}</button>)}
          <button className="g-chip" style={{ height: 48, fontSize: 16 }} onClick={onSignOut}>{t('g_endShift')}</button>
        </div>
      </div>

      {msg && <div className="g-banner" style={{ background: 'color-mix(in oklab, var(--g-ok), transparent 86%)', color: 'var(--g-ok)', fontSize: 20 }}>{msg}</div>}

      {mode === 'new' && <NewVisitor gate={gate} flats={flats} onSave={save} onCancel={() => setMode('home')} />}
      {mode === 'code' && <GuestCode gate={gate} onSave={save} onCancel={() => setMode('home')} />}
      {mode === 'home' && (
        <>
          <div className="g-grid">
            <button className="g-big primary" onClick={() => setMode('new')}><Icon name="plus" size={36} stroke={2.4} />{t('g_newVisitor')}</button>
            <button className="g-big" onClick={() => setMode('code')}><Icon name="key" size={34} stroke={2.2} />{t('g_guestCode')}</button>
          </div>
          <div className="g-list">
            {rows.length === 0 && <div className="g-muted">{t('g_none')}</div>}
            {rows.map((v) => (
              <div key={v.id} className="g-visitor">
                {v.photo ? <img src={v.photo} alt="" /> : <div className="g-ph" aria-hidden="true">{(v.name || '?').trim().charAt(0).toUpperCase()}</div>}
                <div className="grow">
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{v.name}</div>
                  <div className="g-muted">{v.flat_id} · {v.purpose ? t(`g_purpose_${v.purpose}`) : ''} · {time(v.created_at)}</div>
                </div>
                <span className={`g-status s-${v.status}`}>{t(`g_${v.status}`)}</span>
                {(v.status === 'approved' || v.status === 'inside') && (
                  <button className="g-chip" onClick={() => api(`/gate/visitors/${v.id}/${v.status === 'approved' ? 'enter' : 'exit'}`, { method: 'POST' }).then(refresh).catch(() => {})}>
                    {v.status === 'approved' ? t('g_entered') : t('g_exited')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="g-dpdp">
        <Icon name="shield" size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
        {t('g_notice')}
      </div>
    </div>
  );
}

function Pair({ onPaired }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function key(k) {
    const v = k === 'del' ? code.slice(0, -1) : k === 'clear' ? '' : code.length < 8 ? code + k : code;
    setCode(v); setError('');
    if (v.length === 8) {
      try { const d = await api('/devices/pair', { method: 'POST', body: { code: v } }); setDevice(d); onPaired(d); }
      catch (e) { setError(e.message); setCode(''); }
    }
  }
  return (
    <div className="gate">
      <div className="g-title">Set up this gate tablet</div>
      <div className="g-grid">
        <div className="stack" style={{ gap: 16 }}>
          <p className="g-muted">Enter the 8-digit pairing code from Admin → Gate tablets. Each code works once.</p>
          <div className="g-input" style={{ display: 'flex', alignItems: 'center', fontSize: 40, letterSpacing: '0.25em', height: 96 }}>{code || <span className="g-muted" style={{ fontSize: 22, letterSpacing: 0 }}>Pairing code</span>}</div>
          {error && <div className="g-banner off">{error}</div>}
        </div>
        <Keypad onKey={key} />
      </div>
    </div>
  );
}

function GuardLogin({ device, onSignedIn }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [focus, setFocus] = useState('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = (k) => {
    const [v, set, max] = focus === 'phone' ? [phone, setPhone, 10] : [pin, setPin, 8];
    setError('');
    if (k === 'del') set(v.slice(0, -1));
    else if (k === 'clear') set('');
    else if (v.length < max) { set(v + k); if (focus === 'phone' && v.length + 1 === 10) setFocus('pin'); }
  };
  async function signIn() {
    setBusy(true); setError('');
    try { const r = await api('/auth/pin', { method: 'POST', body: { phone, pin } }); setSession(r); onSignedIn(); }
    catch (e) { setError(e.status === 0 ? 'No network. The tablet needs a connection to start a shift.' : e.message); setPin(''); }
    finally { setBusy(false); }
  }
  return (
    <div className="gate">
      <div className="g-head"><div className="g-title">{device.gate}</div><span className="g-muted">{device.name}</span></div>
      <div className="g-grid">
        <div className="stack" style={{ gap: 16 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Start your shift</div>
          <button type="button" className="g-input" style={{ textAlign: 'left', borderColor: focus === 'phone' ? 'var(--g-accent)' : undefined }} onClick={() => setFocus('phone')}>
            <span className="g-muted" style={{ fontSize: 16, display: 'block', lineHeight: 1 }}>Mobile number</span>{phone || '—'}
          </button>
          <button type="button" className="g-input" style={{ textAlign: 'left', borderColor: focus === 'pin' ? 'var(--g-accent)' : undefined }} onClick={() => setFocus('pin')}>
            <span className="g-muted" style={{ fontSize: 16, display: 'block', lineHeight: 1 }}>PIN</span>{pin ? '•'.repeat(pin.length) : '—'}
          </button>
          {error && <div className="g-banner off">{error}</div>}
          <button className="g-btn primary" disabled={busy || phone.length !== 10 || pin.length < 4} onClick={signIn}>Sign in</button>
        </div>
        <Keypad onKey={key} />
      </div>
    </div>
  );
}

export default function Gate() {
  const [device, setDeviceState] = useState(getDevice);
  const [session, setSessionState] = useState(() => (getSession()?.user?.role === 'guard' ? getSession() : null));
  if (!device) return <Pair onPaired={setDeviceState} />;
  if (!session) return <GuardLogin device={device} onSignedIn={() => setSessionState(getSession())} />;
  return <GateConsole device={device} onSignOut={async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null); setSessionState(null);
  }} />;
}
