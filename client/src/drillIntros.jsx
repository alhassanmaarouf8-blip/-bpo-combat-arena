/**
 * drillIntros.jsx — the "why this drill, and how it connects" one-liner shown on every core
 * drill's practice screen. Owner (2026-07-02): "I need the logic behind everything clear for the
 * user — every drill must be real, not random words. There should be a short introductory to each
 * drill showing how it compounds with the others in making them a better speaker."
 *
 * ONE line, always visible, no dismiss-state to manage (kept "extremely short" per the ask —
 * a persistent banner is simpler and more robust than a first-time-only tooltip that can drift
 * out of sync with what the learner actually remembers). German only; Arabic is an OWNER-AR slot
 * (never authored here).
 */
const DRILL_INTROS = {
  shadowing: 'Hören + nachsprechen — trainiert die Mundmotorik, die Flow-Drill und das Interview brauchen.',
  fluency: 'Dieselbe Antwort dreimal, immer kürzer — dein Sprechtempo steigt automatisch, wie beim Interview.',
  listening: 'Ein echter Anrufer-Satz, einmal gehört — trainiert das Zuhören, das reines Sprechen nicht abdeckt.',
  spokenreview: 'Das hier ist dein EIGENER früherer Fehler (durchgestrichen) — sag jetzt die korrekte Version aus dem Gedächtnis. So schließt du genau die Lücken, die das Interview bei dir gefunden hat.',
  spokenreview_phrase: 'Ein echter Call-Center-Satz: sag ihn AUF DEUTSCH — die englische Bedeutung steht darunter, die deutsche Antwort nicht. So werden die Standard-Sätze automatisch, bevor das echte Interview kommt.',
  pressure: 'Ein Kunde eskaliert Stufe für Stufe — bereitet dich auf den härtesten Teil des echten Interviews vor: Teil 3.',
  satzbau: 'Baue den Satz Wort für Wort — das Verb gehört ans Ende. Genau die Struktur, die im Interview über flüssig oder holprig entscheidet.',
};

export function DrillIntro({ drillKey, style }) {
  const text = DRILL_INTROS[drillKey];
  if (!text) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, padding: '8px 11px',
      borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)',
      marginBottom: 12, ...style }}>
      {text} {/* OWNER-AR slot */}
    </div>
  );
}
