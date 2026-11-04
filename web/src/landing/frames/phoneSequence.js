// Renders the frames of a phone turning a full circle, as an image sequence.
// There are no studio renders of the product, so the frames are drawn here:
// the front (the resident home screen) and back are painted once as textures,
// then each frame projects them with real perspective, strip by strip, and
// adds the edge, shading and a moving highlight. Frames are compressed to
// image blobs, so 60 of them cost a few megabytes, not hundreds.
//
// Swapping in real renders later only means passing their URLs to
// <ImageSequence> instead.

const W = 300, H = 620, DEPTH = 24, R = 46, FOCAL = 1500;
export const SEQ_WIDTH = 420, SEQ_HEIGHT = 700;
const INK = '#14161b', COBALT = '#2f6feb', NAVY = '#1a3a94';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  return c;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(ctx, s, x, y, font, color, align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
}

function frontTexture(s) {
  const c = canvas(W * s, H * s); const ctx = c.getContext('2d'); ctx.scale(s, s);
  const body = ctx.createLinearGradient(0, 0, W, H);
  body.addColorStop(0, '#45484f'); body.addColorStop(0.45, '#1c1d21'); body.addColorStop(1, '#34363c');
  rr(ctx, 0, 0, W, H, R); ctx.fillStyle = body; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();

  ctx.save();
  rr(ctx, 10, 10, W - 20, H - 20, R - 10); ctx.clip();
  ctx.fillStyle = '#f3f4f7'; ctx.fillRect(0, 0, W, H);
  const head = ctx.createLinearGradient(0, 0, W, 290);
  head.addColorStop(0, '#13245a'); head.addColorStop(1, COBALT);
  ctx.fillStyle = head; ctx.fillRect(0, 0, W, 292);
  const sheen = ctx.createRadialGradient(W * 0.8, 40, 10, W * 0.8, 40, 220);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, 292);

  text(ctx, '9:41', 34, 42, '600 13px Inter', '#fff');
  rr(ctx, W - 58, 32, 22, 11, 3); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1; ctx.stroke();
  rr(ctx, W - 56, 34, 15, 7, 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(W / 2, 36, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#07080a'; ctx.fill();

  text(ctx, 'Good evening', 30, 88, '500 12px Inter', 'rgba(255,255,255,0.72)');
  text(ctx, 'Swati Joshi', 30, 114, '600 22px Inter', '#fff');
  text(ctx, 'T12-0408 · Tower 12', 30, 134, '500 11.5px Inter', 'rgba(255,255,255,0.7)');
  rr(ctx, 24, 154, W - 48, 118, 20); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.24)'; ctx.lineWidth = 1; ctx.stroke();
  text(ctx, 'Maintenance due', 40, 182, '500 11.5px Inter', 'rgba(255,255,255,0.78)');
  text(ctx, '₹4,820', 40, 222, '700 34px Inter', '#fff');
  text(ctx, 'Due 10 Nov', 40, 248, '500 11px Inter', 'rgba(255,255,255,0.7)');
  rr(ctx, W - 124, 218, 84, 34, 17); ctx.fillStyle = '#fff'; ctx.fill();
  text(ctx, 'Pay now', W - 82, 240, '600 12.5px Inter', NAVY, 'center');

  const labels = ['Pay', 'Fix', 'Visitors', 'Book'];
  const tw = (W - 48 - 30) / 4;
  labels.forEach((l, i) => {
    const x = 24 + i * (tw + 10);
    rr(ctx, x, 306, tw, 66, 14); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#e4e6ec'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + tw / 2, 330, 12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(47,111,235,0.12)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + tw / 2, 330, 4.5, 0, Math.PI * 2); ctx.fillStyle = COBALT; ctx.fill();
    text(ctx, l, x + tw / 2, 360, '500 10.5px Inter', '#3a3d45', 'center');
  });

  text(ctx, 'Today', 24, 404, '600 13px Inter', INK);
  const rows = [
    ['Visitor at Gate 1', 'Ravi, delivery · tap to approve', COBALT],
    ['Water leak, kitchen', 'Plumber assigned · 2:40 pm', '#d08a06'],
    ['Clubhouse', 'Sat, 7–9 pm · booked', '#17a34a'],
  ];
  rows.forEach(([t, sub, col], i) => {
    const y = 418 + i * 64;
    rr(ctx, 24, y, W - 48, 56, 14); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#e4e6ec'; ctx.stroke();
    ctx.beginPath(); ctx.arc(46, y + 28, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    text(ctx, t, 62, y + 24, '600 12.5px Inter', INK);
    text(ctx, sub, 62, y + 41, '500 10.5px Inter', '#7a7d86');
  });
  rr(ctx, W / 2 - 48, H - 26, 96, 4, 2); ctx.fillStyle = 'rgba(20,22,27,0.85)'; ctx.fill();
  ctx.restore();
  return c;
}

function backTexture(s) {
  const c = canvas(W * s, H * s); const ctx = c.getContext('2d'); ctx.scale(s, s);
  const body = ctx.createLinearGradient(0, 0, W, H);
  body.addColorStop(0, '#2a3b66'); body.addColorStop(0.5, '#17223f'); body.addColorStop(1, '#22325a');
  rr(ctx, 0, 0, W, H, R); ctx.fillStyle = body; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();
  const frost = ctx.createLinearGradient(0, 0, W, 0);
  frost.addColorStop(0, 'rgba(255,255,255,0.06)'); frost.addColorStop(0.5, 'rgba(255,255,255,0)'); frost.addColorStop(1, 'rgba(255,255,255,0.05)');
  rr(ctx, 0, 0, W, H, R); ctx.fillStyle = frost; ctx.fill();

  rr(ctx, 20, 20, 96, 96, 28); ctx.fillStyle = 'rgba(12,16,28,0.55)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
  [[46, 46], [90, 46], [46, 90]].forEach(([x, y]) => {
    const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 15);
    g.addColorStop(0, '#3b4a6b'); g.addColorStop(0.5, '#0b0e16'); g.addColorStop(1, '#05070b');
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
  });
  ctx.beginPath(); ctx.arc(90, 90, 5, 0, Math.PI * 2); ctx.fillStyle = '#e9e3cf'; ctx.fill();

  // Mark: three towers.
  const cx = W / 2, cy = H / 2;
  [[-22, 34], [0, 52], [22, 26]].forEach(([dx, h]) => {
    rr(ctx, cx + dx - 8, cy + 26 - h, 16, h, 3); ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.fill();
  });
  text(ctx, 'Township', cx, cy + 56, '600 13px Inter', 'rgba(255,255,255,0.55)', 'center');
  return c;
}

// Projects a point on the phone (x across, z through it) turned by theta.
function projector(theta, cx) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return (x, z) => {
    const X = x * c + z * s, Z = -x * s + z * c, p = FOCAL / (FOCAL + Z);
    return [cx + X * p, p];
  };
}

function drawFrame(out, face, theta, front, back, s) {
  const ctx = out.getContext('2d');
  const cx = SEQ_WIDTH / 2, cy = SEQ_HEIGHT / 2;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const proj = projector(theta, cx);
  ctx.clearRect(0, 0, out.width, out.height);

  // Soft floor shadow, as wide as the phone looks at this angle.
  const span = Math.abs(W * cos) + Math.abs(DEPTH * sin) + 40;
  ctx.save();
  ctx.translate(cx * s, (cy + H / 2 + 20) * s); ctx.scale(1, 0.14);
  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, span * 0.62 * s);
  sh.addColorStop(0, 'rgba(0,0,0,0.6)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(-span * s, -span * s, span * 2 * s, span * 2 * s);
  ctx.restore();

  // Edge: the side facing the camera.
  if (Math.abs(sin) > 0.02) {
    const xe = sin > 0 ? W / 2 : -W / 2;
    const [ax, ap] = proj(xe, -DEPTH / 2), [bx, bp] = proj(xe, DEPTH / 2);
    const he = H / 2 - R * 0.55;
    const g = ctx.createLinearGradient(ax * s, 0, bx * s, 0);
    g.addColorStop(0, '#5a5e67'); g.addColorStop(0.5, '#2a2c31'); g.addColorStop(1, '#17181b');
    ctx.beginPath();
    ctx.moveTo(ax * s, (cy - he * ap) * s); ctx.lineTo(bx * s, (cy - he * bp) * s);
    ctx.lineTo(bx * s, (cy + he * bp) * s); ctx.lineTo(ax * s, (cy + he * ap) * s); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }

  // Face, front or back, drawn in thin vertical strips so it narrows and
  // grows with perspective.
  const isFront = cos >= 0;
  const tex = isFront ? front : back;
  const z = isFront ? -DEPTH / 2 : DEPTH / 2;
  const fctx = face.getContext('2d');
  fctx.globalCompositeOperation = 'source-over';
  fctx.clearRect(0, 0, face.width, face.height);
  const N = 140;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    const x0 = isFront ? (u0 - 0.5) * W : (0.5 - u0) * W;
    const x1 = isFront ? (u1 - 0.5) * W : (0.5 - u1) * W;
    const [sx0, p0] = proj(x0, z), [sx1, p1] = proj(x1, z);
    const p = (p0 + p1) / 2, h = H * p;
    fctx.drawImage(tex, u0 * W * s, 0, (u1 - u0) * W * s, H * s,
      Math.min(sx0, sx1) * s, (cy - h / 2) * s, Math.abs(sx1 - sx0) * s + 0.8, h * s);
  }
  // Turning away from the light darkens the face; a highlight sweeps across.
  fctx.globalCompositeOperation = 'source-atop';
  fctx.fillStyle = `rgba(0,0,0,${(1 - Math.abs(cos)) * 0.62})`;
  fctx.fillRect(0, 0, face.width, face.height);
  const hx = (cx + sin * W * 0.9) * s;
  const spec = fctx.createLinearGradient(hx - 90 * s, 0, hx + 90 * s, 0);
  spec.addColorStop(0, 'rgba(255,255,255,0)'); spec.addColorStop(0.5, 'rgba(255,255,255,0.2)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
  fctx.fillStyle = spec; fctx.fillRect(0, 0, face.width, face.height);
  ctx.drawImage(face, 0, 0);
}

const toBlobUrl = (c) => new Promise((resolve) => {
  c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : c.toDataURL()), 'image/webp', 0.86);
});

// Resolves to the frame URLs. onProgress gets the list as it grows, so the
// first frames can be shown before the rest are ready.
export async function renderPhoneSequence({ count = 60, scale = 1.5, onProgress } = {}) {
  await document.fonts?.load('600 20px Inter').catch(() => {});
  const front = frontTexture(scale), back = backTexture(scale);
  const out = canvas(SEQ_WIDTH * scale, SEQ_HEIGHT * scale);
  const face = canvas(SEQ_WIDTH * scale, SEQ_HEIGHT * scale);
  const urls = [];
  for (let i = 0; i < count; i++) {
    drawFrame(out, face, (i / count) * Math.PI * 2, front, back, scale);
    urls.push(await toBlobUrl(out));
    if (i === 0 || i % 12 === 11 || i === count - 1) onProgress?.(urls.slice());
  }
  return urls;
}
