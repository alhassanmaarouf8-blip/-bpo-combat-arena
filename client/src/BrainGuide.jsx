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
import { SpeakerIcon } from './icons/AudioIcons';
import { salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { SalmaPortrait } from './SalmaTakeover.jsx';
import { salmaSpeak } from './salmaVoice.js';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The guide's masri voice. Owner-ordered to finish 2026-07-10 ("go do them, the eight brain copy —
// finish the job"): authored best-effort warm Cairo masri, SHIPPED on his explicit instruction.
// The {slots} carry TRUE engine values only. Owner: give it a native pass whenever convenient —
// the words are yours to sharpen, the structure stays.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const BRAIN_COPY = {
  nextStepLabel: 'خطوتك الجاية',
  journeyLabel:  'طريقك للشغل الألماني',
  stepsLeft:     (n) => `فاضلّك ${n} ${n === 1 ? 'خطوة واحدة' : 'خطوات'} بس`,
  drill:         (id) => DRILL_LABEL[id] || id,
  startCta:      'يلا بينا',
  // "أكونت ألماني … في" = the owner's own correction (2026-07-10) — his verbatim phrasing wins.
  apply:         '🎉 برافو يا وحش! انت دلوقتي جاهز تشتغل في أكونت ألماني — قدّم وانت واثق من نفسك.',
  measure:       'قبل ما نكمّل، محتاج أقيس حاجة واحدة عشان أظبّط طريقك صح — يلا نعملها في دقيقتين.',
  ahaTitle:      'شوف بنفسك — تدريبك جاب نتيجة:',
  ahaBody:       (label, before, after) => `${label}: كنت بتغلط فيها ${before} مرّة، دلوقتي ${after} بس — ده مجهودك انت، مش صدفة.`,
};
const DRILL_LABEL = {
  'shadowing': 'SHADOWING', 'sag-es-richtig': 'SAG-ES-RICHTIG', 'flow-drill': 'FLOW-DRILL',
  'hoer-check': 'HÖR-CHECK', 'druck-leiter': 'DRUCK-LEITER', 'srs': 'WIEDERHOLUNG', 'interview': 'INTERVIEW',
  'satzbau-schmiede': 'SATZBAU-SCHMIEDE',
};
// Readable German labels for the canonical grammar ruleIds (so the aha reads naturally, not "konjunktiv-2").
const RULE_LABEL = {
  'konjunktiv-2': 'Konjunktiv II', 'dativ-akkusativ': 'Dativ/Akkusativ', 'word-order-sub': 'Satzstellung',
};
const ruleLabel = (id) => RULE_LABEL[id] || String(id || '').replace(/^lt:/, '');

// Skill-graph target ids → learner-readable German (the graph itself is copy-free).
const SKILL_LABEL = {
  'self-intro': 'Selbstvorstellung', 'praesens-perfekt': 'Präsens & Perfekt', 'core-vocab': 'Kern-Wortschatz',
  'listen-clear': 'Klares Verstehen', 'word-order-sub': 'Verb ans Ende (weil/dass/wenn)',
  'dativ-akkusativ': 'Dativ & Akkusativ', 'sie-register': 'Sie-Form & Höflichkeit',
  'handle-clear-request': 'Klare Kundenanfragen', 'listen-phone': 'Hören am Telefon',
  'no-freeze-expected': 'Nicht einfrieren', 'deescalate': 'Deeskalation', 'gdpr-verify': 'Daten-Verifizierung',
  'complaint-phrases': 'Beschwerde-Formeln', 'fluency-interrupt': 'Flüssig trotz Unterbrechung',
  'pronunciation-phone': 'Aussprache am Telefon', 'angry-c1': 'Wütende Kunden (C1)',
  'spontaneous-precise': 'Spontan & präzise', 'behavioral-salary': 'Verhaltensfragen & Gehalt',
  'konjunktiv-2': 'Konjunktiv II',
};
const MEASURE_LABEL = { intelligibility: 'deine Verständlichkeit am Telefon', deescalation: 'deine Deeskalation', wpm: 'dein Sprechtempo' };

// THE FATHER EXPLAINS (bottleneck-doctrine D1–D4): one German sentence saying WHY this is the
// step — the diagnosis framing (D1), honest "I must hear you more" (D4), drill-nominates/
// interview-confirms (D3), soft wording on thin evidence (D4). German is builder-authorable;
// the masri voice above stays the owner's.
function whyLine(d) {
  const label = d.target ? (SKILL_LABEL[d.target.skillId] || ruleLabel(d.target.skillId)) : null;
  const soft = d.confidence === 'low';
  switch (d.state) {
    case 'NEW':
      return 'Dein Diagnose-Interview: Ich muss dich zuerst sprechen hören, um deine größte Baustelle zu finden — danach führe ich dich Schritt für Schritt.';
    case 'MEASURE': {
      const sig = MEASURE_LABEL[d.prescription?.signal] || 'ein wichtiges Signal';
      return `Ich kann ${sig} noch nicht sicher messen — und ich rate nicht. Das nächste Interview misst genau das.`;
    }
    case 'READY':
      return `Du hast trainiert${label ? ` (${label})` : ''} — jetzt der Beweis: die Interviewerin kennt deine Akte und testet genau diese Stelle erneut. Erst wenn sie im Interview hält, gilt sie als gelöst.`;
    case 'APPLY':
      return 'Deine Entry-Skills sind komplett. Ab hier bringt dich jede Bewerbung weiter als jede weitere Übung.';
    case 'PLATEAU':
      return `Du warst ein paar Tage weg — ${label ? `mit ${label} ` : ''}machst du am schnellsten wieder Boden gut.`;
    default:   // POST_FIGHT — the fresh prescription
      if (!label) return null;
      return soft
        ? `Erste Diagnose: ${label}. Je mehr ich dich höre, desto schärfer wird sie — dieses Training bringt dich JETZT am weitesten.`
        : `Deine größte Baustelle: ${label}. Von allem, was ich gemessen habe, blockiert DAS deine Einstellung am meisten — ein Problem, ein Training, dann der Beweis im Interview.`;
  }
}

// onAction(directive) — the parent launches the prescribed thing (drill / interview / assessment / apply).
// externalInterviewCta: the host screen already shows THE interview button (the home's single
// orange) — when the prescription IS the interview, the guide keeps its why + journey but hides
// its own button instead of duplicating the CTA (designer pass 2026-07-10: one job, one button).
// The interviewer org ladder (mirror of server/progression.js BOSS_LADDER — ids/tiers/minLevels
// are stable product canon). Salma's pipeline renders progression against it; the SERVER still
// decides every real unlock.
const LADDER = [
  { id: 'yasmin', name: 'Yasmin', tier: 'Junior-Recruiterin', minLevel: 1 },
  { id: 'karim', name: 'Karim', tier: 'Teamleiter', minLevel: 2 },
  { id: 'hana', name: 'Hana', tier: 'Hiring Managerin', minLevel: 4 },
  { id: 'tarek', name: 'Tarek', tier: 'Eskalations-Boss', minLevel: 6 },
  { id: 'frau-mona-adel', name: 'Frau Mona Adel', tier: 'Geschäftsführerin', minLevel: 8 },
  { id: 'lukas', name: 'Lukas', tier: 'Reality-Check', minLevel: 9 },
];

// She greets + directs out loud ONCE per page-load session (see the proactive-speak effect below).
// A module flag, not state, so returning to the home mid-session doesn't re-trigger her every time.
let greetedThisSession = false;

export function BrainGuide({ token, apiUrl, onAction, externalInterviewCta = false, topWeakness = null, trial = null, lang = 'de', pipeline = null }) {
  const [data, setData] = useState(null);
  const [speaking, setSpeaking] = useState(false);
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

  // THE FATHER SPEAKS FIRST (owner 07-12: "she's slow, passive, waits for me to click, doesn't
  // guide"). The instant her card has a real directive she GREETS + directs OUT LOUD — once per
  // session — instead of sitting silent behind a 🔊. Autoplay-safe: if the browser blocks audio
  // (no gesture yet) playNative fails silently and the button still works. The module flag makes
  // her lead you in ONCE, then respect that you're working (no repeat every time you return home).
  useEffect(() => {
    if (!data?.directive || greetedThisSession) return undefined;
    const dir = data.directive;
    const items = [];
    if (topWeakness?.rule) items.push({ key: 'note_weakness', slots: { rule: ruleLabel(topWeakness.rule), lapses: topWeakness.lapses ?? 1 } });
    if (trial?.active && Number.isFinite(trial?.daysLeft)) items.push({ key: 'note_trial', slots: { days: trial.daysLeft } });
    const pre = whyLine(dir);
    if (!items.length && !pre) return undefined;
    greetedThisSession = true;
    setSpeaking(true);
    const stop = salmaSpeak({ apiUrl, token, items, dePrefix: pre, onEnd: () => setSpeaking(false) });
    return () => { try { stop?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

  // Salma's notes — each only when its REAL datum exists (she never speaks without evidence).
  const weaknessNote = topWeakness?.rule
    ? salmaLine('note_weakness', lang, { rule: ruleLabel(topWeakness.rule), lapses: topWeakness.lapses ?? 1 })
    : null;
  const trialNote = trial?.active && Number.isFinite(trial?.daysLeft)
    ? salmaLine('note_trial', lang, { days: trial.daysLeft })
    : null;
  // Her pipeline — where the candidate stands on the interviewer org ladder (level-derived).
  const curLevel = pipeline?.currentBoss?.minLevel ?? null;
  const speakSalma = () => {
    // Masri-first (owner order 07-12): once her note rows carry owner masri she speaks pure masri;
    // until then she speaks the German composition. The German directive rides along ONLY on the
    // German path (dePrefix) — it has no masri twin and stays visible on the card either way.
    const items = [];
    if (weaknessNote) items.push({ key: 'note_weakness', slots: { rule: ruleLabel(topWeakness.rule), lapses: topWeakness.lapses ?? 1 } });
    if (trialNote) items.push({ key: 'note_trial', slots: { days: trial.daysLeft } });
    if (!items.length && !whyLine(d)) return;
    setSpeaking(true);
    salmaSpeak({ apiUrl, token, items, dePrefix: whyLine(d),
      onEnd: () => setSpeaking(false) });
  };

  return (
    <div dir="rtl" style={card}>
      {/* The recruiter's face on the card — the brain's directive is HER professional advice. */}
      <div dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, textAlign: 'left' }}>
        <SalmaPortrait fallback={salmaName(lang).charAt(0)} size={46} speaking={speaking} />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#e2e8f0' }}>{salmaName(lang)}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.04em' }}>{salmaRole(lang)}</div>
        </div>
        <button onClick={speakSalma} disabled={speaking} aria-label="Salma anhören"
          style={{ marginLeft: 'auto', minWidth: 44, minHeight: 44, padding: '8px 10px', cursor: speaking ? 'wait' : 'pointer',
            borderRadius: 10, border: '1px solid rgba(59,130,246,0.45)', color: '#bfdbfe',
            background: 'rgba(59,130,246,0.10)', fontSize: 16 }}>
          {speaking ? '…' : <SpeakerIcon />}
        </button>
      </div>

      {/* The aha — only when the engine confirmed a real closed loop (it never fabricates one). */}
      {d.aha && (
        <div style={ahaBox}>
          <div style={{ fontWeight: 800, color: 'var(--accent)' }}>{BRAIN_COPY.ahaTitle}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{BRAIN_COPY.ahaBody(ruleLabel(d.aha.ruleId), d.aha.before, d.aha.after)}</div>
          {/* The tell-everyone moment (R4, WOW plan): the aha is engine-verified truth (D3 closed
              loop), so sharing it can never brag a lie. Quiet link — the aha stays the hero. */}
          <button
            onClick={() => {
              const text = `${ruleLabel(d.aha.ruleId)}: von ${d.aha.before} Fehlern auf ${d.aha.after} — mit echten Live-Interviews auf Deutsch. https://omni-perform.vercel.app/?src=aha`;
              if (navigator.share) navigator.share({ text }).catch(() => {});
              else navigator.clipboard?.writeText(text).catch(() => {});
            }}
            style={{ marginTop: 8, padding: '6px 10px', minHeight: 36, background: 'none', cursor: 'pointer',
              border: 'none', color: 'var(--accent-2)', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}>
            ↗ شارك النتيجة{/* OWNER-AR slot — refine wording */}
          </button>
        </div>
      )}

      {/* The journey — makes step-by-step progress toward the goal VISIBLE (reflected back).
          Hidden entirely when the graph reports no steps (audit S14: a "0/0" line is a
          screenshot-able zero-state that reads as broken). */}
      {(j.entryTotal ?? 0) > 0 && (
        <>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            {BRAIN_COPY.journeyLabel} · {j.entryDone ?? 0}/{j.entryTotal}{j.stepsToApply > 0 ? ` · ${BRAIN_COPY.stepsLeft(j.stepsToApply)}` : ''}
          </div>
          <div style={track}><div style={{ ...fill, width: `${pct}%` }} /></div>
        </>
      )}

      {/* The ONE next step. */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>{BRAIN_COPY.nextStepLabel}</div>
      {/* WHY this step (the father explains the diagnosis — bottleneck-doctrine). German, LTR
          inside the RTL card; renders only when the engine's state yields an honest line. */}
      {whyLine(d) && (
        <div dir="ltr" style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6, margin: '6px 0 2px', textAlign: 'left' }}>
          {whyLine(d)}
        </div>
      )}
      {/* Salma's quiet file notes — real dashboard/entitlement/leaderboard values only. */}
      {(weaknessNote || trialNote) && (
        <div dir="ltr" style={{ margin: '8px 0 2px', padding: '8px 10px', borderRadius: 8, textAlign: 'left',
          background: 'rgba(59,130,246,0.07)', borderLeft: '2px solid rgba(59,130,246,0.45)' }}>
          {weaknessNote && <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.55 }}>{weaknessNote}</div>}
          {trialNote && <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.55, marginTop: weaknessNote ? 4 : 0 }}>{trialNote}</div>}
        </div>
      )}

      {/* Her pipeline — the interviewer org ladder as her bookings. Filled = passed rungs
          (level-derived, server-decided), ring = the current appointment, dim = still locked. */}
      {curLevel != null && (
        <div dir="ltr" style={{ margin: '10px 0 2px', textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.06em', marginBottom: 6 }}>
            {salmaLine('pipeline_label', lang)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {LADDER.map((b, i) => {
              const passed  = b.minLevel < curLevel;
              const current = pipeline?.currentBoss?.id === b.id;
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', flex: i < LADDER.length - 1 ? 1 : 'none' }}>
                  <div title={`${b.name} · ${b.tier}`} style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800,
                    color: passed ? '#04110b' : current ? '#dbeafe' : '#475569',
                    background: passed ? 'linear-gradient(135deg,var(--accent),var(--accent-2))'
                      : current ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.04)',
                    border: current ? '2px solid rgba(59,130,246,0.85)' : '1px solid rgba(255,255,255,0.12)',
                    boxShadow: current ? '0 0 10px rgba(59,130,246,0.5)' : 'none' }}>
                    {b.name.charAt(0)}
                  </div>
                  {i < LADDER.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: passed ? 'rgba(59,130,246,0.55)' : 'rgba(255,255,255,0.08)' }} />
                  )}
                </div>
              );
            })}
          </div>
          {pipeline?.nextBoss?.name && (
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55, marginTop: 6 }}>
              {salmaLine('pipeline_next', lang, { name: pipeline.nextBoss.name, tier: pipeline.nextBoss.tier || '' })}
            </div>
          )}
        </div>
      )}

      {/* Hand the WHY to the destination too, so the prescribed drill opens carrying the same
          honest reason (the drill renders it as its why-you bar). */}
      {!(externalInterviewCta && (d.prescription?.action === 'interview' || d.prescription?.action === 'measure')) && (
        <button style={cta} onClick={() => onAction?.(d, whyLine(d))}>{ctaText}</button>
      )}
    </div>
  );
}

const card   = { marginTop: 12, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'right' };
const track  = { height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' };
const fill   = { height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))', transition: 'width .4s' };
const ahaBox = { marginBottom: 12, padding: 10, borderRadius: 10, background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.3)' };
const cta    = { width: '100%', marginTop: 6, padding: '12px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, color: '#04110b', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' };
