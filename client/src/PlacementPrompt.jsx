/**
 * PlacementPrompt.jsx — captures the ONE metric that defines the mission: did the student
 * get hired into a German-speaking BPO role?
 *
 * Renders NOTHING unless the server says shouldPrompt (returning user, not brand-new, not
 * already terminal, not asked in the last week). Self-contained: GETs /api/placement, POSTs
 * the chosen status, and snoozes the weekly nudge on dismiss. Never blocks anything.
 */
import { useEffect, useState, useCallback } from 'react';

const STAGES = [
  { id: 'applying',     de: 'Ich bewerbe mich',        ar: 'بقدّم على شغل',        ask: false },
  { id: 'interviewing', de: 'Ich habe Interviews',      ar: 'عندي إنترفيوهات',      ask: false },
  { id: 'offer',        de: 'Ich habe ein Angebot',     ar: 'عندي عرض شغل',         ask: true  },
  { id: 'hired',        de: 'Ich wurde eingestellt!', ar: 'اتعيّنت!',          ask: true  },
  { id: 'not_hired',    de: 'Noch nicht / abgelehnt',   ar: 'لسه لأ / مرفوض',       ask: false },
];

export default function PlacementPrompt({ token, apiUrl, lang = 'de' }) {
  const ar = lang === 'ar';
  const [view, setView]   = useState('loading');   // loading | prompt | employer | done | hidden
  const [stage, setStage] = useState(null);
  const [employer, setEmployer] = useState('');
  const [busy, setBusy]   = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/placement`, { headers: headers() });
        if (!r.ok) { if (alive) setView('hidden'); return; }
        const d = await r.json();
        if (alive) setView(d.shouldPrompt ? 'prompt' : 'hidden');
      } catch { if (alive) setView('hidden'); }
    })();
    return () => { alive = false; };
  }, [apiUrl, headers]);

  async function submit(statusId, employerName) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/placement`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ status: statusId, employer: employerName || '' }),
      });
      setView('done');
    } catch {
      setView('hidden');   // never let a failed report block the results screen
    } finally { setBusy(false); }
  }

  function pick(s) {
    setStage(s);
    if (s.ask) { setView('employer'); }
    else submit(s.id, '');
  }

  async function dismiss() {
    setView('hidden');
    try { await fetch(`${apiUrl}/api/placement/snooze`, { method: 'POST', headers: headers(), body: '{}' }); }
    catch { /* best-effort snooze */ }
  }

  if (view === 'loading' || view === 'hidden') return null;

  const card = {
    marginTop: 10, padding: '12px 14px', borderRadius: 10,
    direction: ar ? 'rtl' : 'ltr', textAlign: ar ? 'right' : 'left',
    background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)',
  };
  const title = { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 };

  if (view === 'done') {
    return (
      <div style={card}>
        <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>
          {ar ? 'تمام، اتسجّل ✅ بالتوفيق — وكمّل تدريب.' : 'Gespeichert ✅ Viel Erfolg — und weiter trainieren!'}
        </div>
      </div>
    );
  }

  if (view === 'employer') {
    return (
      <div style={card}>
        <div style={title}>
          {stage?.id === 'hired'
            ? (ar ? 'مبروووك! مين الشركة؟' : 'Glückwunsch! Welcher Arbeitgeber?')
            : (ar ? 'حلو! مين الشركة؟ (اختياري)' : 'Stark! Welcher Arbeitgeber? (optional)')}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={employer} onChange={(e) => setEmployer(e.target.value)}
            placeholder={ar ? '…' : 'Name der Firma'}
            style={{ flex: 1, minWidth: 160, padding: '8px 10px', borderRadius: 8,
              background: 'var(--surface)', border: '1px solid rgba(148,163,184,0.3)',
              color: 'var(--text)', fontSize: 12, direction: ar ? 'rtl' : 'ltr' }}
          />
          <button onClick={() => submit(stage.id, employer)} disabled={busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'var(--surface)', color: '#04121f', fontWeight: 700, fontSize: 12 }}>
            {ar ? 'تسجيل' : 'Speichern'}
          </button>
        </div>
      </div>
    );
  }

  // view === 'prompt'
  return (
    <div style={card}>
      <div style={title}>
        {ar ? 'فيه أخبار عن الشغل؟' : 'Neuigkeiten bei der Jobsuche?'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STAGES.map((s) => (
          <button key={s.id} onClick={() => pick(s)} disabled={busy}
            style={{ padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11.5,
              background: s.id === 'hired' ? 'rgba(59,130,246,0.18)' : 'rgba(15,23,42,0.6)',
              border: `1px solid ${s.id === 'hired' ? 'rgba(59,130,246,0.5)' : 'rgba(148,163,184,0.28)'}`,
              color: s.id === 'hired' ? '#86efac' : 'var(--text-dim)', fontWeight: s.id === 'hired' ? 700 : 500 }}>
            {ar ? s.ar : s.de}
          </button>
        ))}
      </div>
      <button onClick={dismiss}
        style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-faint)', fontSize: 10.5, textDecoration: 'underline' }}>
        {ar ? 'مش دلوقتي' : 'Später'}
      </button>
    </div>
  );
}
