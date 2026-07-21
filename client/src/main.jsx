import { StrictMode, Component, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import PublicFeedback from './PublicFeedback.jsx';
import { API_URL as BACKEND, BUILD_ID, IS_PRODUCTION } from './config.js';
import { VoiceLabOverlay } from './VoiceLabOverlay.jsx';

// A shareable link (?feedback) lands directly on the standalone feedback page — no login,
// no hunting for the in-app button. Everything else renders the full app as before.
const IS_FEEDBACK = /[?&]feedback\b/.test(window.location.search);
// Call Floor (Mode 2) — named wiring exception per docs/FROZEN.md: ?callfloor renders the
// standalone floor (lazy chunk, main bundle untouched); server-side CALLFLOOR_ENABLED gates it.
const IS_CALLFLOOR = /[?&]callfloor\b/.test(window.location.search);
const CallFloor = lazy(() => import('./CallFloor.jsx'));

// Paint a readable error into the page instead of leaving a blank/black screen, so a
// runtime crash is never invisible. Covers both render errors (boundary) and async /
// module errors (global handlers).
// Backend base URL, derived from the same build-time WS URL the app uses (wss→https).
function reportError(title, detail) {
  try {
    // Never send query/hash: password-reset tokens and campaign identifiers live there.
    // Stack traces are useful locally but reveal source details in production.
    const safeDetail = import.meta.env.PROD ? String(detail || '').split('\n')[0] : String(detail || '');
    const body = JSON.stringify({ title: String(title || '').slice(0, 80), detail: safeDetail.slice(0, 500), path: location.pathname });
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
  const technical = IS_PRODUCTION ? '' : `<pre style="max-width:560px;max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;color:#fb923c;text-align:left;background:#020409;padding:14px;border-radius:8px;border:1px solid #f8717155">${String(detail || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`;
  box.innerHTML =
    `<div style="font-size:20px;font-weight:700;color:#f8fafc">OMNI-PERFORM</div>` +
    `<div style="font-size:15px;color:#cbd5e1">Die App konnte gerade nicht geladen werden. Deine Zahlung oder dein Konto wurden dadurch nicht verändert.</div>` +
    technical +
    `<button id="omni-reload" style="padding:12px 18px;border:0;border-radius:10px;background:#f97316;color:#081019;font-weight:800;cursor:pointer">SEITE NEU LADEN</button>`;
  root.appendChild(box);
  box.querySelector('#omni-reload')?.addEventListener('click', () => location.reload());
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

// "Empty" = React hasn't rendered yet. The inline boot splash (index.html) seeds #root with ONE
// child so a slow WebView isn't blank; treat splash-only as still-empty, or a boot-time chunk error
// would leave the user stuck on the spinner instead of the honest reload screen. paintError itself
// clears #root, so the splash is wiped when an error IS painted.
function rootNotYetRendered(root) {
  if (!root) return false;
  if (root.childElementCount === 0) return true;
  return root.childElementCount === 1 && root.firstElementChild?.id === 'boot-splash';
}
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (rootNotYetRendered(root)) paintError('JavaScript-Fehler', e.error?.stack || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const root = document.getElementById('root');
  if (rootNotYetRendered(root)) paintError('Unbehandelter Promise-Fehler', e.reason?.stack || String(e.reason));
});

try {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <RootBoundary>
        {IS_FEEDBACK ? <PublicFeedback />
          : IS_CALLFLOOR ? <Suspense fallback={null}><CallFloor /></Suspense>
          : <><App /><VoiceLabOverlay /></>}
      </RootBoundary>
    </StrictMode>,
  );
  // Build stamp (bottom-right) — HIDDEN for real users: a "build 4cc5277" tag on every screen read as
  // unfinished/beta to a novel user. Still available on demand for deploy verification via ?debug (or on
  // localhost); the canonical, always-on check is the <meta name="build"> in index.html (curl-grep'd),
  // which is unchanged. Commit is injected at build time by Vite.
  try {
    const showStamp = !import.meta.env.PROD && (location.hostname === 'localhost' || /[?&](debug|build)\b/.test(location.search));
    if (showStamp) {
      const bid = BUILD_ID;
      const tag = document.createElement('div');
      tag.textContent = 'build ' + bid;
      tag.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:2147483647;font:10px/1 monospace;color:#334155;opacity:0.55;pointer-events:none;user-select:none';
      document.body.appendChild(tag);
    }
  } catch { /* ignore */ }
} catch (err) {
  paintError('App konnte nicht starten', err?.stack || err?.message || err);
}

// Register from the module instead of an inline script so production can use a strict CSP.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const alreadyControlled = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!alreadyControlled || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      const updateWhenVisible = () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', updateWhenVisible);
      window.addEventListener('focus', updateWhenVisible);
    }).catch(() => {});
  }, { once: true });
}
