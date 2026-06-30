import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

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
        <App />
      </RootBoundary>
    </StrictMode>,
  );
  // Tiny build stamp (bottom-right) so the LIVE Vercel deploy is visually verifiable —
  // mirrors the server /health "build". Commit is injected at build time by Vite.
  try {
    const bid = (typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev');
    const tag = document.createElement('div');
    tag.textContent = 'build ' + bid;
    tag.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;font:10px/1 monospace;color:#334155;opacity:0.55;pointer-events:none;user-select:none';
    document.body.appendChild(tag);
  } catch { /* ignore */ }
} catch (err) {
  paintError('App konnte nicht starten', err?.stack || err?.message || err);
}
