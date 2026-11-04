import { useEffect, useState } from 'react';
import { renderPhoneSequence } from './phoneSequence.js';

// Renders the phone frames once per page load, after the hero has had its
// moment on the main thread, and shares them between every user of the hook.
let job = null;
let latest = [];
const listeners = new Set();

function start() {
  if (job) return;
  const small = matchMedia('(max-width: 767px)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  job = renderPhoneSequence({
    count: small ? 48 : 60,
    scale: Math.max(1, dpr * (small ? 0.6 : 0.75)),
    onProgress: (urls) => { latest = urls; listeners.forEach((fn) => fn(urls)); },
  });
}

export function usePhoneSequence() {
  const [frames, setFrames] = useState(latest);
  useEffect(() => {
    listeners.add(setFrames);
    if (latest.length) setFrames(latest);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 700));
    const id = idle(start, { timeout: 1500 });
    return () => { listeners.delete(setFrames); (window.cancelIdleCallback || clearTimeout)(id); };
  }, []);
  return frames;
}
