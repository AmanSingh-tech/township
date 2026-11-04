import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { useState } from 'react';
import { api, getSession, setSession } from '../../api.js';
import { Icon, initials } from '../../ui.jsx';
import { LOGO } from '../../brand.js';
import InstallButton from '../../InstallButton.jsx';

export default function ResidentShell() {
  const { t } = useT();
  const user = getSession()?.user;
  const loc = useLocation();
  const titles = { '/book': t('bookTitle'), '/bills': t('bills'), '/complaints': t('complaints'), '/visitors': t('visitors'), '/me': t('me') };
  const title = titles[loc.pathname];
  const [consented, setConsented] = useState(!!user.consent_at);
  if (!consented) return <Consent onDone={() => setConsented(true)} />;
  return (
    <div className="app">
      <header className="topbar no-print">
        {title ? <div className="title">{title}</div> : (
          <div>
            <div className="faint small">{user.flat_id}</div>
            <div className="title">{t('hello')}, {user.name.split(' ')[0]}</div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <InstallButton variant="icon" />
          <Link to="/me" className="avatar" aria-label={t('me')}>{initials(user.name)}</Link>
        </div>
      </header>
      <Outlet />
      <div className="tabbar no-print">
        <nav>
          <NavLink to="/" end><Icon name="home" />{t('home')}</NavLink>
          <NavLink to="/bills"><Icon name="bill" />{t('bills')}</NavLink>
          <NavLink to="/complaints"><Icon name="wrench" />{t('complaints')}</NavLink>
          <NavLink to="/visitors"><Icon name="users" />{t('visitors')}</NavLink>
          <NavLink to="/book"><Icon name="clock" />{t('book')}</NavLink>
        </nav>
      </div>
    </div>
  );
}

// DPDP Act 2023: residents see what is collected and why before first use.
function Consent({ onDone }) {
  const [busy, setBusy] = useState(false);
  async function agree() {
    setBusy(true);
    try {
      const user = await api('/me', { method: 'PATCH', body: { consent: true } });
      setSession({ ...getSession(), user });
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="app" style={{ paddingTop: 32 }}>
      <div className="stack-lg">
        <div className="brand"><img src={LOGO} alt="" /><span>Township</span></div>
        <h1>Your data</h1>
        <div className="stack muted" style={{ fontSize: 14.5 }}>
          <p>To run this app, the society office keeps your name, mobile number and flat, your maintenance bills and payments, complaints you raise with any photos, and visitors who come to your flat.</p>
          <p>It is used only to bill and receive maintenance, fix complaints and manage the gates. It is not sold or shared, except with the payment provider to process your payments.</p>
          <p>Visitor photos are deleted after 90 days. You can ask the help desk for a copy of your data or to correct it at any time, as the Digital Personal Data Protection Act, 2023 allows.</p>
        </div>
        <button className="btn primary lg block" disabled={busy} onClick={agree}>I agree</button>
      </div>
    </div>
  );
}
