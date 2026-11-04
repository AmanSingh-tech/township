import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

// Plays an image sequence on a canvas. The parent drives it with
// ref.current.seek(progress), progress from 0 to 1, usually from a scrubbed
// ScrollTrigger. A frame is only redrawn when the frame number changes, and
// frames still loading fall back to the nearest one that has arrived.
const ImageSequence = forwardRef(function ImageSequence({ frames, label, className, width, height }, ref) {
  const canvasRef = useRef(null);
  const images = useRef([]);
  const state = useRef({ p: 0, drawn: null });

  const draw = useCallback((force = false) => {
    const c = canvasRef.current, list = images.current;
    if (!c || !list.length) return;
    const want = Math.round(state.current.p * (list.length - 1));
    let img = null;
    for (let d = 0; d < list.length && !img; d++) {
      for (const i of [want - d, want + d]) {
        const im = list[i];
        if (im && im.complete && im.naturalWidth) { img = im; break; }
      }
    }
    if (!img || (!force && state.current.drawn === img)) return;
    state.current.drawn = img;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, []);

  useImperativeHandle(ref, () => ({
    seek(p) { state.current.p = Math.min(1, Math.max(0, p)); draw(); },
  }), [draw]);

  useEffect(() => {
    const prev = images.current;
    images.current = frames.map((src, i) => {
      if (prev[i]?.src === src) return prev[i];
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => draw(true);
      im.src = src;
      return im;
    });
    draw(true);
  }, [frames, draw]);

  useEffect(() => {
    const c = canvasRef.current;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr);
      draw(true);
    };
    const ro = new ResizeObserver(size);
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={label} style={{ aspectRatio: `${width} / ${height}` }} />;
});

export default ImageSequence;
