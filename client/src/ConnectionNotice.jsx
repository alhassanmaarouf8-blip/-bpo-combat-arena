import { useCallback, useEffect, useState } from 'react';

// The cached PWA shell can render while the API and live interview service are unavailable.
// Keep that state explicit without touching authentication or the voice stack.
export function ConnectionNotice() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const becameOnline = () => { setOnline(true); setDismissed(false); };
    const becameOffline = () => { setOnline(false); setDismissed(false); };
    window.addEventListener('online', becameOnline);
    window.addEventListener('offline', becameOffline);
    return () => {
      window.removeEventListener('online', becameOnline);
      window.removeEventListener('offline', becameOffline);
    };
  }, []);

  const retry = useCallback(() => window.location.reload(), []);
  if (online || dismissed) return null;

  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', zIndex: 260, left: 12, right: 12, bottom: 12,
      maxWidth: 560, margin: '0 auto', padding: '12px 14px', borderRadius: 12,
      background: 'var(--surface)', border: '1px solid var(--action)', boxShadow: 'var(--e2)', color: 'var(--text)' }}>
      <div style={{ fontSize: 13, fontWeight: 750, lineHeight: 1.45 }}>Du bist gerade offline.</div>
      <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
        Dein gespeicherter Stand bleibt erhalten. Für Sprachtraining und neue Ergebnisse brauchst du wieder eine Verbindung.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={retry} style={{ minHeight: 44, padding: '9px 12px', cursor: 'pointer',
          borderRadius: 8, border: '1px solid var(--accent)', background: 'rgba(59,130,246,0.12)',
          color: 'var(--accent-2)', fontWeight: 750 }}>
          ERNEUT PRÜFEN
        </button>
        <button type="button" onClick={() => setDismissed(true)} style={{ minHeight: 44, padding: '9px 12px', cursor: 'pointer',
          borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)' }}>
          SCHLIESSEN
        </button>
      </div>
    </div>
  );
}
