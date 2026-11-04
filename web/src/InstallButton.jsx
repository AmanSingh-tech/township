// "Install app" for navigation bars, on every screen size. Opens the browser's
// install prompt where there is one (Chrome and Edge on desktop and Android),
// or the steps for Safari (iPhone, iPad, Mac). Hidden once installed, and in
// browsers that cannot install web apps.
import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n.jsx';
import { Icon, useToast } from './ui.jsx';
import { useInstall } from './install.js';

export function InstallSteps({ mode, t }) {
  return mode === 'mac'
    ? <ol className="install-steps tiny"><li>{t('macStep')}</li></ol>
    : <ol className="install-steps tiny"><li>{t('iosStep1')}</li><li>{t('iosStep2')}</li></ol>;
}

export default function InstallButton({ variant = 'pill', className = '' }) {
  const { t } = useT();
  const toast = useToast();
  const { mode, install } = useInstall();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!mode) return null;

  async function onClick() {
    if (mode === 'prompt') { if (await install()) toast(t('installed')); } else setOpen((v) => !v);
  }
  return (
    <span className={`install-btn ${variant} ${className}`} ref={ref}>
      <button type="button" onClick={onClick} aria-expanded={mode === 'prompt' ? undefined : open} aria-label={variant === 'icon' ? t('installApp') : undefined} title={t('installApp')}>
        <Icon name="download" size={variant === 'side' ? 18 : 16} />{variant !== 'icon' && <span>{t('installApp')}</span>}
      </button>
      {open && (
        <div className="install-pop" role="dialog" aria-label={t('installApp')}>
          <b>{mode === 'mac' ? t('installApp') : t('installTitle')}</b>
          <InstallSteps mode={mode} t={t} />
        </div>
      )}
    </span>
  );
}
