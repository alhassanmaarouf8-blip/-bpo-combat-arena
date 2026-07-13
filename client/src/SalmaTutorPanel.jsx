import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipRecorder } from './clipRecorder.js';
import { salmaModel } from './salmaVoice.js';

const quietButton = { minHeight: 44, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
  border: '1px solid rgba(96,165,250,0.34)', background: 'rgba(59,130,246,0.08)',
  color: '#bfdbfe', fontSize: 12.5, fontWeight: 650 };

function auth(token, extra = {}) { return { Authorization: `Bearer ${token}`, ...extra }; }

const automaticCueCounts = new Map();

export function SalmaTutorPanel({ token, apiUrl, screen = 'home', drillId = '', initialCue = null }) {
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

  const stopSpeech = useCallback(() => {
    try { speechStopRef.current?.(); } catch { /* best-effort audio cleanup */ }
    speechStopRef.current = null;
    setSpeaking(false);
  }, []);

  const loadCoach = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/salma/coach`, { cache: 'no-store', headers: auth(token) });
      if (response.status === 404) return;
      if (!response.ok) throw new Error('coach_unavailable');
      setCoach(await response.json());
    } catch { /* fail closed: the legacy BrainGuide remains intact */ }
  }, [apiUrl, token]);

  useEffect(() => { loadCoach(); return stopSpeech; }, [loadCoach, stopSpeech]);
  useEffect(() => { if (initialCue?.text) setCue(initialCue); }, [initialCue]);
  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail;
      if (!detail?.cue || (drillId && detail.drill !== drillId)) return;
      setCue(detail.cue);
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
    // Keep the session cap free of account identifiers and bearer tokens.
    const key = drillId || screen;
    const count = automaticCueCounts.get(key) || 0;
    if (count >= Math.min(2, cue.maxAutomaticSpeech || 2)) return;
    automaticCueCounts.set(key, count + 1);
    speak(cue.text);
  }, [coach, cue, drillId, screen, speak, token]);

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
  return (
    <section dir="ltr" aria-label="Salma, persönliche Interviewtrainerin" aria-busy={busy} style={{ marginTop: 12, padding: '12px 0 2px',
      borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'left' }}>
      {p && <div style={{ color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.55 }}>
        <strong style={{ color: '#e2e8f0' }}>Dein persönlicher Trainingsblock:</strong>{' '}
        {p.repetitions} Wiederholungen · {Math.ceil(p.durationSeconds / 60)} Minuten
        {p.timesPerDay > 1 ? ` · ${p.timesPerDay} Blöcke mit mindestens ${Math.round(p.minimumSpacingMinutes / 60)} Stunden Abstand` : ''}.
        <div style={{ color: '#94a3b8', marginTop: 4 }}>Erfolg: {p.successGate}</div>
        {coach.progress && <div style={{ color: '#94a3b8', marginTop: 4 }}>
          Saubere Wiederholungen: {coach.progress.successfulRepetitions}/{coach.progress.requiredSuccessfulRepetitions}
          {coach.progress.blockNominatedComplete ? ' · Block abgeschlossen; Bestätigung folgt im Live-Interview.' : ''}
        </div>}
      </div>}
      {coach.intervention && coach.feature.voiceEnabled && !coach.preferences.muted && (
        <button type="button" onClick={() => speaking ? stopSpeech() : speak(`${coach.intervention.text} ${coach.intervention.nextAction}`, coach.intervention.id)}
          style={{ ...quietButton, marginTop: 9 }} aria-label={speaking ? 'Salma unterbrechen' : 'Persönlichen Trainingsblock anhören'}>
          {speaking ? 'Unterbrechen' : 'Anhören'}
        </button>
      )}
      {answer && <div role="status" style={{ marginTop: 10, padding: 10, borderRadius: 10, color: '#dbeafe',
        background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(96,165,250,0.2)', fontSize: 13, lineHeight: 1.55 }}>
        {answer}
      </div>}
      {cue?.text && <div role="status" style={{ marginTop: 10, color: '#dbeafe', fontSize: 12.5, lineHeight: 1.55 }}>
        <strong>Korrektur für den nächsten Versuch:</strong> {cue.text}
      </div>}
      <form onSubmit={(event) => { event.preventDefault(); ask(question); }} style={{ marginTop: 10 }}>
        <label htmlFor="salma-question" style={{ display: 'block', color: '#94a3b8', fontSize: 11.5, marginBottom: 5 }}>Salma fragen</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id="salma-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={400}
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
