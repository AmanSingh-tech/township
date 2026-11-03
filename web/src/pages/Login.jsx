import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api.js';
import { useT, LANGS } from '../i18n.jsx';
import { homeFor } from '../App.jsx';

export default function Login() {
  const { t, lang, setLang } = useT();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [screenCode, setScreenCode] = useState('');
  const digits = phone.replace(/\D/g, '').slice(-10);

  async function sendOtp(e) {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api('/auth/otp', { method: 'POST', body: { phone: digits } });
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
          <div className="brand"><img src="/icon.svg" alt="" /><span>Township</span></div>
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
