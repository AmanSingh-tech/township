import { api } from './api.js';

// Web push: residents turn on alerts once per phone. Needs the installed or
// HTTPS app (service workers are not available on plain HTTP).
const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  const { enabled } = await api('/push/key').catch(() => ({ enabled: false }));
  if (!enabled) return 'unavailable';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function turnOnPush() {
  const { key } = await api('/push/key');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts were not allowed. You can allow them in your browser settings.');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
}
