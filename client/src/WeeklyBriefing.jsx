/**
 * WeeklyBriefing.jsx — ELITE-ONLY premium surface. Shows Alhassan's deep weekly briefing
 * (GET /api/guide/briefing): what you beat this week, where you are on the road to applying, and the
 * ONE move next week — in his Cairo voice, from the brain's real signals. Server caches it per week.
 * Rendered only for Elite users (the parent gates on entitlement.plan === 'elite').
 */
import { useEffect, useState } from 'react';

export function WeeklyBriefing({ token, apiUrl }) {
  const [state, setState] = useState('loading');   // loading | ready | hidden
  const [text, setText]   = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/guide/briefing`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) { if (alive) setState('hidden'); return; }
        const d = await r.json();
        if (alive) { setText(d.briefing || ''); setState(d.briefing ? 'ready' : 'hidden'); }
      } catch { if (alive) setState('hidden'); }
    })();
    return () => { alive = false; };
  }, [token, apiUrl]);

  if (state === 'hidden') return null;
  return (
    <div style={card}>
      <div style={head}>📋 بريفينج الأسبوع · WÖCHENTLICHES BRIEFING <span style={badge}>ELITE</span></div>
      {state === 'loading'
        ? <div style={{ color: '#94a3b8', fontSize: 12 }}>… بحضّرلك تقرير الأسبوع</div>
        : <div dir="rtl" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.75, textAlign: 'right', color: '#e2e8f0' }}>{text}</div>}
    </div>
  );
}

const card  = { marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid rgba(251,191,36,0.25)',
  background: 'linear-gradient(180deg, rgba(251,191,36,0.07), rgba(255,255,255,0.03))' };
const head  = { fontSize: 10.5, letterSpacing: '0.08em', color: '#fbbf24', fontWeight: 800, marginBottom: 8, fontFamily: 'Orbitron,monospace' };
const badge = { fontSize: 8.5, padding: '2px 6px', borderRadius: 99, border: '1px solid rgba(251,191,36,0.5)', color: '#fbbf24', marginInlineStart: 6 };
