import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import { api } from './api.js';

const PATHS = {
  home: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  bank: 'M3 9.5 12 4l9 5.5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v6H3v-6z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  door: 'M6 21V4h12v17M3 21h18M14 12v.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  key: 'M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM13 12l8 8M17 16l2-2',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  drop: 'M12 3.5c3.2 4.1 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.8-6.2 6-10.3z',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  lift: 'M5 3h14v18H5zM9.5 9 12 6.5 14.5 9M9.5 15l2.5 2.5 2.5-2.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  star: 'm12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  leaf: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3M7.5 12.5h.01M16.5 12.5h.01',
  bug: 'M9 8a3 3 0 0 1 6 0v1H9zM7 10h10v4a5 5 0 0 1-10 0zM12 10v9M4 12h3M17 12h3M5 17l2-1M19 17l-2-1',
  volume: 'M5 10v4h3l4 4V6L8 10zM16 9a4 4 0 0 1 0 6',
  wall: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v5M14 10v5M8 15v4M16 15v4',
  tree: 'M12 3a5 5 0 0 1 5 5 4 4 0 0 1-1 7H8a4 4 0 0 1-1-7 5 5 0 0 1 5-5zM12 15v6',
};
export function Icon({ name, size = 20, stroke = 1.7, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function usePoll(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function Sheet({ open, onClose, title, children, center }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`scrim ${center ? 'center' : ''}`} onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {title && <div className="row between" style={{ marginBottom: 16 }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>}
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const timer = useRef();
  const show = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2800);
  }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

export const Skeleton = ({ h = 80, style }) => <div className="skeleton" style={{ height: h, ...style }} />;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const STATUS_TONE = { open: '', assigned: '', in_progress: 'warn', resolved: 'ok', closed: '' };
export const URGENCY_TONE = { critical: 'danger', high: 'warn', medium: '', low: '' };
export const STEP = { open: 1, assigned: 2, in_progress: 3, resolved: 4, closed: 4 };

export function Steps({ status, alert }) {
  const n = STEP[status] || 1;
  return <div className={`steps ${alert ? 'alert' : ''}`}>{[1, 2, 3, 4].map((i) => <span key={i} className={i <= n ? 'on' : ''} />)}</div>;
}

export function initials(name = '') {
  return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
