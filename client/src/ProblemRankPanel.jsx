/**
 * ProblemRankPanel.jsx — the visible half of the v2 Phase 2 CHOOSE layer: the learner's observed
 * problems, ranked the way an elite teacher triages (impact → frequency in their OWN interviews →
 * readiness). Renders NOTHING without ranked evidence (never a fake card — NextStep law). Every
 * line is checkable: the counts come from the learner's own sessions, the order from the brain's
 * deterministic ranking (server/brain/problemRank.js) — no LLM, no invention.
 *
 * Design law: quiet blue instrument; the page's one orange stays on the primary CTA elsewhere.
 * Copy: German here, Arabic = OWNER-AR slots (empty → German renders).
 */

const RULE_LABELS = {
  'word-order-sub':   { de: 'Verbstellung im Nebensatz', ar: '' /* OWNER-AR */ },
  'praesens-perfekt': { de: 'Verbformen (Präsens/Perfekt)', ar: '' /* OWNER-AR */ },
  'dativ-akkusativ':  { de: 'Dativ & Akkusativ', ar: '' /* OWNER-AR */ },
  'konjunktiv-2':     { de: 'Konjunktiv II (Höflichkeit)', ar: '' /* OWNER-AR */ },
};
const REASON_BY_TIER = {
  3: { de: 'bricht das Verständnis', ar: '' /* OWNER-AR */ },
  2: { de: 'stört Präzision und Ton', ar: '' /* OWNER-AR */ },
  1: { de: 'Feinschliff', ar: '' /* OWNER-AR */ },
};

const label = (ruleId, lang) => {
  const known = RULE_LABELS[ruleId];
  if (known) return lang === 'ar' && known.ar ? known.ar : known.de;
  return ruleId.replace(/[-_]+/g, ' ');   // honest fallback for LT-derived rule ids
};

export function ProblemRankPanel({ ranked, lang = 'de' }) {
  if (!Array.isArray(ranked) || ranked.length === 0) return null;
  // PREMIUM PASS 2026-07-24: flat black box → a real layered surface with a lit top edge;
  // 13px padding → 20px. The uppercase eyebrow becomes a proper sentence-case heading with its
  // own size: this is the most valuable list in the app (the learner's ranked weaknesses) and it
  // was labelled like a form section. Headings should look like headings, not like tags.
  // (A `{/* */}` here rather than a `//` above the return parses as an object literal — twice
  // today. JSX comments only work INSIDE JSX.)
  return (
    <div style={{ borderRadius: 18, padding: '20px 18px', marginTop: 12,
      background: 'var(--surface-2)', border: '1px solid var(--line)',
      boxShadow: 'inset 0 1px 0 var(--surface-2)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17,
        letterSpacing: '-0.01em', color: 'var(--text)', marginBottom: 3 }}>
        Deine größten Baustellen{/* OWNER-AR slot */}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 14 }}>
        gereiht nach Wirkung — nicht nach Anzahl{/* OWNER-AR slot */}
      </div>
      {ranked.map((r, i) => {
        const reason = REASON_BY_TIER[r.tier] || REASON_BY_TIER[1];
        return (
          <div key={r.ruleId} style={{ display: 'flex', gap: 10, alignItems: 'baseline',
            padding: '7px 0', borderTop: i ? '1px solid var(--surface-2)' : 'none' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
              color: i === 0 ? 'var(--accent)' : 'var(--text-faint)', minWidth: 18 }}>{i + 1}.</span>
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: i === 0 ? 600 : 400 }}>
                {label(r.ruleId, lang)}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--fs-meta)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                {lang === 'ar' && reason.ar ? reason.ar : reason.de}
                {' · in '}{r.sessionsWith}{' Interviews aufgetreten ('}{r.occurrences}{'×)'}
                {r.ready === false && <span>{' · kommt später — Grundlagen zuerst'}{/* OWNER-AR slot */}</span>}
              </span>
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
        Reihenfolge wie bei einem erfahrenen Trainer: Was das Verständnis bricht, kommt zuerst — dann die Häufigkeit in deinen eigenen Antworten.{/* OWNER-AR slot */}
      </div>
    </div>
  );
}
