// Applies the saved theme before the page paints, so dark mode never flashes
// light. "system" (nothing saved) follows the device. Kept as a file because
// the Content Security Policy allows no inline scripts.
try {
  var t = localStorage.getItem('township.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: follow the device */ }
