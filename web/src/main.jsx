import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { LangProvider } from './i18n.jsx';
import { ToastProvider } from './ui.jsx';
// Fonts ship with the app: no third-party requests, and they work offline.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-500.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LangProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </LangProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Error reporting, only when the server has a Sentry DSN configured.
fetch('/api/client-config').then((r) => r.json()).then(async ({ sentryDsn, environment }) => {
  if (!sentryDsn) return;
  const Sentry = await import('@sentry/browser');
  Sentry.init({ dsn: sentryDsn, environment, sendDefaultPii: false, tracesSampleRate: 0 });
}).catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
