import { useState } from 'react';
import { Icon } from './ui.jsx';
import { useT } from './i18n.jsx';

// System (follow the device), Light or Dark. Saved per browser; /theme.js
// applies it before the first paint.
const KEY = 'township.theme';
const read = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  try { theme === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, theme); } catch { /* private mode */ }
}

export function ThemeSwitch({ compact = false }) {
  const { t } = useT();
  const [theme, setTheme] = useState(read);
  const options = [['system', 'monitor', t('themeSystem')], ['light', 'sun', t('themeLight')], ['dark', 'moon', t('themeDark')]];
  return (
    <div className="tabs" role="radiogroup" aria-label={t('theme')}>
      {options.map(([k, icon, label]) => (
        <button key={k} type="button" role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''} title={label}
          onClick={() => { apply(k); setTheme(k); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name={icon} size={16} />{!compact && label}
        </button>
      ))}
    </div>
  );
}
