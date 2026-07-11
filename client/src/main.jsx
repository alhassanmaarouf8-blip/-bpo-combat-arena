import { StrictMode, Component, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import PublicFeedback from './PublicFeedback.jsx';
// Lazy so the ElevenLabs SDK (~180KB gzip) is code-split into its own chunk — loaded ONLY on
// ?elevenlabs, never in the main bundle every user downloads.
const ElevenTest = lazy(() => import('./ElevenTest.jsx'));

// A shareable link (?feedback) lands directly on the standalone feedback page — no login,
// no hunting for the in-app button. Everything else renders the full app as before.
const IS_FEEDBACK = /[?&]feedback\b/.test(window.location.search);
// ?elevenlabs → the ISOLATED ElevenLabs voice test (owner rollout; separate from the fight code).
const IS_ELEVEN = /[?&]elevenlabs\b/.test(window.location.search);

// Paint a readable error into the page instead of leaving a blank/black screen, so a
// runtime crash is never invisible. Covers both render errors (boundary) and async /
// module errors (global handlers).
// Backend base URL, derived from the same build-time WS URL the app uses (wss→https).
const BACKEND = (import.meta.env.VITE_WS_URL || 'ws://localhost:3001').replace(/^ws/, 'http');
function reportError(title, detail) {
  try {
    const body = JSON.stringify({ title, detail: String(detail || '').slice(0, 4000), url: location.href, ua: navigator.userAgent });
    // Report to the backend so the crash shows up in the server log (diagnostics).
    fetch(`${BACKEND}/api/clienterror`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

function paintError(title, detail) {
  reportError(title, detail);
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;padding:24px;text-align:center;background:#0a0f1a;color:#fca5a5;font-family:monospace;z-index:99999';
  box.innerHTML =
    `<div style="font-size:20px;font-weight:700;color:#f87171">⚠ ${title}</div>` +
    `<pre style="max-width:560px;max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;color:var(--action-2);text-align:left;background:#020409;padding:14px;border-radius:8px;border:1px solid #f8717155">${String(detail || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>` +
    `<div style="font-size:13px;color:#94a3b8">Bitte diese Meldung abfotografieren / kopieren. Dann Strg+Shift+R.</div>`;
  root.appendChild(box);
}

class RootBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[app] render crashed:', error, info);
    paintError('App-Fehler beim Rendern', (error?.stack || error?.message || error) + '\n\n' + (info?.componentStack || ''));
  }
  render() { return this.state.error ? null : this.props.children; }
}

window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0) paintError('JavaScript-Fehler', e.error?.stack || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0) paintError('Unbehandelter Promise-Fehler', e.reason?.stack || String(e.reason));
});

try {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <RootBoundary>
        {IS_ELEVEN
          ? <Suspense fallback={<div style={{ minHeight: '100vh', background: '#04070d' }} />}><ElevenTest apiUrl={BACKEND} /></Suspense>
          : IS_FEEDBACK ? <PublicFeedback /> : <App />}
      </RootBoundary>
    </StrictMode>,
  );
  // Build stamp (bottom-right) — HIDDEN for real users: a "build 4cc5277" tag on every screen read as
  // unfinished/beta to a novel user. Still available on demand for deploy verification via ?debug (or on
  // localhost); the canonical, always-on check is the <meta name="build"> in index.html (curl-grep'd),
  // which is unchanged. Commit is injected at build time by Vite.
  try {
    const showStamp = location.hostname === 'localhost' || /[?&](debug|build)\b/.test(location.search);
    if (showStamp) {
      const bid = (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev');
      const tag = document.createElement('div');
      tag.textContent = 'build ' + bid;
      tag.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;font:10px/1 monospace;color:#334155;opacity:0.55;pointer-events:none;user-select:none';
      document.body.appendChild(tag);
    }
  } catch { /* ignore */ }
} catch (err) {
  paintError('App konnte nicht starten', err?.stack || err?.message || err);
}
