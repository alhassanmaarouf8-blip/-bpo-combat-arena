import { useState, useEffect, useRef, useCallback, useReducer, Component } from 'react';
import { AudioRecorder } from './audioRecorder.js';
import { ClipRecorder } from './clipRecorder.js';
import PlacementPrompt from './PlacementPrompt.jsx';
import Zielplan from './Zielplan.jsx';
import DailyTraining from './DailyTraining.jsx';
import { HomeFeedback, FirstFightCard, AdminFeedback } from './Feedback.jsx';
import { Assessment } from './Assessment.jsx';
import { Shadowing } from './Shadowing.jsx';
import { FluencyDrill } from './FluencyDrill.jsx';
import { Listening } from './Listening.jsx';
import { SpokenReview } from './SpokenReview.jsx';
import { PressureLadder } from './PressureLadder.jsx';
import { BrainGuide } from './BrainGuide.jsx';
import { WeeklyBriefing } from './WeeklyBriefing.jsx';
import { InviteCard } from './InviteCard.jsx';
import { DailyMission } from './DailyMission.jsx';
import { Alhassan } from './Alhassan.jsx';
import { Trainingslager, GameMapCompact } from './Trainingslager.jsx';
import Trainingsnachweis from './Trainingsnachweis.jsx';

// Isolates an overlay so a crash inside it shows a readable message instead of blacking
// out the whole app (and survives Vite HMR glitches when a new module is added mid-session).
class OverlayBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[overlay] crashed:', error, info);
    try {
      fetch(`${API_URL}/api/clienterror`, { method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
        body: JSON.stringify({ title:'OverlayBoundary', detail: String(error?.stack || error) + '\n' + (info?.componentStack || '') }) }).catch(() => {});
    } catch { /* ignore */ }
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ position:'absolute', inset:0, zIndex:300, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:14, padding:24, textAlign:'center',
        background:'rgba(2,4,9,0.98)', color:'#fca5a5' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:14, color:'#f87171' }}>Etwas ist schiefgelaufen</div>
        <div style={{ fontSize:11, color:'#94a3b8', maxWidth:340, wordBreak:'break-word' }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <div style={{ fontSize:10, color:'#64748b' }}>Tipp: Seite neu laden (Strg+Shift+R).</div>
        <button onClick={this.props.onClose} style={{ fontFamily:'var(--font-display)', fontSize:11,
          padding:'10px 18px', borderRadius:8, cursor:'pointer', border:'1px solid var(--accent)',
          color:'var(--accent)', background:'rgba(59,130,246,0.06)' }}>SCHLIESSEN</button>
      </div>
    );
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const WS_URL = typeof __WS_URL__ !== 'undefined' ? __WS_URL__ : 'ws://localhost:3001';
// API base is injected separately (defaults to the live Render backend in production builds).
// Fall back to deriving it from the WebSocket URL if the define is ever missing.
const API_URL = typeof __API_URL__ !== 'undefined' ? __API_URL__ : WS_URL.replace(/^ws/, 'http');
// The live-brain guide (GET /api/brain) is built + wired but stays OFF until the owner authors the
// masri in BrainGuide.jsx (no fake Arabic ships to users). Flip to true to activate it on the home screen.
const BRAIN_GUIDE_LIVE = true;
// Referral: capture ?ref=<inviter id> from the invite link (persist so it survives navigation), read at signup.
function getRefCode() {
  try {
    const u = new URLSearchParams(window.location.search).get('ref');
    if (u) { localStorage.setItem('bpo_ref', u); return u; }
    return localStorage.getItem('bpo_ref') || undefined;
  } catch { return undefined; }
}

// Human-readable, bilingual text for server error codes (DE default + Arabic). Raw
// recorder/connection strings that aren't codes fall through to their own message.
const WS_ERROR_TEXT = {
  service_unavailable:  { de: 'Der Sprachdienst ist gerade nicht verfügbar. Bitte versuche es in ein paar Minuten erneut.', ar: 'خدمة المحادثة مش متاحة دلوقتي. من فضلك جرّب تاني بعد كام دقيقة.' },
  realtime_error:       { de: 'Verbindungsproblem mit dem Interviewer. Bitte starte den Kampf neu.', ar: 'في مشكلة في الاتصال بالمحاوِر. من فضلك ابدأ الجولة من جديد.' },
  fight_start_failed:   { de: 'Der Kampf konnte nicht gestartet werden. Bitte versuche es erneut.', ar: 'مقدرناش نبدأ الجولة. من فضلك جرّب تاني.' },
  fight_already_active: { de: 'Es läuft bereits ein Kampf.', ar: 'في جولة شغّالة بالفعل.' },
  auth_required:        { de: 'Bitte melde dich erneut an.', ar: 'من فضلك سجّل دخول تاني.' },
  mic_denied:           { de: 'Mikrofon-Zugriff wurde blockiert. Erlaube das Mikrofon in den Browser-Einstellungen (Schloss-Symbol neben der Adresse) und starte neu.', ar: 'الوصول للمايك متمنوع. اسمح للمايك من إعدادات المتصفح (علامة القُفل جنب العنوان) وابدأ من جديد.' },
  mic_not_found:        { de: 'Kein Mikrofon gefunden. Schließe ein Mikrofon an oder erlaube es und starte neu.', ar: 'مفيش مايك متوصّل. وصّل مايك أو اسمح بيه وابدأ من جديد.' },
  mic_lost:             { de: 'Verbindung zum Mikrofon verloren. Der Kampf wurde beendet — bitte starte neu.', ar: 'الاتصال بالمايك اتقطع. الجولة خلصت — من فضلك ابدأ من جديد.' },
  lessons_incomplete:   { de: 'Schließe zuerst deine Trainingslager-Stationen ab, um das Boss-Tor zu öffnen.', ar: 'خلّص محطات الـTrainingslager الأول عشان تفتح بوابة التحدي.' },
  plan_required:        { de: 'Dein Trainingsplan ist fertig — wähle einen Plan, um ihn freizuschalten.', ar: 'خطتك جاهزة — اختار خطة عشان تفتحها.' },
  daily_limit:          { de: 'Dein heutiges Training ist erledigt. Morgen wartet das nächste — heute: Drills & Lektionen.', ar: 'تمرين النهارده خلص. بكرة في جولة جديدة — النهارده: تمارين ودروس.' },
  ws_connect_failed:    { de: 'Keine Verbindung zum Server. Prüfe dein Internet und starte neu.', ar: 'مفيش اتصال بالسيرفر. اتأكد من النت وابدأ من جديد.' },
  connection_lost:      { de: 'Verbindung unterbrochen. Bitte starte den Kampf neu.', ar: 'الاتصال اتقطع. من فضلك ابدأ الجولة من جديد.' },
};
function wsErrorText(code, lang) {
  const e = WS_ERROR_TEXT[code];
  if (!e) return null;               // not a known code → caller shows the raw message
  return lang === 'ar' ? e.ar : e.de;
}

// ── Auth storage (token + cached account) ──────────────────────────────────────
function loadStoredAuth() {
  try {
    const token = localStorage.getItem('bpo_token');
    const acct  = localStorage.getItem('bpo_account');
    return token && acct ? { token, account: JSON.parse(acct) } : null;
  } catch { return null; }
}
function persistAuth(auth) {
  try {
    if (auth) { localStorage.setItem('bpo_token', auth.token); localStorage.setItem('bpo_account', JSON.stringify(auth.account)); }
    else      { localStorage.removeItem('bpo_token'); localStorage.removeItem('bpo_account'); }
  } catch { /* ignore */ }
}
function authErrText(code) {
  return ({
    invalid_email:       { de: 'Ungültige E-Mail-Adresse.',            ar: 'الإيميل مش صح.' },
    weak_password:       { de: 'Passwort muss mind. 6 Zeichen haben.', ar: 'الباسورد لازم ٦ حروف على الأقل.' },
    email_taken:         { de: 'Diese E-Mail ist bereits registriert.', ar: 'الإيميل ده متسجّل قبل كده — سجّل دخول.' },
    invalid_credentials: { de: 'E-Mail oder Passwort ist falsch.',     ar: 'الإيميل أو الباسورد غلط.' },
    too_many_attempts:   { de: 'Zu viele Versuche. Bitte warte ein paar Minuten.', ar: 'محاولات كتير. استنى كام دقيقة وجرّب تاني.' },
  })[code] || { de: 'Etwas ist schiefgelaufen.', ar: 'حصل خطأ. جرّب تاني.' };
}

// ── Server message types ──────────────────────────────────────────────────────
const S = {
  SESSION_READY:      'session_ready',
  SESSION_CLOSED:     'session_closed',
  AUDIO_DELTA:        'audio_delta',
  TRANSCRIPT_DELTA:   'transcript_delta',
  TRANSCRIPT_DONE:    'transcript_done',
  TRANSCRIPT_PARTIAL: 'transcript_partial',   // Deepgram streaming interim result
  BOSS_SPEECH:        'boss_speech',
  BOSS_SPEECH_DONE:   'boss_speech_done',
  SCENARIO_INFO:      'scenario_info',
  STAGE_UPDATE:       'stage_update',
  DEBRIEF_PENDING:    'debrief_pending',
  DEBRIEF:            'debrief',
  NO_SESSION:         'no_session',
  PAYWALL:            'paywall',
  HP_UPDATE:          'hp_update',
  LIVE_STATS:         'live_stats',
  ERROR:              'error',
  PONG:               'pong',
};

// ── Client message types ──────────────────────────────────────────────────────
const C = {
  START_FIGHT:  'start_fight',
  STOP_FIGHT:   'stop_fight',
  // Turn-based: one complete answer per turn. TEXT path: typed or REST-transcribed.
  // STREAMING path: AUDIO_CHUNK + AUDIO_END → server-side Deepgram LiveTranscription.
  ANSWER:       'answer',
  AUDIO_CHUNK:  'audio_chunk',   // b64 linear16 PCM chunk (hands-free streaming)
  AUDIO_END:    'audio_end',     // VAD silence — finalize the Deepgram stream
  PING:         'ping',
};

// ── Semantic end-of-turn classification (research-backed: LiveKit/Deepgram/OpenAI model) ──
// We never end a German turn on a fixed timer. The latest live transcript is inspected for
// continuation cues — a trailing conjunction / preposition / article / filler means the
// speaker is MID-THOUGHT, so we wait much longer before yielding the floor. A trailing
// sentence punctuation or a short complete formula ("Gerne.") means we may take the turn
// sooner. Combined with cancel-on-resume (silence resets the instant the user speaks again),
// this is what stops the boss cutting in during a thinking pause between sentences.
const _CONT_CUES = new Set([
  // coordinating + subordinating conjunctions (a clause must still follow → incomplete)
  'und','oder','aber','sondern','denn','sowie','weil','dass','ob','wenn','als','während',
  'obwohl','damit','indem','nachdem','bevor','bis','seit','seitdem','sobald','solange',
  'sodass','sofern','falls','da','ehe','wie','wodurch','womit',
  // relative / interrogative pronouns mid-utterance
  'der','die','das','dem','den','dessen','deren','welcher','welche','welches','wer','wen',
  'wem','was','wo','wohin','woher','warum','weshalb','wieso','wann',
  // prepositions (a noun phrase must follow)
  'in','an','auf','unter','über','vor','hinter','neben','zwischen','mit','nach','bei',
  'von','zu','aus','durch','für','gegen','ohne','um','trotz','wegen','statt',
  // articles / possessives / determiners (a noun must follow)
  'ein','eine','einen','einem','einer','eines','des','mein','meine','meinen','meinem',
  'sein','seine','ihr','ihre','unser','kein','keine','dieser','diese','dieses','jeder',
  // list / continuation adverbs + thinking fillers
  'also','zwar','einerseits','andererseits','nämlich','ähm','äh','öhm','hm','hmm','mh',
  'naja','halt','quasi','sozusagen','irgendwie',
]);
const _SHORT_VALID = new Set([
  'ja','nein','doch','gerne','danke','genau','richtig','okay','ok','klar','natürlich',
  'vielleicht','sicher','absolut','stimmt','korrekt','jein','nö','joa','perfekt',
]);
function classifyTurnDE(partial) {
  const raw = String(partial || '').trim();
  if (!raw) return 'ambiguous';
  const noPunct = raw.toLowerCase().replace(/[.,!?;:"'»«…\-]+$/u, '').trim();
  if (_SHORT_VALID.has(noPunct)) return 'complete';            // a short, valid one-word answer
  if (/[.!?]["'»«]?\s*$/.test(raw)) return 'complete';         // finished sentence (Deepgram punctuate)
  const toks = noPunct.split(/\s+/);
  const last = toks[toks.length - 1] || '';
  if (_CONT_CUES.has(last)) return 'incomplete';               // trailing cue → still mid-thought
  return 'ambiguous';
}

// ── Boss voice: ElevenLabs Flash v2.5 (neural, streamed) → Deepgram neural fallback ──
// PRIMARY: ElevenLabs Flash v2.5, streamed server-side and played progressively via a
// GET <audio> source (sound starts before the full clip is ready). FALLBACK: the existing
// Deepgram Aura neural voice. The robotic browser Web Speech API has been REMOVED — on a
// total failure the line is shown on screen with no audio, but never the robotic voice.
let _bossAudio = null;
let _streamSeq = 0;   // bumped to cancel an in-flight streamed (multi-sentence) boss line
function stopBossVoice() {
  _streamSeq++;        // cancel any sentence-stream in progress
  // Null handlers BEFORE clearing src. Clearing src causes the browser to fire onerror/onemptied
  // on the element; if handlers are still attached they call onEnd() → setBossSpeak(false) on
  // the OLD audio, which races with a newly-started audio and clears bossSpeak prematurely.
  try {
    if (_bossAudio) {
      const a = _bossAudio;
      _bossAudio = null;
      a.onplay = null; a.onended = null; a.onerror = null; a.onstalled = null; a.onwaiting = null;
      a.pause(); a.src = '';
    }
  } catch {}
}

// Fetch ONE clip's audio (POST → normalized WAV blob) and return an object URL. Throws on failure.
// [LAT] real client timing → POSTed to the server so /api/diag/latency shows the FULL split
// (vad wait + tts) with the client build id (catches stale cache as "zero improvement").
let _latTtsStart = 0, _latAudioEndAt = 0, _latVadWait = 0;
function reportClientLat(apiUrl) {
  try {
    const now = Date.now();
    const ttsMs = _latTtsStart ? now - _latTtsStart : 0;
    const fullMs = _latAudioEndAt ? _latVadWait + (now - _latAudioEndAt) : 0;
    const build = (typeof document !== 'undefined' && document.querySelector('meta[name=build]')?.content) || 'dev';
    fetch(`${apiUrl}/api/diag/clientlat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vadWaitMs: _latVadWait, ttsMs, fullMs, build }) }).catch(() => {});
    _latTtsStart = 0;
  } catch {}
}

async function fetchTtsUrl(apiUrl, token, voice, text) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${apiUrl}/api/tts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ text, voice }),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error('tts ' + res.status);
    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error('empty audio');
    return URL.createObjectURL(blob);
  } finally { clearTimeout(tid); }
}

// Play ONE already-fetched clip. onEnd fires EXACTLY ONCE (watchdog + backstop) so a hung clip can
// never leave the boss stuck silent — the same guarantee the single-shot path had.
function playClipFromUrl(url, onStart, onEnd) {
  let ended = false;
  const done = () => { if (ended) return; ended = true; try { onEnd?.(); } catch {} };
  try {
    const audio = new Audio(url);
    audio.volume = 1.0;
    _bossAudio = audio;
    let wd = null;
    const cleanup = () => { if (wd) { clearInterval(wd); wd = null; } try { URL.revokeObjectURL(url); } catch {} if (_bossAudio === audio) _bossAudio = null; };
    audio.onplay = () => {
      try { onStart?.(); } catch {}
      let last = -1, stuck = 0;
      wd = setInterval(() => {
        if (ended) { clearInterval(wd); wd = null; return; }
        const ct = audio.currentTime;
        if (ct === last) { if (++stuck >= 4) { try { audio.pause(); } catch {} cleanup(); done(); } }
        else { stuck = 0; last = ct; }
      }, 1500);
    };
    audio.onended = () => { cleanup(); done(); };
    audio.onerror = () => { cleanup(); done(); };
    setTimeout(() => { if (!ended) { try { audio.pause(); } catch {} cleanup(); done(); } }, 45000);
    audio.play().catch(() => { cleanup(); done(); });
  } catch { done(); }
}

// Deepgram Aura neural (POST → WAV blob). Single-clip path (ElevenLabs fallback + 1-sentence lines).
async function playDeepgramVoice({ apiUrl, token, voice, text, onStart, onEnd }) {
  try { playClipFromUrl(await fetchTtsUrl(apiUrl, token, voice, text), onStart, onEnd); }
  catch { onEnd?.(); }
}

// Split a German line into sentences, merging very short fragments so we never TTS a 2-word scrap.
function splitSentencesDE(text) {
  // Split on CLAUSE boundaries (commas/colons/semicolons too, not just sentence enders) so the FIRST
  // playable clip is short → synthesizes + starts in ~0.2-0.3s instead of waiting for the whole line.
  const raw = (String(text).match(/[^.!?…;:,]+[.!?…;:,]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of raw) { if (out.length && out[out.length - 1].length < 10) out[out.length - 1] += ' ' + p; else out.push(p); }
  return out.length ? out : [String(text)];
}

// STREAMED boss voice: speak sentence 1 the instant its (short) clip is ready, PREFETCHING the next
// sentence while the current plays → boss starts talking ~1s sooner with no mid-line gaps. onEnd fires
// once after the LAST sentence; a newer line (stopBossVoice bumps _streamSeq) cancels silently so it
// never clears bossSpeak out from under the new line.
async function speakBossStreamed({ apiUrl, token, voice, text, onStart, onEnd }) {
  const sentences = splitSentencesDE(text);
  if (sentences.length <= 1) return playDeepgramVoice({ apiUrl, token, voice, text, onStart, onEnd });
  const myseq = _streamSeq;   // set by the stopBossVoice() the caller just ran
  let started = false;
  try {
    let url = await fetchTtsUrl(apiUrl, token, voice, sentences[0]);
    for (let i = 0; i < sentences.length; i++) {
      if (myseq !== _streamSeq) return;                       // cancelled by a newer line → silent
      const cur = url;
      const prefetch = (i + 1 < sentences.length) ? fetchTtsUrl(apiUrl, token, voice, sentences[i + 1]).catch(() => null) : Promise.resolve(null);
      await new Promise((resolve) => playClipFromUrl(cur, () => { if (!started) { started = true; try { onStart?.(); } catch {} } }, resolve));
      if (myseq !== _streamSeq) return;                       // cancelled mid-line → silent
      url = await prefetch;
      if (!url && i + 1 < sentences.length) break;            // prefetch failed → stop cleanly
    }
  } catch { /* fall through to onEnd so bossSpeak always clears on a real error */ }
  if (myseq === _streamSeq) { try { onEnd?.(); } catch {} }
}

// Play a STREAMING audio URL via a progressive <audio> element: sound starts the instant the first
// bytes arrive (~350ms) instead of waiting for the whole clip. Returns true if it FELL BACK (the
// stream failed before any playback began) so the caller can try a buffered path; false once it has
// taken ownership of playback (onStart/onEnd will fire). Used for BOTH boss voices — ElevenLabs and
// the free Deepgram Aura-2 mp3 stream — since the machinery (stall watchdog, single-fire end) is
// voice-agnostic.
function playProgressiveAudio(url, onStart, onEnd) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    _bossAudio = audio;
    let started = false, resolved = false, stallInterval = null;
    const finish = (fallback) => {
      if (resolved) return;
      resolved = true;
      if (stallInterval) { clearInterval(stallInterval); stallInterval = null; }
      clearTimeout(guard);
      resolve(fallback);
    };
    // 40s hard cap: final backstop for cases where neither onended nor onerror fires.
    // onstalled/onwaiting NOT used — they fire during normal initial buffering (false positive).
    // A currentTime-based stall detector (started in onplay) catches mid-play stream hangs
    // without triggering during the normal buffering phase before playback begins.
    const guard = setTimeout(() => { if (started) { try { onEnd?.(); } catch {} } finish(false); }, 40000);
    audio.onplay = () => {
      started = true;
      try { onStart?.(); } catch {}
      // Detect a stream stall: if currentTime stops advancing for 6s after playback began, the
      // server-side stream hung. Catches mid-play hangs without false-firing during initial buffering.
      let lastTime = -1, stuckCount = 0;
      stallInterval = setInterval(() => {
        if (resolved) { clearInterval(stallInterval); stallInterval = null; return; }
        const ct = audio.currentTime;
        if (ct === lastTime) {
          stuckCount++;
          if (stuckCount >= 4) { // 4 × 1.5s = 6s frozen → stall confirmed
            if (_bossAudio === audio) _bossAudio = null;
            try { onEnd?.(); } catch {}
            finish(false);
          }
        } else { stuckCount = 0; lastTime = ct; }
      }, 1500);
    };
    audio.onended = () => { if (_bossAudio === audio) _bossAudio = null; try { onEnd?.(); } catch {} finish(false); };
    audio.onerror = () => {
      if (_bossAudio === audio) _bossAudio = null;
      if (started) { try { onEnd?.(); } catch {} finish(false); }
      else finish(true);
    };
    audio.play().catch(() => { if (!started) { if (_bossAudio === audio) _bossAudio = null; finish(true); } });
  });
}

async function playBossVoice({ apiUrl, token, voice, elevenVoice, text, onStart, onEnd }) {
  if (!text) { onEnd?.(); return; }
  stopBossVoice();
  const enc = encodeURIComponent;
  // PRIMARY: a STREAMING GET <audio> source — sound starts ~350ms in, killing the ~6s dead air the
  // buffered (whole-clip) path had. ElevenLabs if opted in (paid), else the free Deepgram Aura-2 stream.
  const streamUrl = elevenVoice
    ? `${apiUrl}/api/voice?voice=${enc(elevenVoice)}&token=${enc(token)}&text=${enc(text)}`
    : `${apiUrl}/api/tts-stream?voice=${enc(voice)}&token=${enc(token)}&text=${enc(text)}`;
  const fellBack = await playProgressiveAudio(streamUrl, onStart, onEnd);
  if (!fellBack) return;
  // FALLBACK (stream unavailable): buffered, clause-split Deepgram clips (never the robotic browser voice).
  stopBossVoice();   // bump _streamSeq so the fallback owns the stream (speakBossStreamed contract)
  await speakBossStreamed({ apiUrl, token, voice, text, onStart, onEnd });
}

// ── Boss emotional states → drives the SVG interviewer's expression ───────────
const EMOTIONS = {
  // Pre-fight default + the FOUR backend-driven reaction states. Each carries the SVG
  // face, the German status label, and the accent colour the whole boss card shifts to.
  idle:        { face: 'composed',  label: 'GEFASST',     color: 'var(--accent-2)' }, // before the fight
  gefasst:     { face: 'composed',  label: 'GEFASST',     color: 'var(--accent-2)' }, // composed authority
  skeptisch:   { face: 'skeptical', label: 'SKEPTISCH',   color: 'var(--action)' }, // mild doubt — weak answer
  beeindruckt: { face: 'impressed', label: 'BEEINDRUCKT', color: 'var(--accent)' }, // grudging respect
  wuetend:     { face: 'furious',   label: 'WÜTEND',      color: '#ef4444' }, // cornered / candidate fails
  hurt:        { face: 'shaken',    label: 'GETROFFEN',   color: 'var(--action)' }, // rattled (transient)
};

// Per-expression facial parameters (driven into the SVG below).
const FACE_PARAMS = {
  composed:  { browTilt:  6, browLift:  0, eyeOpen: 1.0,  mouthCurve: -0.10, mouthOpen: 0.00 },
  skeptical: { browTilt: 13, browLift: -5, eyeOpen: 0.80, mouthCurve: -0.16, mouthOpen: 0.05, smirk: true },
  smug:      { browTilt:  3, browLift: -3, eyeOpen: 0.85, mouthCurve:  0.34, mouthOpen: 0.04, smirk: true },
  impressed: { browTilt: -9, browLift: -9, eyeOpen: 1.18, mouthCurve:  0.14, mouthOpen: 0.20 },
  furious:   { browTilt: 20, browLift:  2, eyeOpen: 0.62, mouthCurve: -0.42, mouthOpen: 0.55 },
  shaken:    { browTilt:-12, browLift:-10, eyeOpen: 1.25, mouthCurve: -0.05, mouthOpen: 0.55 },
};

// Per-emotion posture — a subtle whole-body transform so the mood reads in his stance,
// not just the badge. (Composed = neutral, skeptical = head-tilt, impressed = sits back,
// furious = looms forward.)
const POSTURE = {
  idle:        '',
  gefasst:     '',
  skeptisch:   'rotate(-1.6deg)',
  beeindruckt: 'translateY(-4px) scale(0.99)',
  wuetend:     'translateY(5px) scale(1.04)',
  hurt:        'translateY(2px) rotate(1deg)',
};

// ── Styles ────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  /* Direction A = calm/premium/trust. ONE clean type family (Inter — full ä ö ü ß + good Latin),
     no gaming display face. Share Tech Mono kept only for any monospace numerics. */
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Share+Tech+Mono&display=swap');

  /* ── OMNI-PERFORM design tokens ─────────────────────────────────────────────
     Single source of truth for colour, type, spacing, radius, motion, depth.
     Everything in the redesign references these — never hard-coded hexes. */
  :root {
    /* ── Direction A: calm, premium, trustworthy. TWO brand colours ONLY —
       BLUE = trust / primary / structure, ORANGE = the single action accent (use sparingly).
       Neutrals carry everything else. No neon, no rainbow. Intensity lives only in the fight
       (player = blue, boss = orange — the brand pair, not green/red). */
    /* surfaces / depth — calm deep navy, not neon black */
    --bg-0:#0a0f1a; --bg-1:#0f1626; --bg-2:#172033;
    --surface:rgba(255,255,255,0.04); --surface-2:rgba(255,255,255,0.07);
    --line:rgba(255,255,255,0.09); --line-strong:rgba(255,255,255,0.18);
    /* accents — blue primary, orange action */
    --accent:#3b82f6; --accent-2:#60a5fa; --accent-dim:rgba(59,130,246,0.45);
    --action:#f97316; --action-2:#fb923c; --action-dim:rgba(249,115,22,0.45);
    --player:#3b82f6; --player-2:#60a5fa; --player-glow:rgba(59,130,246,0.40);
    --boss:#f97316; --boss-2:#fb923c; --boss-glow:rgba(249,115,22,0.40);
    --warn:#f97316; --good:#3b82f6; --bad:#f87171; --violet:#3b82f6;
    /* text */
    --text:#e8eef6; --text-dim:#9aa7bd; --text-faint:#64748b;
    /* type — one clean family, no gaming face */
    --font-display:'Inter','system-ui',sans-serif;
    --font-body:'Inter',system-ui,sans-serif;
    --font-mono:'Share Tech Mono',monospace;
    /* radius / spacing */
    --r-sm:6px; --r-md:10px; --r-lg:16px; --r-pill:999px;
    --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
    /* motion */
    --dur-fast:150ms; --dur:240ms; --dur-slow:320ms;
    --ease:cubic-bezier(.4,0,.2,1);
    --ease-out:cubic-bezier(.23,1,.32,1);
    --ease-spring:cubic-bezier(.34,1.56,.64,1);
    /* depth primitives */
    --glow-accent:0 0 0 1px rgba(59,130,246,0.18);
    --glow-player:0 0 16px var(--player-glow);
    --glow-boss:0 0 16px var(--boss-glow);
    --shadow-card:0 12px 38px rgba(0,0,0,0.55), inset 0 0 60px rgba(0,0,0,0.45);
    --vignette:radial-gradient(120% 100% at 50% 32%, transparent 48%, rgba(0,0,0,0.55) 100%);
  }

  /* Respect the OS "reduce motion" setting — all juice becomes instant. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration:0.001ms !important; animation-iteration-count:1 !important;
      transition-duration:0.001ms !important; scroll-behavior:auto !important;
    }
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root {
    min-height: 100svh;            /* grow with content — do NOT lock to 100% (clips the start button) */
    background:
      radial-gradient(140% 100% at 50% -10%, #0a1422 0%, transparent 55%),
      var(--bg-0);
    color: var(--text);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    overflow-y: auto;
  }
  body::before {
    content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px);
  }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.25); border-radius: 2px; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 60%{transform:translateX(7px)} }
  @keyframes boss-hurt { 0%,100%{transform:scale(1)} 30%{transform:scale(1.14) rotate(-3deg)} 70%{transform:scale(0.93)} }
  @keyframes flash-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  @keyframes dmg-float { 0%{opacity:0;transform:translate(-50%,4px) scale(0.6)} 18%{opacity:1} 100%{opacity:0;transform:translate(-50%,-52px) scale(1.3)} }
  @keyframes hp-reason { 0%{opacity:0;transform:translateY(6px)} 12%{opacity:1} 80%{opacity:1} 100%{opacity:0;transform:translateY(-10px)} }
  @keyframes hp-low { 0%,100%{opacity:1} 50%{opacity:0.45} }
  @keyframes hp-sheen { 0%{transform:translateX(-120%)} 100%{transform:translateX(320%)} }
  @keyframes orb-ring { 0%{transform:scale(0.85);opacity:0.55} 100%{transform:scale(1.7);opacity:0} }
  .hp-low-pulse { animation: hp-low 1.1s ease-in-out infinite; }
  @keyframes tick-pop { 0%{transform:scale(1)} 35%{transform:scale(1.55)} 100%{transform:scale(1)} }
  @keyframes combo-in { 0%{transform:scale(0.4);opacity:0} 60%{transform:scale(1.18)} 100%{transform:scale(1);opacity:1} }
  @keyframes combo-glow { 0%,100%{opacity:0.5} 50%{opacity:1} }
  @keyframes node-pop { 0%{transform:scale(1)} 50%{transform:scale(1.32)} 100%{transform:scale(1)} }
  @keyframes round-pop { 0%{opacity:0;transform:translate(-50%,-50%) scale(0.8)} 14%{opacity:1;transform:translate(-50%,-50%) scale(1.05)} 78%{opacity:1;transform:translate(-50%,-50%) scale(1)} 100%{opacity:0;transform:translate(-50%,-50%) scale(1.03)} }
  @keyframes rank-pop { 0%{opacity:0;transform:scale(0.3) rotate(-8deg)} 55%{opacity:1;transform:scale(1.16) rotate(2deg)} 100%{opacity:1;transform:scale(1) rotate(0)} }
  @keyframes result-rise { 0%{opacity:0;transform:translateY(14px)} 100%{opacity:1;transform:translateY(0)} }
  @keyframes spin { to { transform: rotate(360deg) } }
  .spin { animation: spin 0.9s linear infinite; }
  @keyframes scan { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
  .scanline { position:fixed;top:0;left:0;width:100%;height:3px;background:rgba(0,255,200,0.04);animation:scan 5s linear infinite;pointer-events:none;z-index:9998; }
  .shake  { animation: shake 0.4s ease; }
  .hurt   { animation: boss-hurt 0.55s ease; }
  .flash  { animation: flash-in 0.2s ease; }
  @keyframes boss-blink { 0%,93%,100%{transform:scaleY(1)} 96%{transform:scaleY(0.08)} }
  .boss-blink { animation: boss-blink 5.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes boss-sway { 0%,100%{transform:translateX(0) rotate(0deg)} 50%{transform:translateX(-2px) rotate(-0.6deg)} }
  @keyframes boss-talk { 0%,100%{transform:scaleY(0.5)} 50%{transform:scaleY(1)} }
  .boss-talk { animation: boss-talk 0.22s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-3px) scale(1.012)} }
  .breathe { animation: breathe 4.5s ease-in-out infinite; }
  @keyframes portrait-glow { 0%,100%{opacity:0.55} 50%{opacity:0.9} }
  @keyframes grid-drift { from{background-position:0 0} to{background-position:0 56px} }
  @keyframes vignette-pulse { 0%,100%{opacity:0.85} 50%{opacity:1} }
`;

// ── Component: BossAvatar (designed SVG interviewer that emotes) ───────────────
function _eyePath(cx, cy, open) {
  const ry = 9 * open;
  return `M ${cx-15} ${cy} Q ${cx} ${cy-ry} ${cx+15} ${cy} Q ${cx} ${cy+ry} ${cx-15} ${cy} Z`;
}
function _mouthPath(cx, cy, curve, open) {
  const w = 22, mid = cy + curve * 26, h = open * 22;
  return `M ${cx-w} ${cy} Q ${cx} ${mid} ${cx+w} ${cy} Q ${cx} ${mid + h} ${cx-w} ${cy} Z`;
}

function BossAvatar({ emotion = 'composed', speaking = false, color = 'var(--accent-2)' }) {
  const p = FACE_PARAMS[emotion] || FACE_PARAMS.composed;
  const eyeCY = 102, browY = 80 + p.browLift, mouthCY = 150;

  return (
    <svg viewBox="0 0 220 244" style={{ width:'100%', height:'100%', display:'block', overflow:'visible' }}>
      <defs>
        <radialGradient id="ba-spot" cx="50%" cy="34%" r="64%">
          <stop offset="0%"  stopColor={color} stopOpacity="0.30" />
          <stop offset="55%" stopColor={color} stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ba-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c49a6c" /><stop offset="55%" stopColor="#9b6f42" /><stop offset="100%" stopColor="#7a5030" />
        </linearGradient>
        <linearGradient id="ba-hair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#120808" /><stop offset="100%" stopColor="#060202" />
        </linearGradient>
        <linearGradient id="ba-suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1218" /><stop offset="100%" stopColor="#040609" />
        </linearGradient>
        <filter id="ba-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>

      <rect x="0" y="0" width="220" height="244" fill="url(#ba-spot)" />

      {/* suit + shirt + tie */}
      <path d="M 28 244 Q 28 196 70 183 L 150 183 Q 192 196 192 244 Z" fill="url(#ba-suit)" stroke={color} strokeOpacity="0.28" strokeWidth="1.5" />
      <path d="M 92 183 L 110 210 L 128 183 Z" fill="#0b1119" />
      <path d="M 92 183 L 110 206 M 128 183 L 110 206" stroke={color} strokeOpacity="0.55" strokeWidth="2" fill="none" />
      <path d="M 104 187 L 116 187 L 120 232 L 110 244 L 100 232 Z" fill={color} fillOpacity="0.5" />

      {/* neck + head */}
      <rect x="96" y="156" width="28" height="34" rx="11" fill="url(#ba-skin)" />
      <ellipse cx="110" cy="108" rx="60" ry="70" fill="url(#ba-skin)" />
      <ellipse cx="110" cy="108" rx="60" ry="70" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" filter="url(#ba-soft)" />
      <ellipse cx="110" cy="150" rx="40" ry="24" fill="#10161f" opacity="0.45" />

      {/* hair */}
      <path d="M 50 98 Q 46 36 110 34 Q 174 36 170 98 Q 150 68 110 68 Q 70 68 50 98 Z" fill="url(#ba-hair)" />
      <path d="M 50 98 Q 46 36 110 34 Q 174 36 170 98" fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />

      {/* ears + call-center headset (themed) */}
      <circle cx="48" cy="114" r="12" fill="url(#ba-skin)" />
      <circle cx="172" cy="114" r="12" fill="url(#ba-skin)" />
      <path d="M 40 112 Q 40 42 110 40 Q 180 42 180 112" fill="none" stroke="#1a2430" strokeWidth="7" strokeLinecap="round" />
      <path d="M 40 112 Q 40 42 110 40 Q 180 42 180 112" fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="2" />
      <rect x="33" y="105" width="16" height="22" rx="6" fill="#0c131c" stroke={color} strokeWidth="1.5" />
      <circle cx="41" cy="116" r="2.6" fill={color}>
        <animate attributeName="opacity" values="1;0.25;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <path d="M 35 124 Q 28 152 64 158" fill="none" stroke="#1a2430" strokeWidth="4" strokeLinecap="round" />
      <circle cx="64" cy="158" r="4.5" fill={color} fillOpacity="0.7" />

      {/* brows */}
      <g fill={color}>
        <rect x="73"  y={browY-4} width="34" height="9" rx="4" transform={`rotate(${p.browTilt} 90 ${browY})`} />
        <rect x="113" y={browY-4} width="34" height="9" rx="4" transform={`rotate(${-p.browTilt} 130 ${browY})`} />
      </g>

      {/* eyes — wrapped so they blink occasionally */}
      <g className="boss-blink">
        <path d={_eyePath(90, eyeCY, p.eyeOpen)}  fill="#e6edf5" />
        <path d={_eyePath(130, eyeCY, p.eyeOpen)} fill="#e6edf5" />
        <circle cx="90"  cy={eyeCY} r="5" fill="#1a0c05" />
        <circle cx="130" cy={eyeCY} r="5" fill="#1a0c05" />
        <circle cx="88.5"  cy={eyeCY-1.5} r="1.5" fill={color} />
        <circle cx="128.5" cy={eyeCY-1.5} r="1.5" fill={color} />
      </g>

      {/* nose */}
      <path d="M 110 110 L 103 133 Q 110 138 117 133 Z" fill="#10161f" opacity="0.65" />
      <ellipse cx="110" cy="163" rx="13" ry="4" fill="#0a0605" opacity="0.35" />

      {/* mouth (lip-syncs while the boss speaks) */}
      <g className={speaking ? 'boss-talk' : ''}>
        <path d={_mouthPath(110, mouthCY, p.mouthCurve, p.mouthOpen)} fill="#0a0f16" stroke={color} strokeOpacity="0.55" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

// ── Component: HpBar ──────────────────────────────────────────────────────────
// Smoothly tweens a displayed integer toward `target` with rAF (cubic ease-out).
// Only this small component re-renders during the ~0.55s count; nothing else.
function useAnimatedNumber(target, dur = 550) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef  = useRef(0);
  useEffect(() => {
    const from  = fromRef.current;
    const delta = target - from;
    if (delta === 0) { setVal(target); return undefined; }
    let start = 0;
    const step = (t) => {
      if (!start) start = t;
      const p     = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + delta * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else { fromRef.current = target; setVal(target); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, dur]);
  return Math.round(val);
}

function HpBar({ label, value, isPlayer, reason }) {
  const pct   = Math.max(0, Math.min(100, value));
  const shown = useAnimatedNumber(pct);
  const low   = pct <= 25;
  // Palette tracks the design tokens; solid hexes kept where glow math needs string concat.
  const solid = isPlayer
    ? (pct > 50 ? 'var(--accent)' : pct > 25 ? 'var(--action)' : '#ef4444')
    : (pct > 50 ? '#ef4444' : pct > 25 ? '#f97316' : '#dc2626');
  const glow   = solid + '66';
  const rColor = isPlayer ? '#f87171' : 'var(--accent)';   // player loss = red, gain = green
  const rSign  = isPlayer ? '−' : '+';

  return (
    <div style={{ marginBottom: 'var(--sp-2)', position:'relative' }}>
      {reason && (
        <div key={reason.id} style={{ position:'absolute', right:0, top:-15, zIndex:6, pointerEvents:'none',
          fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, color:rColor,
          textShadow:`0 0 8px ${rColor}99`, whiteSpace:'nowrap',
          animation:'hp-reason 2s var(--ease-out) forwards' }}>
          {rSign}{reason.amount} {reason.label}
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
        <span style={{ fontFamily:'var(--font-display)', fontSize:11, fontWeight:600, letterSpacing:'0.16em',
          color:solid, textShadow:`0 0 9px ${glow}` }}>
          {label}
        </span>
        <span style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:700, color:solid,
          textShadow:`0 0 8px ${glow}`, fontVariantNumeric:'tabular-nums' }}>
          {shown}<span style={{ opacity:0.45, fontSize:10 }}> / 100</span>
        </span>
      </div>
      {/* weighty track */}
      <div className={low ? 'hp-low-pulse' : ''} style={{ height:15, borderRadius:'var(--r-sm)',
        background:'linear-gradient(180deg, rgba(0,0,0,0.5), rgba(255,255,255,0.03))',
        border:`1px solid ${glow}`, overflow:'hidden', position:'relative',
        boxShadow:`inset 0 2px 6px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)` }}>
        {/* fill — spring-eased width */}
        <div style={{ position:'absolute', inset:0, width:`${pct}%`, borderRadius:'inherit',
          background:`linear-gradient(90deg, ${solid}99, ${solid})`,
          boxShadow:`0 0 12px ${glow}, inset 0 1px 0 rgba(255,255,255,0.35)`,
          transition:'width 0.55s var(--ease-spring), background 0.4s var(--ease)' }}>
          {/* moving sheen on the fill */}
          <div style={{ position:'absolute', top:0, bottom:0, width:'30%',
            background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
            filter:'blur(2px)', animation:'hp-sheen 2.6s var(--ease) infinite' }} />
        </div>
        {/* segment ticks for that weighty, gauge-like read */}
        <div style={{ position:'absolute', inset:0, pointerEvents:'none',
          background:'repeating-linear-gradient(90deg,transparent,transparent 17px,rgba(0,0,0,0.28) 17px,rgba(0,0,0,0.28) 19px)' }} />
      </div>
    </div>
  );
}

// ── Phase 2: Live performance HUD ─────────────────────────────────────────────
// All values here are DISPLAY-ONLY, supplied by the backend over the websocket
// (live_stats / hp_update). The client never computes score-affecting numbers.

// Live WPM meter with the 140–160 target zone highlighted in green.
const WPM_MAX = 220;
function WpmMeter({ wpm }) {
  const shown = useAnimatedNumber(Math.max(0, Math.min(WPM_MAX, wpm)), 350);
  const pos   = Math.max(0, Math.min(100, (wpm / WPM_MAX) * 100));
  const inZone = wpm >= 140 && wpm <= 160;
  const near   = wpm >= 110 && wpm < 140;
  const mColor = inZone ? 'var(--accent)' : near || (wpm > 160 && wpm <= 185) ? 'var(--action)' : wpm === 0 ? '#475569' : '#f87171';
  const zoneL  = (140 / WPM_MAX) * 100;
  const zoneW  = ((160 - 140) / WPM_MAX) * 100;
  return (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:3 }}>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8, letterSpacing:'0.14em', color:'var(--text-dim)' }}>TEMPO</span>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:11, color:mColor, fontVariantNumeric:'tabular-nums' }}>
          {shown}<span style={{ opacity:0.5, fontSize:8 }}> WpM</span>
        </span>
      </div>
      <div style={{ position:'relative', height:8, borderRadius:'var(--r-pill)', overflow:'hidden',
        background:'rgba(0,0,0,0.45)', border:'1px solid var(--line)' }}>
        {/* green target zone */}
        <div style={{ position:'absolute', top:0, bottom:0, left:`${zoneL}%`, width:`${zoneW}%`,
          background:'linear-gradient(90deg, rgba(59,130,246,0.25), rgba(59,130,246,0.4))',
          boxShadow:'0 0 8px rgba(59,130,246,0.5)' }} />
        {/* needle */}
        <div style={{ position:'absolute', top:-2, bottom:-2, left:`${pos}%`, width:3, marginLeft:-1.5,
          borderRadius:2, background:mColor, boxShadow:`0 0 8px ${mColor}`,
          transition:'left var(--dur) var(--ease-out), background var(--dur)' }} />
      </div>
    </div>
  );
}

// Filler-word counter — pops each time the backend reports more fillers.
function FillerCounter({ count }) {
  const hot = count > 0;
  return (
    <div style={{ textAlign:'center', minWidth:54 }}>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8, letterSpacing:'0.12em',
        color:'var(--text-dim)', marginBottom:3 }}>FÜLLWÖRTER</div>
      {/* key=count remounts the number so it replays the pop animation on every change */}
      <div key={count} style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, lineHeight:1,
        color: hot ? '#f87171' : '#64748b',
        textShadow: hot ? '0 0 10px rgba(248,113,113,0.6)' : 'none',
        animation: hot ? 'tick-pop 0.4s var(--ease-spring)' : 'none' }}>
        {count}
      </div>
    </div>
  );
}

// Combo / streak multiplier — escalates glow and size as the streak climbs.
function ComboMeter({ combo }) {
  const active = combo >= 2;
  const intensity = Math.min(combo, 6);
  return (
    <div style={{ textAlign:'center', minWidth:64 }}>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8, letterSpacing:'0.12em',
        color:'var(--text-dim)', marginBottom:3 }}>KOMBO</div>
      {active ? (
        <div key={combo} style={{ fontFamily:'var(--font-display)', fontWeight:700,
          fontSize: 14 + intensity * 1.5, lineHeight:1,
          color:'var(--action)',
          textShadow:`0 0 ${6 + intensity * 3}px rgba(249,115,22,${0.5 + intensity * 0.08})`,
          animation:'combo-in 0.35s var(--ease-spring)' }}>
          x{combo}
        </div>
      ) : (
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, lineHeight:1, color:'#64748b' }}>—</div>
      )}
    </div>
  );
}

// The strip that holds the three live meters. Glows brighter as the combo climbs.
function PerformanceHud({ wpm, fillers, combo }) {
  const hot = combo >= 3;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'var(--sp-3)', marginBottom:'var(--sp-3)',
      padding:'8px 12px', borderRadius:'var(--r-md)',
      background:'linear-gradient(180deg, rgba(8,16,28,0.9), rgba(4,8,14,0.92))',
      border:`1px solid ${hot ? 'rgba(249,115,22,0.45)' : 'var(--line)'}`,
      boxShadow: hot ? '0 0 22px rgba(249,115,22,0.18), inset 0 0 24px rgba(0,0,0,0.5)' : 'inset 0 0 24px rgba(0,0,0,0.5)',
      transition:'border-color var(--dur-slow), box-shadow var(--dur-slow)' }}>
      <WpmMeter wpm={wpm} />
      <div style={{ width:1, alignSelf:'stretch', background:'var(--line)' }} />
      <FillerCounter count={fillers} />
      <div style={{ width:1, alignSelf:'stretch', background:'var(--line)' }} />
      <ComboMeter combo={combo} />
    </div>
  );
}

// ── Component: WaveformRing ───────────────────────────────────────────────────
function WaveformRing({ volRef, active, bossSpeak }) {
  // Animate locally via requestAnimationFrame. Volume used to be React state on the
  // parent, so every audio frame (60fps) re-rendered the ENTIRE app — that render
  // storm is what blacked out the screen mid-speech. Now volume is a ref and only
  // this ring re-renders, at a capped ~25fps.
  const [, tick] = useReducer((x) => (x + 1) % 1e6, 0);
  useEffect(() => {
    if (!active) return undefined;
    let raf, last = 0;
    const loop = (t) => {
      if (t - last >= 40) { last = t; tick(); }   // ~25fps, this component only
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const bars    = 28;
  const volume  = active ? Math.min(volRef.current || 0, 1) : 0;
  const baseHue = bossSpeak ? 185 : (active ? 160 : 220);
  // The orb breathes with the mic amplitude — transform: scale only (GPU-cheap, no reflow).
  const scale   = active ? (1 + volume * 0.3).toFixed(3) : '1';
  const ringCol = bossSpeak ? 'var(--accent-2)' : active ? 'var(--accent)' : '#475569';

  return (
    <div style={{ position:'relative', width:154, height:154, margin:'0 auto',
      display:'flex', alignItems:'center', justifyContent:'center' }}>

      {/* expanding pulse rings (only while live) */}
      {active && [0, 1].map(i => (
        <div key={`r${i}`} style={{ position:'absolute', width:100, height:100, borderRadius:'50%',
          border:`2px solid ${ringCol}`, opacity:0, pointerEvents:'none',
          animation:`orb-ring 1.9s var(--ease-out) ${i * 0.95}s infinite` }} />
      ))}

      {/* radial amplitude bars */}
      {Array.from({ length: bars }).map((_, i) => {
        const angle = (i / bars) * 360;
        const h     = active
          ? 6 + Math.abs(Math.sin(Date.now() / 110 + i * 0.6)) * 12 * Math.max(volume, 0.06)
          : 4;
        return (
          <div key={i} style={{ position:'absolute', left:'50%', top:'50%',
            width: 3, height: h, borderRadius: 2,
            background: `hsl(${baseHue},85%,${active ? 60 : 30}%)`,
            opacity: active ? 0.5 + volume * 0.5 : 0.18,
            transform: `rotate(${angle}deg) translateY(-70px)`,
            transformOrigin: '50% 100%',
            transition: 'height 0.06s linear, opacity 0.12s, background 0.4s',
          }} />
        );
      })}

      {/* the core orb — scales with voice */}
      <div style={{ position:'relative', zIndex:2, width:94, height:94, borderRadius:'50%',
        display:'flex', alignItems:'center', justifyContent:'center',
        border:`2px solid ${ringCol}`, fontSize:34, userSelect:'none',
        background: active
          ? 'radial-gradient(circle at 50% 32%, rgba(59,130,246,0.20), rgba(59,130,246,0.04) 70%)'
          : 'rgba(255,255,255,0.02)',
        boxShadow: active
          ? `0 0 30px ${ringCol}55, inset 0 0 24px ${ringCol}33`
          : 'inset 0 0 18px rgba(0,0,0,0.5)',
        transform: `scale(${scale})`,
        transition:'transform 0.08s linear, box-shadow var(--dur-slow) var(--ease), border-color var(--dur-slow), background var(--dur-slow)',
      }}>
        🎙️
      </div>
    </div>
  );
}

// ── Component: TranscriptPanel ────────────────────────────────────────────────
const FILLER_RE = /\b(äh+|ehm+|um+|also\s|halt\s|irgendwie|quasi|sozusagen)\b/gi;

function TranscriptPanel({ lines, userSpeak, bossName }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [lines]);

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'10px 12px', fontSize:12.5, lineHeight:1.8,
      fontFamily:'var(--font-body)',
      background:'linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.28))',
      borderRadius:'var(--r-md)', border:'1px solid var(--line)',
      boxShadow:'inset 0 0 30px rgba(0,0,0,0.4)', minHeight:90 }}>
      {lines.length === 0 && (
        <span style={{ color:'var(--text-faint)', fontStyle:'italic' }}>Bereit für das Gespräch…</span>
      )}
      {lines.map(line => (
        <div key={line.id} style={{ marginBottom:5, overflowWrap:'anywhere',
          color: line.speaker === 'boss' ? 'var(--accent)' : 'var(--text)',
          opacity: line.partial ? 0.65 : 1 }}>
          <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8.5, letterSpacing:'0.14em', marginRight:8,
            color: line.speaker === 'boss' ? 'var(--accent-dim)' : 'rgba(59,130,246,0.6)' }}>
            {line.speaker === 'boss' ? (bossName || 'GEGNER') : 'DU'}
          </span>
          {_renderLine(line)}
          {line.partial && <span style={{ color:'#475569', animation:'pulse 1s infinite' }}> ▋</span>}
        </div>
      ))}
      {userSpeak && lines.length === 0 && (
        <div style={{ color:'var(--accent)', animation:'pulse 0.8s infinite' }}>Höre zu…</div>
      )}
      <div ref={endRef} />
    </div>
  );
}

// Renders a transcript line: applies Deepgram word-confidence heat-map for player
// spoken lines (orange ≥65%, red <55%, rest normal), plus filler-word highlights.
function _renderLine(line) {
  if (line.speaker !== 'player' || line.partial || !line.words?.length) {
    return _highlight(line.text);
  }
  const parts = (line.text ?? '').split(/(\s+)/);
  let wi = 0;
  return parts.map((tok, i) => {
    if (!tok || /^\s+$/.test(tok)) return tok;
    const conf = line.words[wi]?.confidence ?? 1;
    wi++;
    if (conf < 0.55) return (
      <mark key={i} title={`${Math.round(conf * 100)}% sicher`}
        style={{ background:'rgba(239,68,68,0.2)', color:'#fca5a5', borderRadius:2, padding:'0 1px',
          textDecoration:'underline dotted', textUnderlineOffset:3 }}>{tok}</mark>
    );
    if (conf < 0.75) return (
      <span key={i} title={`${Math.round(conf * 100)}% sicher`}
        style={{ color:'var(--action)' }}>{tok}</span>
    );
    return tok;
  });
}

function _highlight(text) {
  if (!text) return text;
  const parts = []; let last = 0;
  FILLER_RE.lastIndex = 0;
  let m;
  while ((m = FILLER_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={m.index} style={{ background:'rgba(239,68,68,0.25)',color:'#fca5a5',borderRadius:2,padding:'0 2px' }}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

// ── Component: GameOver ───────────────────────────────────────────────────────
function GameOver({ winner, onRestart }) {
  const win = winner === 'player';
  return (
    <div style={{ position:'absolute', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center',
      background:'rgba(0,0,0,0.88)', backdropFilter:'blur(6px)', flexDirection:'column', padding:24,
      animation:'flash-in 0.4s ease' }}>
      <div style={{ fontSize:70, marginBottom:16 }}>{win ? '🏆' : '💀'}</div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:900, letterSpacing:4, marginBottom:10,
        color: win ? 'var(--accent)' : '#ef4444',
        textShadow:`0 0 30px ${win ? 'rgba(59,130,246,0.7)' : 'rgba(239,68,68,0.7)'}` }}>
        {win ? 'SIEG!' : 'NIEDERLAGE'}
      </div>
      <div style={{ fontSize:12, color:'#94a3b8', marginBottom:28, textAlign:'center', lineHeight:1.6 }}>
        {win ? 'Herr Tariq ist besiegt. Du hast den Level bestanden.' : 'Herr Tariq triumphiert. Versuche es erneut.'}
      </div>
      <button onClick={onRestart} style={{ fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.14em',
        padding:'12px 32px', borderRadius:8, cursor:'pointer',
        border:`1px solid ${win ? 'var(--accent)' : '#ef4444'}`,
        color:  win ? 'var(--accent)' : '#ef4444',
        background:'transparent',
        boxShadow:`0 0 20px ${win ? 'rgba(59,130,246,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
        NEU STARTEN
      </button>
    </div>
  );
}

// ── Component: Metric pill ────────────────────────────────────────────────────
function Metric({ label, value, sub, color = 'var(--accent)' }) {
  return (
    <div style={{ flex:1, minWidth:78, padding:'8px 6px', borderRadius:8, textAlign:'center',
      background:'rgba(0,0,0,0.35)', border:`1px solid ${color}33` }}>
      <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:900, color }}>{value}</div>
      <div style={{ fontSize:8, letterSpacing:'0.08em', color:'#94a3b8', marginTop:2 }}>{label}</div>
      {sub && <div style={{ fontSize:7.5, color:'#64748b', marginTop:1 }}>{sub}</div>}
    </div>
  );
}

// ── Component: animated category "damage" bar ─────────────────────────────────
function CatBar({ label, value, color }) {
  const v = useAnimatedNumber(Math.max(0, Math.min(100, value || 0)), 700);
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:9.5, letterSpacing:'0.06em', color:'#cbd5e1' }}>{label}</span>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, color, fontVariantNumeric:'tabular-nums' }}>{v}</span>
      </div>
      <div style={{ height:9, borderRadius:'var(--r-pill)', overflow:'hidden',
        background:'rgba(0,0,0,0.45)', border:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ height:'100%', width:`${Math.max(0, Math.min(100, value || 0))}%`, borderRadius:'inherit',
          background:`linear-gradient(90deg, ${color}99, ${color})`, boxShadow:`0 0 10px ${color}66`,
          transition:'width 0.7s var(--ease-out)' }} />
      </div>
    </div>
  );
}

// ── Component: RankLadder (interview-readiness, backend-computed) ─────────────
function RankLadder({ rank }) {
  if (!rank?.ranks?.length) return null;
  const tier = rank.tier ?? 0;
  const cur  = tier >= 4 ? 'var(--accent)' : 'var(--action)';
  return (
    <div style={{ padding:'10px 12px', borderRadius:'var(--r-md)', background:'rgba(0,0,0,0.3)', border:'1px solid var(--line)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:9 }}>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.14em', color:'var(--text-dim)' }}>INTERVIEW-BEREITSCHAFT</span>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, color:cur, textShadow:`0 0 10px ${cur}99` }}>{rank.label}</span>
      </div>
      <div style={{ display:'flex', alignItems:'center' }}>
        {rank.ranks.map((r, i) => (
          <div key={r} style={{ display:'flex', alignItems:'center', flex: i < rank.ranks.length - 1 ? 1 : '0 0 auto' }}>
            <div title={r} style={{ width:15, height:15, borderRadius:'50%', flexShrink:0,
              background: i < tier ? 'var(--player)' : i === tier ? cur : 'rgba(255,255,255,0.08)',
              border:`2px solid ${i < tier ? 'var(--player)' : i === tier ? cur : '#334155'}`,
              boxShadow: i === tier ? `0 0 10px ${cur}` : 'none',
              animation: i === tier ? 'pulse 2s ease-in-out infinite' : 'none' }} />
            {i < rank.ranks.length - 1 && (
              <div style={{ flex:1, height:2, margin:'0 3px', borderRadius:1,
                background: i < tier ? 'var(--player)' : 'rgba(255,255,255,0.08)' }} />
            )}
          </div>
        ))}
      </div>
      {rank.nextLabel ? (
        <div style={{ marginTop:9 }}>
          <div style={{ height:6, borderRadius:'var(--r-pill)', overflow:'hidden', background:'rgba(0,0,0,0.45)', border:'1px solid var(--line)' }}>
            <div style={{ height:'100%', width:`${rank.toNextPct}%`, borderRadius:'inherit',
              background:`linear-gradient(90deg, ${cur}, var(--accent))`, boxShadow:`0 0 8px ${cur}66`,
              transition:'width 0.7s var(--ease-out)' }} />
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
            <span style={{ fontSize:9, color:'var(--text-faint)' }}>
              {rank.nextBy === 'sessions'
                ? <>Score erreicht — noch <b style={{ color:'#cbd5e1' }}>{rank.sessionsToNext}</b> {rank.sessionsToNext === 1 ? 'Sitzung' : 'Sitzungen'} bis <b style={{ color:'#cbd5e1' }}>{rank.nextLabel}</b></>
                : <>{rank.toNextPct}% bis <b style={{ color:'#cbd5e1' }}>{rank.nextLabel}</b></>}
            </span>
            {/* Near-miss psychology (Griffiths 1991): within 15% of next tier activates reward circuits */}
            {rank.nextBy !== 'sessions' && rank.toNextPct >= 85 && (
              <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:9, letterSpacing:'0.1em',
                color:'var(--action)', textShadow:'0 0 8px rgba(249,115,22,0.6)', animation:'pulse 1.8s ease-in-out infinite' }}>
                SO NAH! 🔥
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ fontSize:10.5, color:'var(--player-2)', marginTop:9, textAlign:'center', fontWeight:600 }}>🏆 Höchster Rang erreicht — Interview-Bereit!</div>
      )}
    </div>
  );
}

// ── Component: WeeklyLeaderboard ─────────────────────────────────────────────
// Social accountability (Duolingo leagues research): ranking peers in a weekly
// cohort drives daily return rate without requiring chat or social features.
function WeeklyLeaderboard({ token, apiUrl, myId, data, onLoad, onClose }) {
  const [err, setErr] = useState('');
  useEffect(() => {
    if (data) return;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/leaderboard`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error('failed');
        onLoad(await r.json());
      } catch { setErr('Tabelle konnte nicht geladen werden.'); }
    })();
  }, [apiUrl, token, data, onLoad]);

  const entries = data?.entries ?? [];
  const me = entries.find(e => e.id === (data?.myId ?? myId));

  return (
    <div style={{ position:'absolute', inset:0, zIndex:220, display:'flex', flexDirection:'column',
      background:'rgba(2,4,9,0.98)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 16px 10px' }}>
        <div>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:17, letterSpacing:'0.1em',
            color:'var(--action)', textShadow:'0 0 14px rgba(249,115,22,0.5)' }}>🏆 DIESE WOCHE</div>
          <div style={{ fontSize:9, color:'var(--text-faint)', letterSpacing:'0.08em' }}>TOP 15 · ÜBUNGEN + TÄGLICHE TRAININGS</div>
        </div>
        <button onClick={onClose} style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:12, padding:'7px 11px',
          borderRadius:'var(--r-sm)', cursor:'pointer', border:'1px solid var(--line)', background:'transparent', color:'var(--text-dim)' }}>✕</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0 16px 18px', display:'flex', flexDirection:'column', gap:6 }}>
        {err && <div style={{ fontSize:12, color:'#fca5a5', textAlign:'center', marginTop:20 }}>⚠ {err}</div>}
        {!data && !err && (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-dim)', fontSize:12 }}>Lade…</div>
        )}

        {me && (
          <div style={{ padding:'8px 12px', borderRadius:'var(--r-sm)', marginBottom:4,
            background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.3)',
            fontSize:11, color:'var(--accent)', fontFamily:'var(--font-display)', fontWeight:700, textAlign:'center' }}>
            DU · RANG #{me.rank} · {me.liveSessions} Kämpfe + {me.dailyDays} Tage Training
          </div>
        )}

        {entries.map((e) => {
          const isMe = e.id === (data?.myId ?? myId);
          return (
            <div key={e.rank} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
              borderRadius:'var(--r-sm)',
              background: isMe ? 'rgba(59,130,246,0.07)' : e.rank === 1 ? 'rgba(249,115,22,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isMe ? 'rgba(59,130,246,0.35)' : e.rank === 1 ? 'rgba(249,115,22,0.35)' : 'var(--line)'}` }}>
              <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:13,
                color: e.rank === 1 ? 'var(--action)' : e.rank === 2 ? '#94a3b8' : e.rank === 3 ? '#cd7f32' : 'var(--text-dim)',
                minWidth:24, textAlign:'center' }}>
                {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
              </span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:11,
                  color: isMe ? 'var(--accent)' : '#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {e.masked}{isMe ? ' 👈' : ''}
                </div>
                <div style={{ fontSize:9, color:'var(--text-faint)', marginTop:1 }}>
                  {e.liveSessions} Kämpfe · {e.dailyDays} Tage · {e.streak > 0 ? `${e.streak}🔥` : ''}
                </div>
              </div>
              <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:12, color:'var(--action)' }}>{e.score}</span>
            </div>
          );
        })}

        {data && !entries.length && (
          <div style={{ textAlign:'center', marginTop:30, fontSize:12, color:'var(--text-dim)', lineHeight:1.6 }}>
            Noch keine Aktivität diese Woche.<br />
            <span dir="rtl">مفيش نشاط الأسبوع ده لسه — كن أول واحد!</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component: Debrief (end-of-session feedback) ──────────────────────────────
// lang: 'de' | 'ar' — toggles the EXPLANATION prose only. German targets/phrases/
// corrections always stay German. All values are backend-supplied (display-only).
function Debrief({ data, pending, onRestart, lang = 'de', onLang, bossName, token, apiUrl, onOpenTrainingslager, studentName, onOpenGuide }) {
  // The student's first name — so the most personal moment in the app actually speaks to THEM.
  const _fn = (studentName || '').toString().trim().split(/\s+/)[0];
  const nm  = _fn ? _fn.charAt(0).toUpperCase() + _fn.slice(1) : '';
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied]   = useState(false);
  const m = data?.metrics ?? {};
  const r = data?.result ?? {};
  const ar = lang === 'ar';
  const pick = (de, arr) => (ar && arr ? arr : de) || de || '';   // explanation chooser
  const rtl  = ar ? { direction:'rtl', textAlign:'right' } : null;
  const [lo, hi] = m.wpmTarget ?? [140, 160];
  const wpmColor = m.wpm >= lo && m.wpm <= hi ? 'var(--accent)'
                 : (m.wpm >= lo - 30 && m.wpm <= hi + 25) ? 'var(--action)' : '#ef4444';
  const win   = r.outcome === 'win';
  const score = Number.isFinite(r.score) ? r.score : (m.avgScore ?? 0);
  const shownScore = useAnimatedNumber(score, 900);
  const rank  = r.rank ?? '–';
  const gradeUnavailable = !!r.gradeUnavailable;
  const cats  = r.categories ?? {};
  const accent = win ? 'var(--accent)' : 'var(--action)';

  const shareUrl  = (typeof window !== 'undefined' && window.location?.origin) || 'https://bpo-combat-arena.vercel.app';
  const shareText = [
    `🎯 OMNI-PERFORM — Deutsches BPO-Interview`,
    `Rang: ${rank} · Score: ${score}/100`,
    m.c1Hits  > 0 ? `✅ C1-Vokabular: ${m.c1Hits} ${m.c1Hits === 1 ? 'Wort' : 'Wörter'}` : '',
    m.connectorHits > 0 ? `✅ Satzbau: ${m.connectorHits} ${m.connectorHits === 1 ? 'Konnektor' : 'Konnektoren'}` : '',
    m.wpm > 0  ? `🎙 ${m.wpm} Wörter/min` : '',
    r.jobLabel ? `💼 ${r.jobLabel}` : '',
    ``,
    `أتدرب على مقابلات الشغل بالألماني — جرّب كمان:`,
    shareUrl,
  ].filter((l, i) => i < 2 || l !== '').join('\n');
  // Render the result as a SHARE IMAGE (people share images on WhatsApp/FB, not paragraphs). Pure
  // client-side canvas → PNG, $0. Falls back to text share / clipboard if the image or Web Share fails.
  const makeShareImage = async () => {
    try {
      const W = 1080, H = 1080;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); if (!x) return null;
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#04070d'); g.addColorStop(1, '#0a1222');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = accent; x.fillRect(0, 0, W, 14);
      x.textAlign = 'center';
      x.fillStyle = '#94a3b8'; x.font = 'bold 36px system-ui,sans-serif'; x.fillText('OMNI-PERFORM', W / 2, 130);
      x.fillStyle = '#e2e8f0'; x.font = 'bold 40px system-ui,sans-serif'; x.fillText('Deutsches BPO-Interview', W / 2, 195);
      x.fillStyle = accent;    x.font = 'bold 190px system-ui,sans-serif'; x.fillText(String(rank || '—'), W / 2, 470);
      x.fillStyle = '#e2e8f0'; x.font = 'bold 96px system-ui,sans-serif'; x.fillText(`${score}/100`, W / 2, 595);
      if (r.jobLabel) {
        x.fillStyle = '#cbd5e1'; x.font = '34px system-ui,sans-serif';
        const words = String(r.jobLabel).split(' '); let line = '', y = 685;
        for (const w of words) { if (x.measureText(line + w).width > W - 160) { x.fillText(line.trim(), W / 2, y); line = ''; y += 46; } line += w + ' '; }
        if (line.trim()) x.fillText(line.trim(), W / 2, y);
      }
      const stats = [m.wpm > 0 ? `${m.wpm} W/min` : '', m.c1Hits > 0 ? `C1-Vokabular: ${m.c1Hits}` : ''].filter(Boolean).join('   ·   ');
      if (stats) { x.fillStyle = '#94a3b8'; x.font = '32px system-ui,sans-serif'; x.fillText(stats, W / 2, 830); }
      x.fillStyle = 'var(--action)'; x.font = 'bold 38px system-ui,sans-serif'; x.fillText('اتدرّب على إنترفيو شغل ألماني', W / 2, 930);
      x.fillStyle = '#64748b'; x.font = '30px system-ui,sans-serif'; x.fillText(shareUrl.replace(/^https?:\/\//, ''), W / 2, 1000);
      return await new Promise((res) => c.toBlob(res, 'image/png'));
    } catch { return null; }
  };
  const onShare = async () => {
    try {
      const blob = await makeShareImage();
      if (blob && navigator.canShare) {
        const file = new File([blob], 'omni-perform.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: shareText, title: 'OMNI-PERFORM' }); return; }
      }
      if (navigator.share) { await navigator.share({ title: 'OMNI-PERFORM', text: shareText, url: shareUrl }); return; }
      await navigator.clipboard?.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* user cancelled */ }
  };

  const LangToggle = onLang ? (
    <div style={{ display:'inline-flex', borderRadius:'var(--r-pill)', overflow:'hidden',
      border:'1px solid var(--line)', background:'rgba(0,0,0,0.4)' }}>
      {[['de','DE'],['ar','العربية']].map(([id, lbl]) => (
        <button key={id} onClick={() => onLang(id)} style={{ cursor:'pointer', padding:'4px 12px',
          fontFamily:'var(--font-display)', fontWeight:600, fontSize:10, letterSpacing:'0.06em', border:'none',
          color: lang === id ? '#04070d' : '#94a3b8',
          background: lang === id ? 'var(--accent)' : 'transparent', transition:'background var(--dur), color var(--dur)' }}>
          {lbl}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position:'absolute', inset:0, zIndex:200, display:'flex', flexDirection:'column',
      background:'rgba(2,4,9,0.97)', backdropFilter:'blur(6px)', animation:'flash-in 0.4s ease', overflow:'hidden' }}>

      {pending && !data ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
          <div className="spin" style={{ width:34, height:34, borderRadius:'50%',
            border:'3px solid rgba(59,130,246,0.2)', borderTopColor:'var(--accent)' }} />
          <div style={{ fontSize:12, color:'#94a3b8' }}>Analyse deiner Antworten läuft…</div>
        </div>
      ) : (
        <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 16px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* ── Cinematic outcome + rank reveal ─────────────────────────────── */}
          <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:'0.22em',
              color:accent, textShadow:`0 0 16px ${accent}88`, animation:'result-rise 0.4s var(--ease-out)' }}>
              {win ? 'SIEG' : 'NIEDERLAGE'}
            </div>
            {gradeUnavailable ? (
              <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:20, lineHeight:1.25, color:'var(--action)',
                margin:'12px 0 2px', textShadow:'0 0 18px rgba(249,115,22,0.4)' }}>
                Bewertung nicht verfügbar
              </div>
            ) : (
              <>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:54, lineHeight:1, color:'#fff',
                  margin:'6px 0 2px', textShadow:`0 0 30px ${accent}aa, 0 2px 12px rgba(0,0,0,0.8)`,
                  animation:'rank-pop 0.7s var(--ease-spring)' }}>
                  {rank}
                </div>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:11, letterSpacing:'0.14em', color:'#94a3b8' }}>
                  RANG · {shownScore}<span style={{ opacity:0.5 }}> / 100</span>
                </div>
                {r.jobLabel && (
                  <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:'0.08em', color:'var(--action)', textShadow:'0 0 10px rgba(249,115,22,0.35)', marginTop:4 }}>
                    {r.jobLabel.toUpperCase()}
                  </div>
                )}
              </>
            )}
            {/* Motivating loss / win line */}
            <div style={{ marginTop:8, fontSize:12, color: win ? 'var(--accent-2)' : 'var(--action)', lineHeight:1.5,
              animation:'result-rise 0.6s var(--ease-out)' }}>
              {win
                ? `Stark${nm ? ', ' + nm : ''}! Du hast ${bossName || 'den Interviewer'} bezwungen — nur noch ${r.playerHp ?? '?'} HP übrig bei dir.`
                : `So nah${nm ? ', ' + nm : ''}! ${bossName || 'Der Interviewer'} hatte nur ${r.bossHp ?? '?'} HP übrig. Beim nächsten Mal knackst du ihn.`}
            </div>
            {data?.progress?.personalBest && (
              <div style={{ marginTop:11, display:'inline-block', padding:'6px 15px', borderRadius:'var(--r-pill)',
                fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:'0.08em',
                color:'#04070d', background:'linear-gradient(135deg,var(--action-2),var(--action))', boxShadow:'0 0 22px rgba(249,115,22,0.55)',
                animation:'rank-pop 0.7s var(--ease-spring)' }}>
                🏆 BESTLEISTUNG!
              </div>
            )}
          </div>

          {/* ── Hiring decision — maps the CEFR VERDICT (not the game score) to the real
                Cairo bar: C1-held-under-pressure = seated; B2 = screen only; freeze = out.
                Mirrors the server jobLabel so the screen never shows two competing verdicts. ── */}
          {!gradeUnavailable && (() => {
            const d = r.verdict === 'fail'
              ? { icon:'✗', label:'DIESMAL NICHT', de:'Unter Druck eingebrochen — genau das entscheidet auf der Linie. Weiter trainieren, der Weg ist klar.', ar:'انهرت تحت الضغط — ده بالظبط اللي الشغل بيتقرر عليه. كمّل تدريب، الطريق واضح.', color:'#f87171', bg:'rgba(239,68,68,0.10)', border:'rgba(239,68,68,0.35)' }
              : (rank === 'C1' && r.verdict === 'pass')
              ? { icon:'🤝', label:'EINSTELLUNGSEMPFEHLUNG', de:'C1 unter Druck gehalten — auf einer deutschen Kundenlinie einsetzbar.', ar:'حافظت على C1 تحت الضغط — جاهز لخط خدمة ألماني.', color:'var(--accent)', bg:'rgba(59,130,246,0.12)', border:'rgba(59,130,246,0.4)' }
              : rank === 'C1'
              ? { icon:'📋', label:'ZWEITES GESPRÄCH', de:'C1-Niveau, aber unter Druck noch instabil — das schließt die Linie noch nicht auf.', ar:'مستوى C1 بس لسه مش ثابت تحت الضغط — لسه بدري على الخط.', color:'var(--action)', bg:'rgba(249,115,22,0.10)', border:'rgba(249,115,22,0.4)' }
              : rank === 'B2'
              ? { icon:'📋', label:'TELEFON-SCREEN BESTANDEN', de:'B2: Sie bestehen das HR-Screening. Für die Kundenlinie fehlt C1 unter Druck.', ar:'B2: بتعدّي فلتر الـHR. لكن الخط محتاج C1 تحت الضغط.', color:'var(--action)', bg:'rgba(249,115,22,0.10)', border:'rgba(249,115,22,0.4)' }
              : rank === 'B1'
              ? { icon:'⏸', label:'NOCH NICHT', de:'B1: Die Grundlage steht — aber eine deutsche Linie verlangt C1.', ar:'B1: الأساس موجود — بس الخط الألماني محتاج C1.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' }
              : rank === 'A2'
              ? { icon:'🌱', label:'AUFBAUSTUFE', de:'A2: Du baust dein Fundament — noch unter der Einstellungsschwelle, aber jede Sitzung bringt dich näher.', ar:'A2: بتبني الأساس — لسه تحت عتبة التوظيف، بس كل جلسة بتقرّبك أكتر.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' }
              // A1/unknown → match the server jobLabel's gentle tone, NOT a harsh red "DIESMAL NICHT".
              : { icon:'🌱', label:'DEIN ANFANG', de:'Jeder Profi hat hier angefangen. Bleib dran — du schaffst das, Schritt für Schritt.', ar:'كل محترف بدأ من هنا. كمّل — هتعملها خطوة بخطوة.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' };
            return (
              <div style={{ padding:'12px 14px', borderRadius:'var(--r-md)', background:d.bg, border:`1px solid ${d.border}`,
                animation:'result-rise 0.5s var(--ease-out)', textAlign:'center' }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, letterSpacing:'0.18em', color:d.color, marginBottom:6 }}>
                  {d.icon} ENTSCHEIDUNG · {d.label}
                </div>
                <div style={{ fontSize:13, color:'#e2e8f0', lineHeight:1.5 }}>{d.de}</div>
                <div dir="rtl" style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>{d.ar}</div>
              </div>
            );
          })()}

          {/* ── WOCHENFOKUS — the ONE thing to drill this week (amber anchor) ── */}
          {data?.priorityFix && (data.priorityFix.de || data.priorityFix.ar) && (
            <div style={{ padding:'14px 16px', borderRadius:14, animation:'result-rise 0.5s var(--ease-out)',
              background:'linear-gradient(135deg, rgba(249,115,22,0.16) 0%, rgba(249,115,22,0.06) 100%)',
              border:'2px solid rgba(249,115,22,0.65)',
              boxShadow:'0 0 28px rgba(249,115,22,0.14)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:9 }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:'rgba(249,115,22,0.2)',
                  border:'1.5px solid rgba(249,115,22,0.6)', display:'flex', alignItems:'center',
                  justifyContent:'center', fontSize:14, flexShrink:0 }}>⭐</div>
                <div>
                  <div style={{ fontSize:8.5, letterSpacing:'0.16em', fontFamily:'var(--font-display)', color:'var(--action)' }}>
                    WOCHENFOKUS · DEIN TÄGLICHES ZIEL
                  </div>
                  <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', letterSpacing:'0.08em', fontFamily:'var(--font-display)' }}>
                    تمرين الأسبوع · هدفك اليومي
                  </div>
                </div>
              </div>
              <div style={{ fontSize:13.5, color:'var(--action-2)', lineHeight:1.65, fontWeight:600 }}>
                {ar && data.priorityFix.ar ? data.priorityFix.ar : data.priorityFix.de}
              </div>
              {!ar && data.priorityFix.ar && (
                <div dir="rtl" style={{ marginTop:7, fontSize:11.5, color:'var(--action)', lineHeight:1.55, opacity:0.8 }}>
                  {data.priorityFix.ar}
                </div>
              )}
            </div>
          )}

          {/* PROGRESS — deterministic, from the user's OWN past sessions (never the model's opinion) */}
          {data?.progressNarrative && (data.progressNarrative.de || data.progressNarrative.ar) && (
            <div style={{ padding:'10px 13px', borderRadius:10, background:'rgba(56,189,248,0.07)', border:'1px solid rgba(56,189,248,0.3)' }}>
              <div style={{ fontSize:9, fontFamily:'var(--font-display)', letterSpacing:'0.12em', color:'var(--accent-2)', marginBottom:5 }}>{ar ? 'تقدّمك' : 'DEIN FORTSCHRITT'}</div>
              <div style={{ fontSize:12, color:'#e0f2fe', lineHeight:1.6, ...rtl }}>{ar && data.progressNarrative.ar ? data.progressNarrative.ar : data.progressNarrative.de}</div>
            </div>
          )}

          {/* INTERVIEW REVIEW — per exchange: your real words → what was missing vs the question → the fix that gets you hired */}
          {!!data?.interviewReview?.length && (
            <Section title={ar ? 'المقابلة · سؤال بسؤال' : 'INTERVIEW · FRAGE FÜR FRAGE'} color="var(--action)">
              {data.interviewReview.map((r, i) => (
                <div key={i} style={{ marginBottom:i < data.interviewReview.length-1 ? 12 : 0,
                  paddingBottom:i < data.interviewReview.length-1 ? 12 : 0,
                  borderBottom:i < data.interviewReview.length-1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  {r.frage && <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4, ...rtl }}>❓ {r.frage}</div>}
                  <div style={{ fontSize:12, color:'#e2e8f0', fontStyle:'italic', lineHeight:1.5, marginBottom:6, overflowWrap:'anywhere', ...rtl }}>„{r.deinSatz}“</div>
                  {(ar ? r.stark_ar : r.stark) && <div style={{ fontSize:11.5, color:'var(--accent-2)', lineHeight:1.5, marginBottom:4, ...rtl }}>✓ {ar && r.stark_ar ? r.stark_ar : r.stark}</div>}
                  {(ar ? r.luecke_ar : r.luecke) && <div style={{ fontSize:11.5, color:'#fca5a5', lineHeight:1.5, marginBottom:4, ...rtl }}>✗ {ar && r.luecke_ar ? r.luecke_ar : r.luecke}</div>}
                  {(ar ? r.fixDerEinstellt_ar : r.fixDerEinstellt) && (
                    <div style={{ fontSize:11.5, color:'var(--action)', lineHeight:1.55, background:'rgba(249,115,22,0.08)', borderRadius:7, padding:'6px 9px', marginTop:4, ...rtl }}>
                      💡 {ar && r.fixDerEinstellt_ar ? r.fixDerEinstellt_ar : r.fixDerEinstellt}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* Language toggle (Arabic explanations) */}
          {LangToggle && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:9.5, color:'#64748b', letterSpacing:'0.06em' }}>Erklärungen / الشرح</span>
              {LangToggle}
            </div>
          )}

          {/* ── Schaden nach Kategorie — only when the server actually scored them (honesty: never
              paint a fake "Grammatik 0" from a missing/failed scoring path). ── */}
          {!gradeUnavailable && r.categories && (
            <Section title={ar ? 'الضرر حسب الفئة · SCHADEN' : 'SCHADEN NACH KATEGORIE'} color="var(--accent)">
              <CatBar label="Flüssigkeit"   value={cats.fluency}      color="var(--accent)" />
              <CatBar label="Grammatik"     value={cats.grammar}      color="var(--accent)" />
              <CatBar label="Wortschatz"    value={cats.vocab}        color="var(--accent)" />
              <CatBar label="De-Eskalation" value={cats.deescalation} color="var(--action)" />
            </Section>
          )}

          {/* ── Natürlichkeit (language naturalness score) ─────────────────── */}
          {data?.naturalness && (
            <Section title={ar ? 'صياغة وكلمات · NATÜRLICHKEIT' : 'NATÜRLICHKEIT · WORTWAHL'} color="var(--accent-2)"
              right={
                <span style={{ fontSize:8.5, fontFamily:'var(--font-display)', letterSpacing:'0.06em', padding:'3px 8px',
                  borderRadius:99, border:'1px solid rgba(96,165,250,0.45)', color:'var(--accent-2)' }}>
                  {data.naturalness.score}/100
                </span>
              }>
              <div style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.6, ...rtl, marginBottom:8 }}>
                {ar && data.naturalness.ar ? data.naturalness.ar : data.naturalness.de}
              </div>
              {data.naturalness.tips?.map((t, i) => (
                <div key={i} style={{ fontSize:11, color:'var(--text-dim)', marginBottom:5, paddingLeft:10,
                  borderLeft:'2px solid rgba(96,165,250,0.4)', ...rtl }}>
                  {ar && t.ar ? t.ar : t.de}
                </div>
              ))}
            </Section>
          )}

          {/* ── Dein Fortschritt: readiness rank + one improvement trend line ── */}
          {(data?.progress?.rank || data?.progress?.trend?.fluency?.length > 1) && (
            <Section title={ar ? 'تقدّمك · DEIN FORTSCHRITT' : 'DEIN FORTSCHRITT'} color="var(--accent)">
              {data.progress.rank && <RankLadder rank={data.progress.rank} />}
              {data.progress.trend?.fluency?.length > 1 && (() => {
                const f = data.progress.trend.fluency;
                const delta = f[f.length - 1] - f[0];
                return (
                  <div style={{ marginTop:11 }}>
                    <div style={{ fontSize:10, color:'var(--text-dim)', marginBottom:5 }}>Flüssigkeit über deine letzten Sitzungen:</div>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:'0.02em' }}>
                      {f.map((v, i) => (
                        <span key={i}>
                          <span style={{ color: i === f.length - 1 ? 'var(--accent)' : '#94a3b8',
                            textShadow: i === f.length - 1 ? '0 0 10px rgba(59,130,246,0.6)' : 'none' }}>{v}</span>
                          {i < f.length - 1 && <span style={{ color:'#475569', margin:'0 7px' }}>→</span>}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize:10, marginTop:4, color: delta > 0 ? 'var(--accent)' : delta < 0 ? '#f87171' : '#94a3b8' }}>
                      {delta > 0 ? `+${delta} besser als zu Beginn dieser Reihe — du verbesserst dich.`
                        : delta < 0 ? `${delta} heute — dranbleiben, der Trend dreht sich.`
                        : 'Stabil — jetzt zum nächsten Sprung.'}
                    </div>
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Progression: XP gained, level, rank, level-up, personal best marker */}
          {data?.progress && (
            <div style={{ padding:'10px 12px', borderRadius:10,
              background: data.progress.leveledUp ? 'rgba(59,130,246,0.14)' : 'rgba(59,130,246,0.06)',
              border:`1px solid ${data.progress.leveledUp ? 'var(--accent)' : 'rgba(59,130,246,0.25)'}` }}>
              {data.progress.leveledUp && (
                <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:900, color:'var(--accent)',
                  letterSpacing:'0.1em', marginBottom:4, textShadow:'0 0 12px rgba(59,130,246,0.7)' }}>
                  ↑ LEVEL UP — LEVEL {data.progress.level ?? '–'}
                </div>
              )}
              <div style={{ fontSize:12, color:'#e2e8f0' }}>
                <b style={{ color:'var(--accent)' }}>+{data.progress.xpGained ?? 0} XP</b>
                <span style={{ color:'#94a3b8' }}> · RANG {data.result?.rank ?? '–'} · Level {data.progress.level ?? '–'}</span>
                {typeof data.progress.dueReviews === 'number' && data.progress.dueReviews > 0 && (
                  <span style={{ color:'var(--action)' }}> · {data.progress.dueReviews} Wiederholung(en) fällig</span>
                )}
              </div>
              {data.progress.levelProgress && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5 }}>
                  <div style={{ flex:1, height:7, borderRadius:'var(--r-pill)', overflow:'hidden', background:'rgba(0,0,0,0.45)', border:'1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ height:'100%', width:`${Math.max(0, Math.min(100, data.progress.levelProgress.pct || 0))}%`, borderRadius:'inherit',
                      background:'linear-gradient(90deg, var(--accent-2)99, var(--accent))', boxShadow:'0 0 8px rgba(59,130,246,0.35)', transition:'width 0.7s var(--ease-out)' }} />
                  </div>
                  <span style={{ fontSize:9.5, color:'#94a3b8', fontVariantNumeric:'tabular-nums' }}>{data.progress.levelProgress.pct ?? 0}%</span>
                </div>
              )}
              {data.progress.nextBoss && (
                <div style={{ fontSize:9.5, color:'#64748b', marginTop:4 }}>
                  Nächster Gegner ab Level {data.progress.nextBoss.minLevel}: {data.progress.nextBoss.name}
                </div>
              )}
              {data.progress.trainingDelta && (
                <div style={{ fontSize:10.5, color:'#cbd5e1', marginTop:6, paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)', ...rtl }}>
                  <b style={{ color:'var(--action)' }}>{ar ? data.progress.trainingDelta.title_ar : data.progress.trainingDelta.title_de}</b>:{' '}
                  {ar ? 'الجولة اللي فاتت' : 'letzter Kampf'} {data.progress.trainingDelta.before} {ar ? '→ النهارده' : 'Fehler → heute'}{' '}
                  <b style={{ color: data.progress.trainingDelta.after <= data.progress.trainingDelta.before ? 'var(--accent)' : '#f87171' }}>{data.progress.trainingDelta.after}</b>
                </div>
              )}
              {data.progress.weakRuleDelta && (
                <div style={{ fontSize:10.5, color:'#cbd5e1', marginTop:6, paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)', ...rtl }}>
                  <b style={{ color:'var(--action)' }}>{ar ? 'نقطة ضعفك المستهدفة' : 'Gezielt getestete Schwäche'}</b> — {data.progress.weakRuleDelta.rule}:{' '}
                  {ar ? 'الجولة اللي فاتت' : 'letzte Sitzung'} {data.progress.weakRuleDelta.before} {ar ? '→ النهارده' : 'Fehler → heute'}{' '}
                  <b style={{ color: data.progress.weakRuleDelta.after <= data.progress.weakRuleDelta.before ? 'var(--accent)' : '#f87171' }}>{data.progress.weakRuleDelta.after}</b>
                </div>
              )}
              {data.progress.weekTrend && (
                <div style={{ fontSize:10.5, color:'#cbd5e1', marginTop:6, paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)', ...rtl }}>
                  <b style={{ color:'var(--action)' }}>{ar ? 'الأسبوع ده مقابل اللي فات' : 'Diese Woche vs. letzte Woche'}</b>:{' '}
                  {ar ? 'الطلاقة' : 'Flüssigkeit'} {data.progress.weekTrend.fluency.last} → <b style={{ color: data.progress.weekTrend.fluency.delta >= 0 ? 'var(--accent)' : '#f87171' }}>{data.progress.weekTrend.fluency.this}</b>{' '}
                  <span style={{ color: data.progress.weekTrend.fluency.delta >= 0 ? 'var(--accent)' : '#f87171' }}>({data.progress.weekTrend.fluency.delta >= 0 ? '+' : ''}{data.progress.weekTrend.fluency.delta})</span>
                </div>
              )}
            </div>
          )}

          {/* Metrics */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <Metric label="WpM"        value={m.wpm ?? '–'}            sub={`Ziel ${lo}–${hi}`} color={wpmColor} />
            <Metric label="FÜLLWÖRTER" value={m.fillers ?? 0}         sub="äh/ehm/also" color="var(--action)" />
            <Metric label="C1-VOKABEL" value={m.c1Hits ?? 0}          color="var(--accent)" />
            <Metric label="KONJ. II"   value={m.konjunktivHits ?? 0}  sub="Höflichkeit" color="var(--accent)" />
            <Metric label="KONNEKTOR"  value={m.connectorHits ?? 0}   sub="weil/obwohl…" color="var(--accent)" />
          </div>

          {data?.note && (
            <div style={{ fontSize:10, color:'#94a3b8', fontStyle:'italic' }}>{data.note}</div>
          )}

          {/* Strengths */}
          {!!data?.strengths?.length && (
            <Section title="DAS LIEF GUT" color="var(--accent)">
              {data.strengths.map((s, i) => {
                const txt = ar && data.strengths_ar?.[i] ? data.strengths_ar[i] : s;
                return <div key={i} style={{ fontSize:12, color:'var(--accent-2)', marginBottom:5, lineHeight:1.5, ...rtl }}>✓ {txt}</div>;
              })}
            </Section>
          )}

          {/* Answer architecture (structure & framing) — additive coaching dimension */}
          {data?.answerArchitecture && (data.answerArchitecture.ar || data.answerArchitecture.de) && (
            <Section title={ar ? 'بنية الإجابة · ANTWORT-AUFBAU' : 'ANTWORT-AUFBAU · STRUKTUR'} color="var(--accent-2)"
              right={<span style={{ fontSize:8.5, fontFamily:'var(--font-display)', letterSpacing:'0.06em', padding:'3px 8px',
                borderRadius:99, border:'1px solid rgba(96,165,250,0.45)', color:'var(--accent-2)' }}>{String(data.answerArchitecture.label || '').toUpperCase()}</span>}>
              <div style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.6, ...rtl }}>
                {ar && data.answerArchitecture.ar ? data.answerArchitecture.ar : data.answerArchitecture.de}
              </div>
            </Section>
          )}

          {/* Delivery confidence — additive coaching dimension (separate from filler/fluency) */}
          {data?.deliveryConfidence && (data.deliveryConfidence.ar || data.deliveryConfidence.de) && (
            <Section title={ar ? 'ثقة الإلقاء · AUFTRETEN' : 'AUFTRETEN · SICHERHEIT'} color="var(--accent)"
              right={<span style={{ fontSize:8.5, fontFamily:'var(--font-display)', letterSpacing:'0.06em', padding:'3px 8px',
                borderRadius:99, border:'1px solid rgba(59,130,246,0.45)', color:'var(--accent)' }}>{String(data.deliveryConfidence.label || '').toUpperCase()}</span>}>
              <div style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.6, ...rtl }}>
                {ar && data.deliveryConfidence.ar ? data.deliveryConfidence.ar : data.deliveryConfidence.de}
              </div>
            </Section>
          )}

          {/* Grammar grouped by rule */}
          {!!data?.grammar?.length && (
            <Section title="GRAMMATIK · NACH REGEL" color="#f87171"
              right={
                <button onClick={() => setShowAll(v => !v)} style={{ fontSize:8.5, cursor:'pointer',
                  fontFamily:'var(--font-display)', letterSpacing:'0.06em', padding:'3px 7px', borderRadius:5,
                  border:'1px solid rgba(248,113,113,0.4)', background:'transparent', color:'#f87171' }}>
                  {showAll ? 'NUR BEISPIELE' : 'ALLE FEHLER ANZEIGEN'}
                </button>
              }>
              <div style={{ fontSize:9, color:'#64748b', marginBottom:7, fontStyle:'italic', ...rtl }}>
                {ar ? 'فقط أخطاء حقيقية رصدها المدقق. الأحمر = ما قلته · الأخضر = التصحيح.'
                    : 'Nur echte, vom Grammatik-Prüfer erkannte Fehler. Rot = was du gesagt hast · Grün = Korrektur.'}
              </div>
              {data.grammar.map((g, i) => {
                const ex = (showAll ? g.allExamples : g.summaryExamples) ?? [];
                return (
                  <div key={i} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, color:'#fca5a5', fontWeight:700 }}>
                      {g.rule} {g.count ? <span style={{ color:'#7f1d1d', fontWeight:400 }}>· {g.count}×</span> : null}
                    </div>
                    {(ar && g.explanation_ar) || g.explanation
                      ? <div style={{ fontSize:11, color:'#94a3b8', margin:'2px 0 5px', lineHeight:1.45, ...rtl }}>
                          {ar && g.explanation_ar ? g.explanation_ar : g.explanation}
                        </div>
                      : null}
                    {ex.map((e, j) => {
                      const hasFrag = e.wrongWord && e.rightWord;
                      return (
                        <div key={j} style={{ marginBottom:7, fontSize:11.5, lineHeight:1.45, overflowWrap:'anywhere' }}>
                          {hasFrag ? (
                            <>
                              <div>
                                <span style={{ color:'#ef4444', textDecoration:'line-through' }}>{e.wrongWord}</span>
                                <span style={{ color:'#64748b' }}> → </span>
                                <b style={{ color:'var(--accent)' }}>{e.rightWord}</b>
                              </div>
                              {e.wrongFragment && (
                                <div style={{ fontSize:10, color:'#64748b', marginTop:2, fontStyle:'italic' }}>{e.wrongFragment}</div>
                              )}
                            </>
                          ) : (
                            <>
                              <span style={{ color:'#ef4444' }}>✗ {e.wrong}</span><br />
                              <span style={{ color:'var(--accent)' }}>✓ {e.right}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </Section>
          )}

          {/* ── KORREKTURDRILL — flip-cards built from this session's errors ──── */}
          {!!data?.drills?.length && (
            <Section title={ar ? 'كوّن الجملة الصح · KORREKTURDRILL' : 'KORREKTURDRILL · ÜBEN'} color="var(--action)">
              <div style={{ fontSize:9.5, color:'#94a3b8', marginBottom:9, fontStyle:'italic' }}>
                {ar ? 'انقر على كل كارت عشان تشوف الإجابة الصح.'
                    : 'Tippe auf eine Karte, um die korrekte Version aufzudecken.'}
              </div>
              {data.drills.map((drill, i) => (
                <DrillCard key={i} drill={drill} ar={ar} />
              ))}
            </Section>
          )}

          {/* No real grammar errors → celebrate, then pivot to lesson/enrichment */}
          {/* Grammar check FAILED (LanguageTool unreachable) → honest "couldn't check", NEVER "clean". */}
          {data?.grammarUnavailable && (m.answers > 0) && (
            <div style={{ padding:'10px 12px', borderRadius:10, ...rtl,
              background:'rgba(249,115,22,0.10)', border:'1px solid rgba(249,115,22,0.35)',
              fontSize:11.5, color:'var(--action)', lineHeight:1.5 }}>
              {ar ? '⚠ فحص القواعد غير متاح حاليًا — لم نتمكن من التحقق من الأخطاء النحوية هذه المرة.'
                  : '⚠ Grammatikprüfung nicht verfügbar — die Grammatik konnte diesmal nicht geprüft werden.'}
            </div>
          )}

          {!data?.grammar?.length && (m.answers > 0) && !data?.grammarUnavailable && (
            <div style={{ padding:'10px 12px', borderRadius:10, ...rtl,
              background:'rgba(59,130,246,0.10)', border:'1px solid rgba(59,130,246,0.3)',
              fontSize:11.5, color:'var(--accent-2)', lineHeight:1.5 }}>
              {ar ? '✓ لم يتم رصد أخطاء نحوية واضحة — أداء نظيف. ارفع ألمانيتك إلى مستوى أقوى:'
                  : '✓ Keine klaren Grammatikfehler gefunden — saubere Leistung. Heb dein Deutsch jetzt auf die nächste Stufe:'}
            </div>
          )}

          {/* Lesson when there are few/no corrections */}
          {!!data?.lesson?.length && (
            <Section title={ar ? 'الدرس · LESSON' : 'LESSON'} color="var(--action)">
              {data.lesson.map((line, i) => {
                const text = line && typeof line === 'object'
                  ? (ar && line.ar ? line.ar : line.de)
                  : String(line ?? '');
                return <div key={i} style={{ fontSize:11.5, color:'var(--action-2)', lineHeight:1.5, marginBottom:4 }}>{text}</div>;
              })}
            </Section>
          )}

          {/* Enrichment: STRONGER ways to say what the candidate ACTUALLY said (not corrections) */}
          {!!data?.upgrades?.length && (
            <Section title={ar ? 'صياغة أقوى · STÄRKER FORMULIEREN' : 'STÄRKER FORMULIEREN'} color="var(--accent)">
              {data.upgrades.map((u, i) => {
                const why = ar && u.why_ar ? u.why_ar : u.why;
                return (
                  <div key={i} style={{ marginBottom:9, fontSize:11.5, lineHeight:1.45, overflowWrap:'anywhere' }}>
                    <div style={{ color:'#94a3b8' }}>{ar ? 'إنت قلت' : 'Du'}: „{u.original}“</div>
                    <div style={{ color:'var(--accent-2)' }}>{ar ? 'أقوى' : 'Stärker'}: <b style={{ color:'var(--accent-2)' }}>{u.better}</b></div>
                    {why && <div style={{ color:'#64748b', fontSize:10, marginTop:1, ...rtl }}>{why}</div>}
                  </div>
                );
              })}
            </Section>
          )}

          {/* What to study next */}
          {!!data?.studyNext?.length && (
            <Section title="NÄCHSTE SCHRITTE" color="var(--accent)">
              {data.studyNext.map((s, i) => {
                const title  = ar && s.title_ar  ? s.title_ar  : s.title;
                const detail = ar && s.detail_ar ? s.detail_ar : s.detail;
                return (
                  <div key={i} style={{ fontSize:12, color:'#e2e8f0', marginBottom:6, lineHeight:1.45, ...rtl }}>
                    <span style={{ color:'var(--accent)' }}>▸ {title}</span>
                    {detail && <span style={{ color:'#94a3b8' }}> — {detail}</span>}
                  </div>
                );
              })}
            </Section>
          )}

          {/* Vocab to drill (also queued into spaced repetition) */}
          {!!data?.vocabTargets?.length && (
            <Section title="VOKABELN ZUM ÜBEN" color="var(--accent)">
              {data.vocabTargets.map((v, i) => {
                const note = ar && v.note_ar ? v.note_ar : v.note;
                return (
                  <div key={i} style={{ fontSize:12, marginBottom:4, lineHeight:1.45 }}>
                    <b style={{ color:'var(--accent)' }}>{v.de}</b>
                    <span style={{ color:'#94a3b8' }}> — {v.en}{note ? ` (${note})` : ''}</span>
                  </div>
                );
              })}
              <div style={{ fontSize:9, color:'#64748b', marginTop:4, fontStyle:'italic' }}>
                Diese werden in kommenden Sitzungen als Schnell-Wiederholung abgefragt.
              </div>
            </Section>
          )}

          {/* One-time feedback prompt, only after the user's first-ever fight. Skippable; never blocks restart. */}
          {data?.sessionCount === 1 && token && (
            <FirstFightCard token={token} apiUrl={API_URL} />
          )}

          {/* Trainingslager next-step teaser on the results screen */}
          {token && apiUrl && (
            <GameMapCompact token={token} apiUrl={apiUrl} lang={lang} onOpen={onOpenTrainingslager} />
          )}

          {/* Honesty disclaimer: this is training feedback, NOT a recognized German certificate. */}
          <div style={{ marginTop:6, padding:'8px 10px', borderRadius:8, ...rtl,
            background:'rgba(148,163,184,0.06)', border:'1px solid rgba(148,163,184,0.16)',
            fontSize:9.5, color:'#64748b', lineHeight:1.5 }}>
            {ar
              ? 'ℹ️ ده تدريب وتقييم لمستواك للتمرين بس — مش شهادة ألمانية رسمية ولا معتمدة (زي Goethe / telc).'
              : 'ℹ️ Trainings-Feedback zur Übung — KEIN offizielles oder anerkanntes deutsches Sprachzertifikat (z. B. Goethe / telc).'}
          </div>
        </div>
      )}

      {/* Reach the mentor RIGHT HERE — the debrief (esp. a loss) is the moment a student feels most
          lost; Alhassan is warm + honest + remembers this session. Don't make them hunt for help. */}
      {onOpenGuide && (
        <div style={{ padding:'2px 16px 0' }}>
          <button onClick={onOpenGuide} style={{ width:'100%', fontFamily:'var(--font-display)', fontWeight:700,
            fontSize:12, letterSpacing:'0.06em', padding:'12px', borderRadius:'var(--r-md)', cursor:'pointer',
            border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)' }}>
            🧭 {lang === 'ar' ? 'مش فاهم نتيجتك؟ اسأل الحسن' : 'Frag Alhassan — was bedeutet das für mich?'}
          </button>
        </div>
      )}

      <div style={{ padding:'10px 16px 20px', display:'flex', gap:10 }}>
        <button onClick={onRestart} style={{ flex:2, fontFamily:'var(--font-display)', fontWeight:700, fontSize:13,
          letterSpacing:'0.1em', padding:'14px', borderRadius:'var(--r-md)', cursor:'pointer',
          border:'1px solid var(--accent)', color:'#04070d',
          background:'linear-gradient(135deg, var(--accent-2), var(--accent))',
          boxShadow:'0 0 22px rgba(59,130,246,0.4)' }}>
          ⚔ NOCHMAL KÄMPFEN
        </button>
        <button onClick={onShare} style={{ flex:1, fontFamily:'var(--font-display)', fontWeight:700, fontSize:12,
          letterSpacing:'0.08em', padding:'14px', borderRadius:'var(--r-md)', cursor:'pointer',
          border:'1px solid var(--violet)', color:'var(--violet)', background:'rgba(59,130,246,0.08)' }}>
          {copied ? '✓ KOPIERT' : '↗ TEILEN'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, color, right, children }) {
  return (
    <div style={{ borderRadius:10, padding:'10px 12px',
      background:'rgba(0,0,0,0.35)', border:`1px solid ${color}2a` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
        <span style={{ fontFamily:'var(--font-display)', fontSize:9.5, letterSpacing:'0.12em', color,
          textShadow:`0 0 8px ${color}55` }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── Component: DrillCard (flip-card grammar drill from session errors) ───────
function DrillCard({ drill, ar }) {
  const [flipped, setFlipped] = useState(false);
  const rtl = ar ? { direction:'rtl', textAlign:'right' } : null;
  return (
    <div onClick={() => setFlipped(f => !f)} style={{ cursor:'pointer', marginBottom:9,
      padding:'10px 12px', borderRadius:10, userSelect:'none',
      border:`1px solid rgba(249,115,22,${flipped ? '0.65' : '0.3'})`,
      background: flipped ? 'rgba(249,115,22,0.09)' : 'rgba(249,115,22,0.04)',
      transition:'background 0.2s, border-color 0.2s' }}>
      <div style={{ fontSize:9.5, fontFamily:'var(--font-display)', color:'var(--action)', marginBottom:6, letterSpacing:'0.08em' }}>
        {drill.rule}
      </div>
      <div style={{ fontSize:12, color:'#fca5a5', marginBottom: flipped ? 8 : 0, fontStyle:'italic' }}>
        ✗ „{drill.before}"
      </div>
      {flipped ? (
        <>
          <div style={{ fontSize:12, color:'var(--accent)', marginBottom:6 }}>
            ✓ „{drill.after}"
          </div>
          <div style={{ fontSize:11, color:'var(--action-2)', lineHeight:1.5, ...rtl }}>
            {ar && drill.ar ? drill.ar : drill.de}
          </div>
        </>
      ) : (
        <div style={{ fontSize:9, color:'#64748b', textAlign:'center', marginTop:6 }}>
          ↕ {ar ? 'انقر للحل' : 'Tippe für Lösung'}
        </div>
      )}
    </div>
  );
}

// ── Component: Sparkline (zero-dependency inline SVG) ─────────────────────────
function Sparkline({ data, color = 'var(--accent)', invert = false, height = 34 }) {
  const pts = (data || []).filter((n) => Number.isFinite(n));
  if (pts.length < 2) {
    return <div style={{ height, display:'flex', alignItems:'center', fontSize:9, color:'#475569' }}>
      Noch nicht genug Daten</div>;
  }
  const w = 100, h = height, max = Math.max(...pts, 1), min = Math.min(...pts, 0);
  const span = max - min || 1;
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width:'100%', height }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx={w} cy={h - ((pts[pts.length-1] - min) / span) * (h - 4) - 2} r="2" fill={color} />
    </svg>
  );
}

// ── Component: Dashboard (return-to progress view) ────────────────────────────
function Dashboard({ data, loading, account, onClose, onReview, onLogout, onOpenGuide }) {
  const t   = data?.totals ?? {};
  const lp  = data?.levelProgress ?? { level: 1, pct: 0, intoLevel: 0, perLevel: 120 };
  const acc = data?.account ?? account;
  const sub = acc?.subscription ?? {};
  const ent = acc?.entitlement ?? {};
  const planName = (ent.plan || 'free').toUpperCase();
  const tierLabel = ent.dailyLiveMinutes > 0 ? `${planName} · ${ent.dailyLiveMinutes} Min/Tag` : 'GRATIS · Einstufung';
  const isFreePlan = (ent.plan || 'free') === 'free';
  return (
    <div style={{ position:'absolute', inset:0, zIndex:210, display:'flex', flexDirection:'column',
      background:'rgba(2,4,9,0.97)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 16px 8px' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:900, letterSpacing:2,
          color:'var(--accent)', textShadow:'0 0 20px rgba(59,130,246,0.5)' }}>FORTSCHRITT</div>
        <button onClick={onClose} style={{ fontFamily:'var(--font-display)', fontSize:10, cursor:'pointer',
          padding:'6px 12px', borderRadius:6, border:'1px solid rgba(59,130,246,0.3)', background:'transparent', color:'var(--accent)' }}>
          ✕ ZURÜCK
        </button>
      </div>

      {loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12 }}>
          Lade Fortschritt…
        </div>
      ) : (
        <div style={{ flex:1, overflowY:'auto', padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:13 }}>

          {/* Account + subscription */}
          {acc && (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'8px 12px', borderRadius:8, background:'rgba(0,0,0,0.35)', border:'1px solid rgba(59,130,246,0.18)' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:11, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acc.email}</div>
                <div style={{ fontSize:9, color: isFreePlan ? 'var(--action)' : 'var(--accent)', fontFamily:'var(--font-display)', letterSpacing:'0.08em', marginTop:2 }}>
                  {tierLabel}
                </div>
              </div>
              <button onClick={onLogout} style={{ fontSize:9, cursor:'pointer', fontFamily:'var(--font-display)',
                padding:'5px 9px', borderRadius:6, border:'1px solid rgba(239,68,68,0.4)', background:'transparent', color:'#fca5a5' }}>
                ABMELDEN
              </button>
            </div>
          )}

          {/* Level + boss ladder */}
          <Section title={`LEVEL ${lp.level}`} color="var(--accent)" right={
            <span style={{ fontSize:9, color:'#94a3b8' }}>{lp.intoLevel}/{lp.perLevel} XP</span>}>
            <div style={{ height:9, borderRadius:5, background:'rgba(255,255,255,0.06)', overflow:'hidden', marginBottom:8 }}>
              <div style={{ height:'100%', width:`${lp.pct}%`,
                background:'linear-gradient(90deg,var(--accent),var(--accent))', boxShadow:'0 0 10px rgba(59,130,246,0.6)',
                transition:'width 0.6s' }} />
            </div>
            <div style={{ fontSize:11, color:'#cbd5e1' }}>
              Aktueller Gegner: <b style={{ color:'#fca5a5' }}>{data?.currentBoss?.name}</b>
              <span style={{ color:'#64748b' }}> · {data?.currentBoss?.tier}</span>
            </div>
            {data?.nextBoss && (
              <div style={{ fontSize:10, color:'#64748b', marginTop:3 }}>
                Nächster Gegner ab Level {data.nextBoss.minLevel}: {data.nextBoss.name} ({data.nextBoss.tier})
              </div>
            )}
            <div style={{ fontSize:10, color:'var(--accent)', marginTop:5 }}>
              Noch {data?.remainingXp ?? Math.max(0, (lp.perLevel || 0) - (lp.intoLevel || 0))} XP bis Level {lp.level + 1}
              {data?.etaSessions ? ` · ~${data.etaSessions} Sitzung${data.etaSessions === 1 ? '' : 'en'}` : ''}
            </div>
          </Section>

          {/* Stat tiles */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <Metric label="SITZUNGEN"      value={t.sessions ?? 0}      color="var(--accent)" />
            <Metric label="VOKABEL"        value={t.vocabLearned ?? 0}  sub="gelernt" color="var(--accent)" />
            <Metric label="REGELN"         value={t.rulesMastered ?? 0} sub="gemeistert" color="var(--accent)" />
            <Metric label="FÄLLIG"         value={t.dueReviews ?? 0}    sub="Wiederholung" color="var(--action)" />
          </div>

          {/* Review CTA */}
          {(t.dueReviews ?? 0) > 0 && (
            <button onClick={onReview} style={{ width:'100%', fontFamily:'var(--font-display)', fontSize:11,
              letterSpacing:'0.12em', padding:'11px', borderRadius:8, cursor:'pointer',
              border:'1px solid var(--action)', color:'var(--action)', background:'rgba(249,115,22,0.08)' }}>
              ⚡ {t.dueReviews} WIEDERHOLUNG{(t.dueReviews) === 1 ? '' : 'EN'} JETZT ÜBEN
            </button>
          )}

          {/* Ask the mentor — reachable from the dashboard too, where a student reviewing their numbers
              is exactly the moment they want to ask "what do I do about this?" */}
          {onOpenGuide && (
            <button onClick={onOpenGuide} style={{ width:'100%', marginTop:8, fontFamily:'var(--font-display)', fontSize:11,
              letterSpacing:'0.1em', padding:'11px', borderRadius:8, cursor:'pointer',
              border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)' }}>
              🧭 الحسن · اسأل دليلك
            </button>
          )}

          {/* Trends */}
          <Section title="FLÜSSIGKEIT ÜBER ZEIT" color="var(--accent)">
            <Sparkline data={data?.trends?.fluency} color="var(--accent)" />
          </Section>
          <Section title="SPRECHTEMPO ÜBER ZEIT (Ziel 140–160 WpM)" color="var(--accent-2)">
            <Sparkline data={data?.trends?.wpm} color="var(--accent-2)" />
          </Section>
          <Section title="FÜLLWÖRTER-TREND (weniger = besser)" color="var(--action)">
            <Sparkline data={data?.trends?.fillers} color="var(--action)" />
          </Section>
          <Section title="WORTSCHATZ-WACHSTUM" color="var(--accent)">
            <Sparkline data={data?.trends?.vocab} color="var(--accent)" />
          </Section>

          {!!data?.masteredRules?.length && (
            <Section title="GEMEISTERTE REGELN" color="var(--accent)">
              {data.masteredRules.map((r, i) => (
                <div key={i} style={{ fontSize:11, color:'#ddd6fe', marginBottom:3 }}>✓ {r}</div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// (RecallDrill removed — the typed pre-fight warm-up duplicated SAG ES RICHTIG / Daily Training on the
//  same SRS items. One review surface, spoken + on-mission. Server /api/review[/grade] now unused.)

// ── Component: AuthScreen (login / signup gate) ───────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode]   = useState('signup');   // cold link-clickers are NEW visitors → show signup first (conversion)
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!email || !pw) { setErr({ de: 'Bitte E-Mail und Passwort eingeben.', ar: 'من فضلك دخّل الإيميل والباسورد.' }); return; }
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, ...(mode === 'signup' ? { ref: getRefCode() } : {}) }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(authErrText(data.error)); setBusy(false);
        // Email already registered → flip to LOGIN (keep the email) so the user isn't stuck re-signing-up.
        if (data.error === 'email_taken' && mode === 'signup') setMode('login');
        return;
      }
      // Honor the landing promise: open the free assessment right after a fresh signup.
      if (mode === 'signup') { try { localStorage.setItem('bpo_pending_assessment', '1'); } catch {} }
      onAuth({ token: data.token, account: data.account });
    } catch { setErr({ de: 'Server nicht erreichbar. Bitte versuche es gleich erneut.', ar: 'مفيش اتصال بالسيرفر. حاول تاني بعد شوية.' }); setBusy(false); }
  };

  return (
    <div style={{ minHeight:'100svh', maxWidth:440, margin:'0 auto', display:'flex', flexDirection:'column',
      justifyContent:'center', padding:'24px', position:'relative' }}>
      <div className="scanline" />
      <div style={{ textAlign:'center', marginBottom:24 }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:900, letterSpacing:3,
          color:'var(--accent)', textShadow:'0 0 24px rgba(59,130,246,0.6)' }}>OMNI-PERFORM</div>
        <div style={{ fontSize:10, color:'#64748b', marginTop:4, letterSpacing:'0.12em' }}>
          DE BPO COMBAT · SPRACHTRAINING
        </div>
        {/* Arabic-first positioning — our biggest moat: no other German trainer serves Arabic speakers */}
        <div dir="rtl" style={{ fontSize:14, fontWeight:700, color:'#f8fafc', marginTop:14, lineHeight:1.6, maxWidth:360, marginInline:'auto' }}>
          أول تدريب إنترفيو ألماني مصمم خصيصًا للعرب — علشان توصل للشغل في كول سنتر ألماني.
        </div>
        <div style={{ fontSize:11, color:'#94a3b8', marginTop:8, lineHeight:1.55, maxWidth:360, marginInline:'auto' }}>
          Das erste deutsche Interview-Trainer für Arabisch-Sprechende — optimiert für den ägyptischen BPO-Markt.
        </div>
        <div style={{ fontSize:10.5, color:'var(--action)', marginTop:10, lineHeight:1.5, maxWidth:360, marginInline:'auto' }}>
          🎯 Direkt nach der Anmeldung: kostenlose Einstufung deines Niveaus.
          <br /><span dir="rtl">🎯 بعد ما تسجّل على طول: تقييم مجاني لمستواك.</span>
        </div>
      </div>

      {/* Landing proof — honest, concrete (mirrors what the app actually does; no fabricated stats) */}
      <div style={{ maxWidth:380, margin:'0 auto 18px', display:'flex', flexDirection:'column', gap:8 }}>
        {[
          { icon:'🎤', ar:'إنترفيو ألماني حقيقي بالصوت ضد HR صعب',          de:'Echtes deutsches Voice-Interview gegen einen harten HR-Boss' },
          { icon:'🎯', ar:'فيدباك دقيق على أخطائك انت — مش كلام عام',        de:'Präzises Feedback auf DEINE Fehler (Grammatik via LanguageTool) — nie generisch' },
          { icon:'📈', ar:'شوف تقدّمك أسبوع بأسبوع لحد ما تتوظف',           de:'Sieh deinen Fortschritt Woche für Woche — bis zum Job' },
        ].map((b, i) => (
          <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start',
            background:'rgba(59,130,246,0.05)', border:'1px solid rgba(59,130,246,0.15)', borderRadius:10, padding:'9px 11px' }}>
            <span style={{ fontSize:16, lineHeight:1.3 }}>{b.icon}</span>
            <div style={{ flex:1 }}>
              <div dir="rtl" style={{ fontSize:12, fontWeight:700, color:'#e2e8f0' }}>{b.ar}</div>
              <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{b.de}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderRadius:14, padding:20,
        background:'linear-gradient(145deg,#0a0f1a,#060c15)', border:'1px solid rgba(59,130,246,0.25)',
        boxShadow:'0 0 28px rgba(59,130,246,0.12)' }}>
        <div style={{ display:'flex', gap:6, marginBottom:16 }}>
          {['login','signup'].map((m) => (
            <button key={m} onClick={() => { setMode(m); setErr(''); }}
              style={{ flex:1, padding:'8px', cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10,
                letterSpacing:'0.1em', borderRadius:7, border:`1px solid ${mode===m?'var(--accent)':'rgba(59,130,246,0.2)'}`,
                background: mode===m?'rgba(59,130,246,0.1)':'transparent', color: mode===m?'var(--accent)':'#64748b' }}>
              {m === 'login' ? 'ANMELDEN' : 'REGISTRIEREN'}
            </button>
          ))}
        </div>

        <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="E-Mail"
          autoComplete="email" style={inputStyle} />
        <input type="password" value={pw} onChange={(e)=>setPw(e.target.value)} placeholder="Passwort (min. 6 Zeichen)"
          autoComplete={mode==='signup'?'new-password':'current-password'}
          onKeyDown={(e)=>{ if(e.key==='Enter') submit(); }} style={{ ...inputStyle, marginTop:10 }} />

        {err && (
          <div style={{ marginTop:10 }}>
            <div style={{ color:'#fca5a5', fontSize:11 }}>⚠ {err.de}</div>
            {err.ar && <div dir="rtl" style={{ color:'#fca5a5', fontSize:11, marginTop:2 }}>{err.ar}</div>}
          </div>
        )}

        <button onClick={submit} disabled={busy}
          style={{ width:'100%', marginTop:16, padding:'13px', cursor:busy?'wait':'pointer',
            fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.14em', borderRadius:8,
            border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)', opacity:busy?0.6:1 }}>
          {busy ? '…' : mode==='login' ? 'ANMELDEN' : 'KONTO ERSTELLEN'}
        </button>
        <div style={{ fontSize:9.5, color:'#475569', textAlign:'center', marginTop:12, lineHeight:1.6 }}>
          Kostenlos starten: Niveau-Einstufung · كل ده بالعربي · مجاني للبداية
        </div>
      </div>
    </div>
  );
}
const inputStyle = {
  width:'100%', padding:'12px', borderRadius:8, fontSize:14, fontFamily:'Share Tech Mono, monospace',
  background:'rgba(255,255,255,0.04)', color:'#e2e8f0', border:'1px solid rgba(59,130,246,0.25)', outline:'none',
};

// ── Component: PaywallScreen = the EGP pricing page (Basic / Elite, daily minutes) ─────
// Prices + minutes come from plans.config.js via /api/billing/status (single source).
const PERKS_DE = {
  basic: (m) => [`bis zu ${m} Min Live-Interview — JEDEN TAG`, 'Arabisch-Feedback', 'alle Bosse',
                 'unbegrenzte Drills, Shadowing & Wiederholung', 'volles Trainingslager — auf deine Fehler zugeschnitten'],
  elite: (m) => [`bis zu ${m} Min Live-Interview — JEDEN TAG`, 'monatliche Neu-Einstufung',
                 'rollen-spezifischer Gegner', 'alles aus Basic (inkl. volles Trainingslager)'],
};
const SUB_AR = {
  basic: (m) => `لحد ${m} دقايق إنترفيو مباشر كل يوم + Trainingslager كامل متفصّل على أخطائك + تمارين بلا حدود.`,
  elite: (m) => `لحد ${m} دقيقة إنترفيو مباشر كل يوم + كل مزايا Basic + إعادة تقييم شهرية + خصم مخصص.`,
};

function PaywallScreen({ token, info, onUpgraded, onClose, lang = 'de' }) {
  const [email, setEmail]   = useState('');
  const [accountId, setAccountId] = useState('');
  const [plans, setPlans]   = useState(null);
  const [yearly, setYearly] = useState(false);
  const [vodafone, setVodafone] = useState(null);
  const [whatsapp, setWhatsapp] = useState(null);
  const [pay, setPay]       = useState(null);   // { planId, label, amountEGP, period } | chosen plan to pay
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [pendingPayment, setPendingPayment] = useState(null); // server source of truth
  const [paymentRejected, setPaymentRejected] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setEmail(d.account?.email || ''); setAccountId(d.account?.id || '');
        if (Array.isArray(d.plans)) setPlans(d.plans);
        setVodafone(d.vodafoneNumber || null); setWhatsapp(d.whatsappNumber || null);
        setPendingPayment(d.pendingPayment || null); setPaymentRejected(!!d.paymentRejected);
      })
      .catch(() => {});
  }, [token]);

  const ar  = lang === 'ar';
  const fmt = (n) => Number(n || 0).toLocaleString('de-DE');   // 1299 → "1.299"
  // Short reference code the user writes in their Vodafone Cash transfer note (last 6 of id).
  const refCode = accountId ? accountId.slice(-6).toUpperCase() : '------';

  // Post-payment "send proof" actions: copy the reference code, and (if a WhatsApp number is
  // configured) one-tap open WhatsApp prefilled with the code so the customer isn't stranded
  // during the manual-activation wait. Copy works always; the WhatsApp button appears once
  // WHATSAPP_NUMBER is set on the server. Reduces the post-payment black-box anxiety.
  const copyCode = (code) => { try { navigator.clipboard?.writeText(String(code)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const waLink = (code) => {
    const digits = whatsapp ? String(whatsapp).replace(/\D/g, '') : '';
    if (!digits) return null;
    const planLabel = pay?.label || (pendingPayment?.plan ? pendingPayment.plan.toUpperCase() : '');
    const msg = ar
      ? `أهلاً، دفعت اشتراك OMNI-PERFORM ${planLabel}. كود التحويل بتاعي: ${code}`
      : `Hallo, ich habe für OMNI-PERFORM ${planLabel} bezahlt. Mein Überweisungs-Code: ${code}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  };
  const proofActions = (code) => (
    <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:9 }}>
      {waLink(code) && (
        <a href={waLink(code)} target="_blank" rel="noopener noreferrer"
          style={{ display:'block', textAlign:'center', textDecoration:'none', padding:'13px', minHeight:48, lineHeight:'22px',
            fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.06em', borderRadius:9, fontWeight:700,
            color:'#04130c', background:'linear-gradient(135deg,var(--accent),var(--accent))', border:'1px solid var(--accent)' }}>
          💬 {ar ? 'ابعت إثبات الدفع على واتساب' : 'Zahlungsbeleg per WhatsApp senden'}
        </a>
      )}
      <button onClick={() => copyCode(code)}
        style={{ width:'100%', padding:'11px', minHeight:44, cursor:'pointer', fontFamily:'var(--font-display)', fontSize:11,
          borderRadius:8, border:'1px dashed var(--action)', background:'rgba(249,115,22,0.08)', color:'var(--action)' }}>
        {copied ? (ar ? 'تم نسخ الكود ✓' : 'Code kopiert ✓') : (ar ? `انسخ الكود · ${code}` : `Code kopieren · ${code}`)}
      </button>
    </div>
  );

  // Tap "I paid": record a PENDING request. Grants NO access — the owner verifies & activates.
  const onPaid = async () => {
    if (submitting || !pay) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_URL}/api/billing/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: pay.planId, billingPeriod: pay.period }),
      });
      if (r.ok) setSubmitted(true);
    } catch { /* user can re-tap */ }
    setSubmitting(false);
  };

  const shell = (children) => (
    <div style={{ position:'absolute', inset:0, zIndex:220, display:'flex', flexDirection:'column',
      background:'rgba(2,4,9,0.97)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease', padding:18, overflowY:'auto' }}>
      {children}
    </div>
  );

  // ── "REQUEST RECEIVED" VIEW (after tapping I paid) — verify-first, NO access yet ──
  if (pay && submitted) {
    return shell(<>
      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', textAlign:'center', padding:'0 4px' }}>
        <div style={{ fontSize:48 }}>✅</div>
        <div dir="rtl" style={{ fontSize:14, color:'var(--accent)', fontWeight:700, marginTop:10, lineHeight:1.8 }}>
          تم استلام طلبك ✅ — اشتراكك هيتفعّل خلال ٣٠ دقيقة بعد ما نتأكد من الدفع. تأكد إنك كتبت الكود <b style={{ color:'var(--action)' }}>{refCode}</b> في التحويل.
        </div>
        <div style={{ fontSize:12.5, color:'#cbd5e1', marginTop:14, lineHeight:1.65 }}>
          Anfrage erhalten! Dein Plan wird innerhalb von 30 Minuten nach Zahlungsbestätigung aktiviert. Stelle sicher, dass du den Code <b style={{ color:'var(--action)' }}>{refCode}</b> in der Überweisung angegeben hast.
        </div>
        {proofActions(refCode)}
      </div>
      <button onClick={onClose} style={{ width:'100%', marginTop:14, padding:'12px', minHeight:46, cursor:'pointer',
        fontFamily:'var(--font-display)', fontSize:11, borderRadius:8, border:'1px solid rgba(148,163,184,0.4)', background:'transparent', color:'#cbd5e1' }}>
        {ar ? 'تمام' : 'OK'}
      </button>
    </>);
  }

  // ── PAYMENT-INSTRUCTIONS VIEW ──
  if (pay) {
    return shell(<>
      <div style={{ textAlign:'center', marginBottom:12 }}>
        <div style={{ fontSize:30 }}>📲</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:900, letterSpacing:1.5, color:'var(--accent-2)' }}>VODAFONE CASH</div>
        <div style={{ fontSize:11, color:'#cbd5e1', marginTop:4 }}>
          {pay.label?.toUpperCase()} — <b>{fmt(pay.amountEGP)} EGP</b> {pay.period === 'yearly' ? (ar?'سنويًا':'/Jahr') : (ar?'شهريًا':'/Monat')}
        </div>
      </div>

      {vodafone ? (
        <div style={{ flex:1 }}>
          {/* Step 1 — send the money */}
          <div style={{ borderRadius:10, padding:'12px 13px', marginBottom:10, background:'rgba(0,0,0,0.4)', border:'1px solid rgba(96,165,250,0.3)' }}>
            <div style={{ fontSize:11.5, color:'#e2e8f0', lineHeight:1.5 }}>
              <b style={{ color:'var(--accent-2)' }}>1)</b> Sende <b>{fmt(pay.amountEGP)} EGP</b> per Vodafone Cash an diese Nummer:
            </div>
            <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:3 }}>حوّل <b>{fmt(pay.amountEGP)} جنيه</b> فودافون كاش على الرقم ده:</div>
            <div style={{ textAlign:'center', fontFamily:'Share Tech Mono, monospace', fontSize:22, fontWeight:700, color:'#fff',
              background:'rgba(96,165,250,0.12)', border:'1px solid rgba(96,165,250,0.4)', borderRadius:8, padding:'10px', marginTop:8, letterSpacing:'0.04em' }}>
              {vodafone}
            </div>
          </div>

          {/* Step 2 — the reference code */}
          <div style={{ borderRadius:10, padding:'12px 13px', marginBottom:10, background:'rgba(249,115,22,0.07)', border:'1px solid rgba(249,115,22,0.4)' }}>
            <div style={{ fontSize:11.5, color:'#e2e8f0', lineHeight:1.5 }}>
              <b style={{ color:'var(--action)' }}>2)</b> Schreibe diesen Code in die Notiz der Überweisung:
            </div>
            <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:3 }}>اكتب الكود ده في ملاحظة التحويل (مهم عشان نعرف إنك إنت):</div>
            <div style={{ textAlign:'center', fontFamily:'var(--font-display)', fontSize:26, fontWeight:900, color:'var(--action)',
              background:'rgba(0,0,0,0.4)', border:'1px dashed var(--action)', borderRadius:8, padding:'10px', marginTop:8, letterSpacing:'0.2em', textShadow:'0 0 12px rgba(249,115,22,0.5)' }}>
              {refCode}
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ fontSize:11.5, color:'#cbd5e1', lineHeight:1.6, marginBottom:6 }}>
            <b style={{ color:'var(--accent)' }}>3)</b> Tippe danach unten auf «Ich habe bezahlt».
            <br /><span dir="rtl">وبعد ما تحوّل، دوس تحت على «دفعت».</span>
          </div>

          {/* "I paid" → records a PENDING request (verify-first). Grants NO access. */}
          <button onClick={onPaid} disabled={submitting}
            style={{ width:'100%', marginTop:8, padding:'13px', minHeight:48, cursor: submitting ? 'wait' : 'pointer', fontFamily:'var(--font-display)',
              fontSize:12, letterSpacing:'0.08em', borderRadius:9, fontWeight:700, border:'1px solid var(--accent)', color:'#04130c',
              background:'linear-gradient(135deg,var(--accent),var(--accent))', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? '…' : 'دفعت · ICH HABE BEZAHLT'}
          </button>
        </div>
      ) : (
        <div style={{ flex:1, display:'grid', placeItems:'center', textAlign:'center', color:'#94a3b8', fontSize:12, padding:20 }}>
          Zahlung bald verfügbar.<br /><span dir="rtl">الدفع هيكون متاح قريب.</span>
        </div>
      )}

      <button onClick={() => setPay(null)} style={{ width:'100%', marginTop:12, padding:'11px', minHeight:44, cursor:'pointer',
        fontFamily:'var(--font-display)', fontSize:10, borderRadius:8, border:'1px solid rgba(148,163,184,0.3)', background:'transparent', color:'#94a3b8' }}>
        {ar ? '‹ رجوع للخطط' : '‹ ZURÜCK ZU DEN PLÄNEN'}
      </button>
    </>);
  }

  // ── PENDING-PAYMENT VIEW — the source-of-truth "we're verifying" state (any paid gate) ──
  if (pendingPayment) {
    const code = pendingPayment.referenceCode || refCode;
    return shell(<>
      <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', textAlign:'center', padding:'0 4px' }}>
        <div style={{ fontSize:46 }}>⏳</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:800, color:'var(--accent)', marginTop:8 }}>
          {ar ? 'بنتأكد من دفعك' : 'Wir prüfen deine Zahlung'}
        </div>
        <div dir="rtl" style={{ fontSize:13.5, color:'#cbd5e1', marginTop:12, lineHeight:1.85 }}>
          طلبك وصلنا ✅ وبنتأكد من الدفع دلوقتي — اشتراكك هيتفعّل خلال ٣٠ دقيقة. الكود بتاعك: <b style={{ color:'var(--action)' }}>{code}</b>. لو عايز تتأكد إنك كتبته في التحويل، ده هو.
        </div>
        <div style={{ fontSize:12.5, color:'#94a3b8', marginTop:14, lineHeight:1.65 }}>
          Deine Anfrage ist da ✅ — wir prüfen gerade die Zahlung. Dein Plan wird innerhalb von 30 Minuten aktiviert. Dein Code: <b style={{ color:'var(--action)' }}>{code}</b>.
        </div>
        {proofActions(code)}
      </div>
      <button onClick={onClose} style={{ width:'100%', marginTop:14, padding:'12px', minHeight:46, cursor:'pointer',
        fontFamily:'var(--font-display)', fontSize:11, borderRadius:8, border:'1px solid rgba(148,163,184,0.4)', background:'transparent', color:'#cbd5e1' }}>
        {ar ? 'تمام' : 'OK'}
      </button>
    </>);
  }

  // ── PLAN CARDS VIEW ──
  const toggleBtn = (on, label, sub) => (
    <button onClick={() => setYearly(on)} style={{ flex:1, padding:'8px 6px', cursor:'pointer', borderRadius:8,
      fontFamily:'var(--font-display)', fontSize:10, letterSpacing:'0.06em', lineHeight:1.3,
      border:`1px solid ${yearly===on ? 'var(--action)' : 'rgba(148,163,184,0.3)'}`,
      background: yearly===on ? 'rgba(249,115,22,0.14)' : 'transparent', color: yearly===on ? 'var(--action)' : '#94a3b8' }}>
      {label}{sub && <div style={{ fontSize:8, color:'var(--accent)', marginTop:2 }}>{sub}</div>}
    </button>
  );

  return shell(<>
      <div style={{ textAlign:'center', marginBottom:10 }}>
        <div style={{ fontSize:34 }}>🥊</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:900, letterSpacing:2,
          color:'var(--action)', textShadow:'0 0 18px rgba(249,115,22,0.5)' }}>PLAN WÄHLEN · اختار خطتك</div>
        <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:5, lineHeight:1.6 }}>
          Beide Pläne: Live-Interview JEDEN TAG. Die kostenlose Einstufung bleibt immer frei.
          <br /><span dir="rtl">الخطتين: إنترفيو مباشر كل يوم. تقييم المستوى المجاني دايمًا متاح.</span>
        </div>
      </div>

      {paymentRejected && (
        <div style={{ fontSize:10.5, color:'#fca5a5', textAlign:'center', lineHeight:1.6, marginBottom:10,
          background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'8px 10px' }}>
          Zahlung konnte nicht bestätigt werden — bitte versuche es erneut.
          <br /><span dir="rtl">لم نتمكن من تأكيد الدفع — حاول مرة أخرى.</span>
        </div>
      )}

      {/* monthly / yearly toggle */}
      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {toggleBtn(false, ar ? 'شهري' : 'MONATLICH')}
        {toggleBtn(true, ar ? 'سنوي' : 'JÄHRLICH', ar ? 'شهرين هدية' : '2 Monate geschenkt')}
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:11 }}>
        {(plans || []).map((p) => {
          const price  = yearly ? p.yearlyEGP : p.priceEGP;
          const period = yearly ? (ar ? '/سنة' : '/Jahr') : (ar ? '/شهر' : '/Monat');
          const saving = (p.priceEGP * 12) - p.yearlyEGP;
          const elite  = p.id === 'elite';
          const accent = elite ? 'var(--action)' : 'var(--accent-2)';
          return (
            <div key={p.id} style={{ borderRadius:12, padding:14, position:'relative',
              background:'rgba(0,0,0,0.4)', border:`1px solid ${elite ? 'rgba(249,115,22,0.5)' : 'rgba(96,165,250,0.3)'}`,
              boxShadow: elite ? '0 0 20px rgba(249,115,22,0.12)' : 'none' }}>
              {elite && (
                <div style={{ position:'absolute', top:-9, right:12, fontSize:8.5, fontFamily:'var(--font-display)', letterSpacing:'0.06em',
                  background:'var(--action)', color:'#04070d', padding:'2px 8px', borderRadius:99, fontWeight:700 }}>
                  {ar ? 'الأنسب للإنترفيو' : 'Beliebt für Interview-Prep'}
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                <span style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:900, color:accent }}>{p.label?.toUpperCase()}</span>
                <span style={{ fontSize:14, color:'#e2e8f0', fontWeight:700 }}>{fmt(price)} EGP<span style={{ fontSize:10, color:'#94a3b8' }}>{period}</span></span>
              </div>
              {yearly && (
                <div style={{ fontSize:9.5, color:'var(--accent)', marginBottom:7 }}>
                  {ar ? `شهرين هدية · وفّر ${fmt(saving)} جنيه` : `2 Monate geschenkt · spare ${fmt(saving)} EGP`}
                </div>
              )}
              {(PERKS_DE[p.id]?.(p.dailyLiveMinutes) || []).map((perk) => (
                <div key={perk} style={{ fontSize:11, color:'#cbd5e1', marginBottom:3 }}>✓ {perk}</div>
              ))}
              <div dir="rtl" style={{ fontSize:10.5, color:'#94a3b8', marginTop:6, lineHeight:1.6 }}>{SUB_AR[p.id]?.(p.dailyLiveMinutes)}</div>
              <button onClick={() => setPay({ planId: p.id, label: p.label, amountEGP: yearly ? p.yearlyEGP : p.priceEGP, period: yearly ? 'yearly' : 'monthly' })}
                style={{ width:'100%', marginTop:11, padding:'12px', minHeight:46, cursor:'pointer',
                  fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.1em', borderRadius:8, fontWeight:700,
                  border:`1px solid ${accent}`, color:'#04070d', background:accent }}>
                {p.label?.toUpperCase()} {ar ? 'اختار' : 'WÄHLEN'} ▸
              </button>
            </div>
          );
        })}
        {!plans && <div style={{ textAlign:'center', color:'#64748b', fontSize:11, padding:20 }}>…</div>}

        <div style={{ fontSize:9.5, color:'#64748b', textAlign:'center', lineHeight:1.5 }}>
          Zahlung manuell per Vodafone Cash während der Early-Access-Phase.
          <br /><span dir="rtl">الدفع يدوي عن طريق فودافون كاش في مرحلة الإطلاق المبكر.</span>
        </div>
      </div>

      <button onClick={onClose} style={{ width:'100%', marginTop:10, padding:'11px', minHeight:44, cursor:'pointer',
        fontFamily:'var(--font-display)', fontSize:10, borderRadius:8,
        border:'1px solid rgba(148,163,184,0.3)', background:'transparent', color:'#94a3b8' }}>
        {ar ? 'رجوع' : 'ZURÜCK'}
      </button>
  </>);
}

// ── Main App ──────────────────────────────────────────────────────────────────
let _lineId = 0;

// Feedback-explanation language preference ('de' | 'ar'), persisted across sessions.
function loadFeedbackLang() {
  try { return localStorage.getItem('omni_feedback_lang') === 'ar' ? 'ar' : 'de'; } catch { return 'de'; }
}
function saveFeedbackLang(l) {
  try { localStorage.setItem('omni_feedback_lang', l); } catch { /* ignore */ }
}

// Training-streak cache — instant render before the authoritative backend value loads,
// and an offline fallback. The backend (computeStreak) remains the source of truth.
function loadStreakCache() { try { return parseInt(localStorage.getItem('omni_streak') || '0', 10) || 0; } catch { return 0; } }
function saveStreakCache(n) { try { localStorage.setItem('omni_streak', String(n)); } catch { /* ignore */ } }

// Home reassurance badge while a payment is being verified (tap to reveal code + WhatsApp).
function PendingBadge({ pending, whatsapp, lang }) {
  const [open, setOpen] = useState(false);
  const ar = lang === 'ar';
  const code = pending?.referenceCode || '------';
  const waDigits = whatsapp ? String(whatsapp).replace(/\D/g, '') : '';
  const waLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent((ar ? 'كود الدفع: ' : 'Zahlungs-Code: ') + code)}` : null;
  return (
    <div onClick={() => setOpen((o) => !o)} style={{ marginBottom: 8, padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
      background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.4)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--action)', lineHeight: 1.5, textAlign: 'center' }}>
        {ar ? 'اشتراكك قيد التأكيد ⏳ — هيتفعّل خلال ٣٠ دقيقة' : 'Zahlung wird geprüft — Aktivierung in ~30 Min'}
        <span style={{ color: '#94a3b8' }}> {open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 8, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{ar ? 'الكود بتاعك (لازم يبقى في التحويل)' : 'Dein Code (muss in der Überweisung stehen)'}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: 'var(--action)', letterSpacing: '0.15em' }}>{code}</div>
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 10.5,
              color: '#04130c', background: '#25D366', borderRadius: 7, padding: '7px 12px', fontWeight: 700, textDecoration: 'none' }}>
              {ar ? '📤 ابعت الإيصال على واتساب' : '📤 Beleg per WhatsApp senden'}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Arena({ auth, onLogout, onAccountUpdate }) {
  // (Global CSS is injected once at the app root so the cold-start + auth screens share it.)

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase]         = useState('idle');
  // idle | connecting | active | stopping | error
  const [bossHp, setBossHp]       = useState(100);
  const [playerHp, setPlayerHp]   = useState(100);
  const [emotion, setEmotion]     = useState('idle');
  const [bossText, setBossText]   = useState('');
  const [bossIsCorrection, setBossIsCorrection] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [bossSpeak, setBossSpeak] = useState(false);
  const [userSpeak, setUserSpeak] = useState(false);
  // Boss voice (browser TTS) on/off — persisted; default ON so the boss speaks.
  const [ttsMuted, setTtsMuted] = useState(() => {
    try { return localStorage.getItem('ttsMuted') === '1'; } catch { return false; }
  });
  const ttsMutedRef = useRef(ttsMuted);
  useEffect(() => { ttsMutedRef.current = ttsMuted; try { localStorage.setItem('ttsMuted', ttsMuted ? '1' : '0'); } catch {} }, [ttsMuted]);
  // Fresh-value refs for the boss-voice fetch (avoids stale closures in handleMsg).
  const tokenRef     = useRef(auth.token);
  useEffect(() => { tokenRef.current = auth.token; }, [auth.token]);
  const bossVoiceRef = useRef('aura-2-julius-de');   // Deepgram fallback voice; set per boss on scenario_info
  const bossElevenVoiceRef = useRef('');             // ElevenLabs primary voice id (per character)
  const bossPatienceRef = useRef(0);                 // per-persona turn-taking patience (ms): gentle interviewers wait longer before responding
  // Turn-based answer input (typed or spoken→transcribed).
  const [answerText, setAnswerText]   = useState('');
  const [bossThinking, setBossThinking] = useState(false); // waiting for the boss's next turn
  const [recording, setRecording]     = useState(false);   // mic clip in progress
  const [transcribing, setTranscribing] = useState(false); // clip → text in flight
  const [error, setError]         = useState(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [scoreFlash, setScoreFlash] = useState(null);
  const [screenFlash, setScreenFlash] = useState(null); // 'green' | 'red' | null
  const [bossHurt, setBossHurt]   = useState(false);
  const [shakeScreen, setShakeScreen] = useState(false);
  const [bossDmgFloat, setBossDmgFloat] = useState(null); // {id, amount} flying damage number
  const [bossReason, setBossReason]     = useState(null); // {id, amount, label} why boss lost HP
  const [playerReason, setPlayerReason] = useState(null); // {id, amount, label} why player lost HP
  const [liveWpm, setLiveWpm]   = useState(0);   // live HUD — all backend-supplied, display-only
  const [fillerCount, setFillerCount] = useState(0);
  const [combo, setCombo]       = useState(0);
  const [roundFlash, setRoundFlash] = useState(null); // {id, n, label} round-advance banner
  const [feedbackLang, setFeedbackLang] = useState(loadFeedbackLang); // 'de'|'ar' — explanation language
  const chooseFeedbackLang = useCallback((l) => { setFeedbackLang(l); saveFeedbackLang(l); }, []);
  // One-time "how it works" guide for first-time users (dismissed = stored per device).
  const [showHowto, setShowHowto] = useState(() => { try { return !localStorage.getItem('bpo_howto_seen'); } catch { return false; } });
  const dismissHowto = () => { try { localStorage.setItem('bpo_howto_seen', '1'); } catch {} setShowHowto(false); };
  const [streak, setStreak] = useState(loadStreakCache); // (legacy fight streak, kept)
  const [daily, setDaily]   = useState({ streak: 0, completedToday: false, streakShield: false, best: 0 }); // daily-training loop
  const [trainedToday, setTrainedToday] = useState(true); // any practice today? (drives loss-aversion line)
  const [rank, setRank]     = useState(null);              // interview-readiness rank ladder
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard]         = useState(null); // { entries, myId }
  const [dailyOpen, setDailyOpen] = useState(false);       // Tägliches Training overlay
  const [dueReviews, setDueReviews] = useState(0);         // due SRS cards (home-screen CTA)
  const [zielplanOpen, setZielplanOpen] = useState(false); // Zielplan (goal-plan) overlay
  const [nachweisOpen, setNachweisOpen] = useState(false); // Trainingsnachweis (progress cert)
  const [totals, setTotals] = useState({});                // from /api/progress totals
  const [level, setLevel]         = useState('a2-b1');     // chosen before start: 'a2-b1' | 'b2'
  const [bossPick, setBossPick]   = useState('');          // boss-picker (test): '' = auto by level
  const [handsFree, setHandsFree] = useState(true);        // Freisprech: auto start/stop/send — ON by default
  const [showOpts, setShowOpts]   = useState(false);       // idle home: advanced options (interviewer/freisprech/lang) collapsed by default — declutter
  const [liveTranscript, setLiveTranscript] = useState(''); // Deepgram streaming partial (cleared on transcript_done)
  const [funnel, setFunnel]       = useState(null);        // {stages, idx, levelLabel, displayName}
  const [debrief, setDebrief]     = useState(null);        // end-of-session feedback payload
  const [debriefPending, setDebriefPending] = useState(false);
  const [noSession, setNoSession] = useState(false);       // closed without real participation → honest message, no card
  const [dashboard, setDashboard] = useState(null);        // { data, loading } | null
  const [paywall, setPaywall]     = useState(null);        // entitlement info when blocked | null
  const [billing, setBilling]     = useState(null);        // { plan, minutesRemaining, pendingPayment, justActivated, ... }
  const [assessmentOpen, setAssessmentOpen] = useState(false); // free level-assessment flow
  const [shadowingOpen, setShadowingOpen] = useState(false);   // paid shadowing practice route
  const [fluencyOpen, setFluencyOpen] = useState(false);       // paid 4-3-2 fluency drill route
  const [listeningOpen, setListeningOpen] = useState(false);   // paid listening & data-capture drill route
  const [spokenReviewOpen, setSpokenReviewOpen] = useState(false); // paid spoken-production SRS route
  const [pressureOpen, setPressureOpen] = useState(false);         // pressure-ladder overload drill (client-only)
  const [guideOpen, setGuideOpen] = useState(false);           // Alhassan mentor chat
  const [csBriefing, setCsBriefing] = useState(null);         // {situation, skill, keyPhrases} — shown before boss speaks
  const [showBriefing, setShowBriefing] = useState(false);    // pre-fight briefing card visible

  // Honor the landing promise ("kostenlose Einstufung direkt nach der Anmeldung"): if the user
  // just signed up, auto-open the free assessment ONCE (flag set in AuthScreen on signup).
  useEffect(() => {
    let pending = false;
    try { pending = localStorage.getItem('bpo_pending_assessment') === '1'; } catch {}
    if (!pending) return;
    try { localStorage.removeItem('bpo_pending_assessment'); } catch {}
    fetch(`${API_URL}/api/assessment/status`, { headers: { Authorization: `Bearer ${auth.token}` } })
      .then((r) => r.json()).then((d) => { if (d && !d.used) setAssessmentOpen(true); }).catch(() => {});
  }, []);   // once, on first mount after signup
  const [trainingslagerOpen, setTrainingslagerOpen] = useState(false); // study game-map route

  const phaseRef       = useRef('idle');
  const startingRef    = useRef(false);     // synchronous single-flight guard for start()
  const levelRef       = useRef('a2-b1');   // read inside the WS handler when starting
  const bossPickRef    = useRef('');         // boss-picker selection, read when sending START_FIGHT
  const fightModeRef   = useRef('daily');   // 'daily' | 'bosstor' — read when sending START_FIGHT
  const volRef         = useRef(0);   // mic volume — a ref, NOT state (see WaveformRing)
  const wsRef          = useRef(null);
  const recorderRef    = useRef(null);
  const pingRef        = useRef(null);
  const partialIdRef   = useRef(null);
  const bossPartialIdRef = useRef(null);   // live boss subtitle line in the transcript
  const clipRecRef      = useRef(null);    // ClipRecorder for spoken answers
  const livePartialRef  = useRef('');      // latest Deepgram partial — read by the adaptive VAD
  const stageIdxRef     = useRef(0);       // current funnel stage — 0/1 (intro+behavioral) = patient
  const pendingDurationRef = useRef(0);    // last clip duration (ms), for WPM; 0 if typed
  const bossLineRef      = useRef('');     // accumulates the current boss line
  const prevBossHpRef  = useRef(100);
  const prevPlayerHpRef = useRef(100);
  const prevIdxRef     = useRef(0);   // tracks the round index to detect advances
  const pendingFightRef = useRef(null); // {planId, stepId} when a fight was launched from a Zielplan step

  const setPhaseSync = useCallback((p) => { phaseRef.current = p; setPhase(p); }, []);
  const chooseLevel  = useCallback((l) => { levelRef.current = l; setLevel(l); }, []);
  const chooseBoss   = useCallback((b) => { bossPickRef.current = b; setBossPick(b); }, []);

  // The SERVER is the single source of truth for whether the session is over.
  // HP is purely a visual stake — it NEVER ends the session. The result screen only
  // appears in response to server debrief/session events (see handleMsg + render).

  // ── HP change animations ──────────────────────────────────────────────────
  useEffect(() => {
    if (bossHp < prevBossHpRef.current) {
      setBossHurt(true); setTimeout(() => setBossHurt(false), 600);
      setScreenFlash('green'); setTimeout(() => setScreenFlash(null), 320);
    }
    if (playerHp < prevPlayerHpRef.current) {
      setShakeScreen(true); setTimeout(() => setShakeScreen(false), 420);
      setScreenFlash('red'); setTimeout(() => setScreenFlash(null), 320);
    }
    prevBossHpRef.current   = bossHp;
    prevPlayerHpRef.current = playerHp;
  }, [bossHp, playerHp]);

  // ── Round advance → cinematic "RUNDE n" banner ────────────────────────────
  useEffect(() => {
    const idx = funnel?.idx ?? 0;
    if (!funnel) { prevIdxRef.current = 0; return; }
    if (idx !== prevIdxRef.current && idx > 0) {
      const st  = funnel.stages?.[idx];
      const rid = ++_lineId;
      setRoundFlash({ id: rid, n: idx + 1, label: st?.label ?? '' });
      setTimeout(() => setRoundFlash(r => (r && r.id === rid ? null : r)), 1700);
    }
    prevIdxRef.current = idx;
  }, [funnel?.idx]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS message dispatch ────────────────────────────────────────────────────
  const handleMsg = useCallback((msg) => {
    switch (msg.type) {
      case S.SESSION_READY:
        setBossHp(msg.bossHp ?? 100);
        setPlayerHp(msg.playerHp ?? 100);
        setLiveWpm(0); setFillerCount(0); setCombo(0);   // fresh HUD for the new fight
        bossLineRef.current = '';
        wsRef.current?.send(JSON.stringify({ type: C.START_FIGHT, token: auth.token, level: levelRef.current, mode: fightModeRef.current, bossId: bossPickRef.current || undefined }));
        break;

      case S.LIVE_STATS:
        // Backend-computed live meters (display-only).
        if (Number.isFinite(msg.wpm))         setLiveWpm(msg.wpm);
        if (Number.isFinite(msg.fillerTotal)) setFillerCount(msg.fillerTotal);
        if (Number.isFinite(msg.combo))       setCombo(msg.combo);
        break;

      case S.SCENARIO_INFO:
        setFunnel({
          stages:      msg.stages ?? [],
          idx:         0,
          levelLabel:  msg.levelLabel ?? '',
          displayName: msg.displayName ?? 'HERR TARIQ',
        });
        // Pre-fight scenario briefing (shown while boss is loading, dismissed on first BOSS_SPEECH)
        if (msg.csBriefing?.keyPhrases?.length) {
          setCsBriefing(msg.csBriefing);
          setShowBriefing(true);
          // Auto-dismiss after 12s so even non-tap users see the fight start
          setTimeout(() => setShowBriefing(false), 12_000);
        }
        // Aura-2 German voice: prefer the server-sent per-character voice; fall back to a
        // gender-correct map so a female boss is NEVER voiced by the male default.
        {
          const VOICE_BY_BOSS = {
            'yasmin': 'aura-2-lara-de', 'hana': 'aura-2-viktoria-de', 'frau-mona-adel': 'aura-2-aurelia-de',
            'karim': 'aura-2-fabian-de', 'tarek': 'aura-2-julius-de',
            'frau-mueller': 'aura-2-lara-de', 'herr-tariq': 'aura-2-julius-de', 'direktor-vogel': 'aura-2-fabian-de',
          };
          bossVoiceRef.current = msg.voice || VOICE_BY_BOSS[msg.bossId] || 'aura-2-julius-de';
          bossElevenVoiceRef.current = msg.elevenVoice || '';   // ElevenLabs voice for this character
          bossPatienceRef.current = Math.round((1 - (typeof msg.forcefulness === 'number' ? msg.forcefulness : 0.4)) * 400);   // gentle persona → longer patience, won't cut the candidate off
        }
        break;

      case S.STAGE_UPDATE:
        if (typeof msg.index === 'number') stageIdxRef.current = msg.index;  // drives VAD patience
        setFunnel(f => f ? { ...f, idx: msg.index ?? f.idx } : f);
        break;

      case S.DEBRIEF_PENDING:
        setDebriefPending(true);
        break;

      case S.DEBRIEF:
        setDebrief(msg);
        setDebriefPending(false);
        if (Number.isFinite(msg.progress?.streak)) { setStreak(msg.progress.streak); saveStreakCache(msg.progress.streak); }
        if (typeof msg.progress?.trainedToday === 'boolean') setTrainedToday(msg.progress.trainedToday);
        // If this fight was launched from a Zielplan Mock-Kampf step, mark that step done.
        if (pendingFightRef.current) {
          const { planId, stepId } = pendingFightRef.current;
          pendingFightRef.current = null;
          fetch(`${API_URL}/api/plans/${planId}/steps/${stepId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
            body: JSON.stringify({ done: true }),
          }).catch(() => {});
        }
        break;

      case S.NO_SESSION:
        // The user closed the interview without really participating → NO feedback card.
        // Show an honest "you didn't start" message instead of a fake debrief with 0 WpM.
        setDebrief(null); setDebriefPending(false); setNoSession(true);
        break;

      case S.PAYWALL:
        // Server refused to start the session — trial exhausted. Show the upgrade wall.
        setPhaseSync('idle');
        recorderRef.current?.stop().catch(() => {});
        recorderRef.current = null;
        try { wsRef.current?.close(1000, 'paywall'); } catch {}
        wsRef.current = null;
        setPaywall(msg);
        break;

      case S.AUDIO_DELTA:
        // Boss has no audio in the OpenAI-free text interview — ignore (kept for safety).
        break;

      case S.TRANSCRIPT_DELTA:
        // No live partial transcript in turn-based mode — ignore.
        break;

      case S.TRANSCRIPT_PARTIAL:
        // Deepgram streaming interim result — show as live text while the user speaks.
        // Also feed the adaptive VAD so it can tell "mid-thought" from "finished sentence".
        livePartialRef.current = msg.text || '';
        setLiveTranscript(msg.text || '');
        break;

      case S.TRANSCRIPT_DONE: {
        // Streaming path: server sends the committed transcript text after Deepgram speech_final.
        // We add it as a full line here (no client-side duplicate, since audio_chunk flow
        // never called sendAnswerText locally).
        livePartialRef.current = '';
        setLiveTranscript('');
        setTranscribing(false);
        try { console.log(`[DIAG] EAR (server STT) heard: ${JSON.stringify(msg.transcript || '')} words=${msg.transcript ? msg.transcript.trim().split(/\s+/).filter(Boolean).length : 0}`); } catch {}
        if (msg.transcript) {
          // Boss is now generating its reply — block hands-free from re-triggering the mic
          // before BOSS_SPEECH arrives (gap of 1-2s while Groq generates the response).
          // Without this, the mic restarts immediately and can get stuck in transcribing=true.
          setBossThinking(true);
          const id = ++_lineId;
          setTranscript(prev => [...prev.slice(-39), { id, speaker: 'player', text: msg.transcript, partial: false, words: msg.words ?? [] }]);
        }
        break;
      }

      case S.BOSS_SPEECH: {
        if (!msg.text) break;
        setBossSpeak(true);
        setBossThinking(false);   // the boss's next turn has arrived
        setShowBriefing(false);   // dismiss pre-fight briefing when boss starts speaking
        // Stream the boss's words live. A new utterance (ref cleared by the previous
        // BOSS_SPEECH_DONE) resets the subtitle box and opens one fresh transcript
        // line; subsequent deltas append to that same line instead of spawning many.
        // The boss's line lives in ONE place — the prominent subtitle (bossText), whose
        // header shows the active character's name. It is NOT mirrored into the transcript
        // log below; that double-render was the duplicate-text bug.
        if (bossPartialIdRef.current === null) {
          bossPartialIdRef.current = ++_lineId;
          bossLineRef.current = msg.text;
          setBossText(msg.text);
          // Detect correction-drill turn: boss is asking the user to restate/fix their German
          setBossIsCorrection(/formulieren|nochmal|wie würden sie|wie sagen sie|korrig|nochmal versuchen/i.test(msg.text));
        } else {
          bossLineRef.current += msg.text;
          setBossText(t => t + msg.text);
        }
        break;
      }

      case S.BOSS_SPEECH_DONE:
        // Boss line is not in the transcript log (single-place render) — nothing to finalize there.
        // Speak the boss's German line aloud (playBossVoice → ElevenLabs if opted in, else Deepgram
        // Aura-2 native German; never browser TTS). bossSpeak
        // stays true while speaking, then clears on end, so the avatar animates and
        // the debrief waits until the final line has finished being read out.
        {
          const spokenLine = bossLineRef.current || '';
          try { console.log(`[DIAG] BRAIN (boss reply): ${JSON.stringify(spokenLine)}`); } catch {}
          _latTtsStart = Date.now();   // [LAT] TTS clock: boss text ready, about to synth+play
          if (!ttsMutedRef.current && spokenLine) {
            // playBossVoice now STREAMS both voices (ElevenLabs if opted in, else the free Aura-2 mp3
            // stream) via a progressive <audio> — sound starts ~350ms in instead of after the whole
            // clip buffers (~6s on a long line). Falls back to buffered clause-split clips on failure.
            playBossVoice({
              apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current, elevenVoice: bossElevenVoiceRef.current, text: spokenLine,
              onStart: () => { reportClientLat(API_URL); setBossSpeak(true); }, onEnd: () => setBossSpeak(false),
            });
          } else {
            setBossSpeak(false);
          }
        }
        bossLineRef.current = '';
        bossPartialIdRef.current = null;
        break;

      case S.HP_UPDATE:
        // Guard against non-finite values so a malformed update can't NaN the bars
        // (which silently blanks them) or trip a false game-over.
        if (Number.isFinite(msg.bossHp))   setBossHp(Math.max(0, Math.min(100, msg.bossHp)));
        if (Number.isFinite(msg.playerHp)) setPlayerHp(Math.max(0, Math.min(100, msg.playerHp)));
        // Live HUD values bundled with the scored exchange (display-only).
        if (Number.isFinite(msg.wpm))         setLiveWpm(msg.wpm);
        if (Number.isFinite(msg.fillerTotal)) setFillerCount(msg.fillerTotal);
        if (Number.isFinite(msg.combo))       setCombo(msg.combo);
        // Boss emotion is decided by the BACKEND (gefasst/skeptisch/beeindruckt/wuetend)
        // and just displayed here — the client never invents it.
        if (msg.emotion) setEmotion(msg.emotion);
        if (msg.score !== undefined) {
          setScoreFlash({ score: msg.score, damage: msg.damage });
          setTimeout(() => setScoreFlash(null), 2800);

          // Fly a damage number off the boss when the player lands a hit.
          if (msg.bossDamage > 0) {
            const fid = ++_lineId;
            setBossDmgFloat({ id: fid, amount: msg.bossDamage });
            setTimeout(() => setBossDmgFloat(f => (f && f.id === fid ? null : f)), 1000);
          }
        }

        // Tiny floating reason labels next to each HP bar — the SPECIFIC cause of the
        // change, e.g. "+6 fließend" or "−4 Füllwörter". Fades after ~2s.
        if (msg.reasons?.boss) {
          const rid = ++_lineId;
          setBossReason({ id: rid, ...msg.reasons.boss });
          setTimeout(() => setBossReason(r => (r && r.id === rid ? null : r)), 2000);
        }
        if (msg.reasons?.player) {
          const rid = ++_lineId;
          setPlayerReason({ id: rid, ...msg.reasons.player });
          setTimeout(() => setPlayerReason(r => (r && r.id === rid ? null : r)), 2000);
        }
        break;

      case S.SESSION_CLOSED:
        // The session is over per the SERVER. Stop the mic and close the socket, but
        // do NOT flush the boss audio — let the final line play out. The result screen
        // is gated on the voice finishing (bossSpeak), so screen and audio stay in sync.
        setPhaseSync('idle');
        clearInterval(pingRef.current);
        recorderRef.current?.stop().catch(() => {});
        recorderRef.current = null;
        volRef.current = 0; setUserSpeak(false);
        try { wsRef.current?.close(1000, 'closed'); } catch {}
        wsRef.current = null;
        break;

      case S.ERROR:
        setError(msg.code ?? 'server_error');
        setErrorDetail(msg.detail ?? '');
        break;

      case S.PONG:
        break;
    }
  }, [setPhaseSync]);

  // ── Start interview ────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    // phaseRef only flips to 'connecting' AFTER the awaits below, so a rapid double-click
    // could slip two starts through. startingRef is a synchronous lock that closes that gap.
    if (phaseRef.current !== 'idle' || startingRef.current) return;
    startingRef.current = true;

    // Turn-based text interview: no mic needed to START (typing works everywhere).
    // The microphone is only requested on demand, when the user records a spoken answer.
    setError(null);
    setErrorDetail('');
    setBossHp(100); setPlayerHp(100);
    setBossText(''); setTranscript([]);
    setEmotion('idle'); setScoreFlash(null); setBossDmgFloat(null);
    setFunnel(null); setDebrief(null); setDebriefPending(false); setNoSession(false);
    setAnswerText(''); setBossThinking(false); setRecording(false); setTranscribing(false);
    pendingDurationRef.current = 0;
    partialIdRef.current = null;
    bossPartialIdRef.current = null;

    setPhaseSync('connecting');
    startingRef.current = false;   // phaseRef now guards re-entry

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    // Render's free dyno cold-starts (30-60s+); a slow-but-not-failed handshake fires no error and
    // would hang the UI on "VERBINDE…" forever. Hard 60s connect timeout → honest error, not a hang.
    const connectTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) { try { ws.close(); } catch {} setError((prev) => prev || 'ws_connect_failed'); setPhaseSync('error'); }
    }, 60_000);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      setPhaseSync('active');
      pingRef.current = setInterval(() => ws.send(JSON.stringify({ type: C.PING })), 25_000);
    };

    ws.onmessage = (ev) => {
      try { handleMsg(JSON.parse(ev.data)); } catch {}
    };

    ws.onclose = (ev) => {
      clearTimeout(connectTimer);
      clearInterval(pingRef.current);
      if (phaseRef.current !== 'stopping' && phaseRef.current !== 'idle') {
        // Don't overwrite a more specific error already set (e.g. a mic failure).
        setError((prev) => prev || 'connection_lost');
        setPhaseSync('error');
        recorderRef.current?.stop().catch(() => {});
        volRef.current = 0; setUserSpeak(false); setBossSpeak(false); stopBossVoice();
      } else {
        setPhaseSync('idle');
      }
    };

    ws.onerror = () => {
      setError('ws_connect_failed');   // bilingual via wsErrorText
    };

  }, [handleMsg, setPhaseSync]);

  // ── End interview → request debrief ──────────────────────────────────────────
  // The socket is kept OPEN so the server can stream back the debrief before closing
  // (SESSION_CLOSED handles the final teardown).
  const finishSession = useCallback(async () => {
    if (phaseRef.current !== 'active') return;
    setPhaseSync('stopping');

    // Stop any in-progress spoken-answer recording; no streaming mic to tear down.
    try { await clipRecRef.current?.stop(); } catch {}
    clipRecRef.current = null;
    setRecording(false); setBossThinking(false); setUserSpeak(false); setBossSpeak(false); stopBossVoice();

    setDebriefPending(true);
    wsRef.current?.send(JSON.stringify({ type: C.STOP_FIGHT }));
  }, [setPhaseSync]);

  // ── Submit ONE answer (typed, or transcribed from a clip) ────────────────────
  // Core send — takes text directly so hands-free auto-send doesn't race the textarea state.
  const sendAnswerText = useCallback((raw, durationMs = 0) => {
    const text = (raw || '').trim();
    if (!text || phaseRef.current !== 'active') return;
    const id = ++_lineId;
    setTranscript(prev => [...prev.slice(-39), { id, speaker: 'player', text, partial: false }]);
    wsRef.current?.send(JSON.stringify({ type: C.ANSWER, text, durationMs: durationMs || 0 }));
    setAnswerText('');
    pendingDurationRef.current = 0;
    setBossThinking(true);
  }, []);
  const sendAnswer = useCallback(() => {
    if (bossThinking) return;
    sendAnswerText(answerText, pendingDurationRef.current || 0);
  }, [answerText, bossThinking, sendAnswerText]);

  // ── Spoken answer: record a clip → POST /api/transcribe → fill the textarea ───
  const toggleRecord = useCallback(async () => {
    if (transcribing) return;
    if (recording) {
      setRecording(false);
      let clip = null;
      try { clip = await clipRecRef.current?.stop(); } catch {}
      clipRecRef.current = null;
      if (!clip || !clip.blob) return;
      setTranscribing(true);
      try {
        // Raw audio body (server uses express.raw — no multipart/multer).
        const r = await fetch(`${API_URL}/api/transcribe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': clip.blob.type || 'audio/wav' },
          body: clip.blob,
        });
        if (!r.ok) throw new Error('transcribe_failed');
        const { text } = await r.json();
        if (text && text.trim()) {
          setAnswerText(prev => (prev ? prev.trim() + ' ' : '') + text.trim());
          pendingDurationRef.current = clip.durationMs || 0;
        } else {
          setError('Nichts verstanden — bitte erneut sprechen oder tippen.');
        }
      } catch {
        setError('Spracherkennung fehlgeschlagen — bitte tippen.');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    // start recording
    try {
      clipRecRef.current = new ClipRecorder({ onVolume: (v) => { volRef.current = v; } });
      await clipRecRef.current.start();
      setRecording(true);
    } catch {
      clipRecRef.current = null;
      setError('mic_denied');
    }
  }, [recording, transcribing, auth.token]);

  // ── Hands-free (Freisprech): opt-in. Auto-start on your turn, auto-stop + auto-send on
  // end-of-utterance (~1.5s silence). Uses the mic volume (volRef) as the VAD signal with a
  // conservative end-silence so a mid-thought pause doesn't cut you off. Manual record/SEND
  // stay fully functional when this is off (default). Boss-voice can't self-trigger because
  // a turn only auto-starts once the boss has finished speaking (gated below on !bossSpeak).
  const hfTimerRef  = useRef(null);
  const hfActiveRef = useRef(false);
  const startHandsFreeTurn = useCallback(async () => {
    if (hfActiveRef.current || recording || transcribing) return;
    hfActiveRef.current = true;
    try {
      clipRecRef.current = new ClipRecorder({
        onVolume: (v) => { volRef.current = v; },
        // Stream each PCM chunk live to the server → Deepgram LiveTranscription.
        // This eliminates the ~750ms REST round-trip latency of the old upload path.
        onChunk: (b64) => {
          wsRef.current?.send(JSON.stringify({ type: C.AUDIO_CHUNK, data: b64 }));
        },
      });
      await clipRecRef.current.start();
      setRecording(true);
    } catch { clipRecRef.current = null; hfActiveRef.current = false; setError('mic_denied'); return; }

    let spoke = false, silenceMs = 0, elapsed = 0, floor = 0.02;
    let lastPartial = '', partialStableMs = 0;   // transcript-stopped-growing detector (noisy-mic safety net)
    livePartialRef.current = '';   // fresh transcript for this turn's classification
    // ADAPTIVE end-of-turn. Instead of one fixed silence value we pick how long to wait based
    // on whether the live transcript looks finished (classifyTurnDE): a clearly-complete
    // sentence yields fast, an ambiguous one gets real thinking grace, and a mid-clause
    // utterance ("…ich habe drei Jahre bei …") waits a long time. cancel-on-resume is the
    // load-bearing mechanic: the moment the user speaks again, silenceMs resets to 0, so a
    // pause between sentences can NEVER end the turn. These windows already include the
    // non-native (L2) speaker grace from the turn-taking research.
    // SMART immediacy: jump in FAST when the sentence is clearly COMPLETE (the boss responds the
    // instant the candidate finishes a thought), but stay PATIENT when ambiguous or mid-clause so it
    // NEVER cuts them off. cancel-on-resume resets silence the instant they speak again.
    const SIL_COMPLETE = 350, SIL_AMBIGUOUS = 800, SIL_INCOMPLETE = 1400;
    const STEP = 50, K = 2.6, MIN_SPEAK_MS = 180, MAX_MS = 60000;
    hfTimerRef.current = setInterval(async () => {
      elapsed += STEP;
      const v = volRef.current || 0;
      if (!spoke) floor = floor * 0.92 + v * 0.08;          // adapt to room noise until speech
      const thresh = Math.max(0.02, floor * K);
      if (v > thresh) { if (elapsed > MIN_SPEAK_MS) spoke = true; silenceMs = 0; }
      else if (spoke) { silenceMs += STEP; }
      // SAFETY NET (fixes "my words just hang, it never sends"): if the live transcript has STOPPED
      // GROWING for a while, the candidate has clearly stopped talking — even if a noisy mic keeps the
      // volume above the silence threshold (which would otherwise never end the turn). Grows again →
      // resets, so it can't cut off someone who's still speaking.
      if (livePartialRef.current !== lastPartial) { lastPartial = livePartialRef.current; partialStableMs = 0; }
      else if (spoke) { partialStableMs += STEP; }
      // How long the user must stay silent depends on whether their sentence looks finished.
      const cls = classifyTurnDE(livePartialRef.current);
      let needSilence = cls === 'complete'   ? SIL_COMPLETE
                      : cls === 'incomplete' ? SIL_INCOMPLETE
                      :                        SIL_AMBIGUOUS;
      // Open-question patience: the self-presentation (0) and behavioral (1) stages invite
      // LONG, multi-sentence answers with thinking pauses between sentences ("Ich heiße X.
      // … Ich bin 24. … Ich habe drei Jahre …"). Add grace there so a between-sentence pause
      // never hands the floor to the boss mid-introduction. The roleplay (2) stays snappy.
      if (stageIdxRef.current <= 1) needSilence += 250;   // open-question grace (cut for latency — was 600)
      needSilence += bossPatienceRef.current;             // per-persona patience: gentle interviewers wait longer before taking the floor, forceful ones stay snappy
      // End the turn when: silence-after-speech hits the adaptive window, OR the transcript froze for
      // ~2.5s (noisy-mic safety net — they've stopped, volume just isn't registering it), OR the hard cap.
      const transcriptDone = spoke && livePartialRef.current.trim() && partialStableMs >= 1800;
      if (!((spoke && silenceMs >= needSilence) || transcriptDone || elapsed >= MAX_MS)) return;
      try { console.log(`[DIAG] turn-END reason=${elapsed >= MAX_MS ? 'MAXCAP' : transcriptDone ? 'transcript-frozen' : 'silence'} vadClass=${cls} needSilence=${needSilence}ms silence=${Math.round(silenceMs)}ms stage=${stageIdxRef.current} heardSoFar=${JSON.stringify((livePartialRef.current || '').slice(0, 160))}`); } catch {}
      clearInterval(hfTimerRef.current); hfTimerRef.current = null;
      try { await clipRecRef.current?.stop(); } catch {}
      clipRecRef.current = null; setRecording(false); hfActiveRef.current = false;
      // Always close the Deepgram stream so the server never leaks a stale dgStreamer.
      // Without this, a turn where the user didn't speak leaves dgStreamer open; Deepgram
      // eventually closes it silently (_done=true) and the next turn's audio is dropped.
      _latAudioEndAt = Date.now(); _latVadWait = Math.round(silenceMs);   // [LAT] capture the VAD wait
      wsRef.current?.send(JSON.stringify({ type: C.AUDIO_END }));
      if (!spoke) return;   // said nothing → don't transcribe, just wait for next turn
      // Signal end-of-speech: server's Deepgram streamer flushes remaining audio → speech_final
      // fires → server calls _handleAnswer internally. No REST upload needed.
      setTranscribing(true);   // clears in TRANSCRIPT_DONE handler
    }, STEP);
  }, [recording, transcribing]);

  // Drive hands-free: when it's your idle turn (boss finished, nothing in flight), auto-begin
  // capturing after a short settle. Does nothing while handsFree is off.
  useEffect(() => {
    if (!handsFree || phase !== 'active') return;
    if (recording || transcribing || bossThinking || bossSpeak || hfActiveRef.current) return;
    const t = setTimeout(() => startHandsFreeTurn(), 150);
    return () => clearTimeout(t);
  }, [handsFree, phase, recording, transcribing, bossThinking, bossSpeak, startHandsFreeTurn]);

  useEffect(() => () => { if (hfTimerRef.current) clearInterval(hfTimerRef.current); }, []);

  // KEEP-WARM: the free server sleeps after ~15 min with no inbound traffic, so the NEXT "INTERVIEW
  // STARTEN" pays a long cold-wake. Ping /health every 4 min while the app is open so it never sleeps
  // under the user → clicking start is fast. Tiny request, no auth, no cost.
  useEffect(() => {
    const ping = () => { fetch(`${API_URL}/health`, { cache: 'no-store' }).catch(() => {}); };
    ping();
    const iv = setInterval(ping, 240000);
    return () => clearInterval(iv);
  }, []);

  // Cost guard: if the user locks the phone or switches apps mid-fight, the Realtime
  // session would keep billing in the background. End it cleanly (the debrief still
  // generates) so a backgrounded tab never runs the meter.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && phaseRef.current === 'active') {
        finishSession();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [finishSession]);

  const handleRestart = useCallback(() => {
    setDebrief(null); setDebriefPending(false); setNoSession(false);
    clearInterval(pingRef.current);
    try { wsRef.current?.close(1000, 'restart'); } catch {}
    wsRef.current = null;
    setPhaseSync('idle');
    setTimeout(start, 250);
  }, [start, setPhaseSync]);

  // (Removed) HP no longer ends the session — only the server does. A weak run can
  // drain the bar to zero and the interview still plays all three parts to the end.

  // Safety net: never trap the result behind audio that failed to signal completion.
  useEffect(() => {
    if ((debrief || debriefPending) && bossSpeak) {
      const t = setTimeout(() => setBossSpeak(false), 12000);
      return () => clearTimeout(t);
    }
  }, [debrief, debriefPending, bossSpeak]);

  // Watchdog: if bossSpeak or bossThinking get stuck during an active turn (TTS stream hangs,
  // Groq timeout, network drop), force-clear them so the conversation can continue.
  // bossThinking: Groq call takes ~1-3s; 12s is generous. bossSpeak: audio should finish
  // within ~30s for any reasonable line (40s cap in playBossVoice already handles most cases,
  // but this is a second layer in case the audio resolve path itself fails silently).
  useEffect(() => {
    if (phase !== 'active' || debrief || debriefPending) return;
    if (bossThinking) {
      const t = setTimeout(() => setBossThinking(false), 22000);
      return () => clearTimeout(t);
    }
  }, [phase, debrief, debriefPending, bossThinking]);

  useEffect(() => {
    if (phase !== 'active' || debrief || debriefPending) return;
    if (bossSpeak) {
      const t = setTimeout(() => setBossSpeak(false), 45000);
      return () => clearTimeout(t);
    }
  }, [phase, debrief, debriefPending, bossSpeak]);

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${auth.token}` }), [auth.token]);

  // Home billing state: daily minutes left, pending payment, one-time activation notice.
  const loadBilling = useCallback(() => {
    fetch(`${API_URL}/api/billing/state`, { headers: authHeaders() })
      .then((r) => r.json()).then((d) => setBilling(d || null)).catch(() => {});
  }, [authHeaders]);
  // Refresh whenever we're on the idle home (on mount + after every fight).
  useEffect(() => { if (phase === 'idle') loadBilling(); }, [phase, loadBilling]);

  // Dismiss the one-time "plan activated" celebration (acknowledge server-side so it shows once).
  const ackActivation = useCallback(() => {
    setBilling((b) => (b ? { ...b, justActivated: false } : b));
    fetch(`${API_URL}/api/billing/ack-activation`, { method: 'POST', headers: authHeaders() }).catch(() => {});
  }, [authHeaders]);

  // ── Begin: run a spaced-repetition recall drill (if any due) before the fight ─
  const beginSession = useCallback(async (mode) => {
    fightModeRef.current = (mode === 'bosstor') ? 'bosstor' : 'daily';
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return;
    // Don't even open a socket if the trial is spent — show the wall up front.
    if (auth.account?.entitlement && !auth.account.entitlement.allowed) {
      setPaywall(auth.account.entitlement); return;
    }
    // Straight into the interview. The typed AUFWÄRMEN pre-fight warm-up was removed: it re-drilled the
    // same SRS due-items as SAG ES RICHTIG (spoken) and Daily Training (typed) — off-mission redundancy.
    start();
  }, [start, auth.account]);

  // Launch a real Mock-Kampf from a Zielplan fight step. The step is marked done once the
  // debrief arrives (see the DEBRIEF handler). Goes through the normal paywall/entitlement gate.
  const startFightForStep = useCallback((planId, stepId) => {
    pendingFightRef.current = { planId, stepId };
    setZielplanOpen(false);
    beginSession();
  }, [beginSession]);

  const openDashboard = useCallback(async () => {
    setDashboard({ data: null, loading: true });
    try {
      const r = await fetch(`${API_URL}/api/progress?t=${Date.now()}`, { headers: authHeaders(), cache: 'no-store' });
      const data = await r.json();
      if (data.account) onAccountUpdate?.(data.account);
      setDashboard({ data, loading: false });
    } catch { setDashboard({ data: null, loading: false }); }
  }, [authHeaders, onAccountUpdate]);

  // "Wiederholung fällig" → the SPOKEN review (SAG ES RICHTIG). The standalone TYPED review was a
  // duplicate of it (same SRS items, typing vs speaking) — off-mission for a spoken trainer, so it's
  // gone. RecallDrill now lives ONLY as the pre-fight warm-up (a distinct, complementary role).
  const startReviewFromDash = useCallback(() => {
    setDashboard(null);
    setSpokenReviewOpen(true);
  }, []);

  const handleUpgraded = useCallback((account) => {
    onAccountUpdate?.(account);
    setPaywall(null);
  }, [onAccountUpdate]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(pingRef.current);
      recorderRef.current?.stop().catch(() => {});
      wsRef.current?.close(1000, 'unmount');
    };
  }, []);

  // ── Load the authoritative training streak for the home screen ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/progress?t=${Date.now()}`, { headers: authHeaders(), cache: 'no-store' });
        const data = await r.json();
        if (!cancelled && Number.isFinite(data.streak)) { setStreak(data.streak); saveStreakCache(data.streak); }
        if (!cancelled && Number.isFinite(data.totals?.dueReviews)) setDueReviews(data.totals.dueReviews);
        if (!cancelled && data.totals) setTotals(data.totals);
        if (!cancelled && data.daily) setDaily(prev => ({ streak: 0, completedToday: false, streakShield: false, best: 0, ...prev, ...data.daily }));
        if (!cancelled && typeof data.trainedToday === 'boolean') setTrainedToday(data.trainedToday);
        if (!cancelled && data.rank) setRank(data.rank);      // interview-readiness rank
      } catch { /* keep cached value */ }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  // ── Derived display state ─────────────────────────────────────────────────
  const isActive     = phase === 'active';
  const isConnecting = phase === 'connecting';
  const canStart     = phase === 'idle' || phase === 'error';
  const boss         = EMOTIONS[emotion] ?? EMOTIONS.idle;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={shakeScreen ? 'shake' : ''} style={{
      minHeight:'100svh', maxWidth:440, margin:'0 auto',
      display:'flex', flexDirection:'column', position:'relative', overflowX:'hidden',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div className="scanline" />

      {/* Screen flash */}
      {screenFlash && (
        <div style={{ position:'absolute', inset:0, zIndex:50, pointerEvents:'none',
          background: screenFlash === 'green' ? 'rgba(59,130,246,0.16)' : 'rgba(239,68,68,0.2)',
          transition:'opacity 0.1s' }} />
      )}

      {/* Cinematic round-advance banner ("RUNDE 2 — VERHALTENSFRAGE") */}
      {roundFlash && (
        <div key={roundFlash.id} style={{ position:'absolute', left:'50%', top:'40%', zIndex:55,
          pointerEvents:'none', textAlign:'center', whiteSpace:'nowrap',
          animation:'round-pop 1.7s var(--ease-out) forwards' }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:'0.3em',
            color:'var(--accent)', textShadow:'var(--glow-accent)' }}>RUNDE {roundFlash.n}</div>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:26, color:'#fff',
            letterSpacing:'0.04em', textShadow:'0 0 18px rgba(59,130,246,0.55), 0 2px 10px rgba(0,0,0,0.8)' }}>
            {(roundFlash.label || '').toUpperCase()}
          </div>
        </div>
      )}

      {/* Subscription paywall (trial exhausted) */}
      {paywall && (
        <PaywallScreen token={auth.token} info={paywall} lang={feedbackLang}
          onUpgraded={handleUpgraded} onClose={() => setPaywall(null)} />
      )}

      {/* Zielplan (goal plan) — a separate coaching section layered over the arena */}
      {zielplanOpen && (
        <OverlayBoundary onClose={() => setZielplanOpen(false)}>
          <Zielplan token={auth.token} apiUrl={API_URL} onClose={() => setZielplanOpen(false)} lang={feedbackLang} onStartFight={startFightForStep} />
        </OverlayBoundary>
      )}

      {/* Tägliches Training — the cheap daily habit loop */}
      {dailyOpen && (
        <OverlayBoundary onClose={() => setDailyOpen(false)}>
          <DailyTraining token={auth.token} apiUrl={API_URL} lang={feedbackLang}
            onClose={() => setDailyOpen(false)}
            onComplete={(s) => setDaily(prev => ({ ...prev, streak: s.streak ?? 0, completedToday: true, streakShield: s.streakShield ?? prev.streakShield, best: Math.max(prev.best ?? 0, s.streak ?? 0) }))} />
        </OverlayBoundary>
      )}

      {/* Trainingsnachweis — printable progress certificate */}
      {nachweisOpen && (
        <OverlayBoundary onClose={() => setNachweisOpen(false)}>
          <Trainingsnachweis
            email={auth.account?.email ?? ''}
            sessions={rank?.sessions ?? 0}
            rank={rank}
            daily={daily}
            totals={totals}
            onClose={() => setNachweisOpen(false)} />
        </OverlayBoundary>
      )}

      {/* Weekly leaderboard overlay */}
      {leaderboardOpen && (
        <OverlayBoundary onClose={() => setLeaderboardOpen(false)}>
          <WeeklyLeaderboard
            token={auth.token} apiUrl={API_URL}
            myId={auth.account?.id}
            data={leaderboard} onLoad={setLeaderboard}
            onClose={() => setLeaderboardOpen(false)} />
        </OverlayBoundary>
      )}

      {/* Progress dashboard */}
      {dashboard && (
        <Dashboard data={dashboard.data} loading={dashboard.loading} account={auth.account}
          onClose={() => setDashboard(null)} onReview={startReviewFromDash} onLogout={onLogout}
          onOpenGuide={() => { setDashboard(null); setGuideOpen(true); }} />
      )}

      {/* Free intelligent assessment (turn-based, cheap models only — never a Realtime session) */}
      {assessmentOpen && (
        <Assessment token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setAssessmentOpen(false)}
          onStartInterview={() => { setAssessmentOpen(false); setTimeout(() => beginSession(), 60); }} />
      )}

      {/* Shadowing pronunciation practice (PAID — cheap models + browser TTS, never Realtime) */}
      {shadowingOpen && (
        <Shadowing token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setShadowingOpen(false)}
          onGoPricing={() => { setShadowingOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* 4-3-2 spoken-fluency drill (PAID — Groq Whisper STT, deterministic feedback) */}
      {fluencyOpen && (
        <FluencyDrill token={auth.token} apiUrl={API_URL} lang={feedbackLang} level={level}
          onClose={() => setFluencyOpen(false)}
          onGoPricing={() => { setFluencyOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Listening & live data-capture drill (PAID — browser TTS, deterministic grading, zero cost) */}
      {listeningOpen && (
        <Listening token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setListeningOpen(false)}
          onGoPricing={() => { setListeningOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Spoken-production SRS — say YOUR own errors correctly, spaced (PAID; Groq Whisper, deterministic) */}
      {spokenReviewOpen && (
        <SpokenReview token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setSpokenReviewOpen(false)}
          onGoPricing={() => { setSpokenReviewOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Pressure Ladder — overload training (client-only: browser voice, no server, zero cost) */}
      {pressureOpen && (
        <PressureLadder lang={feedbackLang} onClose={() => setPressureOpen(false)} token={auth.token} apiUrl={API_URL} />
      )}

      {/* Alhassan mentor chat (persistent memory; cheap text model; never Realtime) */}
      {guideOpen && (
        <Alhassan token={auth.token} apiUrl={API_URL} lang={feedbackLang} onClose={() => setGuideOpen(false)} />
      )}

      {/* Trainingslager game-map route (study mode — never a Realtime session) */}
      {trainingslagerOpen && (
        <Trainingslager token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setTrainingslagerOpen(false)}
          onChallengeBoss={() => { setTrainingslagerOpen(false); beginSession('bosstor'); }}
          onGoPricing={() => { setTrainingslagerOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* One-time "plan activated 🎉" celebration after the owner activates the payment */}
      {billing?.justActivated && (
        <div onClick={ackActivation} style={{ position:'absolute', inset:0, zIndex:240, display:'grid', placeItems:'center', padding:20,
          background:'rgba(2,4,9,0.92)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth:360, width:'100%', textAlign:'center', borderRadius:16, padding:'26px 20px',
            background:'linear-gradient(180deg, rgba(12,28,20,0.98), rgba(4,12,8,0.99))', border:'1px solid rgba(59,130,246,0.5)', boxShadow:'0 0 40px rgba(59,130,246,0.2)' }}>
            <div style={{ fontSize:52 }}>🎉</div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:900, color:'var(--accent)', marginTop:6 }}>
              {feedbackLang === 'ar' ? 'تم تفعيل اشتراكك!' : 'Dein Plan ist aktiv!'}
            </div>
            <div style={{ fontSize:13, color:'#cbd5e1', marginTop:8, lineHeight:1.6 }}>
              {feedbackLang === 'ar' ? 'ابدأ التمرين 🥊' : 'Leg los 🥊'}
              <br /><span dir={feedbackLang === 'ar' ? 'ltr' : 'rtl'} style={{ color:'#94a3b8', fontSize:11 }}>
                {feedbackLang === 'ar' ? 'Dein Plan ist aktiv!' : 'تم تفعيل اشتراكك!'}
              </span>
            </div>
            <button onClick={ackActivation} style={{ width:'100%', marginTop:18, padding:'13px', minHeight:48, cursor:'pointer',
              fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.08em', borderRadius:9, fontWeight:700,
              border:'1px solid var(--accent)', color:'#04130c', background:'linear-gradient(135deg,var(--accent),var(--accent))' }}>
              {feedbackLang === 'ar' ? 'يلا نبدأ ▸' : 'Los geht’s ▸'}
            </button>
          </div>
        </div>
      )}

      {/* Result screen: ONLY when the server has ended the session, and only once the
          boss's voice has finished (bossSpeak) so the screen never jumps ahead of audio. */}
      {(debrief || debriefPending) && !bossSpeak && !noSession && (
        <Debrief data={debrief} pending={debriefPending} onRestart={handleRestart}
          lang={feedbackLang} onLang={chooseFeedbackLang} bossName={funnel?.displayName}
          studentName={auth.account?.name || (auth.account?.email || '').split('@')[0]}
          onOpenGuide={() => setGuideOpen(true)}
          token={auth.token} apiUrl={API_URL} onOpenTrainingslager={() => setTrainingslagerOpen(true)} />
      )}

      {/* No-session state: user opened the interview and closed it without speaking → an honest
          message instead of a fake feedback card with 0 WpM. No scores, no recommendations. */}
      {noSession && !bossSpeak && (
        <div style={{ position:'absolute', inset:0, zIndex:230, display:'flex', flexDirection:'column',
          justifyContent:'center', alignItems:'center', textAlign:'center', padding:28,
          background:'rgba(2,4,9,0.97)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease' }}>
          <div style={{ fontSize:46 }}>🎙️</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800, color:'var(--action)', marginTop:10 }}>
            {feedbackLang==='ar' ? 'مفيش مقابلة نقيّمها' : 'Keine Sitzung zum Auswerten'}
          </div>
          <div style={{ fontSize:13, color:'#cbd5e1', marginTop:10, lineHeight:1.6, maxWidth:340 }}>
            Keine Sitzung zum Auswerten — du hast noch nicht angefangen.
          </div>
          <div dir="rtl" style={{ fontSize:13, color:'#94a3b8', marginTop:8, lineHeight:1.85, maxWidth:340 }}>
            لم تبدأ المقابلة فعليًا — مفيش حاجة نقيّمها. يلا ادخل وابدأ بجد.
          </div>
          <button onClick={() => setNoSession(false)} style={{ marginTop:18, padding:'12px 28px', minHeight:46, cursor:'pointer',
            fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.1em', borderRadius:8,
            border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)' }}>
            {feedbackLang==='ar' ? 'تمام' : 'ZURÜCK'}
          </button>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ padding:'16px 16px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <div style={{ width:7, height:7, borderRadius:'50%',
            background: isActive ? 'var(--accent)' : isConnecting ? 'var(--action)' : '#475569',
            boxShadow: isActive ? '0 0 6px var(--accent)' : 'none',
            animation: isActive ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize:10, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase' }}>
            {isActive ? 'VERBUNDEN' : isConnecting ? 'VERBINDE…' : 'GETRENNT'}
          </span>
        </div>

        {/* Campaign / round progress (during a session) or level selector (before start) */}
        {funnel ? (
          <div style={{ marginBottom:'var(--sp-3)' }}>
            <div style={{ position:'relative', display:'flex', justifyContent:'space-between',
              alignItems:'flex-start', padding:'0 6px', marginBottom:9 }}>
              {/* connecting track */}
              <div style={{ position:'absolute', left:18, right:18, top:11, height:3, borderRadius:2,
                background:'rgba(255,255,255,0.08)' }} />
              {/* animated progress fill — grows as rounds are cleared */}
              <div style={{ position:'absolute', left:18, top:11, height:3, borderRadius:2,
                width:`calc((100% - 36px) * ${funnel.stages.length > 1 ? funnel.idx / (funnel.stages.length - 1) : 0})`,
                background:'linear-gradient(90deg, var(--player), var(--accent))',
                boxShadow:'0 0 8px var(--accent-dim)',
                transition:'width 0.6s var(--ease-out)' }} />
              {funnel.stages.map((st, i) => {
                const done = i < funnel.idx, cur = i === funnel.idx;
                const c = cur ? 'var(--accent)' : done ? 'var(--player)' : '#475569';
                return (
                  <div key={st.id} style={{ position:'relative', zIndex:2, flex:1, textAlign:'center' }}>
                    <div key={cur ? `cur${i}` : `n${i}`} style={{ width:23, height:23, borderRadius:'50%', margin:'0 auto',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontFamily:'var(--font-display)', fontWeight:700, fontSize:11,
                      color: (cur || done) ? '#04070d' : '#94a3b8',
                      background: cur ? 'var(--accent)' : done ? 'var(--player)' : 'rgba(255,255,255,0.05)',
                      border:`2px solid ${cur ? 'var(--accent)' : done ? 'var(--player)' : '#334155'}`,
                      boxShadow: cur ? '0 0 12px var(--accent-dim)' : 'none',
                      animation: cur ? 'node-pop 0.5s var(--ease-spring)' : 'none',
                      transition:'background var(--dur), border-color var(--dur), color var(--dur)' }}>
                      {done ? '✓' : i + 1}
                    </div>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:7.5, letterSpacing:'0.06em',
                      color:c, marginTop:5, lineHeight:1.25, transition:'color var(--dur)' }}>
                      {(st.label || '').toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign:'center', padding:'7px 10px', borderRadius:'var(--r-md)',
              background:'linear-gradient(90deg,rgba(59,130,246,0.06),rgba(0,200,255,0.1),rgba(59,130,246,0.06))',
              border:'1px solid var(--line)' }}>
              <span style={{ fontSize:11.5, color:'#cbd5e1', lineHeight:1.45 }}>
                {funnel.stages[funnel.idx]?.prompt ?? ''}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom:12 }}>
            {/* Tägliches Training — big streak + the daily habit entry point */}
            <button onClick={() => setDailyOpen(true)} style={{ width:'100%', textAlign:'left', cursor:'pointer',
              display:'flex', alignItems:'center', gap:10, marginBottom:9, padding:'8px 12px', borderRadius:'var(--r-md)',
              background: streak > 0
                ? 'linear-gradient(135deg, rgba(249,115,22,0.18), rgba(239,68,68,0.10))'
                : 'rgba(255,255,255,0.03)',
              border:`1px solid ${daily.completedToday ? 'rgba(59,130,246,0.45)' : streak > 0 ? 'rgba(249,115,22,0.5)' : 'var(--line)'}`,
              boxShadow: streak > 0 ? '0 0 20px rgba(249,115,22,0.15)' : 'none',
              transition:'all var(--dur-slow)' }}>
              <div style={{ fontSize:22, lineHeight:1,
                filter: streak > 0 ? 'none' : 'grayscale(1)', opacity: streak > 0 ? 1 : 0.5,
                animation: streak > 0 ? 'pulse 2.4s ease-in-out infinite' : 'none' }}>🔥</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, letterSpacing:'0.01em', lineHeight:1.05,
                    color: streak > 0 ? 'var(--action)' : '#94a3b8',
                    textShadow: streak > 0 ? '0 0 12px rgba(249,115,22,0.5)' : 'none' }}>
                    Trainingsserie: {streak} {streak === 1 ? 'Tag' : 'Tage'}
                  </span>
                  {daily.streakShield && (
                    <span title="Schutzschild aktiv — ein verpasster Tag wird vergeben" style={{ fontSize:13, lineHeight:1, cursor:'default' }}>🛡</span>
                  )}
                </div>
                <div style={{ fontSize:9, color:'#94a3b8', marginTop:2, lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {daily.completedToday ? '✓ Heute erledigt — nochmal üben?' : 'Tägliches Training · 3–5 Min'}
                </div>
              </div>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, letterSpacing:'0.06em', whiteSpace:'nowrap',
                padding:'6px 11px', borderRadius:'var(--r-pill)',
                color: daily.completedToday ? 'var(--player-2)' : '#04070d',
                background: daily.completedToday ? 'transparent' : 'linear-gradient(135deg, var(--action), var(--warn))',
                border: daily.completedToday ? '1px solid var(--player)' : 'none' }}>
                {daily.completedToday ? '✓ ERLEDIGT' : 'START ▸'}
              </div>
            </button>
            {/* Loss-aversion (evidence-based retention): the pending LOSS, framed gently, drives return. */}
            {streak > 0 && !trainedToday && (
              <div style={{ marginTop:-3, marginBottom:8, padding:'5px 10px', borderRadius:8,
                background:'rgba(249,115,22,0.10)', border:'1px solid rgba(249,115,22,0.35)',
                fontSize:10.5, color:'var(--action)', textAlign:'center', lineHeight:1.4 }}>
                🔥 Heute üben, sonst endet deine {streak}-Tage-Serie · درّب النهاردة عشان متخسرش سلسلتك
              </div>
            )}

            {/* Interview-readiness rank ladder (visible progress on the home screen) */}
            {rank && <div style={{ marginBottom:9 }}><RankLadder rank={rank} /></div>}

            {/* Trainingsnachweis + Weekly leaderboard moved BELOW the primary action (secondary nav),
                see the "secondary cluster" under the CTA — they used to push the level pick down. */}

            <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.2em',
              color:'var(--accent-dim)', textAlign:'center', marginBottom:9 }}>
              WÄHLE DEIN NIVEAU
            </div>
            <div style={{ display:'flex', gap:10 }}>
              {[['a2-b1','A2–B1','Langsamer · verzeiht Fehler'],
                ['b2','B2','Natürliches Tempo · komplex'],
                ['c1','C1','Schweizer Niveau · formell']].map(([id, lbl, desc]) => {
                const sel = level === id;
                return (
                  <button key={id} onClick={() => chooseLevel(id)} disabled={!canStart}
                    style={{ flex:1, padding:'12px 12px', cursor: canStart ? 'pointer' : 'default',
                      borderRadius:'var(--r-md)', textAlign:'left', position:'relative', overflow:'hidden',
                      border:`1px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
                      background: sel
                        ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.03))'
                        : 'rgba(255,255,255,0.02)',
                      boxShadow: sel ? '0 0 18px rgba(59,130,246,0.3), inset 0 0 20px rgba(59,130,246,0.06)' : 'none',
                      transition:'all var(--dur) var(--ease)' }}>
                    <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:16, letterSpacing:'0.04em',
                      color: sel ? 'var(--accent)' : '#cbd5e1', textShadow: sel ? 'var(--glow-accent)' : 'none' }}>{lbl}</div>
                    <div style={{ fontSize:8.5, color:'#94a3b8', marginTop:3, lineHeight:1.35 }}>{desc}</div>
                    {sel && <div style={{ position:'absolute', top:7, right:9, fontSize:10, color:'var(--accent)' }}>✓</div>}
                  </button>
                );
              })}
            </div>

            {/* Interviewer picker — ALWAYS visible: choosing WHO you face is core to the app, not a hidden
                setting. (It was buried behind "Optionen" during the declutter → users only ever saw Yasmin.) */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:9.5, color:'#94a3b8', letterSpacing:'0.06em' }}>Interviewer · اختر المُحاوِر</span>
              <select value={bossPick} onChange={(e) => chooseBoss(e.target.value)} disabled={!canStart}
                style={{ fontSize:11.5, padding:'6px 9px', borderRadius:6, background:'rgba(2,6,16,0.7)',
                  color:'#e2e8f0', border:'1px solid var(--accent-dim)', fontFamily:'inherit', cursor: canStart ? 'pointer' : 'default' }}>
                <option value="">Auto (nach Niveau)</option>
                <option value="yasmin">Yasmin — warm (L1)</option>
                <option value="karim">Karim — sachlich (L2)</option>
                <option value="hana">Hana — skeptisch (L3)</option>
                <option value="tarek">Tarek — Hochdruck (L4)</option>
                <option value="frau-mona-adel">Frau Mona Adel — streng (L5)</option>
                <option value="lukas">Lukas — casual Berlin 🆕 (L6)</option>
              </select>
            </div>

            {/* ── Secondary settings behind a quiet disclosure (hands-free + feedback language only). ── */}
            <div style={{ textAlign:'center', marginTop:10 }}>
              <button onClick={() => setShowOpts(o => !o)} style={{ cursor:'pointer', background:'none', border:'none',
                fontSize:10, color:'#64748b', letterSpacing:'0.06em', padding:'4px 6px', fontFamily:'inherit' }}>
                {showOpts ? '▾' : '▸'} Optionen · خيارات
              </button>
            </div>
            {showOpts && (
            <>
            {/* Hands-free (Beta): no buttons — speak and it auto-sends on silence */}
            <label style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:10,
              cursor: canStart ? 'pointer' : 'default', userSelect:'none' }}>
              <input type="checkbox" checked={handsFree} disabled={!canStart}
                onChange={(e) => setHandsFree(e.target.checked)} />
              <span style={{ fontSize:10, color: handsFree ? 'var(--accent)' : '#94a3b8', letterSpacing:'0.04em' }}>
                🎙 Freisprech-Modus · بدون أزرار — تكلم وهو يتفهم
              </span>
            </label>

            {/* Feedback explanation language (also switchable on the results screen) */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginTop:10 }}>
              <span style={{ fontSize:9, color:'#64748b', letterSpacing:'0.06em' }}>Feedback-Sprache · لغة الشرح</span>
              <div style={{ display:'inline-flex', borderRadius:'var(--r-pill)', overflow:'hidden',
                border:'1px solid var(--line)', background:'rgba(0,0,0,0.4)' }}>
                {[['de','DE'],['ar','العربية']].map(([id, lbl]) => (
                  <button key={id} onClick={() => chooseFeedbackLang(id)} style={{ cursor:'pointer', padding:'4px 12px',
                    fontFamily:'var(--font-display)', fontWeight:600, fontSize:10, letterSpacing:'0.06em', border:'none',
                    color: feedbackLang === id ? '#04070d' : '#94a3b8',
                    background: feedbackLang === id ? 'var(--accent)' : 'transparent',
                    transition:'background var(--dur), color var(--dur)' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            </>
            )}
          </div>
        )}

        {/* Phase 2: live performance HUD (appears once a fight is in progress) */}
        {funnel && <PerformanceHud wpm={liveWpm} fillers={fillerCount} combo={combo} />}
      </div>

      {/* ── PRE-FIGHT BRIEFING CARD — scenario context + key phrases (dismissed when boss speaks) ── */}
      {showBriefing && csBriefing && (
        <div onClick={() => setShowBriefing(false)} style={{
          position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.82)', backdropFilter:'blur(4px)', cursor:'pointer' }}>
          <div onClick={e => e.stopPropagation()} style={{
            width:'min(92vw,440px)', background:'#0d1828', borderRadius:18,
            border:'1.5px solid rgba(0,188,212,0.45)', boxShadow:'0 0 60px rgba(0,188,212,0.18)',
            padding:'22px 22px 18px', userSelect:'none' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div>
                <div style={{ fontSize:9, letterSpacing:'0.15em', fontFamily:'var(--font-display)', color:'var(--accent)', marginBottom:3 }}>TEIL 3 · SZENARIO-BRIEFING</div>
                <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{csBriefing.skill}</div>
              </div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', textAlign:'right', lineHeight:1.4 }}>
                Antippen<br/>um zu starten
              </div>
            </div>
            {/* Situation */}
            <div style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.55, marginBottom:14,
              padding:'10px 12px', background:'rgba(0,188,212,0.06)', borderRadius:10,
              borderLeft:'3px solid rgba(0,188,212,0.4)' }}>
              {csBriefing.situation}
            </div>
            {/* Key phrases */}
            <div style={{ fontSize:9.5, letterSpacing:'0.1em', color:'var(--accent)', fontFamily:'var(--font-display)', marginBottom:8 }}>SCHLÜSSELPHRASEN</div>
            {csBriefing.keyPhrases.map((phrase, i) => (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:7 }}>
                <div style={{ width:18, height:18, borderRadius:'50%', background:'rgba(0,188,212,0.15)',
                  border:'1px solid rgba(0,188,212,0.4)', display:'flex', alignItems:'center', justifyContent:'center',
                  flexShrink:0, fontSize:9, color:'var(--accent)', fontFamily:'var(--font-display)' }}>{i+1}</div>
                <div style={{ fontSize:11.5, color:'#e2e8f0', lineHeight:1.5, fontStyle:'italic' }}>„{phrase}"</div>
              </div>
            ))}
            {/* Dismiss hint */}
            <div style={{ marginTop:14, textAlign:'center', fontSize:10, color:'rgba(255,255,255,0.3)' }}>
              Verschwindet automatisch · Tippe zum sofortigen Schließen
            </div>
          </div>
        </div>
      )}

      {/* ── STAGE — opponent + cinematic HP bars. Shown ONLY during a live fight. On the idle home it
          was a ~400px intimidating combat wall that buried the primary action; Direction A (calm,
          premium) wants a quiet first impression, so idle gets a one-line preview instead. ── */}
      {!funnel && (
        <div style={{ padding:'12px 14px 0', textAlign:'center', color:'var(--text-dim)', fontSize:12 }}>
          🎧 Bereit, wenn du es bist — dein Interviewer wartet.
        </div>
      )}
      {funnel && (
      <div style={{ padding:'4px 14px 0' }}>
        {/* BOSS HP — top frame */}
        <HpBar label="BOSS HP" value={bossHp} isPlayer={false} reason={bossReason} />

        <div className={bossHurt ? 'hurt' : ''} style={{ marginTop:5, borderRadius:16, position:'relative', overflow:'hidden',
          height:'min(50vh, 400px)', minHeight:300,
          background:'radial-gradient(120% 85% at 50% -8%, #0d1828 0%, #070e1a 48%, #02050b 100%)',
          border:`1px solid ${boss.color}66`,
          boxShadow:`0 0 44px ${boss.color}2e, inset 0 0 90px rgba(0,0,0,0.78)`,
          transition:'border-color 0.6s, box-shadow 0.6s' }}>

          {/* cone of cold light from above — brightens while the boss speaks */}
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:1,
            background:`radial-gradient(${bossSpeak ? '52% 70%' : '46% 62%'} at 50% -4%, ${boss.color}${bossSpeak ? '5a' : '2e'}, transparent ${bossSpeak ? '68%' : '62%'})`,
            animation:`portrait-glow ${bossSpeak ? '1.6s' : '3.5s'} ease-in-out infinite`, transition:'background 0.45s' }} />
          {/* drifting depth grid */}
          <div style={{ position:'absolute', inset:0, opacity:0.045, pointerEvents:'none', zIndex:1,
            backgroundImage:'linear-gradient(rgba(0,255,200,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,0.5) 1px,transparent 1px)',
            backgroundSize:'30px 30px', animation:'grid-drift 6s linear infinite' }} />
          {/* edge vignette — the dark interview room */}
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:2,
            background:'radial-gradient(135% 100% at 50% 32%, transparent 38%, rgba(0,0,0,0.82) 100%)' }} />

          {/* ENDGEGNER ribbon */}
          <div style={{ position:'absolute', top:10, left:12, zIndex:5,
            fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.16em',
            color:'#fca5a5', padding:'3px 9px', borderRadius:'var(--r-pill)',
            background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.35)' }}>⚔ ENDGEGNER</div>
          {/* emotion badge — the boss's state */}
          <div style={{ position:'absolute', top:10, right:12, zIndex:5,
            fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.12em',
            color:boss.color, padding:'3px 9px', borderRadius:'var(--r-pill)',
            background:`${boss.color}1a`, border:`1px solid ${boss.color}55`,
            textShadow:`0 0 8px ${boss.color}`, transition:'color 0.5s, border-color 0.5s' }}>{boss.label}</div>

          {/* flying damage number */}
          {bossDmgFloat && (
            <div key={bossDmgFloat.id} style={{ position:'absolute', left:'50%', top:'30%', zIndex:7, transform:'translateX(-50%)',
              pointerEvents:'none', fontFamily:'var(--font-display)', fontWeight:900, fontSize:48,
              color:'var(--accent)', textShadow:'0 0 22px rgba(59,130,246,0.95), 0 0 6px #fff',
              animation:'dmg-float 1s ease-out forwards' }}>−{bossDmgFloat.amount}</div>
          )}

          {/* the lit opponent — leans in to listen while YOU speak; posture shifts with mood */}
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:56, zIndex:3 }}>
            <div style={{ width:'72%', maxWidth:300, height:'84%',
              transform: `${userSpeak ? 'translateY(9px) scale(1.05)' : ''} ${POSTURE[emotion] || ''}`.trim() || 'none',
              transition:'transform 0.5s var(--ease)' }}>
              <div className={isActive && !bossSpeak && !userSpeak ? 'breathe' : ''} style={{ width:'100%', height:'100%' }}>
                <BossAvatar emotion={boss.face} speaking={bossSpeak} color={boss.color} />
              </div>
            </div>
          </div>
          {/* the room darkens while the candidate speaks — the spotlight shifts to them */}
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:4,
            background:'radial-gradient(120% 100% at 50% 38%, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.62) 100%)',
            opacity: userSpeak ? 1 : 0, transition:'opacity 0.45s' }} />

          {/* name + tags at the base of the stage */}
          <div style={{ position:'absolute', left:0, right:0, bottom:10, zIndex:6, textAlign:'center', padding:'0 12px' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:21, fontWeight:700, color:'#fff',
              letterSpacing:'0.04em', lineHeight:1, textShadow:`0 0 18px ${boss.color}aa, 0 2px 10px rgba(0,0,0,0.9)`, transition:'text-shadow 0.5s' }}>
              {funnel?.displayName ?? 'DEIN GEGNER'}
            </div>
            {!funnel && <div style={{ fontSize:9.5, color:'#94a3b8', marginTop:4 }}>Dein nächster Interview-Gegner wartet.</div>}
            <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap', marginTop:7 }}>
              {[['◆','HOCHDRUCK'], ['◈',`NIVEAU ${funnel?.levelLabel || (level === 'c1' ? 'C1' : level === 'b2' ? 'B2' : 'A2–B1')}`], ['✦','NUR DEUTSCH']].map(([ic, t]) => (
                <span key={t} style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8.5, padding:'4px 9px',
                  borderRadius:'var(--r-pill)', letterSpacing:'0.1em', display:'inline-flex', alignItems:'center', gap:5,
                  background:`${boss.color}12`, border:`1px solid ${boss.color}55`, color:'#e2e8f0', boxShadow:`0 0 10px ${boss.color}22` }}>
                  <span style={{ color:boss.color, fontSize:7 }}>{ic}</span>{t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* DEINE HP — bottom frame */}
        <div style={{ marginTop:6 }}>
          <HpBar label="DEINE HP" value={playerHp} isPlayer={true} reason={playerReason} />
        </div>
      </div>
      )}

      {/* ── SUBTITLE STRIP — boss line + live transcript, one film-subtitle panel. Shown ONLY during a
          live fight; on the idle home it was a tall empty box ("Interview noch nicht gestartet") that
          ate the screen and pushed the primary action down. Calm idle = no dead panel. ── */}
      {funnel && (
      <div style={{ padding:'8px 14px 0', flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', borderRadius:'var(--r-md)',
          background:'linear-gradient(180deg, rgba(0,22,44,0.55), rgba(0,8,18,0.85))',
          border:'1px solid var(--line)', boxShadow:'inset 0 0 30px rgba(0,0,0,0.45)', overflow:'hidden' }}>
          {/* who is speaking + live score flash */}
          <div style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8,
            borderBottom:'1px solid var(--line)', background:'rgba(0,0,0,0.25)' }}>
            <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.14em',
              color: bossSpeak ? boss.color : userSpeak ? 'var(--player)' : 'var(--text-dim)',
              textShadow: bossSpeak ? `0 0 8px ${boss.color}` : 'none', transition:'color 0.3s' }}>
              {bossSpeak ? `${funnel?.displayName ?? 'GEGNER'} SPRICHT` : userSpeak ? 'DU SPRICHST' : isActive ? 'DIALOG' : 'INTERVIEW'}
            </span>
            {userSpeak && <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--player)', boxShadow:'0 0 6px var(--player)', animation:'pulse 0.8s infinite' }} />}
            <div style={{ flex:1 }} />
            {scoreFlash && (
              <span className="flash" style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10,
                color: scoreFlash.score >= 60 ? 'var(--accent)' : '#f87171' }}>
                ⚡ {scoreFlash.score}/100{scoreFlash.damage > 0 ? ` · −${scoreFlash.damage} HP` : ''}
              </span>
            )}
          </div>
          {/* the boss's current line — the prominent subtitle */}
          <div style={{ padding:'9px 13px 5px', fontSize:13.5, lineHeight:1.6, minHeight:34, overflowWrap:'anywhere',
            color: bossIsCorrection ? 'var(--action-2)' : '#e2e8f0',
            borderLeft: bossIsCorrection ? '3px solid var(--action)' : '3px solid transparent',
            transition:'border-color 0.3s, color 0.3s' }}>
            {bossIsCorrection && (
              <div style={{ fontSize:9, fontFamily:'var(--font-display)', color:'var(--action)', marginBottom:4, letterSpacing:'0.1em' }}>
                ← SAG ES NOCHMAL RICHTIG · قول الجملة صح
              </div>
            )}
            {bossText
              ? bossText
              : isActive
                ? <span style={{ color:'#475569', animation:'pulse 1.2s infinite' }}>{funnel?.displayName ?? 'Der Gegner'} spricht…</span>
                : <span style={{ color:'#334155' }}>Interview noch nicht gestartet.</span>}
          </div>
          {/* transcript log */}
          <div style={{ flex:1, minHeight:0, padding:'0 6px 6px' }}>
            <TranscriptPanel
              lines={liveTranscript
                ? [...transcript, { id: 'live', speaker: 'player', text: liveTranscript, partial: true }]
                : transcript}
              userSpeak={userSpeak}
              bossName={(funnel?.displayName || '').toUpperCase()}
            />
          </div>
        </div>
      </div>
      )}

      {/* ── MIC + CONTROLS (pinned to viewport bottom so the START button is
             ALWAYS visible, regardless of screen height) ─────────────────── */}
      <div style={{ padding:'14px 16px 24px', textAlign:'center',
        position:'sticky', bottom:0, zIndex:30,
        background:'linear-gradient(180deg, rgba(2,4,9,0) 0%, rgba(2,4,9,0.88) 26%, #020409 60%)' }}>
        {error && (
          <div style={{ marginBottom:12, padding:'8px 12px', borderRadius:8,
            background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.35)',
            color:'#fca5a5', fontSize:11 }}>
            ⚠ {wsErrorText(error, feedbackLang) ?? error}
          </div>
        )}

        {canStart && showHowto && (
          <div style={{ marginBottom:12, padding:'11px 13px', borderRadius:10, textAlign:'left',
            background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.28)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:9.5, letterSpacing:'0.12em', color:'var(--accent)' }}>SO FUNKTIONIERT'S · إزّاي تلعب</span>
              <button onClick={dismissHowto} aria-label="dismiss" style={{ cursor:'pointer', fontSize:13, lineHeight:1, color:'#64748b', background:'none', border:'none', padding:'2px 4px' }}>✕</button>
            </div>
            <div style={{ fontSize:11, color:'#cbd5e1', lineHeight:1.55 }}>
              1) Niveau wählen · 2) „INTERVIEW STARTEN" drücken und laut Deutsch sprechen · 3) Am Ende sofortiges Feedback.
            </div>
            <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:4 }}>
              ١) اختار المستوى · ٢) دوس «ابدأ» واتكلم ألماني بصوت عالي · ٣) في الآخر هتاخد تقييم وتصحيح فوري.
            </div>
          </div>
        )}

        {/* ── Answer input (turn-based) ─────────────────────────────────────── */}
        {isActive && (
          <div style={{ marginBottom:12, textAlign:'left' }}>
            {bossThinking ? (
              <div style={{ padding:'14px', textAlign:'center', fontFamily:'var(--font-display)',
                fontSize:11, letterSpacing:'0.1em', color:'var(--accent)',
                border:'1px solid rgba(59,130,246,0.25)', borderRadius:8,
                background:'rgba(59,130,246,0.05)', animation:'pulse 1.2s infinite' }}>
                {funnel?.displayName ?? 'Der Chef'} denkt nach…
              </div>
            ) : (
              <>
                <textarea
                  value={answerText}
                  onChange={(e) => { setAnswerText(e.target.value); pendingDurationRef.current = 0; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }}
                  placeholder="Ihre Antwort auf Deutsch… (Enter zum Senden)"
                  rows={3}
                  disabled={transcribing}
                  style={{ width:'100%', boxSizing:'border-box', resize:'vertical', padding:'10px 12px',
                    fontSize:14, lineHeight:1.5, color:'#e2e8f0', background:'rgba(2,6,16,0.7)',
                    border:'1px solid rgba(59,130,246,0.3)', borderRadius:8, outline:'none', fontFamily:'inherit' }}
                />
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button onClick={() => { setTtsMuted(m => { const next = !m; if (next) stopBossVoice(); return next; }); }}
                    title={ttsMuted ? 'Stimme einschalten' : 'Stimme stummschalten'}
                    style={{ flex:'0 0 auto', padding:'10px 12px', cursor:'pointer', borderRadius:8,
                      fontFamily:'var(--font-display)', fontSize:13, letterSpacing:'0.08em',
                      border:'1px solid #475569', color:'#94a3b8', background:'rgba(148,163,184,0.06)' }}>
                    {ttsMuted ? '🔇' : '🔊'}
                  </button>
                  {/* Manual record (with STOPP) is ONLY for the typing fallback when Freisprech is OFF.
                      In hands-free the live VAD auto-starts/stops/sends — showing a STOPP button here
                      forced users into the no-auto-stop path and made the tool feel un-live. */}
                  {!handsFree && (
                  <button onClick={toggleRecord} disabled={transcribing}
                    style={{ flex:'0 0 auto', padding:'10px 14px', cursor:'pointer', borderRadius:8,
                      fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.08em',
                      border:`1px solid ${recording ? '#ef4444' : '#475569'}`,
                      color: recording ? '#fca5a5' : '#94a3b8',
                      background: recording ? 'rgba(239,68,68,0.1)' : 'rgba(148,163,184,0.06)' }}>
                    {transcribing ? '⏳…' : recording ? '■ STOPP' : '🎤 SPRECHEN'}
                  </button>
                  )}
                  <button onClick={sendAnswer} disabled={!answerText.trim() || transcribing}
                    style={{ flex:1, padding:'10px 14px', cursor: answerText.trim() ? 'pointer' : 'not-allowed',
                      borderRadius:8, fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.12em',
                      border:'1px solid var(--accent)', color:'#04070d', fontWeight:700,
                      background: answerText.trim() ? 'linear-gradient(135deg,#67e8f9,var(--accent))' : 'rgba(59,130,246,0.15)',
                      opacity: answerText.trim() ? 1 : 0.5 }}>
                    SENDEN ▶
                  </button>
                </div>
                {recording && (
                  <div style={{ fontSize:10, color: handsFree ? 'var(--accent)' : '#fca5a5', marginTop:4, textAlign:'center' }}>
                    {handsFree
                      ? 'Ich höre zu — sprich einfach weiter, ich sende automatisch.'
                      : 'Aufnahme läuft — auf STOPP drücken, dann wird transkribiert.'}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!isActive && <WaveformRing volRef={volRef} active={isActive} bossSpeak={bossSpeak} />}

        <div style={{ margin:'6px 0 12px' }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:'0.18em',
            fontSize: (isActive && !bossSpeak && !userSpeak) ? 24 : 13,
            color: bossSpeak ? boss.color : isActive ? 'var(--accent)' : isConnecting ? 'var(--warn)' : '#475569',
            textShadow: (isActive && !bossSpeak) ? '0 0 16px rgba(59,130,246,0.6)' : bossSpeak ? `0 0 12px ${boss.color}` : 'none',
            transition:'all 0.3s' }}>
            {isActive ? (bossThinking ? 'CHEF DENKT NACH…' : 'DU BIST DRAN')
              : isConnecting ? 'VERBINDE…' : 'BEREIT ZUM KAMPF'}
          </div>
          {isActive && !bossThinking && (
            <div style={{ fontSize:9, color:'#475569', marginTop:3 }}>Tippe deine Antwort auf Deutsch — oder nimm sie per 🎤 auf</div>
          )}
          {isConnecting && (
            <div style={{ fontSize:9.5, color:'var(--action)', marginTop:4, lineHeight:1.4 }}>
              {feedbackLang === 'ar'
                ? '⏳ بنحضّر المحاوِر… أول مرة ممكن تاخد لحد ٣٠ ثانية. استنى من فضلك.'
                : '⏳ Der Interviewer wird vorbereitet… der erste Start kann bis zu 30 Sek. dauern. Bitte warten.'}
            </div>
          )}
        </div>

        {/* Pending-payment reassurance badge — persists through the wait, no gate needed */}
        {canStart && billing?.pendingPayment && (
          <PendingBadge pending={billing.pendingPayment} whatsapp={billing.whatsappNumber} lang={feedbackLang} />
        )}

        {/* Daily live-minutes remaining (active paid plan, before they start) */}
        {canStart && billing?.dailyLiveMinutes > 0 && billing.minutesRemaining > 0 && (
          <div style={{ fontSize:10.5, color:'var(--accent)', textAlign:'center', marginBottom:7, fontFamily:'var(--font-display)', letterSpacing:'0.05em' }}>
            ⏱ {feedbackLang === 'ar' ? `متبقي ${billing.minutesRemaining} دقيقة النهاردة` : `${billing.minutesRemaining} Min heute übrig`}
          </div>
        )}

        {/* Start / Stop toggle — replaced by an honest "come back tomorrow" note at the daily cap */}
        {canStart && billing?.dailyLiveMinutes > 0 && billing.minutesRemaining <= 0 ? (
          <div style={{ padding:'13px', borderRadius:8, border:'1px solid rgba(249,115,22,0.4)', background:'rgba(249,115,22,0.08)',
            textAlign:'center', fontSize:11, color:'var(--action)', lineHeight:1.6 }}>
            {feedbackLang === 'ar'
              ? 'تمرين النهارده خلص. بكرة في جولة جديدة — النهارده: تمارين ودروس.'
              : 'Dein heutiges Training ist erledigt. Morgen wartet das nächste — heute: Drills & Lektionen.'}
          </div>
        ) : canStart ? (
          <button
            onClick={beginSession}
            disabled={isConnecting}
            style={{
              width:'100%', padding:'14px 20px', cursor: isConnecting ? 'wait' : 'pointer',
              fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.15em',
              borderRadius:8, border:'1px solid var(--accent)',
              color:       'var(--accent)',
              background:  'linear-gradient(135deg,rgba(59,130,246,0.06),rgba(59,130,246,0.02))',
              boxShadow: '0 0 14px rgba(59,130,246,0.12)',
              transition:'all 0.25s',
              opacity: isConnecting ? 0.55 : 1,
            }}>
            {isConnecting ? '⠋ VERBINDE…' : '▶  INTERVIEW STARTEN'}
          </button>
        ) : null}

        {/* Hire-Readiness gauge + today's one mission, auto-routed to the weakest area (idle only).
            Hidden when the live brain is active — the brain is the single source of "what to do next"
            (no two competing routers). */}
        {canStart && !BRAIN_GUIDE_LIVE && (
          <DailyMission token={auth.token} apiUrl={API_URL} lang={feedbackLang}
            name={auth.account?.name || (auth.account?.email || '').split('@')[0]}
            onOpen={(drill) => {
              if (drill === 'interview') beginSession();   // first-timer's mission → the real interview
              else if (drill === 'fluency') setFluencyOpen(true);
              else if (drill === 'spoken') setSpokenReviewOpen(true);
              else if (drill === 'pressure') setPressureOpen(true);
              else if (drill === 'listening') setListeningOpen(true);
            }} />
        )}

        {/* The LIVE BRAIN: one next step + the journey toward the goal + an honest aha (GET /api/brain).
            OFF until the masri in BrainGuide.jsx is authored (BRAIN_GUIDE_LIVE). */}
        {BRAIN_GUIDE_LIVE && canStart && (
          <BrainGuide token={auth.token} apiUrl={API_URL} onAction={(d) => {
            const p = d?.prescription || {};
            const OPEN = { 'shadowing': setShadowingOpen, 'sag-es-richtig': setSpokenReviewOpen,
              'flow-drill': setFluencyOpen, 'hoer-check': setListeningOpen, 'druck-leiter': setPressureOpen,
              'srs': setDailyOpen };
            if (p.action === 'drill') { const fn = OPEN[p.drill]; fn ? fn(true) : beginSession(); }
            else if (p.action === 'interview' || p.action === 'measure') beginSession();
            else if (p.action === 'assessment') setAssessmentOpen(true);
            else if (p.action === 'apply') setZielplanOpen(true);
          }} />
        )}

        {/* ELITE-ONLY premium: Alhassan's deep weekly briefing (self-hides for non-Elite / no data). */}
        {canStart && auth.account?.entitlement?.plan === 'elite' && (
          <WeeklyBriefing token={auth.token} apiUrl={API_URL} />
        )}

        {/* Mission KPI: ask returning students for a job-search update (self-hides unless the server says due) */}
        {canStart && <PlacementPrompt token={auth.token} apiUrl={API_URL} lang={feedbackLang} />}

        {/* Referral loop: invite a friend → both get +3 trial days when the friend finishes their first interview. */}
        {canStart && <InviteCard accountId={auth.account?.id} />}

        {/* Secondary nav — Trainingsnachweis (PDF cert) + weekly leaderboard. Moved here from above the
            level picker so the calm idle home leads with the action; these are check-in-later items. */}
        {canStart && (
          <button onClick={() => setNachweisOpen(true)} style={{ width:'100%', textAlign:'left', cursor:'pointer',
            display:'flex', alignItems:'center', gap:10, marginTop:8, padding:'8px 12px', borderRadius:'var(--r-md)',
            background:'rgba(59,130,246,0.07)', border:'1px solid rgba(59,130,246,0.25)', transition:'all var(--dur-slow)' }}>
            <div style={{ fontSize:20 }}>📄</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, color:'var(--accent)' }}>TRAININGSNACHWEIS</div>
              <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:2 }}>Fortschritt als PDF drucken · اطبع تقدمك كـPDF</div>
            </div>
            <div style={{ fontSize:10, color:'var(--accent)' }}>▸</div>
          </button>
        )}
        {canStart && (
          <button onClick={() => { setLeaderboardOpen(true); setLeaderboard(null); }}
            style={{ width:'100%', textAlign:'left', cursor:'pointer',
            display:'flex', alignItems:'center', gap:10, marginTop:8, padding:'8px 12px', borderRadius:'var(--r-md)',
            background:'rgba(249,115,22,0.06)', border:'1px solid rgba(249,115,22,0.25)', transition:'all var(--dur-slow)' }}>
            <div style={{ fontSize:20 }}>🏆</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, color:'var(--action)' }}>DIESE WOCHE</div>
              <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:2 }}>Wochentabelle — wer trainiert am meisten? · مين بيتدرب أكتر الأسبوع ده؟</div>
            </div>
            <div style={{ fontSize:10, color:'var(--action)' }}>▸</div>
          </button>
        )}

        {/* Free intelligent assessment — the hook (idle only). Distinct highlight. */}
        {canStart && (
          <button onClick={() => setAssessmentOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--action)', color:'#04070d', fontWeight:700,
            background:'linear-gradient(135deg,var(--action),var(--action))', boxShadow:'0 0 16px rgba(249,115,22,0.25)' }}>
            🎯  EINSTUFUNG · تقييم مستواك (gratis)
          </button>
        )}

        {/* Trainingslager study-map teaser (idle only) → opens the full game-map route */}
        {canStart && (
          <GameMapCompact token={auth.token} apiUrl={API_URL} lang={feedbackLang}
            onOpen={() => setTrainingslagerOpen(true)} />
        )}

        {/* Secondary label so the drill menu reads as EXTRAS under today's one guided mission above
            (DailyMission), instead of competing with it as a second set of equal CTAs. */}
        {canStart && (
          <div style={{ marginTop:16, marginBottom:2, fontFamily:'var(--font-display)', fontSize:8.5,
            letterSpacing:'0.18em', color:'rgba(148,163,184,0.65)', textAlign:'center' }}>
            WEITERE ÜBUNGEN · تمارين إضافية
          </div>
        )}

        {/* Shadowing pronunciation practice (idle only) — paid; server returns 402 → paywall */}
        {canStart && (
          <button onClick={() => setShadowingOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--accent-2)', color:'var(--accent-2)',
            background:'rgba(96,165,250,0.06)' }}>
            🗣️  SHADOWING · تمرين الترديد
          </button>
        )}

        {/* 4-3-2 spoken-fluency drill (idle only) — paid; server returns 402 → paywall */}
        {canStart && (
          <button onClick={() => setFluencyOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--action)', color:'var(--action)',
            background:'rgba(249,115,22,0.06)' }}>
            ⚡  FLOW-DRILL · سرعة الكلام
          </button>
        )}

        {/* Listening & data-capture drill (idle only) — paid; trains the #1 hiring gap */}
        {canStart && (
          <button onClick={() => setListeningOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--accent)', color:'var(--accent)',
            background:'rgba(59,130,246,0.06)' }}>
            🎧  HÖR-CHECK · فهم السمع
          </button>
        )}

        {/* Spoken-production SRS (idle only) — say YOUR own errors correctly, spaced. The compounding core. */}
        {canStart && (
          <button onClick={() => setSpokenReviewOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--accent)', color:'var(--accent)',
            background:'rgba(59,130,246,0.06)' }}>
            🗯️  SAG ES RICHTIG · قولها صح
          </button>
        )}

        {/* Pressure Ladder — train harder than the real interview (idle only; client-only, free) */}
        {canStart && (
          <button onClick={() => setPressureOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid #ef4444', color:'#ef4444',
            background:'rgba(239,68,68,0.06)' }}>
            🔥  DRUCK-LEITER · سُلّم الضغط
          </button>
        )}

        {/* Alhassan mentor chat (idle only) — free guide with total recall */}
        {canStart && (
          <button onClick={() => setGuideOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10.5, letterSpacing:'0.1em',
            borderRadius:8, border:'1px solid var(--accent)', color:'var(--accent)',
            background:'rgba(59,130,246,0.06)' }}>
            🧭  الحسن · اسأل دليلك
          </button>
        )}

        {/* Progress dashboard access (idle only) */}
        {canStart && (
          <button onClick={openDashboard} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10, letterSpacing:'0.14em',
            borderRadius:8, border:'1px solid rgba(59,130,246,0.4)', color:'var(--accent)',
            background:'rgba(59,130,246,0.06)' }}>
            📊  FORTSCHRITT & WIEDERHOLUNG
          </button>
        )}

        {/* Standalone TYPED "Wiederholung" button removed — it drilled the same SRS items as
            SAG ES RICHTIG above, just by typing. One review surface (spoken, on-mission) instead of
            two that looked identical. Due-card count now shows on the SAG ES RICHTIG flow itself. */}

        {/* Zielplan (goal plan) access — HIDDEN as low-value clutter (strategy audit): a goal-planner
            is meta-work that forks the "what do I open today" decision. Flip `false &&`→`true &&` to
            restore; code/route left intact so it's fully reversible. */}
        {false && canStart && (
          <button onClick={() => setZielplanOpen(true)} style={{ width:'100%', marginTop:8, padding:'12px 10px', minHeight:44,
            cursor:'pointer', fontFamily:'var(--font-display)', fontSize:10, letterSpacing:'0.14em',
            borderRadius:8, border:'1px solid rgba(59,130,246,0.4)', color:'var(--accent)',
            background:'rgba(59,130,246,0.06)' }}>
            🎯  ZIELPLAN — DEIN TRAININGSPLAN
          </button>
        )}

        {/* Permanent feedback button (idle only) */}
        {canStart && <HomeFeedback token={auth.token} apiUrl={API_URL} />}
        {canStart && auth.account?.isAdmin && <AdminFeedback token={auth.token} apiUrl={API_URL} />}

        {/* Boss speaking indicator */}
        {bossSpeak && (
          <div style={{ marginTop:10, height:2, borderRadius:1,
            background:'linear-gradient(90deg,transparent,var(--accent),transparent)',
            animation:'pulse 1s infinite' }} />
        )}
      </div>
    </div>
  );
}

// ── Root: authentication gate around the arena ────────────────────────────────
function AuthedApp() {
  const [auth, setAuth] = useState(loadStoredAuth);

  // Validate / refresh the stored token on mount; drop it if the server rejects.
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unauth'))))
      .then((d) => { if (!cancelled) { const a = { token: auth.token, account: d.account }; persistAuth(a); setAuth(a); } })
      .catch(() => { if (!cancelled) { persistAuth(null); setAuth(null); } });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuth    = useCallback((a) => { persistAuth(a); setAuth(a); }, []);
  const handleLogout  = useCallback(() => { persistAuth(null); setAuth(null); }, []);
  const handleAccount = useCallback((account) => {
    setAuth((cur) => { if (!cur) return cur; const a = { token: cur.token, account }; persistAuth(a); return a; });
  }, []);

  if (!auth) return <AuthScreen onAuth={handleAuth} />;
  return <Arena auth={auth} onLogout={handleLogout} onAccountUpdate={handleAccount} />;
}

// ── Cold-start gate ───────────────────────────────────────────────────────────
// Render's free tier sleeps after ~15 min idle, so the FIRST request can take up to
// ~50s to wake the server. This gate pings /health before revealing the app: warm starts
// pass through invisibly (<700ms); cold starts get a branded, animated, bilingual
// "waking up" screen with live progress + a retry path — never a frozen/dead screen.
function ColdStartScreen({ phase, elapsed, onRetry }) {
  const failed = phase === 'error';
  // Simulated progress that always moves but never claims "done" before the server answers:
  // eases from 6% toward 92% over ~50s.
  const pct = Math.min(92, 6 + (elapsed / 50) * 86);

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9000, display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:18, padding:'28px 22px', textAlign:'center',
      boxSizing:'border-box', overflow:'hidden',
      background:'radial-gradient(120% 90% at 50% 16%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color:'#e2e8f0', animation:'flash-in 0.4s ease' }}>

      <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:900, letterSpacing:3,
        color:'var(--accent)', textShadow:'0 0 24px rgba(59,130,246,0.55)' }}>OMNI-PERFORM</div>

      {!failed ? (
        <>
          {/* spinner ring + boxing glove */}
          <div style={{ position:'relative', width:74, height:74, display:'grid', placeItems:'center' }}>
            <div style={{ position:'absolute', inset:0, borderRadius:'50%',
              border:'3px solid rgba(59,130,246,0.16)', borderTopColor:'var(--accent)',
              animation:'spin 0.9s linear infinite' }} />
            <div style={{ fontSize:30, animation:'pulse 1.4s ease-in-out infinite' }}>🥊</div>
          </div>

          {/* bilingual status (Arabic prominent, German below) */}
          <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:340 }}>
            <div dir="rtl" style={{ fontSize:15, fontWeight:700, color:'#f8fafc' }}>السيرفر بيصحى… جهّز نفسك 🥊</div>
            <div style={{ fontSize:13, color:'#cbd5e1' }}>Server wird gestartet…</div>
          </div>

          {/* progress bar + elapsed */}
          <div style={{ width:'100%', maxWidth:300 }}>
            <div style={{ height:8, borderRadius:99, overflow:'hidden', background:'rgba(255,255,255,0.07)',
              border:'1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ height:'100%', width:`${pct}%`, borderRadius:99,
                background:'linear-gradient(90deg,var(--accent-2),var(--accent))', boxShadow:'0 0 10px rgba(59,130,246,0.5)',
                transition:'width 0.5s ease' }} />
            </div>
            <div style={{ fontSize:10, color:'#64748b', marginTop:6, fontVariantNumeric:'tabular-nums' }}>~{elapsed}s</div>
          </div>

          {/* reassurance + German vocab tip so the wait feels productive */}
          <div style={{ maxWidth:330, fontSize:11, color:'#94a3b8', lineHeight:1.6 }}>
            Der erste Start kann bis zu einer Minute dauern — das ist ganz normal.
            <br /><span dir="rtl">أول تشغيل ممكن ياخد لحد دقيقة، وده طبيعي تمامًا — استنى شوية.</span>
            <div style={{ marginTop:10, padding:'8px 12px', borderRadius:8,
              background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.15)',
              fontSize:11.5, color:'#cbd5e1', textAlign:'left' }}>
              💡 <b style={{ color:'var(--accent)' }}>Tipp:</b> „Einen Moment, ich schaue kurz nach." — immer höflich, wenn du Zeit brauchst.
              <div dir="rtl" style={{ fontSize:10.5, color:'#94a3b8', marginTop:3 }}>تقدر تقول دي دايمًا لو محتاج وقت تفكر</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:42 }}>⏳</div>
          <div style={{ maxWidth:330, fontSize:13, color:'#fca5a5', lineHeight:1.6 }}>
            Der Server braucht länger als erwartet. Bitte erneut versuchen.
            <br /><span dir="rtl">السيرفر بياخد وقت أطول من المعتاد. من فضلك حاول تاني.</span>
          </div>
          <button onClick={onRetry} style={{ marginTop:4, padding:'14px 24px', minHeight:48, cursor:'pointer',
            fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.1em', borderRadius:10, fontWeight:700,
            border:'1px solid var(--accent)', color:'#020409', background:'var(--accent)', boxShadow:'0 0 18px rgba(59,130,246,0.35)' }}>
            ERNEUT VERSUCHEN · حاول تاني
          </button>
        </>
      )}
    </div>
  );
}

function BackendGate({ children }) {
  const [phase, setPhase]     = useState('checking'); // checking | waking | ready | error
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const runRef   = useRef(0);

  const wake = useCallback(async () => {
    const runId = ++runRef.current;
    setPhase('checking'); setElapsed(0);
    const start = Date.now(); startRef.current = start;
    // Reveal the waking screen only if it's actually slow → no flash on warm starts.
    const reveal = setTimeout(() => {
      if (runRef.current === runId) setPhase((p) => (p === 'checking' ? 'waking' : p));
    }, 700);

    const DEADLINE = 60000;
    let ok = false;
    while (Date.now() - start < DEADLINE) {
      if (runRef.current !== runId) { clearTimeout(reveal); return; } // superseded by a retry
      try {
        const ctrl = new AbortController();
        const remaining = DEADLINE - (Date.now() - start);
        // One attempt can ride Render's held connection for the whole wake (~50s).
        const to = setTimeout(() => ctrl.abort(), Math.max(8000, remaining));
        const r = await fetch(`${API_URL}/health`, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (r.ok) { ok = true; break; }
      } catch { /* server still waking / transient — retry */ }
      if (runRef.current !== runId) { clearTimeout(reveal); return; }
      await new Promise((res) => setTimeout(res, 1500));
    }
    clearTimeout(reveal);
    if (runRef.current === runId) setPhase(ok ? 'ready' : 'error');
  }, []);

  useEffect(() => { wake(); return () => { runRef.current++; }; }, [wake]);

  // Tick the elapsed-seconds counter while the waking screen is visible.
  useEffect(() => {
    if (phase !== 'waking') return;
    const id = setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - startRef.current) / 1000))), 250);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === 'ready')    return children;
  if (phase === 'checking') return null; // brief & invisible on warm starts
  return <ColdStartScreen phase={phase} elapsed={elapsed} onRetry={wake} />;
}

// ── Root: cold-start gate → auth gate → arena ─────────────────────────────────
export default function App() {
  // Inject the global CSS once, app-wide, so the cold-start + auth screens are styled too.
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.prepend(el);
    return () => el.remove();
  }, []);
  return <BackendGate><AuthedApp /></BackendGate>;
}
