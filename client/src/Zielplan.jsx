/**
 * Zielplan.jsx — "goal plan" coaching layer, a NEW section added on top of the app.
 *
 * Phase 1: the user builds their own plan (title + deadline), adds dated days, and adds
 * steps (4 types) to each day; everything persists to the backend (/api/plans) which is
 * the single source of truth. NO AI here and the voice interview is NOT touched — step
 * guidance (Phase 2) and launching the mock fight (Phase 3) come later.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ClipRecorder } from './clipRecorder.js';
import { checkAudioSupport } from './audioRecorder.js';

const STEP_META = {
  research: { label: 'Recherche',   icon: '🔍', color: 'var(--accent)',   hint: 'Thema recherchieren → Ergebnisse einfügen' },
  written:  { label: 'Schriftlich', icon: '✍️', color: 'var(--violet)',   hint: 'Vokabel- / Grammatik-Übung' },
  speaking: { label: 'Sprechen',    icon: '🗣️', color: 'var(--player-2)', hint: 'Kurze Sprech-Übung' },
  fight:    { label: 'Mock-Kampf',  icon: '⚔️', color: 'var(--boss)',     hint: 'Volles Voice-Interview (rationiert)' },
};
const todayStr = () => { try { return new Date().toISOString().slice(0, 10); } catch { return ''; } };

export default function Zielplan({ token, apiUrl, onClose, lang = 'de', onStartFight }) {
  const [plans, setPlans] = useState(null);   // null = loading
  const [active, setActive] = useState(null); // the open plan
  const [err, setErr] = useState('');
  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/api/plans`, { headers: headers() });
      const d = await r.json();
      setPlans(d.plans || []);
    } catch { setPlans([]); setErr('Server nicht erreichbar.'); }
  }, [apiUrl, headers]);
  useEffect(() => { load(); }, [load]);

  // ── create ──
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [maxFights, setMaxFights] = useState(2);
  const createPlan = async () => {
    setErr('');
    if (!title.trim() || !deadline) { setErr('Titel und Frist sind nötig.'); return; }
    try {
      const r = await fetch(`${apiUrl}/api/plans`, { method: 'POST', headers: headers(), body: JSON.stringify({ title, deadline, maxFights }) });
      const d = await r.json();
      if (d.plan) { setTitle(''); setDeadline(''); await load(); setActive(d.plan); }
      else setErr(d.error || 'Fehler beim Anlegen.');
    } catch { setErr('Server nicht erreichbar.'); }
  };

  // ── structure mutations (server is authoritative; PUT returns the canonical plan) ──
  const putPlan = useCallback(async (patch) => {
    setErr('');
    try {
      const r = await fetch(`${apiUrl}/api/plans/${active.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
      const d = await r.json();
      if (d.plan) setActive(d.plan);
      else setErr(d.error === 'fight_cap' ? `Höchstens ${d.max} Mock-Kämpfe pro Plan.` : (d.error || 'Fehler.'));
    } catch { setErr('Server nicht erreichbar.'); }
  }, [apiUrl, active, headers]);

  const toggleStep = async (stepId) => {
    try {
      const r = await fetch(`${apiUrl}/api/plans/${active.id}/steps/${stepId}`, { method: 'PATCH', headers: headers(), body: '{}' });
      const d = await r.json();
      if (d.plan) setActive(d.plan);
    } catch { /* ignore */ }
  };
  const deletePlan = async (id) => {
    try { await fetch(`${apiUrl}/api/plans/${id}`, { method: 'DELETE', headers: headers() }); setActive(null); await load(); } catch { /* ignore */ }
  };

  // ── cheap-model guidance (steps 1–3) ──
  const generateTask = async (stepId) => {
    try {
      const r = await fetch(`${apiUrl}/api/plans/${active.id}/steps/${stepId}/generate`, { method: 'POST', headers: headers(), body: JSON.stringify({ level: 'a2-b1' }) });
      const d = await r.json();
      if (d.plan) setActive(d.plan);
      return d;
    } catch { return { error: 'net' }; }
  };
  const sendForFeedback = async (stepId, input) => {
    try {
      const r = await fetch(`${apiUrl}/api/plans/${active.id}/steps/${stepId}/feedback`, { method: 'POST', headers: headers(), body: JSON.stringify({ input, level: 'a2-b1' }) });
      const d = await r.json();
      if (d.plan) setActive(d.plan);
      return d;
    } catch { return { error: 'net' }; }
  };
  // Speaking step: upload the recorded WAV → transcript + metrics + feedback (cheap models).
  const sendSpeech = async (stepId, blob, durationMs) => {
    try {
      const r = await fetch(`${apiUrl}/api/plans/${active.id}/steps/${stepId}/speak?ms=${durationMs}&level=a2-b1`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${token}` },
        body: blob,
      });
      const d = await r.json();
      if (d.plan) setActive(d.plan);
      return d;
    } catch { return { error: 'net' }; }
  };

  const cloneDays = () => (active?.days || []).map((d) => ({ ...d, steps: (Array.isArray(d?.steps) ? d.steps : []).map((s) => ({ ...s })) }));
  const addDay = (date) => {
    if (!date) return;
    const days = cloneDays();
    if (!days.some((d) => d.date === date)) days.push({ date, steps: [] });
    days.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    putPlan({ days });
  };
  const addStep = (dayId, type, topic) => {
    const days = cloneDays();
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    day.steps.push({ type, topic });
    putPlan({ days });
  };
  const removeStep = (dayId, stepId) =>
    putPlan({ days: cloneDays().map((d) => d.id === dayId ? { ...d, steps: d.steps.filter((s) => s.id !== stepId) } : d) });
  const removeDay = (dayId) => putPlan({ days: cloneDays().filter((d) => d.id !== dayId) });

  // ── derived ──
  const planStats = (p) => {
    const steps = (p?.days || []).flatMap((d) => (Array.isArray(d?.steps) ? d.steps : [])).filter(Boolean);
    const done = steps.filter((s) => s && s.done).length;
    const fights = steps.filter((s) => s && s.type === 'fight').length;
    const ms = new Date(p?.deadline) - new Date(todayStr());
    const daysLeft = Number.isFinite(ms) ? Math.ceil(ms / 86400000) : 0;
    return { total: steps.length, done, pct: steps.length ? Math.round((done / steps.length) * 100) : 0, fights, daysLeft };
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 220, display: 'flex', flexDirection: 'column',
      background: 'rgba(2,4,9,0.98)', backdropFilter: 'blur(6px)', animation: 'flash-in 0.3s ease' }}>

      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 8px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '0.12em',
            color: 'var(--accent)', textShadow: 'var(--glow-accent)' }}>ZIELPLAN</div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>DEIN WEG ZUM ZIEL · TÄGLICHE SCHRITTE</div>
        </div>
        <button onClick={active ? () => setActive(null) : onClose}
          style={btnGhost}>{active ? '← PLÄNE' : '✕ SCHLIESSEN'}</button>
      </div>

      {err && <div style={{ margin: '0 16px 8px', padding: '8px 12px', borderRadius: 8, fontSize: 11,
        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>⚠ {err}</div>}

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── LIST + CREATE ───────────────────────────────────────────── */}
        {!active && (
          <>
            <div style={card}>
              <div style={sectionTitle}>NEUEN PLAN ERSTELLEN</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                placeholder="Ziel, z.B. „Deutsches Remote-Sales-Interview bestehen“" style={input} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <label style={{ flex: 1, fontSize: 9, color: 'var(--text-dim)' }}>FRIST
                  <input type="date" value={deadline} min={todayStr()} onChange={(e) => setDeadline(e.target.value)} style={{ ...input, marginTop: 3 }} />
                </label>
                <label style={{ width: 130, fontSize: 9, color: 'var(--text-dim)' }}>MOCK-KÄMPFE (max.)
                  <select value={maxFights} onChange={(e) => setMaxFights(+e.target.value)} style={{ ...input, marginTop: 3 }}>
                    <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </label>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 6 }}>
                Mock-Kämpfe sind das teure Voice-Interview — bewusst rationiert, am besten kurz vor der Frist.
              </div>
              <button onClick={createPlan} style={{ ...btnPrimary, marginTop: 10 }}>+ PLAN ANLEGEN</button>
            </div>

            <div style={sectionTitle}>DEINE PLÄNE</div>
            {plans === null && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Lade…</div>}
            {plans && plans.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic' }}>Noch kein Plan. Lege oben deinen ersten an.</div>}
            {plans && plans.map((p) => {
              const st = planStats(p);
              return (
                <button key={p.id} onClick={() => setActive(p)} style={{ ...card, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>{p.title}</span>
                    <span style={{ fontSize: 9, color: st.daysLeft < 0 ? '#f87171' : 'var(--warn)' }}>
                      {st.daysLeft < 0 ? 'überfällig' : st.daysLeft === 0 ? 'heute fällig' : `${st.daysLeft} Tg. übrig`}
                    </span>
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 2 }}>
                    Frist {p.deadline} · {st.done}/{st.total} Schritte · {st.fights}/{p.maxFights} ⚔
                    {st.total > 0 && st.done === st.total && <span style={{ color: 'var(--accent)', fontWeight: 600 }}> · ✓ abgeschlossen</span>}
                  </div>
                  <ProgressBar pct={st.pct} />
                </button>
              );
            })}
          </>
        )}

        {/* ── ONE PLAN (builder + dashboard) ──────────────────────────── */}
        {active && <PlanView plan={active} stats={planStats(active)}
          onAddDay={addDay} onAddStep={addStep} onRemoveStep={removeStep} onRemoveDay={removeDay}
          onToggle={toggleStep} onDelete={() => deletePlan(active.id)}
          onGenerate={generateTask} onFeedback={sendForFeedback} onSpeak={sendSpeech} lang={lang}
          onStartFight={onStartFight ? (stepId) => onStartFight(active.id, stepId) : null} />}
      </div>
    </div>
  );
}

function PlanView({ plan, stats, onAddDay, onAddStep, onRemoveStep, onRemoveDay, onToggle, onDelete, onGenerate, onFeedback, onSpeak, lang, onStartFight }) {
  const [newDay, setNewDay] = useState('');
  return (
    <>
      <div style={card}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#fff' }}>{plan.title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
          Frist {plan.deadline} · {stats.daysLeft < 0 ? 'überfällig' : `${stats.daysLeft} Tage übrig`} · Mock-Kämpfe {stats.fights}/{plan.maxFights}
        </div>
        <ProgressBar pct={stats.pct} />
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{stats.done} von {stats.total} Schritten erledigt ({stats.pct}%)</div>
      </div>

      {stats.total > 0 && stats.done === stats.total && (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(59,130,246,0.16), rgba(59,130,246,0.08))',
          border: '1px solid rgba(59,130,246,0.5)', boxShadow: '0 0 22px rgba(59,130,246,0.18)' }}>
          <div style={{ fontSize: 28, lineHeight: 1, animation: 'rank-pop 0.7s var(--ease-spring)' }}>🎯</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--accent)', marginTop: 4, textShadow: '0 0 12px rgba(59,130,246,0.5)' }}>Plan abgeschlossen!</div>
          <div style={{ fontSize: 10.5, color: 'var(--accent-2)', marginTop: 2 }}>Alle {stats.total} Schritte erledigt. Bereit fürs echte Interview.</div>
        </div>
      )}

      {/* add a day */}
      <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={newDay} min={todayStr()} max={plan.deadline} onChange={(e) => setNewDay(e.target.value)} style={{ ...input, flex: 1 }} />
        <button onClick={() => { onAddDay(newDay); setNewDay(''); }} style={btnPrimary}>+ TAG</button>
      </div>

      {(plan.days || []).length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic' }}>Noch keine Tage. Füge oben den ersten Trainingstag hinzu.</div>}
      {(plan.days || []).map((day) => (
        <DayCard key={day.id} day={day} onAddStep={onAddStep} onRemoveStep={onRemoveStep} onRemoveDay={onRemoveDay}
          onToggle={onToggle} onGenerate={onGenerate} onFeedback={onFeedback} onSpeak={onSpeak} lang={lang} onStartFight={onStartFight} />
      ))}

      <button onClick={onDelete} style={{ ...btnGhost, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)', marginTop: 6 }}>PLAN LÖSCHEN</button>
    </>
  );
}

function DayCard({ day, onAddStep, onRemoveStep, onRemoveDay, onToggle, onGenerate, onFeedback, onSpeak, lang, onStartFight }) {
  const [type, setType] = useState('research');
  const [topic, setTopic] = useState('');
  const dateLabel = (() => { try { return new Date(day.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }); } catch { return day.date; } })();

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', color: 'var(--accent)' }}>{dateLabel}</span>
        <button onClick={() => onRemoveDay(day.id)} style={xBtn}>✕ Tag</button>
      </div>

      {(day.steps || []).length === 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic', marginBottom: 6 }}>Keine Schritte.</div>}
      {(day.steps || []).map((s) => {
        const m = STEP_META[s.type] || STEP_META.written;
        return (
          <div key={s.id} style={{ padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <button onClick={() => onToggle(s.id)} title="Erledigt umschalten" style={{
                width: 20, height: 20, flexShrink: 0, borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${s.done ? 'var(--player)' : 'var(--line)'}`,
                background: s.done ? 'var(--player)' : 'transparent', color: '#04070d', fontSize: 12, lineHeight: 1 }}>
                {s.done ? '✓' : ''}
              </button>
              <span style={{ fontSize: 14 }}>{m.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 11, color: m.color,
                  textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.6 : 1 }}>{m.label}</div>
                {s.topic && <div style={{ fontSize: 11, color: '#cbd5e1', opacity: s.done ? 0.5 : 1 }}>{s.topic}</div>}
              </div>
              <button onClick={() => onRemoveStep(day.id, s.id)} style={xBtn}>✕</button>
            </div>
            <StepRunner step={s} onGenerate={onGenerate} onFeedback={onFeedback} onSpeak={onSpeak} lang={lang} onStartFight={onStartFight} />
          </div>
        );
      })}

      {/* add a step */}
      <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...input, width: 120, padding: '8px' }}>
          {Object.entries(STEP_META).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
        </select>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200}
          placeholder="Thema (optional)" style={{ ...input, flex: 1, minWidth: 100 }} />
        <button onClick={() => { onAddStep(day.id, type, topic); setTopic(''); }} style={btnPrimary}>+ SCHRITT</button>
      </div>
      <div style={{ fontSize: 8.5, color: 'var(--text-faint)', marginTop: 5 }}>{STEP_META[type].hint}</div>
    </div>
  );
}

// Interactive guidance for steps 1–3 (cheap text model). Step 4 (fight) is Phase 3.
function StepRunner({ step, onGenerate, onFeedback, onSpeak, lang, onStartFight }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(step.result?.input || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ar = lang === 'ar';
  const task = step.result?.task;
  const feedback = ar && step.result?.feedback_ar ? step.result.feedback_ar : step.result?.feedback;

  if (step.type === 'fight') {
    return (
      <div style={{ marginLeft: 29, marginTop: 5 }}>
        <button onClick={() => onStartFight?.(step.id)} disabled={!onStartFight}
          style={{ ...btnPrimary, border: '1px solid var(--boss)', background: 'linear-gradient(135deg, #f97316, var(--boss))', opacity: onStartFight ? 1 : 0.5 }}>
          ⚔ MOCK-KAMPF STARTEN
        </button>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4 }}>
          {step.done ? '✓ Schon absolviert — du kannst erneut antreten.' : 'Startet das volle Voice-Interview. Danach kehrst du zum Plan zurück.'}
        </div>
      </div>
    );
  }
  // A SPEAKING task must involve SPEAKING — never a text box as primary input.
  if (step.type === 'speaking') {
    return <SpeakingRunner step={step} onGenerate={onGenerate} onSpeak={onSpeak} lang={lang} />;
  }
  const genLabel = step.type === 'research' ? 'Leitfragen generieren' : step.type === 'speaking' ? 'Sprech-Aufgabe' : 'Übung generieren';

  const gen = async () => {
    setBusy(true); setErr('');
    const d = await onGenerate(step.id); setBusy(false);
    if (d?.error) setErr(d.error === 'no_api_key' ? 'KI nicht verfügbar (kein API-Key).' : 'Konnte Aufgabe nicht laden.');
  };
  const submit = async () => {
    if (!input.trim()) return;
    setBusy(true); setErr('');
    const d = await onFeedback(step.id, input); setBusy(false);
    if (d?.error) setErr(d.error === 'no_api_key' ? 'KI nicht verfügbar (kein API-Key).' : 'Feedback fehlgeschlagen.');
  };

  return (
    <div style={{ marginLeft: 29, marginTop: 5 }}>
      <button onClick={() => setOpen((o) => !o)} style={smallBtn}>
        {open ? '▾ Schließen' : feedback ? '▸ Üben · Feedback vorhanden' : '▸ Üben'}
      </button>
      {open && (
        <div style={panel}>
          {!task && <button onClick={gen} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : genLabel}</button>}
          {task && <div style={taskBox}>{task}</div>}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000}
            placeholder={step.type === 'research' ? 'Deine Recherche-Ergebnisse einfügen…' : 'Deine Antwort auf Deutsch…'}
            style={textareaStyle} />
          <button onClick={submit} disabled={busy || !input.trim()} style={{ ...btnPrimary, opacity: (busy || !input.trim()) ? 0.6 : 1 }}>
            {busy ? 'Prüfe…' : 'Prüfen / Feedback'}
          </button>
          {err && <div style={{ color: '#fca5a5', fontSize: 10 }}>⚠ {err}</div>}
          {feedback && (
            <div style={{ ...feedbackBox, direction: ar ? 'rtl' : 'ltr', textAlign: ar ? 'right' : 'left' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--player-2)', marginBottom: 4 }}>FEEDBACK</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{feedback}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Sprechen step: record a spoken answer (reusing the mic), transcribe + give feedback.
function SpeakingRunner({ step, onGenerate, onSpeak, lang }) {
  const [open, setOpen]   = useState(!!step.result?.transcript);
  const [phase, setPhase] = useState('idle');   // idle | recording | processing
  const [elapsed, setEl]  = useState(0);
  const [vol, setVol]     = useState(0);
  const [err, setErr]     = useState('');
  const [task, setTask]   = useState(step.result?.task || '');
  const [busyTask, setBusyTask] = useState(false);
  const recRef = useRef(null);
  const timerRef = useRef(null);
  const ar = lang === 'ar';
  const MAX = 90;

  const r = step.result || {};
  const transcript = r.transcript;
  const fb  = ar && r.feedback_ar ? r.feedback_ar : r.feedback;
  const wpm = r.wpm ?? 0, fillers = r.fillers ?? 0;
  const support = checkAudioSupport();

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); recRef.current?.stop?.().catch(() => {}); }, []);

  const stopRec = async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!recRef.current) return;
    setPhase('processing'); setVol(0);
    try {
      const { blob, durationMs } = await recRef.current.stop();
      recRef.current = null;
      const d = await onSpeak(step.id, blob, durationMs);
      if (d?.error) { setErr(d.error === 'no_api_key' ? 'KI nicht verfügbar (kein API-Key).' : 'Verarbeitung fehlgeschlagen.'); }
    } catch { setErr('Verarbeitung fehlgeschlagen.'); }
    setPhase('idle');
  };
  const startRec = async () => {
    setErr('');
    if (!support.supported) { setErr('Mikrofon wird hier nicht unterstützt.'); return; }
    try {
      recRef.current = new ClipRecorder({ onVolume: (v) => setVol(v) });
      await recRef.current.start();
      setPhase('recording'); setEl(0);
      timerRef.current = setInterval(() => setEl((e) => {
        if (e + 1 >= MAX) { stopRec(); return MAX; }
        return e + 1;
      }), 1000);
    } catch (e) {
      setErr(e?.code === 'MIC_DENIED' ? 'Mikrofon-Zugriff verweigert.' : 'Aufnahme fehlgeschlagen.');
      setPhase('idle');
    }
  };
  const genTask = async () => { setBusyTask(true); const d = await onGenerate(step.id); setBusyTask(false); if (d?.task) setTask(d.task); };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const wpmColor = wpm >= 140 && wpm <= 160 ? 'var(--accent)' : (wpm >= 110 && wpm <= 185) ? 'var(--action)' : '#f87171';

  return (
    <div style={{ marginLeft: 29, marginTop: 5 }}>
      <button onClick={() => setOpen((o) => !o)} style={smallBtn}>
        {open ? '▾ Schließen' : transcript ? '▸ Sprechen · Aufnahme vorhanden' : '▸ Sprechen 🎙'}
      </button>
      {open && (
        <div style={panel}>
          {task ? <div style={taskBox}>{task}</div>
                : <button onClick={genTask} disabled={busyTask} style={{ ...btnPrimary, opacity: busyTask ? 0.6 : 1 }}>{busyTask ? '…' : 'Sprech-Aufgabe vorschlagen'}</button>}

          {phase !== 'processing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <button onClick={phase === 'recording' ? stopRec : startRec} aria-label="record"
                style={{ width: 64, height: 64, borderRadius: '50%', cursor: 'pointer', fontSize: 24, color: '#e2e8f0',
                  border: `2px solid ${phase === 'recording' ? 'var(--boss)' : 'var(--accent)'}`,
                  background: phase === 'recording' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.08)',
                  boxShadow: phase === 'recording' ? `0 0 ${12 + vol * 34}px rgba(239,68,68,0.6)` : '0 0 14px rgba(59,130,246,0.25)',
                  transform: phase === 'recording' ? `scale(${(1 + vol * 0.25).toFixed(3)})` : 'scale(1)',
                  transition: 'transform 0.08s linear, box-shadow 0.12s, border-color 0.2s' }}>
                {phase === 'recording' ? '■' : '🎙'}
              </button>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
                color: phase === 'recording' ? 'var(--boss)' : 'var(--text-dim)' }}>
                {phase === 'recording' ? `● ${mmss(elapsed)} / 1:30` : transcript ? 'NEU AUFNEHMEN' : 'SPRICH'}
              </div>
              {phase !== 'recording' && <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>Max. 90 Sek. · auf Deutsch antworten · Mikrofon nötig</div>}
            </div>
          )}
          {phase === 'processing' && <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, padding: '12px 0' }}>Transkription &amp; Feedback…</div>}

          {err && <div style={{ color: '#fca5a5', fontSize: 10 }}>⚠ {err}</div>}

          {transcript && (
            <>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--text-dim)', marginBottom: 3 }}>DEINE ANTWORT · TRANSKRIPT</div>
                <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5, fontStyle: 'italic' }}>„{transcript}"</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={metricBox}><div style={{ color: wpmColor, fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-display)' }}>{wpm}</div><div style={metricLbl}>WpM · Ziel 140–160</div></div>
                <div style={metricBox}><div style={{ color: fillers <= 2 ? 'var(--accent)' : '#f87171', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-display)' }}>{fillers}</div><div style={metricLbl}>Füllwörter</div></div>
              </div>
              {fb && (
                <div style={{ ...feedbackBox, direction: ar ? 'rtl' : 'ltr', textAlign: ar ? 'right' : 'left' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--player-2)', marginBottom: 4 }}>FEEDBACK</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{fb}</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct }) {
  return (
    <div style={{ height: 8, borderRadius: 'var(--r-pill)', overflow: 'hidden', background: 'rgba(0,0,0,0.45)', border: '1px solid var(--line)', marginTop: 8 }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 'inherit',
        background: 'linear-gradient(90deg, var(--player), var(--accent))', boxShadow: '0 0 8px var(--accent-dim)',
        transition: 'width 0.5s var(--ease-out)' }} />
    </div>
  );
}

// ── shared inline styles ──
const card = { padding: '12px 13px', borderRadius: 'var(--r-md)', background: 'linear-gradient(180deg, rgba(8,16,28,0.9), rgba(4,8,14,0.92))', border: '1px solid var(--line)', boxShadow: 'inset 0 0 24px rgba(0,0,0,0.45)' };
const sectionTitle = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--text-dim)', marginBottom: 6 };
const input = { width: '100%', padding: '10px', borderRadius: 'var(--r-sm)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontFamily: 'var(--font-body)', fontSize: 13, border: '1px solid var(--line)', outline: 'none' };
const btnPrimary = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', padding: '9px 13px', borderRadius: 'var(--r-sm)', cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid var(--accent)', color: '#04070d', background: 'linear-gradient(135deg, var(--accent-2), var(--accent))' };
const btnGhost = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', padding: '7px 11px', borderRadius: 'var(--r-sm)', cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--accent)' };
const xBtn = { fontSize: 9, cursor: 'pointer', padding: '3px 6px', borderRadius: 5, border: '1px solid rgba(148,163,184,0.25)', background: 'transparent', color: '#94a3b8' };
const smallBtn = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 9.5, letterSpacing: '0.04em', cursor: 'pointer', padding: '4px 8px', borderRadius: 5, border: '1px solid var(--line)', background: 'transparent', color: 'var(--accent)' };
const panel = { marginTop: 7, padding: 10, borderRadius: 'var(--r-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 };
const taskBox = { fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.5, whiteSpace: 'pre-wrap', padding: 8, borderRadius: 6, background: 'rgba(59,130,246,0.05)', border: '1px solid var(--line)' };
const feedbackBox = { fontSize: 11.5, color: 'var(--accent-2)', lineHeight: 1.55, padding: 9, borderRadius: 6, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' };
const textareaStyle = { width: '100%', minHeight: 70, padding: 9, borderRadius: 'var(--r-sm)', resize: 'vertical', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontFamily: 'var(--font-body)', fontSize: 12.5, border: '1px solid var(--line)', outline: 'none' };
const metricBox = { flex: 1, textAlign: 'center', padding: '8px 6px', borderRadius: 'var(--r-sm)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)' };
const metricLbl = { fontSize: 8, color: 'var(--text-dim)', marginTop: 2, letterSpacing: '0.04em' };
