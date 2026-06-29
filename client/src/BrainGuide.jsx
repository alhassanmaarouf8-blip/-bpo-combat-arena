/**
 * BrainGuide.jsx — reflects the live brain's ONE next step + the journey toward the goal + an honest
 * "aha" back to the student. The LOGIC/structure is the deterministic engine's (GET /api/brain); the
 * WORDS live in BRAIN_COPY below for the OWNER to author in real Egyptian masri — never auto-generated,
 * never faked. It is mounted behind BRAIN_GUIDE_LIVE (App.jsx, default OFF) until the masri is written.
 *
 * Design it must serve: sophisticated inside, ONE dead-simple step outside; the student FEELS they are
 * being guided step-by-step, progressively, toward getting hired (the journey bar makes it visible).
 */
import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// OWNER: replace every string below with real Egyptian masri. Keep the {slots}; the engine fills them
// with TRUE values. These are PLACEHOLDERS so the structure renders — do NOT ship them as final copy.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const BRAIN_COPY = {
  nextStepLabel: 'خطوتك الجاية',
  journeyLabel:  'طريقك للشغل الألماني',
  stepsLeft:     (n) => `فاضلّك ${n} خطوة`,
  drill:         (id) => DRILL_LABEL[id] || id,
  startCta:      'يلا بينا',
  apply:         '🎉 برافو يا وحش! بقيت جاهز للخط الألماني — قدّم دلوقتي وانت واثق.',
  measure:       'قبل ما نكمّل، محتاج أقيس نقطة واحدة عشان أظبّط مسارك صح — يلا نعملها بسرعة.',
  ahaTitle:      'بص بنفسك — اللي درّبت عليه بيدّي نتيجة:',
  ahaBody:       (label, before, after) => `${label}: كنت بتغلط فيها ${before} مرّة، دلوقتي ${after} بس. ده انت اللي عملت ده.`,
};
// NOTE (owner): masri above is grounded best-effort — give it a native pass; the {slots} stay, the words are yours.
const DRILL_LABEL = {
  'shadowing': 'SHADOWING', 'sag-es-richtig': 'SAG-ES-RICHTIG', 'flow-drill': 'FLOW-DRILL',
  'hoer-check': 'HÖR-CHECK', 'druck-leiter': 'DRUCK-LEITER', 'srs': 'WIEDERHOLUNG', 'interview': 'INTERVIEW',
};
// Readable German labels for the canonical grammar ruleIds (so the aha reads naturally, not "konjunktiv-2").
const RULE_LABEL = {
  'konjunktiv-2': 'Konjunktiv II', 'dativ-akkusativ': 'Dativ/Akkusativ', 'word-order-sub': 'Satzstellung',
};
const ruleLabel = (id) => RULE_LABEL[id] || String(id || '').replace(/^lt:/, '');

// onAction(directive) — the parent launches the prescribed thing (drill / interview / assessment / apply).
export function BrainGuide({ token, apiUrl, onAction }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/brain`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setData(d);
      } catch { /* fail silent — the guide simply doesn't render */ }
    })();
    return () => { alive = false; };
  }, [token, apiUrl]);

  if (!data?.directive) return null;
  const d = data.directive;
  const j = d.journey || {};
  const pct = Math.max(0, Math.min(100, j.pctToApply || 0));

  const ctaText =
      d.prescription?.action === 'drill'      ? `${BRAIN_COPY.startCta} · ${BRAIN_COPY.drill(d.prescription.drill)}`
    : d.prescription?.action === 'interview'  ? `${BRAIN_COPY.startCta} · ${BRAIN_COPY.drill('interview')}`
    : d.prescription?.action === 'assessment' ? `${BRAIN_COPY.startCta} · EINSTUFUNG`
    : d.prescription?.action === 'measure'    ? BRAIN_COPY.measure
    : d.prescription?.action === 'apply'      ? BRAIN_COPY.apply
    : BRAIN_COPY.startCta;

  return (
    <div dir="rtl" style={card}>
      {/* The aha — only when the engine confirmed a real closed loop (it never fabricates one). */}
      {d.aha && (
        <div style={ahaBox}>
          <div style={{ fontWeight: 800, color: '#34d399' }}>{BRAIN_COPY.ahaTitle}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{BRAIN_COPY.ahaBody(ruleLabel(d.aha.ruleId), d.aha.before, d.aha.after)}</div>
        </div>
      )}

      {/* The journey — makes step-by-step progress toward the goal VISIBLE (reflected back). */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
        {BRAIN_COPY.journeyLabel} · {j.entryDone ?? 0}/{j.entryTotal ?? 0}{j.stepsToApply > 0 ? ` · ${BRAIN_COPY.stepsLeft(j.stepsToApply)}` : ''}
      </div>
      <div style={track}><div style={{ ...fill, width: `${pct}%` }} /></div>

      {/* The ONE next step. */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>{BRAIN_COPY.nextStepLabel}</div>
      <button style={cta} onClick={() => onAction?.(d)}>{ctaText}</button>
    </div>
  );
}

const card   = { marginTop: 12, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'right' };
const track  = { height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' };
const fill   = { height: '100%', background: 'linear-gradient(90deg,#22c55e,#6ee7b7)', transition: 'width .4s' };
const ahaBox = { marginBottom: 12, padding: 10, borderRadius: 10, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.3)' };
const cta    = { width: '100%', marginTop: 6, padding: '12px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, color: '#04110b', background: 'linear-gradient(90deg,#22c55e,#6ee7b7)' };
