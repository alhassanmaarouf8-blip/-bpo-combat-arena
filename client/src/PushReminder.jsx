/**
 * PushReminder.jsx — the "🔔 daily reminder" opt-in on the home screen.
 *
 * The $0 daily-practice nudge (owner 2026-07-08): asks notification permission, subscribes via the
 * PushManager with the server's VAPID key, and stores the subscription. The backend's daily cron then
 * pushes "Zeit zu üben" to everyone who hasn't trained that day. Renders NOTHING unless the browser
 * supports push AND the server reports push enabled — so it never shows a dead button.
 */
import { useEffect, useState } from 'react';

function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushReminder({ token, apiUrl }) {
  const [state, setState] = useState('loading');   // loading | hidden | off | on | busy
  const [err, setErr]     = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (alive) setState('hidden'); return;
      }
      try {
        const d = await (await fetch(`${apiUrl}/api/push/key`)).json();
        if (!d.enabled) { if (alive) setState('hidden'); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
      } catch { if (alive) setState('hidden'); }
    })();
    return () => { alive = false; };
  }, [apiUrl]);

  const enable = async () => {
    setState('busy'); setErr('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState('off'); setErr('Benachrichtigungen sind blockiert — bitte im Browser erlauben.'); return; }
      const kr = await (await fetch(`${apiUrl}/api/push/key`)).json();
      if (!kr.enabled || !kr.key) { setState('hidden'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(kr.key) });
      const r = await fetch(`${apiUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!r.ok) throw new Error('save failed');
      setState('on');
    } catch { setState('off'); setErr('Konnte nicht aktivieren. Bitte erneut versuchen.'); }
  };

  const disable = async () => {
    setState('busy'); setErr('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await fetch(`${apiUrl}/api/push/unsubscribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    } catch { /* best effort */ }
    setState('off');
  };

  if (state === 'loading' || state === 'hidden') return null;

  const on = state === 'on';
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={on ? disable : enable} disabled={state === 'busy'}
        style={{ width: '100%', padding: '11px 10px', minHeight: 44, cursor: 'pointer', fontFamily: 'var(--font-display)',
          fontSize: 10, letterSpacing: '0.12em', borderRadius: 8,
          border: `1px solid ${on ? 'rgba(59,130,246,0.5)' : 'rgba(148,163,184,0.35)'}`,
          color: on ? 'var(--accent)' : '#94a3b8', background: on ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)' }}>
        {state === 'busy' ? '…' : on ? '🔔  ERINNERUNG AN ✓ — TIPPEN ZUM AUSSCHALTEN' : '🔔  TÄGLICHE ERINNERUNG AKTIVIEREN'}
      </button>
      {err && <div style={{ fontSize: 10.5, color: '#f87171', marginTop: 5, lineHeight: 1.4 }}>{err}</div>}
    </div>
  );
}
