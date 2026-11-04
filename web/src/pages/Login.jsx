import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setSession } from '../api.js';
import { useT, LANGS } from '../i18n.jsx';
import { homeFor } from '../App.jsx';
import { LOGO } from '../brand.js';

export default function Login() {
  const { t, lang, setLang } = useT();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [screenCode, setScreenCode] = useState('');
  const [demo, setDemo] = useState(null);
  const digits = phone.replace(/\D/g, '').slice(-10);

  // Demo servers (DEMO_DATA=true) list the sample township's logins.
  useEffect(() => {
    fetch('/api/client-config').then((r) => r.json())
      .then((c) => c.demoLogins?.length && setDemo({ logins: c.demoLogins, guard: c.guardLogin }))
      .catch(() => {});
  }, []);

  async function sendOtp(e, number = digits) {
    e?.preventDefault?.();
    setError(''); setBusy(true);
    try {
      const r = await api('/auth/otp', { method: 'POST', body: { phone: number } });
      setScreenCode(r.screenCode || ''); setStep('code'); setCode('');
    }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api('/auth/verify', { method: 'POST', body: { phone: digits, code } });
      setSession(r);
      if (r.user.role === 'resident' && r.user.lang && r.user.lang !== lang) setLang(r.user.lang);
      nav(homeFor(r.user.role), { replace: true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="box stack-lg">
        <div className="row between">
          <Link to="/welcome" className="brand" style={{ textDecoration: 'none' }}><img src={LOGO} alt="" /><span>Township</span></Link>
          <select className="input" style={{ width: 'auto', height: 36 }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            {LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {step === 'phone' ? (
          <form className="stack" onSubmit={sendOtp}>
            <h1>{t('loginTitle')}</h1>
            <input className="input" inputMode="numeric" autoComplete="tel" placeholder="98XXX XXXXX" value={phone}
              onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" autoFocus />
            {error && <p className="error">{error}</p>}
            <button className="btn primary lg block" disabled={busy || digits.length !== 10}>{t('sendOtp')}</button>
            <p className="faint small">Use the number registered with the society office. Not registered? Contact the help desk.</p>
            {demo && (
              <div className="stack">
                <div className="divider" />
                <p className="small"><b>Demo accounts</b> <span className="faint">· sample township, all made up. Tap one to sign in.</span></p>
                <div className="demo-users">
                  {demo.logins.map((u) => (
                    <button type="button" key={u.phone} disabled={busy} onClick={() => { setPhone(u.phone); sendOtp(null, u.phone); }}>
                      <span><b>{u.name}</b><br /><span className="faint">{u.role}</span></span>
                      <span className="faint" style={{ textAlign: 'right' }}>{u.note}<br /><span className="mono">{u.phone}</span></span>
                    </button>
                  ))}
                </div>
                {demo.guard && <p className="faint small">Gate tablet: sign in as Office Admin, add a tablet, open <span className="mono">/gate</span> and enter the pairing code. Guard: <span className="mono">{demo.guard.phone}</span>, PIN <span className="mono">{demo.guard.pin}</span>.</p>}
              </div>
            )}
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            <h1>{t('otpSent', { p: digits.replace(/(\d{5})(\d{5})/, '$1 $2') })}</h1>
            {screenCode && (
              <p className="notice warn small" role="status">
                SMS is not set up (placeholder), so the code is shown here instead: <b className="mono">{screenCode}</b>{' '}
                <button type="button" className="link small" onClick={() => setCode(screenCode)}>Fill it in</button>
              </p>
            )}
            <input className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Code" autoFocus />
            {error && <p className="error">{error}</p>}
            <button className="btn primary lg block" disabled={busy || code.length !== 6}>{t('verify')}</button>
            <div className="row between">
              <button type="button" className="link small" onClick={() => { setStep('phone'); setError(''); }}>Use a different number</button>
              <button type="button" className="link small" disabled={busy} onClick={sendOtp}>Send the code again</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
