export const inr = (n) => (n < 0 ? '−₹' : '₹') + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');
export const pct = (x, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);

export function date(d, opts = { day: 'numeric', month: 'short' }) {
  if (!d) return '';
  const v = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return v.toLocaleDateString('en-IN', opts);
}
export const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function duration(mins) {
  if (mins == null) return '—';
  const a = Math.abs(mins);
  if (a < 60) return `${Math.round(a)} min`;
  if (a < 48 * 60) return `${Math.round(a / 60)} h`;
  return `${Math.round(a / 1440)} d`;
}

// Shrinks a photo before upload so complaints and gate entries stay light.
export function compressImage(file, max = 1024, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
