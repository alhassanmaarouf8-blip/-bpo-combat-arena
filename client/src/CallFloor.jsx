/**
 * CallFloor.jsx — Mode 2's standalone client (Der Anruf-Floor). Reached ONLY via ?callfloor
 * (main.jsx branch — the shipped ?feedback pattern); the protected home/App is untouched.
 * Server flag CALLFLOOR_ENABLED=1 is the kill switch: with it off every API call 404s and this
 * screen shows the honest "nicht verfügbar" state.
 *
 * Phase 3 adds: Shift Mode (back-to-back calls → a BPO shift report), the honest Floor-Score
 * delta after each call, and the Quadrant Career Profile (best seat + rejection stamina). Held to
 * the anti-slop ruling: real BPO metrics only — no bonuses, no streaks, no rarity events.
 *
 * Design law: dark shell, blue + ONE orange object per screen, real SVG (no emoji chrome),
 * 44px targets, primitives-only buttons. All Arabic = OWNER-AR slots (German renders until the
 * owner fills them server-side).
 */
import { useEffect, useRef, useState } from 'react';
import { API_URL } from './config.js';
import { ClipRecorder } from './clipRecorder.js';
import { playNative } from './nativeVoice.js';
import { actionBtn, ghostBtn, cardSurface, screenTitle } from './ui/primitives.js';

const token = () => localStorage.getItem('bpo_token');

// The customer's mood, drawn — 1 (angry) … 5 (happy). Stroke SVG, currentColor, no emoji.
function MoodFace({ mood = 3, size = 72 }) {
  const m = Math.max(1, Math.min(5, Number(mood) || 3));
  const browTilt = [14, 8, 0, -2, -4][m - 1];
  const mouth = [
    'M 22 46 Q 32 38 42 46', 'M 22 45 Q 32 40 42 45', 'M 23 44 L 41 44',
    'M 22 42 Q 32 48 42 42', 'M 21 41 Q 32 52 43 41',
  ][m - 1];
  const color = m <= 2 ? 'var(--bad)' : m === 3 ? '#7d93b8' : 'var(--accent, #3b82f6)';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ color, transition: 'color 400ms' }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line x1="19" y1={24 + browTilt / 4} x2="27" y2={24 - browTilt / 4} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="37" y1={24 - browTilt / 4} x2="45" y2={24 + browTilt / 4} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="23" cy="29" r="2.4" fill="currentColor" />
      <circle cx="41" cy="29" r="2.4" fill="currentColor" />
      <path d={mouth} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function MicIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}

const mmss = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.round((sec || 0) % 60)).padStart(2, '0')}`;
const SKILL_DE = { deeskalation: 'Deeskalation', empathie: 'Empathie', struktur: 'Struktur', loesung: 'Lösung',
  effizienz: 'Effizienz', bedarfsanalyse: 'Bedarfsanalyse', pitch: 'Pitch', einwandbehandlung: 'Einwandbehandlung',
  abschluss: 'Abschluss', eroeffnung: 'Eröffnung', respekt_zeit: 'Respekt vor der Zeit', ziel: 'Zielerreichung',
  einstieg: 'Einstieg', hook: 'Aufhänger' };
const skillName = (k) => SKILL_DE[k] || String(k || '').replace(/_/g, ' ');
const STAMINA_DE = { haelt_dem_druck_stand: 'hält dem Druck stand', wackelt_nach_absagen: 'wackelt nach Absagen',
  bricht_nach_absagen_ein: 'bricht nach Absagen ein' };

const api = async (path, opts = {}) => {
  const r = await fetch(`${API_URL}${path}`, { ...opts, headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

// Honest Floor-Score delta — no confetti, just the number moving.
function ScoreDelta({ d }) {
  if (!d || d.after == null) return null;
  const up = d.delta != null && d.delta > 0, down = d.delta != null && d.delta < 0;
  const color = up ? 'var(--accent, #3b82f6)' : down ? 'var(--bad)' : '#7d93b8';
  return (
    <div style={{ ...cardSurface, padding: 14, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ opacity: 0.8, fontSize: 14 }}>Floor-Score{/* OWNER-AR slot */}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>
        {d.before != null ? <span style={{ opacity: 0.55 }}>{d.before} → </span> : null}
        <span style={{ color }}>{d.after}</span>
        {d.delta != null && d.delta !== 0 ? <span style={{ color, fontSize: 13, marginLeft: 6 }}>{up ? '+' : ''}{d.delta}</span> : null}
      </span>
    </div>
  );
}

export default function CallFloor() {
  const [floor, setFloor] = useState(null);
  const [gate, setGate] = useState('loading');       // loading | off | noauth | ready
  const [view, setView] = useState('floor');         // floor | call | verdict | shiftReport | profile
  const [call, setCall] = useState(null);
  const [phase, setPhase] = useState('idle');        // idle | customer | recording | sending
  const [mood, setMood] = useState(3);
  const [verdict, setVerdict] = useState(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null);
  const [shiftInfo, setShiftInfo] = useState(null);  // { targetSec, startedAt } when a shift is running
  const [shiftReport, setShiftReport] = useState(null);
  const [profile, setProfile] = useState(null);
  const [product, setProduct] = useState(null);      // sales fact sheet to review before the call
  const recRef = useRef(null);
  const callRef = useRef(null);
  const stopVoiceRef = useRef(null);

  const loadFloor = async () => {
    if (!token()) { setGate('noauth'); return; }
    const { status, data } = await api('/api/callfloor/state');
    if (status === 404) { setGate('off'); return; }
    if (status === 401 || status === 403) { setGate('noauth'); return; }
    setFloor(data); setGate('ready');
  };
  useEffect(() => { loadFloor(); }, []);
  useEffect(() => () => { try { stopVoiceRef.current?.(); } catch {} }, []);

  const speak = (text, voice, onEnd) => {
    try { stopVoiceRef.current?.(); } catch {}
    const stop = playNative({ apiUrl: API_URL, token: token(), text, voice, onEnd });
    stopVoiceRef.current = typeof stop === 'function' ? stop : null;
  };

  const beginCall = async (quadrant) => {
    setErr(''); setVerdict(null);
    const { status, data } = await api('/api/callfloor/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quadrant }),
    });
    if (status === 429) { setErr(`Tageslimit erreicht — heute schon ${Math.round((data.usedSec || 0) / 60)} Min. telefoniert. Komm morgen wieder${data.nextLabel ? ` oder hol dir ${data.nextLabel}` : ''}.`); setView('floor'); return; }
    if (status === 403) {
      const label = data.nextLabel || 'Elite';
      setErr(data.error === 'quadrant_locked' ? `Dieser Platz ist ab ${label} verfügbar.` : `Der Anruf-Floor ist ab ${label} verfügbar.`);
      setView('floor'); return;
    }
    if (status !== 200) { setErr('Anruf konnte nicht gestartet werden.'); setView('floor'); return; }
    callRef.current = data; setCall(data); setMood(data.mood); setView('call');
    // Sales calls: review the product fact sheet BEFORE the call begins.
    if (data.product) { setProduct(data.product); setPhase('factsheet'); return; }
    playOpening(data);
  };

  const playOpening = (data) => {
    setProduct(null);
    if (data.opening?.text) { setPhase('customer'); speak(data.opening.text, data.scenario.voice, () => setPhase('yourturn')); }
    else setPhase('yourturn');
  };

  const startFreeTalk = async () => {
    setErr(''); setVerdict(null); setShiftInfo(null);
    const { status, data } = await api('/api/callfloor/freetalk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (status === 403) { setErr(`Freies Gespräch ist ab ${data.nextLabel || 'Elite'} verfügbar.`); return; }
    if (status === 429) { setErr('Tageslimit erreicht — komm morgen wieder.'); return; }
    if (status !== 200) { setErr('Gespräch konnte nicht gestartet werden.'); return; }
    callRef.current = data; setCall(data); setMood(4); setView('call');
    setPhase('customer'); speak(data.opening.text, data.scenario.voice, () => setPhase('yourturn'));
  };

  // A shift picks the seat like a real floor: unpredictable — but only from the UNLOCKED seats.
  const nextShiftQuadrant = () => {
    const qs = (floor?.quadrants || []).filter((q) => q.unlocked).map((q) => q.id);
    return qs[Math.floor(Math.random() * qs.length)] || 'inbound_cs';
  };

  const startShift = async (targetMin) => {
    setErr('');
    const { status, data } = await api('/api/callfloor/shift', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetMin }),
    });
    if (status !== 200) { setErr(`Schicht nicht möglich — heute schon ${Math.round((data.usedSec || 0) / 60)} Min. telefoniert.`); return; }
    setShiftInfo({ targetSec: data.targetSec, startedAt: Date.now() });
    beginCall(nextShiftQuadrant());
  };

  const shiftBudgetLeft = () => shiftInfo ? Math.max(0, shiftInfo.targetSec - (Date.now() - shiftInfo.startedAt) / 1000) : 0;

  const endShift = async () => {
    const { data } = await api('/api/callfloor/shift/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setShiftInfo(null); setShiftReport(data.report || { empty: true }); setView('shiftReport'); loadFloor();
  };

  const afterVerdict = () => {
    // In a shift with budget left → straight to the next call; otherwise back to the floor / report.
    if (shiftInfo) { if (shiftBudgetLeft() > 20) beginCall(nextShiftQuadrant()); else endShift(); return; }
    setCall(null); setVerdict(null); setView('floor'); setPicked(null); loadFloor();
  };

  const record = async () => {
    setErr('');
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); } catch { setErr('Mikrofon nicht verfügbar.'); return; }
    recRef.current = rec; setPhase('recording');
  };

  const sendTurn = async () => {
    const rec = recRef.current; if (!rec) return;
    recRef.current = null;
    let clip; try { clip = await rec.stop(); } catch { setErr('Aufnahme fehlgeschlagen.'); setPhase('yourturn'); return; }
    if (!clip?.blob || clip.blob.size < 1200) { setErr('Nichts aufgenommen — sprich bitte.'); setPhase('yourturn'); return; }
    setPhase('sending');
    const c = callRef.current;
    const r = await fetch(`${API_URL}/api/callfloor/session/${encodeURIComponent(c.sessionId)}/turn`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'audio/wav' }, body: clip.blob,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 422) { setErr('Nichts gehört — sprich bitte deutlich.'); setPhase('yourturn'); return; }
    if (!r.ok) { setErr('Verbindung gestört — versuch es nochmal.'); setPhase('yourturn'); return; }
    if (data.customer?.text) {
      setMood(data.mood); setPhase('customer');
      speak(data.customer.text, c.scenario.voice, () => { if (data.forceEnd) endCall(); else setPhase('yourturn'); });
    } else if (data.forceEnd) endCall();
  };

  const endCall = async () => {
    const c = callRef.current; if (!c) return;
    setView('verdict'); setVerdict({ pending: true });
    const { data } = await api(`/api/callfloor/session/${encodeURIComponent(c.sessionId)}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (data.freeTalk) { setVerdict({ pending: false, freeTalk: true, handleSeconds: data.handleSeconds, wordsSpoken: data.wordsSpoken }); return; }
    if (data.pending) pollResult(c.sessionId);
    else setVerdict({ pending: false, result: data.result, scoreDelta: data.scoreDelta });
  };

  const pollResult = async (id, tries = 0) => {
    if (tries > 20) { setVerdict({ pending: false, failed: true }); return; }
    const { data } = await api(`/api/callfloor/session/${encodeURIComponent(id)}/result`);
    if (data.pending) { setTimeout(() => pollResult(id, tries + 1), 3000); return; }
    setVerdict({ pending: false, result: data.result, scoreDelta: data.scoreDelta, failed: data.failed && !data.result });
  };

  const openProfile = async () => {
    setErr(''); const { data } = await api('/api/callfloor/profile');
    setProfile(data); setView('profile');
  };

  const shell = (children) => (
    <div dir="ltr" style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: 'var(--bg, #04070d)',
      color: 'var(--text)', padding: '20px 16px 48px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>{children}</div>
    </div>
  );

  if (gate === 'loading') return shell(<div style={{ opacity: 0.7, padding: 40, textAlign: 'center' }}>Lädt…</div>);
  if (gate === 'off') return shell(
    <div style={{ ...cardSurface, padding: 24, textAlign: 'center', marginTop: 60 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Der Anruf-Floor ist noch nicht freigeschaltet.</div>
      <a href="/" style={{ color: 'var(--accent, #3b82f6)' }}>Zurück zur App</a>
    </div>);
  if (gate === 'noauth') return shell(
    <div style={{ ...cardSurface, padding: 24, textAlign: 'center', marginTop: 60 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Bitte zuerst in der App anmelden und die E-Mail bestätigen.</div>
      <a href="/" style={{ color: 'var(--accent, #3b82f6)' }}>Zur App</a>
    </div>);

  // ── Shift report ────────────────────────────────────────────────────────────────────────────
  if (view === 'shiftReport') {
    const r = shiftReport || {};
    const Stat = ({ label, value }) => (
      <div style={{ ...cardSurface, padding: 14, flex: '1 1 45%', minWidth: 130 }}>
        <div style={{ opacity: 0.7, fontSize: 12.5 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      </div>);
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 14 }}>SCHICHT-REPORT{/* OWNER-AR slot */}</div>
      {r.empty ? <div style={{ ...cardSurface, padding: 20 }}>Kein abgeschlossener Anruf in dieser Schicht.</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Stat label="Anrufe bearbeitet" value={r.callsHandled} />
          <Stat label="Gelöst" value={r.resolvedPct == null ? '—' : `${r.resolvedPct}%`} />
          <Stat label="Ø Zufriedenheit" value={r.avgSatisfaction == null ? '—' : `${r.avgSatisfaction}/5`} />
          <Stat label="Ø Gesprächszeit" value={r.avgHandleSec == null ? '—' : mmss(r.avgHandleSec)} />
          <Stat label="Floor-Score" value={r.floorScore == null ? '—' : `${r.floorScore}/100`} />
          <Stat label="Gesamtzeit" value={mmss(r.totalTalkSec)} />
        </div>)}
      {r.bestCall && <div style={{ ...cardSurface, padding: 14, marginTop: 10 }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Bester Anruf:</span> {r.bestCall.title_de} · {r.bestCall.overall}/100</div>}
      {r.hardestCall && r.hardestCall.sessionId !== r.bestCall?.sessionId && <div style={{ ...cardSurface, padding: 14, marginTop: 8 }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Härtester Anruf:</span> {r.hardestCall.title_de} · {r.hardestCall.overall}/100</div>}
      <button style={{ ...actionBtn, width: '100%', marginTop: 16, minHeight: 48 }} onClick={() => { setView('floor'); setShiftReport(null); }}>ZURÜCK ZUM FLOOR</button>
    </>);
  }

  // ── Career profile ──────────────────────────────────────────────────────────────────────────
  if (view === 'profile') {
    const p = profile?.profile; const seats = p?.seats || [];
    const st = p?.rejectionStamina;
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 4 }}>DEIN KARRIERE-PROFIL{/* OWNER-AR slot */}</div>
      <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 14 }}>
        {profile?.totalCalls ? `Aus ${profile.totalCalls} Anrufen. ` : ''}
        {p?.bestSeat ? `Dein stärkster Platz: ${seats.find((s) => s.quadrant === p.bestSeat)?.label_de}.` : 'Mach ein paar Anrufe je Bereich, dann sag ich dir deinen Platz.'}
      </div>
      {seats.map((s) => (
        <div key={s.quadrant} style={{ ...cardSurface, padding: 14, marginBottom: 8,
          borderColor: s.quadrant === p?.bestSeat ? 'var(--accent, #3b82f6)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontWeight: 600 }}>{s.label_ar || s.label_de}</span>
            <span style={{ fontSize: 14, color: s.avgOverall == null ? '#7d93b8' : s.avgOverall >= 70 ? 'var(--accent, #3b82f6)' : s.avgOverall < 45 ? 'var(--bad)' : '#7d93b8' }}>
              {s.tested ? `${s.avgOverall}/100` : `${s.calls}/2 Anrufe`}</span>
          </div>
          <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
            {s.tested
              ? `${s.resolvedPct == null ? '' : `Gelöst ${s.resolvedPct}% · `}Stark: ${skillName(s.topSkill)} · Übung: ${skillName(s.weakSkill)}`
              : 'noch nicht bewertbar'}
          </div>
        </div>
      ))}
      {st?.measurable && <div style={{ ...cardSurface, padding: 14, marginTop: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Absage-Stärke (Outbound Sales){/* OWNER-AR slot */}</div>
        <div style={{ opacity: 0.75, fontSize: 13.5, marginTop: 4 }}>
          {STAMINA_DE[st.label] || st.label} — {st.score}/100. Nach einer Absage: {st.afterRejectionOverall} vs. Schnitt {st.baselineOverall}.
        </div></div>}
      <button style={{ ...actionBtn, width: '100%', marginTop: 16, minHeight: 48 }} onClick={() => { setView('floor'); setProfile(null); }}>ZURÜCK ZUM FLOOR</button>
    </>);
  }

  // ── Free-talk summary (not scored — errors are harvested silently) ────────────────────────────
  if (view === 'verdict' && verdict?.freeTalk) {
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 14 }}>GESPRÄCH BEENDET{/* OWNER-AR slot */}</div>
      <div style={{ ...cardSurface, padding: 18, marginBottom: 12 }}>
        <div style={{ fontSize: 15 }}>{mmss(verdict.handleSeconds)} Min gesprochen · {verdict.wordsSpoken} Wörter.</div>
        <div style={{ opacity: 0.75, fontSize: 14, marginTop: 6 }}>Deine Fehler werden im Hintergrund ausgewertet und fließen in deine Diagnose ein.</div>
      </div>
      <button style={{ ...actionBtn, width: '100%', marginTop: 8, minHeight: 48 }}
        onClick={() => { setCall(null); setVerdict(null); setView('floor'); loadFloor(); }}>ZURÜCK ZUM FLOOR</button>
    </>);
  }

  // ── Verdict ─────────────────────────────────────────────────────────────────────────────────
  if (view === 'verdict') {
    const r = verdict?.result;
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 14 }}>ANRUF BEENDET{/* OWNER-AR slot */}
        {shiftInfo ? <span style={{ fontSize: 13, opacity: 0.6, marginLeft: 8 }}>· Schicht {mmss(shiftBudgetLeft())} übrig</span> : null}</div>
      {verdict?.pending && <div style={{ ...cardSurface, padding: 20, textAlign: 'center' }}>Auswertung läuft…</div>}
      {!verdict?.pending && !r && <div style={{ ...cardSurface, padding: 20 }}>
        Die Auswertung ist gerade nicht verfügbar. Deine Fehler fließen trotzdem in deine Diagnose ein.</div>}
      {r && <>
        <ScoreDelta d={verdict.scoreDelta} />
        <div style={{ ...cardSurface, padding: 18, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <MoodFace mood={r.satisfactionFinal ?? mood} size={64} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>
              {r.resolved === true ? 'Anliegen gelöst' : r.resolved === false ? 'Anliegen nicht gelöst' : 'Ergebnis nicht bewertbar'}</div>
            <div style={{ opacity: 0.75, fontSize: 14, marginTop: 3 }}>
              {mmss(r.handleSeconds)} Min · Kundenstimmung am Ende: {(r.satisfactionFinal ?? '–')}/5</div>
            {typeof r.meta?.overall === 'number' && <div style={{ opacity: 0.75, fontSize: 14 }}>Gesamteindruck: {r.meta.overall}/100</div>}
          </div>
        </div>
        {r.meta?.summaryDe && <div style={{ ...cardSurface, padding: 16, marginBottom: 12, fontSize: 14.5, lineHeight: 1.5 }}>{r.meta.summaryDe}</div>}
        {(r.skills || []).map((s) => (
          <div key={s.key} style={{ ...cardSurface, padding: 14, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{skillName(s.key)}</span>
              <span style={{ color: s.score >= 4 ? 'var(--accent, #3b82f6)' : s.score <= 2 ? 'var(--bad)' : '#7d93b8' }}>{s.score}/5</span>
            </div>
            {s.why_de && <div style={{ opacity: 0.75, fontSize: 13.5, marginTop: 4 }}>{s.why_de}</div>}
            {s.quote && <div style={{ opacity: 0.6, fontSize: 13, marginTop: 4, fontStyle: 'italic' }}>„{s.quote}"</div>}
          </div>
        ))}
      </>}
      <button style={{ ...actionBtn, width: '100%', marginTop: 16, minHeight: 48 }} onClick={afterVerdict}>
        {shiftInfo ? (shiftBudgetLeft() > 20 ? 'NÄCHSTER ANRUF' : 'SCHICHT-REPORT ANSEHEN') : 'NÄCHSTER ANRUF'}
      </button>
      {shiftInfo && <button style={{ ...ghostBtn, width: '100%', marginTop: 10, minHeight: 44 }} onClick={endShift}>SCHICHT BEENDEN</button>}
    </>);
  }

  // ── Product fact sheet (reviewed before a sales call) ─────────────────────────────────────────
  if (view === 'call' && call && phase === 'factsheet' && product) {
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 4 }}>PRODUKT-INFOBLATT{/* OWNER-AR slot */}</div>
      <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 14 }}>Lies das kurz durch — im Anruf zählt, dass du die Fakten richtig nutzt.</div>
      <div style={{ ...cardSurface, padding: 18, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{product.name_ar || product.name_de}</div>
        <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 10 }}>{product.type_de}</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 14.5 }}>
          {(product.facts_de || []).map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </div>
      <button style={{ ...actionBtn, width: '100%', minHeight: 52 }} onClick={() => playOpening(callRef.current)}>
        {call.quadrant?.startsWith('outbound') ? 'ANRUFEN' : 'ANRUF ANNEHMEN'}
      </button>
    </>);
  }

  // ── Live call ───────────────────────────────────────────────────────────────────────────────
  if (view === 'call' && call) {
    return shell(<>
      <div style={{ ...screenTitle, marginBottom: 6 }}>{call.scenario.title_de}</div>
      <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 18 }}>{call.scenario.brief_de}
        {shiftInfo ? <span style={{ marginLeft: 6, opacity: 0.7 }}>· Schicht {mmss(shiftBudgetLeft())} übrig</span> : null}</div>
      <div style={{ ...cardSurface, padding: 22, textAlign: 'center', marginBottom: 16 }}>
        <MoodFace mood={mood} size={84} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{call.scenario.customerName}</div>
        <div style={{ opacity: 0.7, fontSize: 14, marginTop: 6, minHeight: 20 }}>
          {phase === 'customer' && 'spricht…'}{phase === 'yourturn' && 'wartet auf dich.'}
          {phase === 'recording' && 'hört zu — sprich jetzt.'}{phase === 'sending' && '…'}
        </div>
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 14, marginBottom: 10 }}>{err}</div>}
      {phase === 'yourturn' &&
        <button style={{ ...actionBtn, width: '100%', minHeight: 52, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }} onClick={record}>
          <MicIcon /> ANTWORTEN</button>}
      {phase === 'recording' && <button style={{ ...actionBtn, width: '100%', minHeight: 52 }} onClick={sendTurn}>FERTIG — SENDEN</button>}
      {(phase === 'customer' || phase === 'sending') && <button style={{ ...ghostBtn, width: '100%', minHeight: 48, opacity: 0.5 }} disabled>…</button>}
      <button style={{ ...ghostBtn, width: '100%', marginTop: 10, minHeight: 44 }} onClick={endCall}>AUFLEGEN</button>
    </>);
  }

  // ── The floor ───────────────────────────────────────────────────────────────────────────────
  const usedMin = Math.round((floor?.usedTodaySec || 0) / 60);
  const limitMin = Math.round((floor?.dailyLimitSec || 600) / 60);
  return shell(<>
    <div style={{ ...screenTitle, marginBottom: 4 }}>DER ANRUF-FLOOR{/* OWNER-AR slot */}</div>
    <div style={{ opacity: 0.75, fontSize: 14, marginBottom: 16 }}>
      Echte Anrufe, echte Kunden-Typen — dein Training für den Job. Heute: {usedMin}/{limitMin} Min.
    </div>

    <div style={{ fontWeight: 600, fontSize: 14, opacity: 0.85, margin: '4px 0 8px' }}>Schicht arbeiten{/* OWNER-AR slot */}</div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
      {(floor?.shiftOptions || [10, 20, 40]).map((m) => (
        <button key={m} style={{ ...ghostBtn, flex: 1, minHeight: 52 }} onClick={() => startShift(m)}>{m} Min</button>
      ))}
    </div>

    <div style={{ fontWeight: 600, fontSize: 14, opacity: 0.85, margin: '4px 0 8px' }}>Einzelanruf{/* OWNER-AR slot */}</div>
    {(floor?.quadrants || []).map((q) => (
      <button key={q.id} disabled={!q.unlocked}
        style={{ ...ghostBtn, width: '100%', textAlign: 'left', padding: 14, marginBottom: 8, minHeight: 56,
          opacity: q.unlocked ? 1 : 0.5, cursor: q.unlocked ? 'pointer' : 'not-allowed',
          borderColor: picked === q.id ? 'var(--accent, #3b82f6)' : undefined }}
        onClick={() => q.unlocked && setPicked(q.id)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600 }}>{q.label_ar || q.label_de}</span>
          {!q.unlocked && <span style={{ fontSize: 12, color: 'var(--accent, #3b82f6)' }}>ab {q.requiredPlan === 'elite' ? 'Elite' : 'Basic'}{/* OWNER-AR slot */}</span>}
        </div>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>{q.skill_de}</div>
      </button>
    ))}
    {err && <div style={{ color: 'var(--bad)', fontSize: 14, margin: '8px 0' }}>{err}</div>}
    <button style={{ ...actionBtn, width: '100%', marginTop: 10, minHeight: 52, opacity: picked ? 1 : 0.45 }}
      disabled={!picked} onClick={() => beginCall(picked)}>
      {picked?.startsWith('outbound') ? 'ANRUFEN' : 'ANRUF ANNEHMEN'}
    </button>
    {floor?.entitlement?.freeTalk && (
      <button style={{ ...ghostBtn, width: '100%', marginTop: 18, minHeight: 52 }} onClick={startFreeTalk}>
        <div style={{ fontWeight: 600 }}>Freies Gespräch{/* OWNER-AR slot */}</div>
        <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>Locker auf Deutsch reden — Fehler werden still ausgewertet.</div>
      </button>
    )}
    <button style={{ ...ghostBtn, width: '100%', marginTop: 10, minHeight: 44 }} onClick={openProfile}>MEIN KARRIERE-PROFIL</button>
    <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 18, color: '#7d93b8', fontSize: 14 }}>Zurück zur App</a>
  </>);
}
