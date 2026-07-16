import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ClipRecorder } from './clipRecorder.js';
import { salmaModel } from './salmaVoice.js';
import { consumeAutomaticTutorCue, createTutorDrillSession, stopTutorWhenDocumentHidden,
  tutorDrillSessionMatches } from './salmaAudioSafety.js';

const quietButton = { minHeight: 44, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
  border: '1px solid rgba(96,165,250,0.34)', background: 'rgba(59,130,246,0.08)',
  color: '#bfdbfe', fontSize: 12.5, fontWeight: 650 };

function auth(token, extra = {}) { return { Authorization: `Bearer ${token}`, ...extra }; }
function formatCairoRetest(value) {
  if (!Number.isFinite(Number(value))) return 'dem angezeigten Zeitpunkt';
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(Number(value)));
}

const RISK_LABELS = Object.freeze({
  fluency: 'Antwortfluss unter Zeitdruck',
  grammar: 'Grammatik in vollständigen Antworten',
  intelligibility: 'Erkennbarkeit des Sprachsignals am Telefon',
  confidence: 'Antwortkontinuität unter Druck',
  deescalation: 'Service-Recovery-Struktur im Kundengespräch',
  complexity: 'sprachliche Bandbreite',
});
const ROLE_LABELS = Object.freeze({ customer_service: 'Kundenservice', technical_support: 'Technischer Support',
  sales: 'Vertrieb', retention: 'Kundenbindung', backoffice: 'Backoffice' });
const INDUSTRY_LABELS = Object.freeze({ general: 'allgemeines deutsches BPO', telecom: 'Telekommunikation',
  ecommerce: 'E-Commerce', fintech: 'Banken & Fintech', airline: 'Airlines & Reisen', delivery: 'Lieferdienste',
  logistik: 'Logistik', energie: 'Energie', versicherung: 'Versicherung', streaming: 'Streaming', b2b: 'B2B' });
const STAGE_LABELS = Object.freeze({ spoken_interview: 'gesprochenes Interview', phone_roleplay: 'Telefon-Rollenspiel',
  customer_roleplay: 'Kunden-Rollenspiel', pressure_followup: 'unerwartete Rückfrage', behavioral_interview: 'Verhaltensinterview' });
const CRITERION_LABELS = Object.freeze({ sustained_pace: 'durchgängiges Antworttempo', grammar_control: 'Grammatikkontrolle',
  speech_recognition_proxy: 'Erkennbarkeit des Sprachsignals', service_recovery_structure: 'Service-Recovery-Struktur',
  complete_response: 'vollständige Antworten', response_latency: 'Reaktionszeit', filler_dependence: 'Füllwortabhängigkeit',
  connected_answer_structure: 'verbundene Antwortstruktur', lexical_range_proxy: 'Wortschatzbreite' });
const UNIT_LABELS = Object.freeze({ wpm: 'Wörter/Min.', errors_per_100_words: 'Fehler/100 Wörter', percent: '%',
  percent_incomplete_turns: '% unvollständige Antworten', seconds: 'Sek.', fillers_per_100_words: 'Füllwörter/100 Wörter',
  subordinate_clauses_per_100_sentences: 'Nebensätze/100 Sätze', type_token_percent: '% verschiedene Wörter',
  recovery_steps_out_of_3: 'von 3 Schritten (Empathie, Verantwortung, nächster Schritt)' });
const DRILL_LABELS = Object.freeze({
  'satzbau-schmiede': 'Satzbau-Training',
  'sag-es-richtig': 'Korrektur-Training',
  'flow-drill': 'Sprechfluss-Training',
  'hoer-check': 'Hör-Training',
  shadowing: 'Aussprache-Training',
  'druck-leiter': 'Druck-Training',
});
const TRUTH_EXPLANATION_LABELS = Object.freeze({
  lexical_retrieval_load: 'Wortabruf unter Zeitdruck',
  sentence_planning_load: 'Satzplanung während des Sprechens',
  question_comprehension_load: 'Verarbeitung der gehörten Frage',
  deliberate_speaking_style: 'bewusst langsamer Sprechstil',
  rule_not_automatic_under_pressure: 'die Regel ist unter Druck noch nicht automatisiert',
  sentence_complexity_load: 'Belastung durch komplexere Sätze',
  self_correction_during_speech: 'Selbstkorrektur während des Sprechens',
  microphone_or_background_noise: 'Mikrofon oder Hintergrundgeräusche',
  speech_recognizer_accent_mismatch: 'Abweichung zwischen Stimme und Spracherkennung',
  pronunciation_or_articulation: 'Aussprache oder Artikulation',
  response_structure_not_automatic: 'die Antwortstruktur ist noch nicht automatisiert',
  scenario_knowledge_gap: 'fehlende Sicherheit im Kundenszenario',
  language_load_during_roleplay: 'sprachliche Belastung im Rollenspiel',
  turn_capture_or_interruption: 'Aufnahmeende oder Unterbrechung',
  response_planning_load: 'Planung der Antwort',
  deliberate_thinking_time: 'bewusst genommene Denkzeit',
  habitual_filler_use: 'angewöhnte Füllwörter',
  grammar_automaticity_gap: 'Grammatik noch nicht automatisch abrufbar',
  task_answer_style: 'zu kurzer oder ungeeigneter Antwortstil',
  topic_vocabulary_gap: 'fehlender Wortschatz für dieses Thema',
  retrieval_under_pressure: 'erschwerter Wortabruf unter Druck',
  short_answer_style: 'knapper Antwortstil mit wenig Sprachmaterial',
});
const TRUTH_DISCRIMINATOR_LABELS = Object.freeze({
  compare_prepared_and_novel_pace: 'Dasselbe Tempo erst mit bekanntem, dann mit neuem Inhalt vergleichen.',
  compare_controlled_rule_and_novel_speech: 'Die Regel erst kontrolliert und später in neuer freier Sprache prüfen.',
  repeat_same_answer_with_clean_audio: 'Dieselbe Antwort einmal mit sauberem Audiosignal wiederholen; bleibt der Befund, folgt ein neuer Aussprachetest.',
  compare_prompted_and_unprompted_roleplay: 'Die Struktur einmal mit Hinweis und später ohne Hinweis in einem neuen Rollenspiel prüfen.',
  restate_question_then_answer_novel_followup: 'Die Frage zuerst mit eigenen Worten wiedergeben und danach eine neue Rückfrage beantworten.',
  compare_understood_and_novel_question_latency: 'Reaktionszeit bei einer sicher verstandenen und einer neuen Frage getrennt messen.',
  compare_prepared_and_novel_filler_rate: 'Füllwörter in einer vorbereiteten und einer neuen Antwort getrennt messen.',
  compare_guided_and_unguided_answer_structure: 'Dieselbe Antwort einmal mit Strukturhilfe und später ohne Hilfe prüfen.',
  compare_familiar_and_novel_topic_range: 'Wortschatzbreite bei einem vertrauten und einem neuen Thema vergleichen.',
});

export function useSalmaDrillSession(token, drillId) {
  const sessionRef = useRef(null);
  if (!tutorDrillSessionMatches(sessionRef.current, token, drillId)) {
    sessionRef.current = createTutorDrillSession(token, drillId);
  }
  return sessionRef.current;
}

export function SalmaTutorPanel({ token, apiUrl, screen = 'home', drillId = '', initialCue = null, drillSession = null, refreshKey = 0 }) {
  const generatedQuestionId = useId();
  const [coach, setCoach] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [cue, setCue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const recorderRef = useRef(null);
  const speechStopRef = useRef(null);
  const spokenEventRef = useRef(null);
  const beaconedRef = useRef(new Set());
  const coachRequestRef = useRef(0);
  const localDrillSession = useSalmaDrillSession(token, drillId || screen);
  const automaticSpeechSession = drillSession || localDrillSession;

  const stopSpeech = useCallback(() => {
    try { speechStopRef.current?.(); } catch { /* best-effort audio cleanup */ }
    speechStopRef.current = null;
    setSpeaking(false);
  }, []);

  const loadCoach = useCallback(async () => {
    const requestId = ++coachRequestRef.current;
    setCoach(null);
    try {
      const response = await fetch(`${apiUrl}/api/salma/coach`, { cache: 'no-store', headers: auth(token) });
      if (requestId !== coachRequestRef.current) return;
      if (response.status === 404) { setCoach(null); return; }
      if (!response.ok) throw new Error('coach_unavailable');
      const next = await response.json();
      if (requestId === coachRequestRef.current) setCoach(next);
    } catch {
      if (requestId === coachRequestRef.current) setCoach(null);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    loadCoach();
    return () => { coachRequestRef.current += 1; stopSpeech(); };
  }, [loadCoach, refreshKey, stopSpeech]);
  useEffect(() => {
    const refresh = () => loadCoach();
    window.addEventListener('omni:coach-state-changed', refresh);
    return () => window.removeEventListener('omni:coach-state-changed', refresh);
  }, [loadCoach]);
  useEffect(() => stopTutorWhenDocumentHidden(), []);
  useEffect(() => { setCue(initialCue?.text ? initialCue : null); }, [initialCue]);
  useEffect(() => {
    const events = [];
    if (coach?.activePrescription?.id) events.push(['salma_prescription_shown', coach.activePrescription.id]);
    if (coach?.progress?.blockNominatedComplete && coach?.activePrescription?.id) {
      events.push(['salma_block_completed', coach.activePrescription.id]);
    }
    const proof = coach?.progress?.verifiedRetest;
    if (proof?.id && ['improved', 'held', 'regressed'].includes(proof.status)) {
      events.push([`salma_retest_${proof.status}`, proof.id]);
    }
    for (const [event, identity] of events) {
      const key = `${event}:${identity}`; if (beaconedRef.current.has(key)) continue;
      beaconedRef.current.add(key);
      fetch(`${apiUrl}/api/beacon`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ e: event }) }).catch(() => {});
    }
  }, [apiUrl, coach]);
  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail;
      if (!detail || !Object.hasOwn(detail, 'cue') || (drillId && detail.drill !== drillId)) return;
      setCue(detail.cue?.text ? detail.cue : null);
    };
    window.addEventListener('omni:salma-coach-cue', handler);
    return () => window.removeEventListener('omni:salma-coach-cue', handler);
  }, [drillId]);

  const acknowledge = useCallback(async (id) => {
    if (!id) return;
    try { await fetch(`${apiUrl}/api/salma/events/${id}/ack`, { method: 'POST', headers: auth(token) }); } catch { /* idempotent retry on next load */ }
  }, [apiUrl, token]);

  const savePreference = useCallback(async (change) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiUrl}/api/salma/preferences`, { method: 'PUT',
        headers: auth(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(change) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('preference_failed');
      setCoach((current) => current ? { ...current, preferences: body.preferences } : current);
    } catch { setError('Die Einstellung konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }, [apiUrl, token]);

  const speak = useCallback((text, eventId = null) => {
    if (!text || coach?.preferences?.muted || document.visibilityState !== 'visible') return;
    stopSpeech();
    speechStopRef.current = salmaModel({ apiUrl, token, text, onStart: () => {
      setSpeaking(true);
      if (eventId) { spokenEventRef.current = eventId; acknowledge(eventId); }
    }, onError: () => setSpeaking(false), onEnd: () => { speechStopRef.current = null; setSpeaking(false); } });
  }, [acknowledge, apiUrl, coach?.preferences?.muted, stopSpeech, token]);

  // Ordinary app opens stay silent. Auto-speech is allowed only for a new, server-identified
  // meaningful event and only after the learner explicitly enabled it.
  useEffect(() => {
    const intervention = coach?.intervention;
    if (!coach?.feature?.voiceEnabled || !coach?.preferences?.autoSpeak || !intervention?.speakable) return;
    if (spokenEventRef.current === intervention.id) return;
    speak(`${intervention.text} ${intervention.nextAction}`, intervention.id);
  }, [coach, speak]);
  useEffect(() => {
    if (!cue?.text || !coach?.feature?.voiceEnabled || !coach?.preferences?.autoSpeak || coach?.preferences?.muted) return;
    if (document.visibilityState !== 'visible') return;
    if (!consumeAutomaticTutorCue(automaticSpeechSession, cue, cue.maxAutomaticSpeech)) return;
    speak(cue.text);
  }, [automaticSpeechSession, coach, cue, speak]);

  const ask = useCallback(async (text, speakReply = false) => {
    const clean = String(text || '').trim().slice(0, 400);
    if (!clean) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiUrl}/api/salma/question`, { method: 'POST',
        headers: auth(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ question: clean, context: { screen, ...(drillId ? { drillId } : {}) } }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'question_failed');
      setAnswer(body.answer || ''); setQuestion('');
      if (speakReply && coach?.feature?.voiceEnabled) speak(body.answer || '');
    } catch (cause) {
      setError(cause.message === 'question_limit_reached' ? 'Dein heutiges Fragenlimit ist erreicht.' : 'Salma konnte gerade nicht antworten. Dein Trainingsschritt bleibt verfügbar.');
    } finally { setBusy(false); }
  }, [apiUrl, coach?.feature?.voiceEnabled, drillId, screen, speak, token]);

  const toggleRecording = useCallback(async () => {
    if (busy) return;
    if (!recording) {
      stopSpeech(); setError('');
      try { const recorder = new ClipRecorder(); recorderRef.current = recorder; await recorder.start(); setRecording(true); }
      catch { recorderRef.current = null; setError('Das Mikrofon ist nicht verfügbar. Du kannst deine Frage direkt eintippen.'); }
      return;
    }
    setRecording(false); setBusy(true);
    try {
      const result = await recorderRef.current?.stop(); recorderRef.current = null;
      if (!result?.blob || result.durationMs < 600) throw new Error('too_short');
      const response = await fetch(`${apiUrl}/api/transcribe`, { method: 'POST', headers: auth(token, { 'Content-Type': 'audio/wav', 'X-Salma-Coach': '1' }), body: result.blob });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.text) throw new Error('transcribe_failed');
      await ask(body.text, true);
    } catch { setError('Die Sprachfrage konnte nicht verarbeitet werden. Tippe sie bitte ein.'); }
    finally { setBusy(false); }
  }, [apiUrl, ask, busy, recording, stopSpeech, token]);

  useEffect(() => () => { if (recorderRef.current?.isRecording) recorderRef.current.stop().catch(() => {}); }, []);
  if (!coach?.feature?.enabled) return null;
  const p = coach.activePrescription;
  const risk = coach.interviewRisk;
  const forecast = coach.rejectionForecast;
  const truth = coach.diagnosticTruth;
  const listeningRetest = coach.listeningRetest;
  const speakingRetest = coach.speakingRetest;
  const masteryConfirmed = coach.progress?.masteryConfirmed === true;
  const rawProof = coach.progress?.verifiedRetest || null;
  // A transfer row is not a mastery claim until the canonical server state agrees.
  // Hiding an unreconciled row is safer than showing a stale or partial success signal.
  const proof = rawProof?.phase === 'transfer' && !masteryConfirmed ? null : rawProof;
  const forecastHeading = forecast?.target?.source === 'vacancy_snapshot' && forecast.target.current === true
    ? 'GRÖSSTES RISIKO IM AKTUELLEN ZIELINTERVIEW'
    : forecast?.target?.source === 'industry_snapshot'
      ? 'BEOBACHTETES RISIKO IN DIESER BRANCHEN-SIMULATION'
      : 'BEOBACHTETES RISIKO IN DIESER SIMULATION';
  const proofOutcome = proof?.status === 'improved' && proof?.phase === 'transfer'
    ? 'Die Verbesserung hielt auch in der neuen Transfersituation.'
    : proof?.status === 'improved' ? 'Verbesserung im passenden Vergleichstest; der Transfernachweis steht noch aus.'
    : proof?.status === 'regressed' ? 'Der Live-Retest war schwächer; dein nächster Schritt wurde angepasst.'
      : proof ? 'Das Niveau hielt im Live-Retest; der Engpass bleibt im Fokus.' : '';
  const bottleneck = forecast?.state === 'observed_simulation_risk' && RISK_LABELS[forecast.riskId]
    ? RISK_LABELS[forecast.riskId]
    : risk?.state === 'measure_first'
      ? 'Noch keine belastbare Diagnose'
      : forecast?.state === 'historical_only'
        ? 'Aktuelle Messung nötig'
        : null;
  const hasEvidenceDetails = forecast?.state === 'observed_simulation_risk'
    || ['repeated_pattern', 'provisional_pattern', 'conflicted_pattern'].includes(truth?.state)
    || !!listeningRetest || !!speakingRetest || !!proof || !!coach.progress;
  const questionId = `salma-question-${generatedQuestionId.replace(/:/g, '')}`;
  return (
    <section dir="ltr" aria-label="Salma, persönliche Interviewtrainerin" aria-busy={busy} style={{ marginTop: 12, padding: '12px 0 2px',
      borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'left' }}>
      {bottleneck && <div role="status" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', color: '#93c5fd' }}>
          {risk?.state === 'measure_first' || forecast?.state === 'historical_only'
            ? 'ZUERST SAUBER MESSEN'
            : forecast?.confidence === 'high'
              ? 'MEHRFACH BEOBACHTETER ENGPASS'
              : 'BEOBACHTETES RISIKO · NOCH ZU BESTÄTIGEN'}
        </div>
        <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 13.5, fontWeight: 750 }}>{bottleneck}</div>
        {risk?.state === 'measure_first' && <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
          Beende zuerst das vollständige Diagnose-Interview. Salma nennt keinen Engpass aus einer kurzen oder unterbrochenen Aufnahme.
        </div>}
        {forecast?.state === 'historical_only' && <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
          Beende eine neue passende Simulation. Salma überträgt alte oder entfernte Stellenziele nicht auf dein heutiges Risiko.
        </div>}
      </div>}
      {p && <div style={{ padding: '10px 11px', borderRadius: 10, background: 'rgba(59,130,246,0.07)',
        border: '1px solid rgba(96,165,250,0.20)', color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.55 }}>
        <div style={{ color: '#e2e8f0', fontWeight: 750 }}>
          {DRILL_LABELS[p.drillId] || 'Dein Trainingsblock'} · {p.repetitions} Wiederholungen · {Math.ceil(p.durationSeconds / 60)} Minuten
          {p.timesPerDay > 1 ? ` · ${p.timesPerDay} Blöcke mit mindestens ${Math.round(p.minimumSpacingMinutes / 60)} Stunden Abstand` : ''}
        </div>
        <div style={{ color: '#94a3b8', marginTop: 4 }}><strong style={{ color: '#cbd5e1' }}>Fertig, wenn:</strong> {p.successGate}</div>
      </div>}
      {coach.intervention && coach.feature.voiceEnabled && !coach.preferences.muted && (
        <button type="button" onClick={() => speaking ? stopSpeech() : speak(`${coach.intervention.text} ${coach.intervention.nextAction}`, coach.intervention.id)}
          style={{ ...quietButton, marginTop: 9 }} aria-label={speaking ? 'Salma unterbrechen' : 'Persönlichen Trainingsblock anhören'}>
          {speaking ? 'Unterbrechen' : 'Anhören'}
        </button>
      )}
      {cue?.text && <div role="status" style={{ marginTop: 10, color: '#dbeafe', fontSize: 12.5, lineHeight: 1.55 }}>
        <strong>Korrektur für den nächsten Versuch:</strong> {cue.text}
      </div>}
      {hasEvidenceDetails && <details style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Warum genau das?</summary>
        <div style={{ paddingTop: 4 }}>
          {forecast?.state === 'observed_simulation_risk' && RISK_LABELS[forecast.riskId] && <div role="status" style={{ marginBottom: 10, padding: 11, borderRadius: 10,
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(96,165,250,0.24)', color: '#dbeafe' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#93c5fd' }}>{forecastHeading}</div>
            <div style={{ marginTop: 5, fontSize: 13, fontWeight: 750 }}>{RISK_LABELS[forecast.riskId]}</div>
            <div style={{ marginTop: 3, color: '#cbd5e1', fontSize: 11.5, lineHeight: 1.5 }}>
              {ROLE_LABELS[forecast.target?.roleType] || 'Kundenservice'} · {INDUSTRY_LABELS[forecast.target?.industryKey] || 'allgemeines deutsches BPO'} ·{' '}
              {STAGE_LABELS[forecast.criterion?.stageId] || 'Interview'}
            </div>
            {forecast.criterion && <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 11.5, lineHeight: 1.5 }}>
              {CRITERION_LABELS[forecast.criterion.criterionId] || forecast.criterion.criterionId}: gemessen {forecast.criterion.observed}{' '}
              {UNIT_LABELS[forecast.criterion.unit] || forecast.criterion.unit}; interne Referenz{' '}
              {forecast.criterion.direction === 'at_least' ? 'mindestens' : 'höchstens'} {forecast.criterion.reference}.
            </div>}
            <div style={{ marginTop: 3, color: '#94a3b8', fontSize: 11.5, lineHeight: 1.5 }}>
              {forecast.confidence === 'high' ? 'Hohe Evidenz innerhalb deiner Simulation.' : 'Mittlere Evidenz; der nächste Retest prüft die Übertragbarkeit.'}
              {' '}Interne Trainingsreferenz, keine Vorhersage einer Arbeitgeberentscheidung.
            </div>
          </div>}
          {['repeated_pattern', 'provisional_pattern', 'conflicted_pattern'].includes(truth?.state) && <div role="status" style={{ marginBottom: 10, padding: 11, borderRadius: 10,
            background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(148,163,184,0.24)', color: '#cbd5e1' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#e2e8f0' }}>WAS DIE MESSUNG WEISS — UND WAS NICHT</div>
            <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.55 }}>
              {truth.state === 'repeated_pattern'
                ? `Das Muster wurde in ${truth.supportCount} passenden Simulationen beobachtet.`
                : truth.state === 'conflicted_pattern'
                  ? `Das Muster trat auf, aber ${truth.conflictCount} passende Messung(en) widersprechen einer stabilen Diagnose.`
                  : 'Das Muster wurde einmal zuverlässig beobachtet und bleibt eine Arbeitshypothese.'}
              {' '}Die Ursache ist damit nicht bewiesen.
            </div>
            {truth.possibleExplanations?.length > 0 && <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.55, color: '#94a3b8' }}>
              <strong style={{ color: '#cbd5e1' }}>Mögliche Erklärungen:</strong>{' '}
              {truth.possibleExplanations.map((id) => TRUTH_EXPLANATION_LABELS[id]).filter(Boolean).join(' · ')}
            </div>}
            {TRUTH_DISCRIMINATOR_LABELS[truth.nextDiscriminatorId] && <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.55, color: '#94a3b8' }}>
              <strong style={{ color: '#cbd5e1' }}>So unterscheiden wir sie:</strong>{' '}
              {TRUTH_DISCRIMINATOR_LABELS[truth.nextDiscriminatorId]}
            </div>}
            <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: '#64748b' }}>
              Keine psychologische Diagnose und keine Vorhersage einer Arbeitgeberentscheidung.
            </div>
          </div>}
          {listeningRetest && <div role="status" style={{ marginBottom: 10, color: '#cbd5e1', lineHeight: 1.55 }}>
            <strong style={{ color: '#e2e8f0' }}>Hörnachweis: </strong>
            {listeningRetest.trainingComplete === false && 'Dein persönlicher Trainingsblock läuft noch. Erst nach mindestens vier richtigen Antworten in den letzten fünf Aufgaben beginnt die Retest-Wartezeit.'}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'baseline' && 'Fünf neue Aufgaben bilden zuerst deine servergeprüfte Ausgangsmessung.'}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'dose' && 'Der Trainingsblock ist noch nicht als vollständige Dosis bestätigt.'}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'matched' && <>{listeningRetest.completed || 0}/5 Vergleichsaufgaben bestätigt.{' '}
              {Date.now() < Number(listeningRetest.nextEligibleAt) && <>Der Retest öffnet frühestens am {formatCairoRetest(listeningRetest.nextEligibleAt)} Uhr (Kairo).</>}</>}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'transfer' && <>{listeningRetest.completed || 0}/5 Transferaufgaben mit neuem Material bestätigt.{' '}
              {Date.now() < Number(listeningRetest.nextEligibleAt) && <>Der Transfer-Retest öffnet frühestens am {formatCairoRetest(listeningRetest.nextEligibleAt)} Uhr (Kairo).</>}</>}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'complete' && 'Vergleich und Transfer sind unter neuer Belastung bestätigt.'}
            {listeningRetest.trainingComplete !== false && listeningRetest.phase === 'failed' && 'Der Retest ist vollständig, aber die Erfolgsschwelle wurde nicht erreicht. BrainGuide passt den nächsten Trainingsschritt an.'}
            {listeningRetest.trainingComplete !== false && !['complete', 'failed'].includes(listeningRetest.phase) && <span> Übung vor der Freigabe hilft, gilt aber nicht als Retest.</span>}
          </div>}
          {speakingRetest && <div role="status" style={{ marginBottom: 10, color: '#cbd5e1', lineHeight: 1.55 }}>
            <strong style={{ color: '#e2e8f0' }}>Sprechnachweis: </strong>
            {speakingRetest.phase === 'matched' && <>Der passende Vergleichstest zählt frühestens am {formatCairoRetest(speakingRetest.nextEligibleAt)} Uhr (Kairo).</>}
            {speakingRetest.phase === 'transfer' && <>Der Test in einer neuen Situation zählt frühestens am {formatCairoRetest(speakingRetest.nextEligibleAt)} Uhr (Kairo).</>}
            {speakingRetest.phase === 'complete' && (speakingRetest.transfer
              ? 'Vergleichs- und Transfernachweis sind vollständig.'
              : 'Der Vergleichstest zeigte noch keine übertragbare Verbesserung; BrainGuide passt das Training an.')}
            {speakingRetest.phase !== 'complete' && <span> Frühere Übung hilft, gilt aber nicht als Retest.</span>}
          </div>}
          {proof && <div role="status" style={{ marginBottom: 10, padding: 11, borderRadius: 10,
            background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(96,165,250,0.30)', color: '#dbeafe' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#93c5fd' }}>
              {proof.phase === 'transfer' ? 'VERIFIZIERTER TRANSFER' : 'VERIFIZIERTER VERGLEICHSTEST'}
            </div>
            <div style={{ marginTop: 5, fontSize: 13, fontWeight: 750 }}>{proof.skillLabel}</div>
            <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.55 }}>
              {proof.metricLabel}: <strong>{proof.before}</strong> → <strong>{proof.after}</strong> {proof.unit}. {proofOutcome}
            </div>
          </div>}
          {p && coach.progress && <div style={{ color: '#94a3b8', lineHeight: 1.55 }}>
            Saubere Wiederholungen: {coach.progress.successfulRepetitions}/{coach.progress.requiredSuccessfulRepetitions}
            {coach.progress.blockNominatedComplete
              ? (p.baseline ? (speakingRetest?.phase === 'transfer'
                ? ' · Vergleich bestanden; Beherrschung wird später in einer neuen Situation geprüft.'
                : ' · Block abgeschlossen; Bestätigung folgt im gezielten Trainingsinterview.')
                : ' · Block abgeschlossen; BrainGuide wählt jetzt die nächste verlässliche Messung.')
              : ''}
          </div>}
        </div>
      </details>}
      <details style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#bfdbfe', fontWeight: 700 }}>
          Salma fragen
        </summary>
        <div style={{ paddingTop: 4 }}>
          {answer && <div role="status" style={{ marginBottom: 10, padding: 10, borderRadius: 10, color: '#dbeafe',
            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(96,165,250,0.2)', fontSize: 13, lineHeight: 1.55 }}>
            {answer}
          </div>}
          <form onSubmit={(event) => { event.preventDefault(); ask(question); }}>
            <label htmlFor={questionId} style={{ display: 'block', color: '#94a3b8', fontSize: 11.5, marginBottom: 5 }}>
              Frage zu deinem aktuellen Schritt
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id={questionId} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={400}
                placeholder="Was bedeutet die Aufgabe?" disabled={busy || recording}
                style={{ flex: '1 1 190px', minHeight: 44, borderRadius: 10, border: '1px solid rgba(148,163,184,0.28)',
                  background: 'rgba(2,6,16,0.72)', color: '#e2e8f0', padding: '10px 12px', fontSize: 13 }} />
              <button type="button" onClick={toggleRecording} disabled={busy} aria-pressed={recording} style={quietButton}>
                {recording ? 'Aufnahme beenden' : 'Sprechen'}
              </button>
              <button type="submit" disabled={busy || recording || !question.trim()} style={{ ...quietButton, opacity: !question.trim() ? 0.5 : 1 }}>
                {busy ? 'Einen Moment …' : 'Fragen'}
              </button>
            </div>
          </form>
        </div>
      </details>
      <details style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Tutor-Einstellungen</summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 6 }}>
          <label htmlFor={`salma-minutes-${drillId || screen}`}>Zeit pro Tag</label>
          <select id={`salma-minutes-${drillId || screen}`} value={coach.preferences.dailyMinutes} disabled={busy}
            onChange={(event) => savePreference({ dailyMinutes: Number(event.target.value) })}
            style={{ minHeight: 44, borderRadius: 9, background: '#07101e', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.3)', padding: '8px 10px' }}>
            <option value={5}>5 Minuten</option><option value={10}>10 Minuten</option><option value={20}>20 Minuten</option>
          </select>
          <button type="button" disabled={busy || !coach.feature.voiceEnabled}
            onClick={() => savePreference({ autoSpeak: !coach.preferences.autoSpeak })}
            aria-pressed={coach.preferences.autoSpeak} style={{ ...quietButton, opacity: coach.feature.voiceEnabled ? 1 : 0.55 }}>
            Automatisch sprechen: {coach.preferences.autoSpeak ? 'An' : 'Aus'}
          </button>
          <button type="button" disabled={busy} onClick={() => { stopSpeech(); savePreference({ muted: !coach.preferences.muted }); }}
            aria-pressed={coach.preferences.muted} style={quietButton}>Stumm: {coach.preferences.muted ? 'An' : 'Aus'}</button>
        </div>
      </details>
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>{error}</div>}
    </section>
  );
}
