// Offers to put the app on the home screen. Hidden once it is installed.
import { useState } from 'react';
import { useT } from '../../i18n.jsx';
import { Icon, useToast } from '../../ui.jsx';
import { LOGO } from '../../brand.js';
import { useInstall } from '../../install.js';
import { InstallSteps } from '../../InstallButton.jsx';

export default function InstallCard({ dismissible = true }) {
  const { t } = useT();
  const toast = useToast();
  const { mode, dismissed, install, dismiss } = useInstall();
  const [steps, setSteps] = useState(false);
  if (!mode || (dismissible && dismissed)) return null;
  return (
    <div className="install-card">
      <img src={LOGO} alt="" />
      <div className="grow">
        <b>{t('installTitle')}</b>
        <div className="tiny">{t('installBody')}</div>
        {mode !== 'prompt' && steps && <InstallSteps mode={mode} t={t} />}
      </div>
      <div className="install-actions">
        {mode === 'prompt'
          ? <button className="btn sm primary" onClick={async () => { if (await install()) toast(t('installed')); }}>{t('install')}</button>
          : <button className="btn sm primary" onClick={() => setSteps((v) => !v)}>{steps ? t('hideDetails') : t('howTo')}</button>}
        {dismissible && <button className="btn sm ghost" onClick={dismiss} aria-label={t('notNow')}><Icon name="x" size={16} /></button>}
      </div>
    </div>
  );
}
