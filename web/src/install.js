// "Install the app": Chrome, Edge and Android offer a prompt we can show from a
// button; Safari on iPhone has none, so it gets instructions instead. The
// browser's event arrives once, early, so it is caught here at start-up.
import { useEffect, useState } from 'react';

let deferred = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}

export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const DISMISS = 'township.installDismissed';
const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < 14 * 864e5; } catch { return false; } };

// mode: 'prompt' (a button works), 'ios' (show steps), or null (installed or unsupported).
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const fn = () => tick((n) => n + 1); listeners.add(fn); return () => listeners.delete(fn); }, []);
  const mode = isStandalone() ? null : deferred ? 'prompt' : isIos() ? 'ios' : null;
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
