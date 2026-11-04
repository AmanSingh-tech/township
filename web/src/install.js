// "Install the app": Chrome, Edge and Android offer a prompt we can show from a
// button; Safari on iPhone has none, so it gets instructions instead. The
// browser's event arrives once, early, so it is caught here at start-up.
import { useEffect, useState } from 'react';

let deferred = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

// Any way an installed web app can run: its own window, or the home-screen app.
export const isStandalone = () => typeof window !== 'undefined'
  && (['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches)
    || window.navigator.standalone === true);

// A browser tab cannot always tell that the app is installed, so remember it:
// once installed (or opened as the app), the download button stays hidden in
// tabs too. If the browser later offers to install again, it was uninstalled.
const INSTALLED = 'township.installed';
const store = (v) => { try { v ? localStorage.setItem(INSTALLED, '1') : localStorage.removeItem(INSTALLED); } catch { /* private mode */ } };
let installed = (() => { try { return localStorage.getItem(INSTALLED) === '1'; } catch { return false; } })();
const setInstalled = (v) => { if (installed !== v) { installed = v; store(v); emit(); } };

if (typeof window !== 'undefined') {
  if (isStandalone()) { installed = true; store(true); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setInstalled(false); emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; setInstalled(true); });
  // Chrome can say directly whether this web app is installed (manifest: related_applications).
  navigator.getInstalledRelatedApps?.().then((apps) => { if (apps.some((a) => a.platform === 'webapp')) setInstalled(true); }).catch(() => {});
}
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Safari on a Mac (Sonoma and later) installs web apps from File → Add to Dock; it has no prompt either.
const isMacSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;

const DISMISS = 'township.installDismissed';
const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < 14 * 864e5; } catch { return false; } };

// mode: 'prompt' (a button works), 'ios' or 'mac' (Safari's steps), 'manual' (no prompt
// yet, or a browser without one: general steps), or null (installed: running as the app, or
// known to be installed on this device).
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const fn = () => tick((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  const mode = isStandalone() || (installed && !deferred) ? null : deferred ? 'prompt' : isIos() ? 'ios' : isMacSafari() ? 'mac' : 'manual';
  return {
    mode,
    dismissed: dismissedRecently(),
    async install() {
      if (!deferred) return false;
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null; emit();
      return outcome === 'accepted';
    },
    dismiss() { try { localStorage.setItem(DISMISS, String(Date.now())); } catch { /* private mode */ } tick((n) => n + 1); },
  };
}
