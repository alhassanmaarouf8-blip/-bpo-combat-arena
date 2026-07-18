/**
 * BrainGuide.jsx — reflects the live brain's ONE next step + the journey toward the goal + an honest
 * "aha" back to the student. The LOGIC/structure is the deterministic engine's (GET /api/brain); the
 * WORDS live in BRAIN_COPY below for the OWNER to author in real Egyptian masri — never auto-generated,
 * never faked. It is mounted behind BRAIN_GUIDE_LIVE (App.jsx, default OFF) until the masri is written.
 *
 * Design it must serve: sophisticated inside, ONE dead-simple step outside; the student FEELS they are
 * being guided step-by-step, progressively, toward getting hired (the journey bar makes it visible).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeakerIcon } from './icons/AudioIcons';
import { salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { SalmaPortrait } from './SalmaTakeover.jsx';
import { salmaSpeak } from './salmaVoice.js';
import { SalmaTutorPanel } from './SalmaTutorPanel.jsx';
import './BrainGuide.css';

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
  apply:         'برافو يا وحش! خلّصت معايير المحاكاة الأساسية — دلوقتي قدّم عشان نختبر جاهزيتك مع فرص حقيقية.',
  measure:       'قبل ما نكمّل، محتاج أقيس حاجة واحدة عشان أظبّط طريقك صح — يلا نعملها في دقيقتين.',
  ahaTitle:      'VERIFIZIERTER TRANSFER',
  ahaBody:       (skill, metric, before, after, unit) => `${skill}: ${metric} ${before} → ${after} ${unit}. Im verzögerten Retest mit einer neuen Situation bestätigt.`,
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
  'pronunciation-phone': 'Verständlichkeit am Telefon', 'angry-c1': 'Wütende Kunden (C1)',
  'spontaneous-precise': 'Spontan & präzise', 'behavioral-salary': 'Verhaltensfragen & Gehalt',
  'konjunktiv-2': 'Konjunktiv II',
};
const AHA_METRIC = Object.freeze({
  grammar_errors: { label: 'Fehlerzahl', unit: 'Fehler' },
  fluency_score: { label: 'Sprechfluss', unit: 'Punkte' },
  wpm: { label: 'Sprechtempo', unit: 'Wörter/Min.' },
  deescalation_score: { label: 'Deeskalation', unit: 'Punkte' },
  response_continuity: { label: 'Antwortkontinuität', unit: 'Punkte' },
  intelligibility_score: { label: 'Verständlichkeit', unit: 'Punkte' },
  listening_accuracy: { label: 'Hörgenauigkeit', unit: '%' },
});
const MEASURE_LABEL = Object.freeze({
  wpm: 'dein Sprechtempo',
  grammar_errors_by_rule: 'deine Grammatik in vollständigen Antworten',
  intelligibility: 'deine Verständlichkeit am Telefon',
  service_recovery_steps: 'deine Service-Recovery-Schritte',
  response_continuity: 'deine Antwortkontinuität unter Druck',
  latencyS: 'deine Reaktionszeit',
  fillerPer100: 'deine Füllwortabhängigkeit',
  subClauseRate: 'deine verbundene Antwortstruktur',
  vocabDiversity: 'deine Wortschatzbreite',
  deescalation: 'deine Deeskalation',
});

const ACTION_LABEL = Object.freeze({
  assessment: 'Diagnose-Interview abschließen',
  measure: 'Fehlendes Signal messen',
  interview: 'Live-Retest starten',
  apply: 'Passende Stellen prüfen',
  wait: 'Bis zum Retest warten',
  vacancy: 'Heutige Interview-Vorbereitung',
  mission: 'Bewerbungsprofil vervollständigen',
  drill: 'Trainingsblock starten',
});

const MISSION_LABEL = Object.freeze({
  passport: 'Dein Bewerbungsprofil erstellen', measure: 'Bewerbungsreife messen', prep: 'Bewerbung vorbereiten',
  shortlist: 'Passende Stellen prüfen', pack: 'Bewerbungs-Paket erstellen', submit: 'Bewerbung offiziell einreichen',
  response: 'Arbeitgeber-Antwort einordnen', interview: 'Interview vorbereiten',
});

const JOURNEY_PHASES = Object.freeze([
  { id: 'measure', label: 'Messen', note: 'Sprachleistung beobachten' },
  { id: 'train', label: 'Trainieren', note: 'Einen Engpass reparieren' },
  { id: 'prove', label: 'Beweisen', note: 'Mit neuem Material retesten' },
  { id: 'apply', label: 'Bewerben', note: 'Reale Chancen verfolgen' },
]);

function activeJourneyPhase(directive) {
  const action = directive?.prescription?.action;
  if (action === 'apply' || action === 'mission' || action === 'vacancy') return 'apply';
  if (action === 'drill' || action === 'wait') return 'train';
  if (action === 'interview' && ['READY', 'RETEST_READY'].includes(directive?.state)) return 'prove';
  return 'measure';
}

function cairoTime(value) {
  const at = Number(value);
  if (!Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Africa/Cairo', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(at));
}

function missionBrief(d, coach) {
  const p = d.prescription || {};
  const active = coach?.activePrescription;
  const ownsDose = p.action === 'drill' && active?.drillId === p.drill && active?.skillId === p.skillId;
  const minutes = ownsDose ? Math.max(1, Math.ceil(active.durationSeconds / 60)) : null;
  const nextAt = ownsDose ? cairoTime(active.nextEligibleAt) : cairoTime(p.nextEligibleAt);
  const skill = p.skillId ? (SKILL_LABEL[p.skillId] || ruleLabel(p.skillId)) : null;

  if (ownsDose) return {
    title: `${SKILL_LABEL[p.skillId] || BRAIN_COPY.drill(p.drill)} gezielt trainieren`,
    dose: `${active.repetitions} Wiederholungen · ca. ${minutes} Min.`,
    done: active.successGate,
    after: active.timesPerDay > 1
      ? `Block 2 nach mindestens ${Math.round(active.minimumSpacingMinutes / 60)} Std.; danach Live-Retest.`
      : 'Danach prüft ein späterer Live-Retest neues Material.',
  };
  if (p.action === 'wait') return {
    title: skill ? `${skill}: Retest vorbereiten` : ACTION_LABEL.wait,
    dose: nextAt ? `Pause bis ${nextAt} Uhr (Kairo)` : 'Das Retest-Zeitfenster abwarten',
    done: nextAt ? `Das Zeitfenster öffnet am ${nextAt} Uhr.` : 'BrainGuide gibt den Retest serverseitig frei.',
    after: 'Dann beweist du die Fähigkeit mit neuem Material.',
  };
  if (p.action === 'assessment') return {
    title: ACTION_LABEL.assessment, dose: 'Ein vollständiges gesprochenes Interview',
    done: 'Alle Interviewstufen sind beantwortet und der Debrief ist gespeichert.',
    after: 'Danach wählt BrainGuide genau einen gemessenen Engpass.',
  };
  if (p.action === 'measure') return {
    title: ACTION_LABEL.measure, dose: `Ein Interview zur Messung: ${MEASURE_LABEL[p.signal] || 'deine aktuelle Leistung'}`,
    done: 'Die erforderliche Sprechprobe ist vollständig und serverseitig auswertbar.',
    after: 'Danach erhältst du nur bei ausreichender Evidenz einen Trainingsblock.',
  };
  if (p.action === 'interview') return {
    title: p.phase === 'transfer' ? 'Transfer unter neuem Druck beweisen' : ACTION_LABEL.interview,
    dose: 'Ein vollständiges gesprochenes Interview',
    done: 'Der serverseitige Debrief ist vollständig gespeichert.',
    after: p.phase === 'matched' ? 'Danach folgt ein späterer Test mit neuem Material.' : 'BrainGuide akzeptiert oder verwirft die Verbesserung.',
  };
  if (p.action === 'vacancy') return {
    title: p.title || ACTION_LABEL.vacancy, dose: p.objective || 'Den heutigen Vorbereitungsschritt abschließen',
    done: p.liveRequired ? 'Ein aussagekräftiger Live-Debrief wurde gespeichert.' : 'Der heutige Meilenstein ist bestätigt.',
    after: 'Danach aktualisiert BrainGuide den Interviewplan.',
  };
  if (p.action === 'mission') {
    if (p.step === 'passport') return {
      title: MISSION_LABEL.passport,
      dose: 'Zieljob, Erfahrung, Verfügbarkeit und bestätigte Stärken eintragen',
      done: 'Deine Angaben sind von dir bestätigt und sicher gespeichert.',
      after: 'Danach kann die App passende Stellen prüfen und Bewerbungshilfen nur aus deinen bestätigten Angaben erstellen.',
    };
    return {
      title: MISSION_LABEL[p.step] || ACTION_LABEL.mission, dose: 'Diesen einen Bewerbungs-Schritt abschließen',
      done: 'Der Schritt ist bestätigt und dauerhaft gespeichert.', after: 'Danach wird der nächste zulässige Schritt sichtbar.',
    };
  }
  if (p.action === 'apply') return {
    title: ACTION_LABEL.apply, dose: 'Eine passende, noch offene Stelle prüfen',
    done: 'Passung und harte Ausschlusskriterien sind ehrlich geprüft.', after: 'Du entscheidest selbst über die offizielle Bewerbung.',
  };
  return {
    title: skill ? `${skill} trainieren` : (ACTION_LABEL[p.action] || 'Nächsten Schritt starten'),
    dose: 'Den angezeigten Trainingsblock vollständig bearbeiten',
    done: 'Der Abschluss ist serverseitig bestätigt.', after: 'Danach berechnet BrainGuide den nächsten Schritt neu.',
  };
}

// THE FATHER EXPLAINS (bottleneck-doctrine D1–D4): one German sentence saying WHY this is the
// step — the diagnosis framing (D1), honest "I must hear you more" (D4), drill-nominates/
// interview-confirms (D3), soft wording on thin evidence (D4). German is builder-authorable;
// the masri voice above stays the owner's.
function whyLine(d) {
  const label = d.target ? (SKILL_LABEL[d.target.skillId] || ruleLabel(d.target.skillId)) : null;
  const soft = d.confidence === 'low';
  switch (d.state) {
    case 'NEW':
      return 'Zuerst höre ich dich sprechen. Dann bekommst du genau einen passenden Trainingsschritt.';
    case 'MEASURE': {
      const sig = MEASURE_LABEL[d.prescription?.signal] || 'dieses Interviewsignal';
      return `Ich kann ${sig} noch nicht sicher messen. Das nächste Interview prüft genau das.`;
    }
    case 'READY':
      return `Du hast trainiert${label ? `: ${label}` : ''}. Jetzt folgt ein Retest mit neuem Material.`;
    case 'RETEST_READY':
      return `Der Hör-Retest${label ? ` für ${label}` : ''} ist jetzt fällig. Neue Aufgaben zählen.`;
    case 'RETEST_WAIT':
      return `Dein Trainingsblock${label ? ` für ${label}` : ''} ist erledigt. Der Retest öffnet zum angezeigten Zeitpunkt.`;
    case 'APPLY':
      return 'Du erfüllst die internen Einstiegskriterien der Simulation. Prüfe jetzt passende Stellen.';
    case 'MISSION_CONTROL':
      return 'Dein nächster Schritt nutzt bestätigte Fakten und aktuelle Messungen.';
    case 'PLATEAU':
      return `Starte wieder klein${label ? `: ${label}` : ''}. Ein sauberer Block reicht heute.`;
    default:   // POST_FIGHT — the fresh prescription
      if (!label) return null;
      return soft
        ? `Erste Messung: ${label}. Trainiere jetzt diesen einen Punkt.`
        : `Wiederholt beobachtet: ${label}. Trainiere ihn, dann folgt ein Retest.`;
  }
}

function orientationReason(d) {
  const p = d.prescription || {};
  if (p.action === 'mission') {
    const reasons = {
      passport: 'Ohne bestätigte Angaben kann die App passende Stellen und Bewerbungshilfen nicht zuverlässig vorbereiten.',
      measure: 'Vor einer Empfehlung fehlen noch überprüfbare Angaben zu deiner Bewerbungsbereitschaft.',
      prep: 'Deine bestätigten Angaben müssen jetzt in eine konkrete, wahrheitsgemäße Bewerbung übersetzt werden.',
      shortlist: 'Jetzt zählt Passung: nur offene Stellen ohne harte Ausschlusskriterien sollen deine Zeit bekommen.',
      pack: 'Die Stelle ist passend genug für einen ehrlichen, auf deine bestätigten Fakten begrenzten Bewerbungsentwurf.',
      submit: 'Der Entwurf ist bestätigt; nur du kannst die Bewerbung auf der offiziellen Arbeitgeberseite einreichen.',
      response: 'Die Arbeitgeberantwort bestimmt, ob du weiter bewirbst oder in die Interview-Vorbereitung wechselst.',
      interview: 'Ein bestätigtes Interview macht die passende Vorbereitung jetzt dringlicher als weitere Bewerbungen.',
    };
    if (reasons[p.step]) return reasons[p.step];
  }
  return whyLine(d) || 'Dieser Schritt folgt aus deinem aktuellen, serverseitig bestätigten Lernstand.';
}

function biggerGoal(d) {
  const action = d.prescription?.action;
  if (action === 'vacancy') {
    return 'Im bestätigten Ziel-Interview verständlich, relevant und ehrlich antworten.';
  }
  if (action === 'mission' || action === 'apply') {
    return 'Eine passende deutschsprachige BPO- oder Remote-Stelle mit ehrlichen, bestätigten Angaben verfolgen.';
  }
  return 'Im deutschen BPO-Interview verständlich und belastbar antworten — und die Verbesserung mit neuem Material beweisen.';
}

// onAction(directive) — the parent launches the prescribed thing (drill / interview / assessment / apply).
// BrainGuide owns the one primary action whenever it is enabled. The home must not render a
// second generic interview CTA beside it.
// The interviewer org ladder (mirror of server/progression.js BOSS_LADDER — ids/tiers/minLevels
// are stable product canon). Salma's pipeline renders progression against it; the SERVER still
// decides every real unlock.
// Mirror of server/progression.js BOSS_LADDER — MUST stay in the same order (ascending minLevel =
// easiest→hardest by seniority, CEO Mona hardest). Lukas moved to an early casual screen (was inverted).
const LADDER = [
  { id: 'yasmin', name: 'Yasmin', tier: 'Junior-Recruiterin', minLevel: 1 },
  { id: 'lukas', name: 'Lukas', tier: 'Agent-Trainer', minLevel: 2 },
  { id: 'karim', name: 'Karim', tier: 'Teamleiter', minLevel: 3 },
  { id: 'hana', name: 'Hana', tier: 'Hiring Managerin', minLevel: 4 },
  { id: 'tarek', name: 'Tarek', tier: 'Eskalations-Manager', minLevel: 6 },
  { id: 'frau-mona-adel', name: 'Frau Mona Adel', tier: 'Geschäftsführerin', minLevel: 8 },
];

export function BrainGuide({ token, apiUrl, onAction, onDirectiveState, onSessionExpired,
  lang = 'de', pipeline = null, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [coachView, setCoachView] = useState(null);
  const [coachRevision, setCoachRevision] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const speechStopRef = useRef(null);
  const speechRunRef = useRef(0);
  const stopSpeaking = useCallback(() => {
    speechRunRef.current += 1;
    const stop = speechStopRef.current;
    speechStopRef.current = null;
    try { stop?.(); } catch { /* audio cleanup is best-effort */ }
    setSpeaking(false);
  }, []);
  const startSpeaking = useCallback((args) => {
    stopSpeaking();
    const run = ++speechRunRef.current;
    setSpeaking(true);
    let stop = null;
    try {
      stop = salmaSpeak({
        apiUrl,
        token,
        ...args,
        onEnd: () => {
          if (speechRunRef.current !== run) return;
          speechStopRef.current = null;
          setSpeaking(false);
        },
      });
    } catch {
      if (speechRunRef.current === run) setSpeaking(false);
    }
    speechStopRef.current = stop;
    return () => {
      try { stop?.(); } catch { /* audio cleanup is best-effort */ }
      if (speechRunRef.current === run) {
        speechRunRef.current += 1;
        speechStopRef.current = null;
        setSpeaking(false);
      }
    };
  }, [apiUrl, stopSpeaking, token]);
  useEffect(() => {
    let alive = true;
    stopSpeaking();
    setData(null);
    setLoadState('loading');
    onDirectiveState?.({ status: 'loading', directive: null });
    setCoachView(null);
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/brain`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 401) {
          if (alive) { setLoadState('auth'); onDirectiveState?.({ status: 'error', directive: null }); }
          return;
        }
        if (!r.ok) {
          if (alive) { setLoadState('error'); onDirectiveState?.({ status: 'error', directive: null }); }
          return;
        }
        const d = await r.json();
        if (!alive) return;
        if (!d?.directive?.prescription?.action) {
          setLoadState('error');
          onDirectiveState?.({ status: 'error', directive: null });
          return;
        }
        setData(d);
        setLoadState('ready');
        onDirectiveState?.({ status: 'ready', directive: d.directive });
        // Dose details are optional and fail closed. BrainGuide remains useful when the tutor
        // feature is disabled (404) or temporarily unavailable; no invented dose is displayed.
        fetch(`${apiUrl}/api/salma/coach`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
          .then((response) => response.ok ? response.json() : null)
          .then((view) => { if (alive && view) setCoachView(view); })
          .catch(() => {});
      } catch {
        if (alive) { setLoadState('error'); onDirectiveState?.({ status: 'error', directive: null }); }
      }
    })();
    return () => { alive = false; stopSpeaking(); };
  }, [token, apiUrl, refreshKey, coachRevision, onDirectiveState, stopSpeaking]);
  useEffect(() => {
    const refresh = () => setCoachRevision((value) => value + 1);
    window.addEventListener('omni:coach-state-changed', refresh);
    return () => window.removeEventListener('omni:coach-state-changed', refresh);
  }, []);

  if (!data?.directive) return (
    <div dir="ltr" style={{ ...card, textAlign:'left' }} role={loadState === 'loading' ? 'status' : 'alert'} aria-live="polite">
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <SalmaPortrait fallback={salmaName(lang).charAt(0)} size={42} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:13, color:'#e2e8f0' }}>
            {loadState === 'auth' ? 'Deine Sitzung ist abgelaufen.'
              : loadState === 'error' ? 'Dein persönlicher Schritt konnte noch nicht geladen werden.'
              : 'Dein persönlicher Schritt wird berechnet…'}
          </div>
          <div style={{ marginTop:3, fontSize:11.5, color:'#94a3b8', lineHeight:1.5 }}>
            {loadState === 'auth' ? 'Deine Messdaten bleiben erhalten. Melde dich erneut an, um genau hier weiterzumachen.'
              : loadState === 'error' ? 'Deine Messdaten bleiben erhalten. Lade nur die Empfehlung erneut.'
              : 'BrainGuide prüft deine letzte verlässliche Messung.'}
          </div>
        </div>
      </div>
      {loadState === 'auth' && (
        <button type="button" onClick={onSessionExpired}
          style={{ ...cta, marginTop:12, background:'rgba(59,130,246,0.12)', color:'#bfdbfe' }}>
          ERNEUT ANMELDEN
        </button>
      )}
      {loadState === 'error' && (
        <button type="button" onClick={() => setCoachRevision((value) => value + 1)}
          style={{ ...cta, marginTop:12, background:'rgba(59,130,246,0.12)', color:'#bfdbfe' }}>
          ERNEUT LADEN
        </button>
      )}
    </div>
  );
  const d = data.directive;
  const j = d.journey || {};
  const pct = Math.max(0, Math.min(100, j.pctToApply || 0));
  const ahaMetric = d.aha && Object.hasOwn(AHA_METRIC, d.aha.metricKey) ? AHA_METRIC[d.aha.metricKey] : null;
  const ahaSkill = d.aha ? (SKILL_LABEL[d.aha.skillId] || ruleLabel(d.aha.skillId)) : null;
  const brief = missionBrief(d, coachView);
  const journeyPhase = activeJourneyPhase(d);
  const currentJourney = JOURNEY_PHASES.find((phase) => phase.id === journeyPhase) || JOURNEY_PHASES[0];
  const reason = orientationReason(d);

  const ctaText =
      d.prescription?.action === 'drill'      ? `${BRAIN_COPY.startCta} · ${BRAIN_COPY.drill(d.prescription.drill)}`
    : d.prescription?.action === 'interview'  ? `${BRAIN_COPY.startCta} · ${BRAIN_COPY.drill('interview')}`
    : d.prescription?.action === 'assessment' ? `${BRAIN_COPY.startCta} · DIAGNOSE-INTERVIEW`
    : d.prescription?.action === 'measure'    ? BRAIN_COPY.measure
    : d.prescription?.action === 'apply'      ? BRAIN_COPY.apply
    : d.prescription?.action === 'wait'       ? 'RETEST-ZEITFENSTER ABWARTEN'
    : d.prescription?.action === 'vacancy'    ? `ZIEL-STELLE · ${d.prescription.title || 'HEUTIGER SCHRITT'}`
    : d.prescription?.action === 'mission'    ? `BEWERBUNG · ${({
      passport:'BEWERBUNGSPROFIL ERSTELLEN', measure:'BEREITSCHAFT MESSEN', prep:'VORBEREITEN', shortlist:'PASSENDE STELLEN',
      pack:'BEWERBUNGS-PACK', submit:'OFFIZIELL EINREICHEN', response:'ANTWORT EINORDNEN', interview:'INTERVIEW VORBEREITEN',
    })[d.prescription.step] || 'NÄCHSTER SCHRITT'}`
    : BRAIN_COPY.startCta;

  // Her pipeline — where the candidate stands on the interviewer org ladder (level-derived).
  const curLevel = pipeline?.currentBoss?.minLevel ?? null;
  const speakSalma = () => {
    // User-initiated playback contains only the current evidence-grounded explanation. Trial
    // marketing and unrelated file notes never enter Salma's spoken intervention.
    if (!whyLine(d)) return;
    startSpeaking({ items: [], dePrefix: whyLine(d) });
  };

  return (
    <section dir="ltr" className={`brain-guide brain-guide--${String(d.state || 'active').toLowerCase()}`}
      aria-labelledby="brain-guide-title">
      <div className="brain-guide__aurora" aria-hidden="true" />
      {/* Salma explains BrainGuide's current evidence-grounded action; she does not create another one. */}
      <div className="brain-guide__coach">
        <SalmaPortrait fallback={salmaName(lang).charAt(0)} size={46} speaking={speaking} />
        <div className="brain-guide__coach-copy">
          <div className="brain-guide__coach-name">{salmaName(lang)}</div>
          <div className="brain-guide__coach-role">{salmaRole(lang)}</div>
        </div>
        {whyLine(d) && <button onClick={speaking ? stopSpeaking : speakSalma} aria-label={speaking ? 'Salma unterbrechen' : 'Salma anhören'}
          className={`brain-guide__audio${speaking ? ' is-speaking' : ''}`}>
          {speaking ? '…' : <SpeakerIcon />}
        </button>}
      </div>

      {/* This is a narrow delayed-transfer measurement, not proof that training caused the change. */}
      {d.aha && ahaMetric && (
        <div className="brain-guide__proof">
          <div style={{ fontWeight: 800, color: 'var(--accent)' }}>{BRAIN_COPY.ahaTitle}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{BRAIN_COPY.ahaBody(ahaSkill, ahaMetric.label, d.aha.before, d.aha.after, ahaMetric.unit)}</div>
          {/* Share only the observed metric and transfer context; never claim causality or hiring proof. */}
          <button
            onClick={() => {
              const text = `${ahaSkill}: ${ahaMetric.label} ${d.aha.before} → ${d.aha.after} ${ahaMetric.unit} — in einem verzögerten Transfer-Retest mit neuer Situation bestätigt. https://omni-perform.vercel.app/?src=aha`;
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
      <div className="brain-guide__mission">
        <div className="brain-guide__mission-kicker">
          <span className="brain-guide__pulse" aria-hidden="true" />
          DEIN NÄCHSTER SCHRITT
          <span className={`brain-guide__confidence brain-guide__confidence--${d.confidence || 'low'}`}>
            {d.confidence === 'high' && d.state === 'POST_FIGHT' ? 'WIEDERHOLT GEMESSEN'
              : d.confidence === 'low' ? 'ERSTE MESSUNG' : 'DEIN PLAN'}
          </span>
        </div>
        <h2 id="brain-guide-title" className="brain-guide__title" style={{ fontSize: 20, margin: '4px 0 6px' }}>{brief.title}</h2>
        <p className="brain-guide__dose"><span>DEIN AUFTRAG</span>{brief.dose}</p>
        {d.prescription?.action !== 'wait' && (
          <button className="brain-guide__cta" onClick={() => onAction?.(d, whyLine(d))}>
            <span>{ctaText}</span><span aria-hidden="true">→</span>
          </button>
        )}
        <div className="brain-guide__briefing" aria-label="Dein persönliches Missionsbriefing">
          <article className="brain-guide__briefing-card brain-guide__briefing-card--why">
            <span>01 · WARUM JETZT</span><strong>{reason}</strong>
          </article>
          <article className="brain-guide__briefing-card brain-guide__briefing-card--finish">
            <span>02 · FERTIG, WENN</span><strong>{brief.done}</strong>
          </article>
          <article className="brain-guide__briefing-card brain-guide__briefing-card--next">
            <span>03 · DANACH</span><strong>{brief.after}</strong>
          </article>
        </div>
        <div className="brain-guide__north-star">
          <span className="brain-guide__north-star-mark" aria-hidden="true">◎</span>
          <span><small>DAS GRÖSSERE ZIEL</small><strong>{biggerGoal(d)}</strong></span>
          <em>Interne Simulation · keine Arbeitgeberentscheidung</em>
        </div>
      </div>

      {(j.entryTotal ?? 0) > 0 && (
        <div className="brain-guide__journey" aria-label="Dein Weg zur internen Bewerbungsbereitschaft">
          <div className="brain-guide__journey-copy">
            <span>DEIN WEG ZUM DEUTSCHEN JOBINTERVIEW</span>
            <strong>JETZT: {currentJourney.label} · {j.entryDone ?? 0} von {j.entryTotal} Fähigkeiten bestätigt</strong>
          </div>
          <div className="brain-guide__phases">
            {JOURNEY_PHASES.map((phase, index) => {
              const current = phase.id === journeyPhase;
              return (
                <div key={phase.id} className={`brain-guide__phase${current ? ' is-current' : ''}`}
                  aria-current={current ? 'step' : undefined}>
                  <span className="brain-guide__phase-index" aria-hidden="true">{index + 1}</span>
                  <span><strong>{phase.label}</strong><small>{phase.note}</small></span>
                </div>
              );
            })}
          </div>
          <div className="brain-guide__track" aria-hidden="true"><div className="brain-guide__fill" style={{ width: `${pct}%` }} /></div>
          <p className="brain-guide__journey-caveat">
            Fortschritt zählt erst, wenn du es in einer neuen Situation zeigst
          </p>
        </div>
      )}

      <SalmaTutorPanel token={token} apiUrl={apiUrl} screen="home" refreshKey={refreshKey + coachRevision} />

      {/* Secondary simulation history. Filled = passed rungs (level-derived, server-decided),
          ring = the current training simulation, dim = still locked. */}
      {curLevel != null && (
        <details dir="ltr" style={{ margin: '10px 0 2px', textAlign: 'left', color: '#94a3b8' }}>
          <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: 12 }}>
            Deine Interview-Simulationen
          </summary>
          <div style={{ paddingTop: 4 }}>
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
        </details>
      )}
    </section>
  );
}

const card   = { marginTop: 12, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'right' };
const cta    = { width: '100%', minHeight: 44, marginTop: 6, padding: '12px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, color: '#04110b', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' };
