/**
 * DailyMission.jsx — the "Hire-Readiness + Deine Mission heute" home panel (client-only, zero cost).
 *
 * Turns the app into ONE coherent system pointing at "hired": a single deterministic readiness
 * gauge built from the student's REAL signals (fluency, fillers, errors mastered, consistency)
 * + the SINGLE best drill to do today, auto-routed to their weakest area. This is the deliberate-
 * practice multiplier — doing the RIGHT thing, consistently, and SEEING the edge grow.
 *
 * 100% deterministic from the existing /api/progress data (no model, no new endpoint, no cost).
 * The score is honestly labelled "Interview-Bereitschaft aus deinen Übungssignalen" — a practice
 * readiness estimate, NEVER a hire guarantee.
 */
import { useState, useEffect } from 'react';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function lastAvg(arr, n = 5) {
  const v = (arr || []).filter((x) => typeof x === 'number');
  const s = v.slice(-n);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

// Deterministic readiness 0–99 (never 100 — always room to grow). Honest composite of real signals.
function computeReadiness(d) {
  const t = d?.trends || {}, tot = d?.totals || {};
  const sessions = tot.sessions || 0;
  if (!sessions) return { score: null, sessions: 0 };
  const fl = lastAvg(t.fluency), wp = lastAvg(t.wpm), fi = lastAvg(t.fillers);
  const mastered = tot.rulesMastered || 0, active = tot.srsActive || 0;
  const fluencyScore     = fl != null ? clamp(fl, 0, 100) : 50;
  const fillerScore      = fi != null ? clamp(100 - fi * 8, 0, 100) : 60;
  const masteryScore     = (mastered + active) > 0 ? Math.round((100 * mastered) / (mastered + active)) : 55;
  const consistencyScore = clamp(sessions * 12 + (d.streak || 0) * 5, 0, 100);
  const score = Math.round(0.4 * fluencyScore + 0.2 * fillerScore + 0.25 * masteryScore + 0.15 * consistencyScore);
  return { score: clamp(score, 0, 99), fl, wp, fi, sessions, mastered, active };
}

// Pick the ONE highest-value next drill from the weakest area.
function nextMission(d, r) {
  const tot = d?.totals || {};
  if ((tot.dueReviews || 0) > 0)
    return { drill: 'spoken', de: `Sag ${tot.dueReviews} offene Fehler laut richtig`, ar: `قول ${tot.dueReviews} أخطاء مفتوحة صح بصوتك` };
  if (!r.sessions)
    return { drill: 'fluency', de: 'Mach deine erste Sprech-Übung', ar: 'اعمل أول تمرين كلام' };
  if (r.wp != null && r.wp < 120)
    return { drill: 'fluency', de: 'Sprechtempo steigern (4-3-2)', ar: 'زوّد سرعة كلامك (4-3-2)' };
  if (r.fi != null && r.fi > 4)
    return { drill: 'pressure', de: 'Weniger Zögern unter Druck', ar: 'قلّل التردد تحت الضغط' };
  return { drill: 'pressure', de: 'Halte Druck aus — Druck-Leiter', ar: 'اتحمّل الضغط — سلّم الضغط' };
}

const DRILL_LABEL = {
  fluency:  { de: '⚡ FLOW-DRILL', ar: '⚡ سرعة الكلام' },
  spoken:   { de: '🗯️ SAG ES RICHTIG', ar: '🗯️ قولها صح' },
  pressure: { de: '🔥 DRUCK-LEITER', ar: '🔥 سلّم الضغط' },
  listening:{ de: '🎧 HÖR-CHECK', ar: '🎧 فهم السمع' },
};

// Warm, HUMAN coach line (Alhassan's voice) — built deterministically from REAL data so it feels
// like a coach who remembers you and is here for you. Zero cost, no API. Varied so it never feels
// like the same canned line. This is the "humanness an app can actually win": perfect memory +
// always present + warm + zero judgment.
function coachLine(name, d, r, ar) {
  const first = (name || '').toString().trim().split(/\s+/)[0];
  const nm = first ? first.charAt(0).toUpperCase() + first.slice(1) : (ar ? 'يا صديقي' : 'Freund');
  const due = d?.totals?.dueReviews || 0, streak = d?.streak || 0, trained = d?.trainedToday;
  let pool;
  if (!r.sessions) pool = ar
    ? [`أهلاً يا ${nm}! 👋 يلا نبدأ — أول خطوة وانت في السكة.`, `نوّرت يا ${nm} 👋 خلّينا نبدأ خطوة خطوة.`]
    : [`Willkommen, ${nm}! 👋 Lass uns starten — der erste Schritt zählt.`];
  else if (streak >= 3) pool = ar
    ? [`يا ${nm}، ${streak} أيام ورا بعض — ده اللي بيفرق، كمّل يا وحش! 🔥`, `${nm}، ${streak} أيام على التوالي… احترامي. نكمّل؟`]
    : [`${nm}, ${streak} Tage in Folge — genau das zählt. Weiter so! 🔥`];
  else if (due > 0) pool = ar
    ? [`يا ${nm}، عندك ${due} حاجات لسه عايزة تتظبط — تعالى نقفلها سوا.`, `${nm}، فاضل ${due} نقط نقفلها — يلا بينا.`]
    : [`${nm}, du hast ${due} offene Punkte — lass sie uns schließen.`];
  else if (!trained) pool = ar
    ? [`وحشتنا يا ${nm} — يوم واحد بس النهاردة ونرجع للسكة. 💪`, `${nm}، رجّعنا الإيقاع — تمرين واحد دلوقتي. 💪`]
    : [`Schön, dich zu sehen, ${nm} — ein Tag heute, und wir sind zurück. 💪`];
  else pool = ar
    ? [`أيوه يا ${nm}! شغّال صح — نكمّل؟`, `${nm}، ماشي تمام — خلّينا نزوّد شوية.`]
    : [`Stark, ${nm}! Du bist dran — weiter?`];
  return pool[(r.sessions + streak + due) % pool.length];
}

export function DailyMission({ token, apiUrl, lang = 'de', name = '', onOpen }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/progress`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('x');
        const j = await r.json();
        if (alive) setD(j);
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [apiUrl, token]);

  if (err || !d) return null;   // silently absent on error — never blocks the home screen

  const r = computeReadiness(d);
  const m = nextMission(d, r);
  const pct = r.score;
  const color = pct == null ? '#64748b' : pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444';
  const ar = lang === 'ar';
  const greet = coachLine(name, d, r, ar);

  return (
    <div style={{ width: '100%', marginTop: 8, padding: '14px', borderRadius: 12,
      background: 'linear-gradient(135deg, rgba(34,197,94,0.07), rgba(56,189,248,0.05))',
      border: '1px solid rgba(56,189,248,0.3)', boxSizing: 'border-box' }}>
      {/* Warm, personal coach line — the human "I remember you" moment */}
      <div style={{ fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 12,
        paddingBottom: 11, borderBottom: '1px solid rgba(255,255,255,0.07)',
        ...(ar ? { direction: 'rtl', textAlign: 'right' } : {}) }}>{greet}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Readiness ring */}
        <div style={{ width: 58, height: 58, borderRadius: '50%', flexShrink: 0, position: 'relative',
          background: pct == null ? 'rgba(255,255,255,0.05)'
            : `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#0a1320',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Orbitron,monospace', fontSize: 15, fontWeight: 800, color }}>
            {pct == null ? '—' : `${pct}`}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 8.5, letterSpacing: '0.12em', fontFamily: 'Orbitron,monospace', color: '#38bdf8' }}>
            {T(lang, 'INTERVIEW-BEREITSCHAFT', 'جاهزية المقابلة')}
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 3, lineHeight: 1.4 }}>
            {pct == null
              ? T(lang, 'Noch keine Daten — fang heute an.', 'لسه مفيش بيانات — ابدأ النهارده.')
              : T(lang, `aus deinen Übungssignalen · ${r.sessions} Sitzungen`, `من إشارات تدريبك · ${r.sessions} جلسات`)}
          </div>
        </div>
      </div>

      {/* THE SPINE: name the #1 weakness so the learner knows EXACTLY what to fix — never guessing */}
      {(() => {
        const w = d.topWeakness;
        const re = Array.isArray(d.recentErrors) ? d.recentErrors.filter(Boolean) : [];
        let title, body;
        if (w && w.rule) {
          title = T(lang, '🎯 DEINE SCHWÄCHE NR. 1 JETZT', '🎯 نقطة ضعفك رقم ١ دلوقتي');
          body = w.lapses > 0
            ? T(lang, `${w.rule} — ${w.lapses}× daneben. Heute fixen wir genau das.`, `${w.rule} — غلطتها ${w.lapses} مرة. النهاردة نظبطها بالظبط.`)
            : T(lang, `${w.rule} — heute fixen wir genau das.`, `${w.rule} — النهاردة نظبطها بالظبط.`);
        } else if (re.length) {
          title = T(lang, '🎯 ZULETZT AUFGEFALLEN', '🎯 أنماط من آخر جلسة');
          body  = re.join(T(lang, ', ', '، '));
        } else {
          title = T(lang, '🎯 SCHWÄCHE NOCH NICHT ERKANNT', '🎯 لسه محددتش نقطة ضعفك');
          body  = T(lang, 'Mach eine Einstufung oder ein Interview — dann zeige ich dir genau, was zu fixen ist.',
                          'اعمل تقييم أو إنترفيو — وساعتها هقولّك بالظبط تظبط إيه.');
        }
        return (
          <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)',
            ...(ar ? { direction: 'rtl', textAlign: 'right' } : {}) }}>
            <div style={{ fontSize: 8.5, letterSpacing: '0.12em', fontFamily: 'Orbitron,monospace', color: '#f87171', marginBottom: 5 }}>{title}</div>
            <div style={{ fontSize: 12.5, color: '#fecaca', lineHeight: 1.5 }}>{body}</div>
          </div>
        );
      })()}

      {/* Today's one mission — the fix for exactly the weakness named above */}
      <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize: 8.5, letterSpacing: '0.12em', fontFamily: 'Orbitron,monospace', color: '#fbbf24', marginBottom: 5 }}>
          {T(lang, 'DEINE MISSION HEUTE', 'مهمتك النهارده')}
        </div>
        <div style={{ fontSize: 13, color: '#f1f5f9', lineHeight: 1.5, marginBottom: 9, ...(ar ? { direction: 'rtl', textAlign: 'right' } : {}) }}>
          {T(lang, m.de, m.ar)}
        </div>
        <button onClick={() => onOpen?.(m.drill)} style={{ width: '100%', padding: '12px', minHeight: 46, cursor: 'pointer',
          fontFamily: 'Orbitron,monospace', fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', borderRadius: 9,
          border: '1px solid #38bdf8', color: '#04070d', background: 'linear-gradient(135deg,#38bdf8,#22d3ee)' }}>
          {T(lang, DRILL_LABEL[m.drill]?.de || 'START', DRILL_LABEL[m.drill]?.ar || 'ابدأ')} ▸
        </button>
      </div>
    </div>
  );
}
