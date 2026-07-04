import { useState, useEffect, useRef, useCallback, useReducer, Component } from 'react';
import { AudioRecorder } from './audioRecorder.js';
import { ClipRecorder } from './clipRecorder.js';
import { GeminiVoicePlayer } from './geminiVoice.js';
import PlacementPrompt from './PlacementPrompt.jsx';
import Zielplan from './Zielplan.jsx';
import DailyTraining from './DailyTraining.jsx';
import { HomeFeedback, FirstFightCard, AdminFeedback } from './Feedback.jsx';
import { Assessment } from './Assessment.jsx';
import { Shadowing } from './Shadowing.jsx';
import { FluencyDrill } from './FluencyDrill.jsx';
import { Listening } from './Listening.jsx';
import { SpokenReview } from './SpokenReview.jsx';
import { SatzbauSchmiede } from './SatzbauSchmiede.jsx';
import { PressureLadder } from './PressureLadder.jsx';
import { BargeInMonitor } from './bargeInMonitor.js';
import { BrainGuide } from './BrainGuide.jsx';
import { WeeklyBriefing } from './WeeklyBriefing.jsx';
import { InviteCard } from './InviteCard.jsx';
import { DailyMission } from './DailyMission.jsx';
import { Alhassan } from './Alhassan.jsx';
import { Trainingslager, GameMapCompact } from './Trainingslager.jsx';
import { VideoLessons } from './VideoLessons.jsx';
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
// BARGE-IN: let the user interrupt the boss by talking over it (real-conversation feel). The fail-safe
// BargeInMonitor is fully built, but true talk-over overlaps live mic + boss speaker → echo behaviour
// differs on a phone speaker vs headphones, so it stays OFF until the owner phone-tests + tunes the
// sensitivity (rule 2.5). When false, NO extra mic stream is even opened. Flip to true to test on device.
const BARGE_IN_LIVE = false;
// INTERVIEW-BEREITSCHAFT card in the debrief: the hire-readiness judge's verdict (ready / almost +
// the ONE blocking skill). Honest — it names how many of the 9 signals were really measured and
// says "vorläufig" when pronunciation wasn't. Flip to false to hide the card in one line.
const HIRE_VERDICT_LIVE = true;
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
  BOSS_SPEECH_EARLY:  'boss_speech_early',   // first sentence, streamed ahead of the full line → start speaking NOW
  BOSS_SPEECH_DONE:   'boss_speech_done',
  // ── Gemini Live native-audio path (only when the server flags useGeminiAudio for this account) ──
  BOSS_AUDIO_DELTA:             'boss_audio_delta',            // b64 PCM16 @24kHz — boss voice over the WS
  BOSS_INTERRUPTED:             'boss_interrupted',            // user barged in → flush queued boss audio
  LIVE_BOSS_TRANSCRIPT:         'live_boss_transcript',        // boss's words, streamed chunk-by-chunk
  LIVE_USER_TRANSCRIPT_PARTIAL: 'live_user_transcript_partial',// your words, as Gemini transcribes them
  LIVE_USER_TRANSCRIPT_DONE:    'live_user_transcript_done',
  GEMINI_COST:                  'gemini_cost',                 // {monthUsd, capUsd, capped} live spend readout
  GEMINI_ENDED:                 'gemini_ended',                // paid path ended mid-fight → resume the $0 flow
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
  // CONSERVATIVE doctrine (owner 07-02, "smooth > fast"): only a POSITIVE completion signal may
  // classify a turn as done. Anything uncertain is treated as MID-THOUGHT and we wait — a wrongly
  // early boss reply (talking over him) is far worse than an extra second of natural silence,
  // and the instant thinking-filler masks the added latency anyway.
  if (/[,;:\-–—]\s*$/.test(raw)) return 'incomplete';          // mid-clause punctuation → clearly not done
  const noPunct = raw.toLowerCase().replace(/[.,!?;:"'»«…\-]+$/u, '').trim();
  if (_SHORT_VALID.has(noPunct)) return 'complete';            // a short, valid one-word answer
  const toks = noPunct.split(/\s+/);
  const last = toks[toks.length - 1] || '';
  if (_CONT_CUES.has(last)) return 'incomplete';               // trailing cue → still mid-thought (even if Deepgram added a period)
  if (/[.!?]["'»«]?\s*$/.test(raw)) return 'complete';         // finished sentence (Deepgram punctuate)
  return 'incomplete';                                         // no completion signal → assume mid-thought, wait
}

// ── Icon system (07-02 uplift): hand-authored Feather-style stroke SVGs replace every emoji-as-icon
// on home + landing. $0, no deps, one component. Icons render in --accent or --text-dim only —
// orange appears solely inside the hero/CTA buttons via currentColor. Emoji survives only inside
// conversational content (chat, debrief text), never as UI chrome.
const ICON_PATHS = {
  mic: <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  waveform: <><line x1="4" y1="9" x2="4" y2="15" /><line x1="8" y1="6" x2="8" y2="18" /><line x1="12" y1="3" x2="12" y2="21" /><line x1="16" y1="6" x2="16" y2="18" /><line x1="20" y1="9" x2="20" y2="15" /></>,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  headphones: <><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></>,
  messageCheck: <><path d="M21 11.5a8.38 8.38 0 0 1-8.4 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l2-5.8a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.4 8.5z" /><polyline points="9 11.5 11.5 14 15.5 9.5" /></>,
  gauge: <><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /><line x1="12" y1="12" x2="16" y2="8" /></>,
  map: <><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>,
  compass: <><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></>,
  chartUp: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
  fileBadge: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><circle cx="12" cy="15" r="3" /></>,
  trophy: <><path d="M8 21h8M12 17v4" /><path d="M7 4h10v6a5 5 0 0 1-10 0z" /><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" /></>,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  gift: <><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  chevronRight: <polyline points="9 18 15 12 9 6" />,
  play: <polygon points="6 3 20 12 6 21 6 3" />,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
};
function Icon({ name, size = 20, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {ICON_PATHS[name] || null}
    </svg>
  );
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
  _earlyBoss = null;   // an in-flight early first sentence is superseded too (seq guard makes stale callbacks inert)
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
  stopFiller();   // a real boss line is starting (or we're tearing down) → kill any thinking-sound bridge
}

// ── Dead-air "thinking" filler ──────────────────────────────────────────────────
// Real interviewers don't sit in dead silence for 1-2s while they think — they go "Mhm…", "Also…".
// Ours used to: the gap between the candidate finishing and the boss's reply arriving was pure silence,
// which reads as robotic. We fill it with a SHORT sound in the interviewer's OWN voice, pre-generated at
// session start and played the instant the boss starts "thinking". The mic is OFF during that window
// (half-duplex), so this is echo-safe. Separate audio channel from the boss line so the two never fight.
let _fillerAudio = null;
// THINKING FILLER — DISABLED 2026-07-04. The pre-synthesized "Mhm./Verstehe./Also." clips replayed
// every turn were the #1 robotic tell (owner: "no 'Mhm', not every time — be natural"). Only 4 clips
// existed, so the ear recognised the loop as canned. The boss's real, varied, content-reactive reply
// now streams in as the ONLY voice; a natural half-second pause reads like a human considering the
// answer, a recording reads like a machine. Flip to true to restore the old bridge-sound behaviour.
const THINKING_FILLER_ENABLED = false;
function stopFiller() {
  try {
    if (_fillerAudio) {
      const a = _fillerAudio; _fillerAudio = null;
      a.onended = null; a.onerror = null;
      a.pause(); a.src = '';
    }
  } catch {}
}
function playFiller(urls) {
  if (!THINKING_FILLER_ENABLED) return;   // owner 07-04: no canned bridge-sound; the streamed boss reply is the only voice
  if (!urls || !urls.length || _fillerAudio) return;   // nothing cached, or one already bridging
  try {
    const url = urls[Math.floor(Math.random() * urls.length)];   // vary it so it's not the same word every turn
    const a = new Audio(url); a.volume = 0.72;
    _fillerAudio = a;
    a.onended = () => { if (_fillerAudio === a) _fillerAudio = null; };
    a.onerror = () => { if (_fillerAudio === a) _fillerAudio = null; };
    a.play().catch(() => { if (_fillerAudio === a) _fillerAudio = null; });
  } catch {}
}
// Generate a few one-word thinking sounds in the active interviewer's voice, ONCE per session. Forceful
// personas get clipped/assertive fillers; gentle ones get soft acknowledgements. Returns blob URLs.
async function precacheFillers({ apiUrl, token, voice, elevenVoice, forceful }) {
  const phrases = forceful ? ['Also.', 'Gut.', 'So.', 'Hm, gut.'] : ['Mhm.', 'Verstehe.', 'Okay.', 'Ah ja.'];
  const enc = encodeURIComponent;
  const urls = [];
  for (const ph of phrases) {
    try {
      const u = elevenVoice
        ? `${apiUrl}/api/voice?voice=${enc(elevenVoice)}&token=${enc(token)}&text=${enc(ph)}`
        : `${apiUrl}/api/tts-stream?voice=${enc(voice)}&token=${enc(token)}&text=${enc(ph)}`;
      const r = await fetch(u);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (blob.size > 0) urls.push(URL.createObjectURL(blob));
    } catch {}
  }
  return urls;
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

// The one place a boss-voice stream URL is built (ElevenLabs if opted in, else free Aura-2 stream).
function bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text }) {
  const enc = encodeURIComponent;
  const em = emotion ? `&emotion=${enc(emotion)}` : '';   // felt state → server maps it to expressive voice settings
  return elevenVoice
    ? `${apiUrl}/api/voice?voice=${enc(elevenVoice)}&token=${enc(token)}&text=${enc(text)}${em}`
    : `${apiUrl}/api/tts-stream?voice=${enc(voice)}&token=${enc(token)}&text=${enc(text)}${em}`;
}

async function playBossVoice({ apiUrl, token, voice, elevenVoice, text, emotion, onStart, onEnd }) {
  if (!text) { onEnd?.(); return; }
  stopBossVoice();
  // PRIMARY: a STREAMING GET <audio> source — sound starts ~350ms in, killing the ~6s dead air the
  // buffered (whole-clip) path had. ElevenLabs if opted in (paid), else the free Deepgram Aura-2 stream.
  const streamUrl = bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text });
  const fellBack = await playProgressiveAudio(streamUrl, onStart, onEnd);
  if (!fellBack) return;
  // FALLBACK (stream unavailable): buffered, clause-split Deepgram clips (never the robotic browser voice).
  stopBossVoice();   // bump _streamSeq so the fallback owns the stream (speakBossStreamed contract)
  await speakBossStreamed({ apiUrl, token, voice, text, onStart, onEnd });
}

// ── EARLY first sentence (sentence-streaming reply) ────────────────────────────
// The server now streams the boss LLM and sends the FIRST complete sentence (BOSS_SPEECH_EARLY)
// while the rest of the line is still generating. We start speaking that sentence immediately;
// when the full line lands (BOSS_SPEECH_DONE) we splice in only the REMAINDER. The short fetch
// gap between the two clips reads as a natural inter-sentence pause. If anything about the early
// clip fails or the full line doesn't start with it (a guard replaced the line), we fall back to
// playing the whole line from scratch — worst case is a rough cut, never a silent or stuck boss.
let _earlyBoss = null;   // { text, seq, clipDone, failed, pendingRest, onLineEnd }
function playBossEarlySentence({ apiUrl, token, voice, elevenVoice, emotion, text, onStart }) {
  stopBossVoice();               // kills the thinking-filler + any previous line; bumps _streamSeq
  const seq = _streamSeq;
  const st = { text, seq, clipDone: false, failed: false, pendingRest: null, onLineEnd: null };
  _earlyBoss = st;
  const url = bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text });
  playProgressiveAudio(url, onStart, () => {
    st.clipDone = true;
    if (seq !== _streamSeq) return;                  // superseded by a newer line → nothing to do
    if (st.pendingRest)     { const go = st.pendingRest;  st.pendingRest = null; _earlyBoss = null; go(); }
    else if (st.onLineEnd)  { const end = st.onLineEnd;   st.onLineEnd = null;   _earlyBoss = null; try { end(); } catch {} }
    // else: the full line hasn't landed yet — hold the floor; BOSS_SPEECH_DONE will splice or restart.
  }).then((fellBack) => { if (fellBack) st.failed = true; });
}
// Called by BOSS_SPEECH_DONE with the full sanitized line. Returns true if the early clip took
// ownership (the caller must NOT start its own playback), false to play the whole line normally.
function continueBossLineEarly({ full, apiUrl, token, voice, elevenVoice, emotion, onEnd }) {
  const st = _earlyBoss;
  if (!st) return false;
  if (st.seq !== _streamSeq || st.failed || !String(full || '').startsWith(st.text)) {
    _earlyBoss = null;                               // stale / failed / guard replaced the line → full restart
    return false;
  }
  const rest = String(full).slice(st.text.length).trim();
  const playRest = () => {
    // NO stopBossVoice here — that would bump _streamSeq and orphan this line's cancellation contract.
    const url = bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text: rest });
    playProgressiveAudio(url, () => {}, () => { if (st.seq === _streamSeq) { try { onEnd?.(); } catch {} } })
      .then((fellBack) => {
        if (fellBack && st.seq === _streamSeq) {
          speakBossStreamed({ apiUrl, token, voice, text: rest, onStart: () => {}, onEnd });
        }
      });
  };
  if (!rest) {
    if (st.clipDone) { _earlyBoss = null; try { onEnd?.(); } catch {} }
    else st.onLineEnd = onEnd;                       // the early clip WAS the whole line — its end ends the turn
    return true;
  }
  if (st.clipDone) { _earlyBoss = null; playRest(); }
  else st.pendingRest = playRest;                    // splice the remainder in when sentence 1 finishes
  return true;
}

// ── Boss emotional states → drives the SVG interviewer's expression ───────────
const EMOTIONS = {
  // Pre-fight default + the FOUR backend-driven reaction states. Each carries the SVG
  // face, the German status label, and the accent colour the whole boss card shifts to.
  idle:        { face: 'composed',  label: 'GEFASST',     color: 'var(--accent-2)' }, // before the fight
  gefasst:     { face: 'composed',  label: 'GEFASST',     color: 'var(--accent-2)' }, // composed authority
  skeptisch:   { face: 'skeptical', label: 'SKEPTISCH',   color: 'var(--action)' }, // mild doubt — weak answer
  beeindruckt: { face: 'impressed', label: 'BEEINDRUCKT', color: 'var(--accent)' }, // grudging respect
  wuetend:     { face: 'furious',   label: 'WÜTEND',      color: 'var(--action-deep)' }, // cornered / candidate fails — deep orange, red stays reserved for true errors
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
    --action:#f97316; --action-2:#fb923c; --action-deep:#ea580c; --action-dim:rgba(249,115,22,0.45);
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
    /* ── "Private Bank Arena" uplift (07-02): premium glass + a real type scale.
       Floor 11px — the 8.5-10.5px micro-caps era is over. One orange object per screen. */
    --fs-hero:clamp(30px,7vw,44px); --fs-h1:24px; --fs-h2:17px;
    --fs-body:15px; --fs-label:13px; --fs-meta:11px;
    --glass:linear-gradient(165deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015));
    --glass-border:1px solid rgba(255,255,255,0.10);
    --glass-highlight:inset 0 1px 0 rgba(255,255,255,0.08);
    --e1:0 1px 2px rgba(0,0,0,0.35);
    --e2:0 8px 24px -8px rgba(0,0,0,0.5);
    --e3:0 24px 64px -16px rgba(2,6,17,0.7);
    --r-xl:24px;
    --grad-action:linear-gradient(180deg,#fb923c,#f97316);
    --shadow-action:0 8px 24px -6px rgba(249,115,22,0.45), inset 0 1px 0 rgba(255,255,255,0.25);
    --grad-ring:conic-gradient(from 220deg,#3b82f6,#60a5fa,transparent 70%);
    --ring-focus:0 0 0 1px var(--accent), 0 0 0 4px rgba(59,130,246,0.18);
    --sp-6:32px; --sp-7:48px;
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
  /* CRT scanline overlay REMOVED (07-02 uplift) — premium surfaces are clean; the gamer-HUD
     texture read as a toy. (body::before + .scanline are gone on purpose.) */
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
  @keyframes sheen-once { 0%{transform:translateX(-130%) skewX(-18deg)} 100%{transform:translateX(340%) skewX(-18deg)} }
  @keyframes rise-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
  @keyframes wave-bar { 0%,100%{transform:scaleY(0.3)} 50%{transform:scaleY(1)} }
  .uplift-input:focus { box-shadow: var(--ring-focus); border-color: var(--accent); }
  @media (min-width: 900px) {
    .landing-grid { display:grid; grid-template-columns: 1.1fr 0.9fr; gap:48px; align-items:center; }
  }
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
  /* Listening nod: a real interviewer nods along while you talk instead of freezing. Subtle, slightly
     asymmetric so it reads as human, not a metronome. Applied to the avatar while the candidate speaks. */
  @keyframes listen-nod { 0%,100%{transform:translateY(0) rotate(0deg)} 30%{transform:translateY(3px) rotate(0.5deg)} 65%{transform:translateY(-1.5px) rotate(-0.4deg)} }
  .listening { animation: listen-nod 2.1s ease-in-out infinite; }
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
// The one-tap interview→drill handoff: the hire-readiness judge names the ONE blocking skill,
// this maps it to the drill that trains exactly that skill (drill key + on-screen name kept
// together so the button label can never drift from what actually opens). `confidence`
// (hesitation/latency) trains with the 4-3-2 fluency drill; `complexity` (Satzbau/Nebensätze)
// lives in the Trainingslager lessons until the dedicated Satzbau drill ships.
const TRAIN_FOR_SKILL = {
  fluency:         { drill: 'fluency',        label: 'FLUENCY 4-3-2' },
  confidence:      { drill: 'fluency',        label: 'FLUENCY 4-3-2' },
  intelligibility: { drill: 'shadowing',      label: 'SHADOWING' },
  deescalation:    { drill: 'pressure',       label: 'DRUCK-LEITER' },
  grammar:         { drill: 'trainingslager', label: 'TRAININGSLAGER' },
  complexity:      { drill: 'trainingslager', label: 'TRAININGSLAGER' },
};

function Debrief({ data, pending, onRestart, lang = 'de', onLang, bossName, token, apiUrl, onOpenTrainingslager, studentName, onOpenGuide, onTrainSkill }) {
  // The student's first name — so the most personal moment in the app actually speaks to THEM.
  const _fn = (studentName || '').toString().trim().split(/\s+/)[0];
  const nm  = _fn ? _fn.charAt(0).toUpperCase() + _fn.slice(1) : '';
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied]   = useState(false);
  // FEEDBACK ESSENCE (owner 07-02): "never give a million advice." The debrief opens with ONLY the
  // verdict, the readiness judge, and the plan for today — everything else (17 sections of analysis)
  // lives behind one toggle for the learner who wants to dig.
  const [showDetails, setShowDetails] = useState(false);
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
              ? { icon:'✗', label:'DIESMAL NICHT', de:'Unter Druck eingebrochen — genau das entscheidet auf der Linie. Weiter trainieren, der Weg ist klar.', ar:'انهرت تحت الضغط — ده بالظبط اللي الشغل بيتقرر عليه. كمّل تدريب، الطريق واضح.', color:'var(--bad)', bg:'rgba(248,113,113,0.08)', border:'rgba(248,113,113,0.3)' }
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

          {/* ── INTERVIEW-BEREITSCHAFT — the hire-readiness judge (auto-research winner, server-side).
                Unlike ENTSCHEIDUNG (this fight's result), this reads the student's OVERALL measured
                signals and names the ONE skill blocking hire-readiness. Honest by construction: it
                shows how many of the 9 signals were really measured, never guesses the missing ones,
                and only says "fast bereit" when the level gate (B1+) is actually met. ── */}
          {HIRE_VERDICT_LIVE && !gradeUnavailable && data?.progress?.hireReadiness && (() => {
            const h = data.progress.hireReadiness;
            const SKILL = {
              fluency:         { de: 'Flüssigkeit — sprich in ganzen Sätzen, ohne lange Pausen', ar: 'الطلاقة — اتكلم بجمل كاملة من غير وقفات طويلة' },
              grammar:         { de: 'Grammatik — zu viele Fehler pro Antwort', ar: 'القواعد — أخطاء كتير في كل إجابة' },
              intelligibility: { de: 'Verständlichkeit — deine Aussprache kommt noch nicht klar an', ar: 'وضوح النطق — نطقك لسه مش واصل بوضوح' },
              confidence:      { de: 'Sicherheit — weniger zögern, schneller antworten', ar: 'الثقة — تردد أقل ورد أسرع' },
              deescalation:    { de: 'Deeskalation — wütende Kunden ruhig und sicher auffangen', ar: 'التهدئة — استيعاب العميل الغضبان بهدوء وثقة' },
              complexity:      { de: 'Satzbau & Wortschatz — mehr Nebensätze, mehr Vielfalt', ar: 'تركيب الجمل والمفردات — جمل مركّبة أكتر وتنوّع أكبر' },
            }[h.limitingSkill] || null;
            // Tri-state, honest: BEREIT / FAST BEREIT (level gate met, one signal short) / else the
            // biggest lever. hireReady === null (a gating signal unmeasured) → only show the lever.
            const levelOk = { B1: 1, B2: 1, C1: 1 }[h.level] === 1;
            let v = null;
            if (h.hireReady === true) {
              v = { label: 'INTERVIEW-BEREIT', color: 'var(--accent)', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)',
                    de: 'Alle gemessenen Einstellungs-Signale sind im grünen Bereich — du bist bereit für ein echtes Interview.',
                    ar: 'كل إشارات التوظيف المتقاسة في النطاق الأخضر — انت جاهز لمقابلة حقيقية.' };
            } else if (h.hireReady === false && levelOk && SKILL) {
              v = { label: 'FAST INTERVIEW-BEREIT', color: 'var(--action)', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.4)',
                    de: `Was dich gerade am stärksten blockiert: ${SKILL.de}`,
                    ar: `أكتر حاجة بتعطّلك دلوقتي: ${SKILL.ar}` };
            } else if (SKILL) {
              v = { label: 'DEIN GRÖSSTER HEBEL', color: '#94a3b8', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.15)',
                    de: SKILL.de, ar: SKILL.ar };
            }
            if (!v) return null;   // no verdict AND no measurable lever → say nothing rather than guess
            return (
              <div style={{ padding:'12px 14px', borderRadius:'var(--r-md)', background:v.bg, border:`1px solid ${v.border}`,
                animation:'result-rise 0.5s var(--ease-out)', textAlign:'center' }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, letterSpacing:'0.18em', color:v.color, marginBottom:6 }}>
                  🎯 INTERVIEW-BEREITSCHAFT · {v.label}
                </div>
                <div style={{ fontSize:13, color:'#e2e8f0', lineHeight:1.5 }}>{v.de}</div>
                <div dir="rtl" style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>{v.ar}</div>
                {(h.partial || h.readyCaveat) && (
                  <div style={{ fontSize:10, color:'#64748b', marginTop:7 }}>
                    vorläufig · {h.measuredSignals}/{h.totalSignals} Signale gemessen{h.readyCaveat ? ' · Aussprache als klar angenommen' : ''}
                  </div>
                )}
                {/* One-tap handoff: the drill that trains EXACTLY the blocking skill opens on top of
                    this screen (drills stack above the debrief); closing it returns to the results. */}
                {SKILL && onTrainSkill && TRAIN_FOR_SKILL[h.limitingSkill] && (
                  <button onClick={() => onTrainSkill(TRAIN_FOR_SKILL[h.limitingSkill].drill)}
                    style={{ width:'100%', marginTop:10, padding:'12px', minHeight:46, cursor:'pointer',
                      fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.1em', fontWeight:700,
                      borderRadius:9, border:`1px solid ${v.border}`, color:v.color, background:'rgba(0,0,0,0.25)' }}>
                    ▶ JETZT GEZIELT TRAINIEREN: {TRAIN_FOR_SKILL[h.limitingSkill].label}
                  </button>
                )}
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
              {/* The two-session day rhythm: study THIS now, come back tonight — the boss's dossier
                  re-test + AKTE memory make the "she re-tests your weakness" promise literally true. */}
              <div style={{ marginTop:10, paddingTop:9, borderTop:'1px solid rgba(249,115,22,0.25)',
                fontSize:12, color:'#e2e8f0', lineHeight:1.6 }}>
                Übe genau das jetzt — und komm heute Abend für dein zweites Interview zurück:
                dein Interviewer kennt deine Akte und testet deine Schwachstelle erneut.
              </div>
            </div>
          )}

          {/* ── DEIN L1-MUSTER — the Arabic-L1-specific pattern (ROADMAP #3). Deterministic
                detectors, named ONLY when it repeated ≥2×; the example is the learner's own
                (non-truncated, confidence-gated) fragment. Neutral blue — the Wochenfokus above
                stays the screen's single orange anchor. note_ar is an OWNER-AR slot. ── */}
          {data?.l1Pattern && (
            <div style={{ padding:'13px 15px', borderRadius:13, animation:'result-rise 0.55s var(--ease-out)',
              background:'rgba(96,165,250,0.07)', border:'1px solid rgba(96,165,250,0.35)' }}>
              <div style={{ fontSize:8.5, letterSpacing:'0.16em', fontFamily:'var(--font-display)', color:'var(--accent-2)', marginBottom:7 }}>
                DEIN L1-MUSTER · {data.l1Pattern.count}× IN DIESEM INTERVIEW
              </div>
              <div style={{ fontSize:13.5, color:'#f1f5f9', fontWeight:700, lineHeight:1.5 }}>{data.l1Pattern.title}</div>
              <div style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.65, marginTop:6 }}>{data.l1Pattern.explain}</div>
              {ar && data.l1Pattern.note_ar && (
                <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:6 }}>{data.l1Pattern.note_ar}</div>
              )}
              {data.l1Pattern.example && (
                <div style={{ marginTop:9, paddingTop:8, borderTop:'1px solid rgba(96,165,250,0.2)', fontSize:12.5, lineHeight:1.6 }}>
                  <span style={{ color:'var(--bad)', textDecoration:'line-through' }}>{data.l1Pattern.example.quote}</span>
                  {data.l1Pattern.example.better && <>
                    <span style={{ color:'#64748b' }}> → </span>
                    <span style={{ color:'var(--good)' }}>{data.l1Pattern.example.better}</span>
                  </>}
                </div>
              )}
            </div>
          )}

          {/* ── DAS SITZT SCHON — verified structure wins (ROADMAP #12): the SAME deterministic,
                honesty-gated positives the interviewer spoke in the goodbye, persisted in writing.
                ≥2 occurrences each, quote = the learner's own gated words. Neutral blue like the
                L1 card — the Wochenfokus stays the screen's single orange. note_ar = OWNER-AR. ── */}
          {(data?.structureWins || []).slice(0, 2).map((w) => (
            <div key={w.key} style={{ padding:'13px 15px', borderRadius:13, animation:'result-rise 0.55s var(--ease-out)',
              background:'rgba(96,165,250,0.07)', border:'1px solid rgba(96,165,250,0.35)' }}>
              <div style={{ fontSize:8.5, letterSpacing:'0.16em', fontFamily:'var(--font-display)', color:'var(--accent-2)', marginBottom:7 }}>
                DAS SITZT SCHON · {w.count}× IN DIESEM INTERVIEW
              </div>
              <div style={{ fontSize:13.5, color:'#f1f5f9', fontWeight:700, lineHeight:1.5 }}>{w.title}</div>
              {w.explain && <div style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.65, marginTop:6 }}>{w.explain}</div>}
              {ar && w.note_ar && (
                <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:6 }}>{w.note_ar}</div>
              )}
              {w.quote && (
                <div style={{ marginTop:9, paddingTop:8, borderTop:'1px solid rgba(96,165,250,0.2)', fontSize:12.5, lineHeight:1.6 }}>
                  <span style={{ color:'var(--good)' }}>„{w.quote}…"</span>
                  <span style={{ color:'#64748b' }}> — deine eigenen Worte</span>
                </div>
              )}
            </div>
          ))}

          {/* Progressive disclosure (owner: "never give a million advice"): the full analysis —
              every metric, exchange review, grammar group, drill and vocab list — sits behind ONE
              toggle. The learner leaves with a verdict and a plan, not a wall. */}
          <button onClick={() => setShowDetails(s => !s)}
            style={{ width:'100%', padding:'12px', minHeight:46, cursor:'pointer', borderRadius:10,
              fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.1em', fontWeight:700,
              border:'1px solid var(--line-strong)', color:'var(--text-dim)', background:'var(--surface)' }}>
            {showDetails
              ? (ar ? '▴ إخفاء التفاصيل' : 'WENIGER ANZEIGEN ▴')
              : (ar ? '▾ كل التفاصيل والتحليل' : 'ALLE DETAILS & ANALYSE ANZEIGEN ▾')}
          </button>

          {showDetails && (<>
          {/* PROGRESS — deterministic, from the user's OWN past sessions (never the model's opinion) */}
          {data?.progressNarrative && (data.progressNarrative.de || data.progressNarrative.ar) && (
            <div style={{ padding:'10px 13px', borderRadius:10, background:'rgba(96,165,250,0.07)', border:'1px solid rgba(96,165,250,0.3)' }}>
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
                  {(ar ? r.luecke_ar : r.luecke) && <div style={{ fontSize:11.5, color:'var(--bad)', lineHeight:1.5, marginBottom:4, ...rtl }}>✗ {ar && r.luecke_ar ? r.luecke_ar : r.luecke}</div>}
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
            <Section title="GRAMMATIK · NACH REGEL" color="var(--bad)"
              right={
                <button onClick={() => setShowAll(v => !v)} style={{ fontSize:8.5, cursor:'pointer',
                  fontFamily:'var(--font-display)', letterSpacing:'0.06em', padding:'3px 7px', borderRadius:5,
                  border:'1px solid rgba(248,113,113,0.4)', background:'transparent', color:'var(--bad)' }}>
                  {showAll ? 'NUR BEISPIELE' : 'ALLE FEHLER ANZEIGEN'}
                </button>
              }>
              <div style={{ fontSize:9, color:'#64748b', marginBottom:7, fontStyle:'italic', ...rtl }}>
                {ar ? 'فقط أخطاء حقيقية رصدها المدقق. الأحمر = ما قلته · الأزرق = التصحيح.'
                    : 'Nur echte, vom Grammatik-Prüfer erkannte Fehler. Rot = was du gesagt hast · Blau = Korrektur.'}
              </div>
              {data.grammar.map((g, i) => {
                const ex = (showAll ? g.allExamples : g.summaryExamples) ?? [];
                return (
                  <div key={i} style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, color:'var(--bad)', fontWeight:700 }}>
                      {g.rule} {g.count ? <span style={{ color:'var(--text-faint)', fontWeight:400 }}>· {g.count}×</span> : null}
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
                                <span style={{ color:'var(--bad)', textDecoration:'line-through' }}>{e.wrongWord}</span>
                                <span style={{ color:'#64748b' }}> → </span>
                                <b style={{ color:'var(--accent)' }}>{e.rightWord}</b>
                              </div>
                              {e.wrongFragment && (
                                <div style={{ fontSize:10, color:'#64748b', marginTop:2, fontStyle:'italic' }}>{e.wrongFragment}</div>
                              )}
                            </>
                          ) : (
                            <>
                              <span style={{ color:'var(--bad)' }}>✗ {e.wrong}</span><br />
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
          </>)}

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
  // Public ratings (owner 2026-07-02: show real user ratings publicly). Honest by construction —
  // the server itself refuses to return anything until there's a real, non-thin sample (see
  // feedback.js buildPublicRatings); `null` here just means "don't render the section", never a
  // fabricated placeholder.
  const [publicRatings, setPublicRatings] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/feedback/public`).then((r) => r.json())
      .then((d) => { if (!cancelled && d?.available) setPublicRatings(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  // "Private Bank Arena" landing (07-02 uplift): quiet lockup, the Arabic headline AS the hero,
  // a CSS-drawn phone showing the REAL fight UI (the blue-vs-orange moat — $0 product proof),
  // a boxless feature checklist, and a glass auth card whose KONTO-ERSTELLEN button is the ONE
  // orange fill on the page. All DE/AR copy verbatim from the previous landing.
  const rise = (i) => ({ animation:`rise-in 0.36s var(--ease-out) both`, animationDelay:`${i * 60}ms` });
  return (
    <div className="auth-shell" style={{ minHeight:'100svh', display:'flex', flexDirection:'column',
      justifyContent:'center', padding:'24px', position:'relative', overflow:'hidden' }}>
      {/* one ultra-soft blue orb — the only background decoration */}
      <div style={{ position:'fixed', top:-180, right:-180, width:600, height:600, borderRadius:'50%', pointerEvents:'none',
        background:'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 65%)' }} />
      <div className="landing-grid" style={{ maxWidth:1120, margin:'0 auto', width:'100%' }}>
      <div>
      <div style={{ textAlign:'center', marginBottom:20, ...rise(0) }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, letterSpacing:'0.04em', color:'var(--text-dim)' }}>
          OMNI-PERFORM <span style={{ color:'var(--text-faint)' }}>· Sprachtraining</span>
        </div>
        {/* Arabic-first positioning — our biggest moat: no other German trainer serves Arabic speakers */}
        <div dir="rtl" style={{ fontSize:'var(--fs-hero)', fontWeight:700, color:'#f8fafc', marginTop:16, lineHeight:1.35, maxWidth:520, marginInline:'auto' }}>
          أول تدريب إنترفيو ألماني مصمم خصيصًا للعرب — علشان توصل للشغل في كول سنتر ألماني.
        </div>
        <div style={{ fontSize:'var(--fs-body)', color:'var(--text-dim)', marginTop:12, lineHeight:1.6, maxWidth:440, marginInline:'auto' }}>
          Das erste deutsche Interview-Trainer für Arabisch-Sprechende — optimiert für den ägyptischen BPO-Markt.
        </div>
        <div style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', gap:4, marginTop:16,
          padding:'9px 16px', borderRadius:'var(--r-pill)', border:'1px solid var(--action-dim)',
          background:'rgba(249,115,22,0.08)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, color:'var(--action)' }}>
            <Icon name="target" size={14} /> Direkt nach der Anmeldung: kostenlose Einstufung deines Niveaus.
          </div>
          <span dir="rtl" style={{ fontSize:12, color:'var(--action)' }}>بعد ما تسجّل على طول: تقييم مجاني لمستواك.</span>
        </div>
      </div>

      {/* $0 PRODUCT PROOF — a CSS phone showing the actual fight UI (blue player vs orange boss).
          Pure divs, zero assets. The boss line is VERBATIM from scenarios.js (german-checked). */}
      <div style={{ display:'flex', justifyContent:'center', margin:'26px 0 30px', perspective:'1200px', ...rise(1) }}>
        <div style={{ width:240, borderRadius:34, padding:9, background:'#0f1626', boxShadow:'var(--e3)',
          transform:'rotate(-4deg)', border:'1px solid rgba(255,255,255,0.08)', position:'relative' }}>
          <div style={{ position:'absolute', left:'50%', bottom:-26, transform:'translateX(-50%)', width:190, height:30,
            borderRadius:'50%', background:'radial-gradient(ellipse, rgba(59,130,246,0.25), transparent 70%)', filter:'blur(6px)' }} />
          <div style={{ borderRadius:26, overflow:'hidden', background:'linear-gradient(180deg,#0a0f1a,#0d1424)', padding:'10px 12px 14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:'var(--text-faint)', marginBottom:10 }}>
              <span>09:41</span><span>●●●</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <div style={{ width:30, height:30, borderRadius:'50%', background:'rgba(249,115,22,0.18)', border:'1px solid rgba(249,115,22,0.5)',
                display:'grid', placeItems:'center', fontSize:12, fontWeight:700, color:'var(--boss-2)' }}>Y</div>
              <div>
                <div style={{ fontSize:10, fontWeight:600, color:'var(--text)' }}>Yasmin · HR</div>
                <div style={{ fontSize:8, color:'var(--text-faint)' }}>Live-Interview</div>
              </div>
            </div>
            <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.07)', marginBottom:5 }}>
              <div style={{ width:'64%', height:'100%', borderRadius:3, background:'var(--boss)' }} />
            </div>
            <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.07)', marginBottom:12 }}>
              <div style={{ width:'88%', height:'100%', borderRadius:3, background:'var(--player)' }} />
            </div>
            <div style={{ borderRadius:'10px 10px 10px 3px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)',
              padding:'8px 9px', fontSize:9.5, lineHeight:1.5, color:'var(--text)', marginBottom:8 }}>
              Gut. Erzählen Sie mir zuerst kurz, wer Sie sind und was Sie mitbringen.
            </div>
            <div style={{ borderRadius:'10px 10px 3px 10px', background:'rgba(59,130,246,0.15)', border:'1px solid rgba(59,130,246,0.3)',
              padding:'8px 10px', marginLeft:34, marginBottom:10, display:'flex', gap:3, alignItems:'center', justifyContent:'center', height:30 }}>
              {[0,1,2,3,4].map((i) => (
                <div key={i} style={{ width:3, height:14, borderRadius:2, background:'var(--accent-2)', transformOrigin:'center',
                  animation:`wave-bar 1.1s ease-in-out ${i * 90}ms infinite` }} />
              ))}
            </div>
            <div style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:8.5, fontWeight:600, color:'var(--accent-2)',
              background:'rgba(59,130,246,0.12)', border:'1px solid rgba(59,130,246,0.3)', borderRadius:'var(--r-pill)', padding:'3px 8px' }}>
              +12 · Grammatik
            </div>
          </div>
        </div>
      </div>
      <div style={{ textAlign:'center', fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginTop:-16, marginBottom:22, ...rise(2) }}>
        Echtes Live-Interview — Ton an. {/* OWNER-AR slot */}
      </div>

      {/* Feature checklist — boxless, real icons (copy verbatim) */}
      <div style={{ maxWidth:420, margin:'0 auto 26px', display:'flex', flexDirection:'column', gap:18, ...rise(3) }}>
        {[
          { icon:'mic',     ar:'إنترفيو ألماني حقيقي بالصوت ضد HR صعب',          de:'Echtes deutsches Voice-Interview gegen einen harten HR-Boss' },
          { icon:'target',  ar:'فيدباك دقيق على أخطائك انت — مش كلام عام',        de:'Präzises Feedback auf DEINE Fehler (Grammatik via LanguageTool) — nie generisch' },
          { icon:'chartUp', ar:'شوف تقدّمك أسبوع بأسبوع لحد ما تتوظف',           de:'Sieh deinen Fortschritt Woche für Woche — bis zum Job' },
        ].map((b, i) => (
          <div key={i} style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
            <div style={{ width:36, height:36, borderRadius:10, background:'var(--surface)', border:'1px solid var(--line)',
              display:'grid', placeItems:'center', flexShrink:0, color:'var(--accent)' }}>
              <Icon name={b.icon} size={18} />
            </div>
            <div style={{ flex:1 }}>
              <div dir="rtl" style={{ fontSize:'var(--fs-label)', fontWeight:600, color:'#e2e8f0', textAlign:'right' }}>{b.ar}</div>
              <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:3, lineHeight:1.5 }}>{b.de}</div>
            </div>
          </div>
        ))}
      </div>
      </div>

      {/* PUBLIC RATINGS (owner 2026-07-02: real user ratings, publicly shown) — only renders once
          the server confirms a real, non-thin sample exists (never a placeholder/fabricated stat).
          The average is always computed over EVERY rating ever submitted, not just the quotes
          shown below — that's what keeps a curated quote sample honest rather than cherry-picked. */}
      {publicRatings && (
        <div style={{ maxWidth:420, margin:'0 auto 22px', ...rise(3.5) }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:14 }}>
            <span style={{ color:'var(--action)', fontSize:15, fontWeight:700 }}>★ {publicRatings.avgRating.toFixed(1)}</span>
            <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)' }}>
              · {publicRatings.ratingCount} echte Bewertungen {/* OWNER-AR slot */}
            </span>
          </div>
          {publicRatings.comments.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {publicRatings.comments.slice(0, 3).map((c, i) => (
                <div key={i} style={{ padding:'12px 14px', borderRadius:12, background:'var(--surface)',
                  border:'1px solid var(--line)' }}>
                  <div style={{ fontSize:'var(--fs-label)', color:'var(--text)', lineHeight:1.5, fontStyle:'italic' }}>
                    „{c.text}"
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:7 }}>
                    <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', fontWeight:600 }}>— {c.name}</span>
                    <span style={{ fontSize:'var(--fs-meta)', color:'var(--action)' }}>{'★'.repeat(c.rating)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AUTH CARD — glass, one orange fill on the whole page */}
      <div style={{ borderRadius:'var(--r-xl)', padding:24, maxWidth:420, margin:'0 auto', width:'100%',
        background:'var(--glass)', border:'var(--glass-border)', boxShadow:'var(--e3), var(--glass-highlight)',
        backdropFilter:'blur(14px) saturate(1.1)', ...rise(4) }}>
        <div style={{ display:'flex', gap:0, marginBottom:18, background:'rgba(255,255,255,0.05)', borderRadius:'var(--r-pill)', padding:3 }}>
          {['login','signup'].map((m) => (
            <button key={m} onClick={() => { setMode(m); setErr(''); }}
              style={{ flex:1, padding:'11px', minHeight:44, cursor:'pointer', fontFamily:'var(--font-display)', fontSize:'var(--fs-label)',
                fontWeight:600, letterSpacing:'0.04em', borderRadius:'var(--r-pill)', border:'none', transition:'all 200ms var(--ease)',
                background: mode===m?'rgba(59,130,246,0.18)':'transparent', color: mode===m?'var(--accent-2)':'var(--text-faint)' }}>
              {m === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          ))}
        </div>

        <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="E-Mail"
          autoComplete="email" className="uplift-input" style={inputStyle} />
        <input type="password" value={pw} onChange={(e)=>setPw(e.target.value)} placeholder="Passwort (min. 6 Zeichen)"
          autoComplete={mode==='signup'?'new-password':'current-password'}
          onKeyDown={(e)=>{ if(e.key==='Enter') submit(); }} className="uplift-input" style={{ ...inputStyle, marginTop:10 }} />

        {err && (
          <div style={{ marginTop:10 }}>
            <div style={{ color:'#fca5a5', fontSize:12 }}>⚠ {err.de}</div>
            {err.ar && <div dir="rtl" style={{ color:'#fca5a5', fontSize:12, marginTop:2 }}>{err.ar}</div>}
          </div>
        )}

        <button onClick={submit} disabled={busy}
          style={{ width:'100%', marginTop:18, padding:'15px', minHeight:52, cursor:busy?'wait':'pointer',
            fontFamily:'var(--font-display)', fontSize:16, fontWeight:700, letterSpacing:'0.02em', borderRadius:14,
            border:'none', color:'#081019', background:'var(--grad-action)', boxShadow:'var(--shadow-action)',
            opacity:busy?0.6:1, transition:'transform 100ms var(--ease)' }}>
          {busy ? '…' : mode==='login' ? 'Anmelden' : 'Konto erstellen'}
        </button>
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', textAlign:'center', marginTop:12, lineHeight:1.6 }}>
          Kostenlos starten: Niveau-Einstufung · كل ده بالعربي · مجاني للبداية
        </div>
      </div>

      {/* Legal links — static pages in client/public; the payment provider's site review
          requires terms/privacy/refund to be reachable from the public site. Quiet by design. */}
      <div style={{ textAlign:'center', marginTop:18, fontSize:'var(--fs-meta)', color:'var(--text-faint)', ...rise(5) }}>
        {[['/terms.html','AGB'], ['/privacy.html','Datenschutz'], ['/refund.html','Rückerstattung']].map(([href, label], i) => (
          <span key={href}>
            {i > 0 && ' · '}
            <a href={href} style={{ color:'var(--text-faint)', textDecoration:'underline', textUnderlineOffset:3 }}>{label}</a>
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}
const inputStyle = {
  width:'100%', padding:'14px 16px', minHeight:52, borderRadius:12, fontSize:15, fontFamily:'var(--font-body)',
  background:'rgba(255,255,255,0.05)', color:'#e2e8f0', border:'1px solid var(--line)', outline:'none',
  letterSpacing:'0.01em', transition:'box-shadow 120ms var(--ease), border-color 120ms var(--ease)',
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
  const emotionRef                = useRef('gefasst');   // latest boss emotion → drives the VOICE delivery (not just the face)
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
  const fillerUrlsRef = useRef([]);                  // pre-cached "thinking" sounds (this persona's voice) for the dead-air gap
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
  const [satzbauOpen, setSatzbauOpen] = useState(false);           // paid verb-final word-order builder drill route
  const [pressureOpen, setPressureOpen] = useState(false);         // pressure-ladder overload drill (client-only)
  const [guideOpen, setGuideOpen] = useState(false);           // Alhassan mentor chat
  const [csBriefing, setCsBriefing] = useState(null);         // {situation, skill, keyPhrases} — shown before boss speaks
  const [showBriefing, setShowBriefing] = useState(false);    // pre-fight briefing card visible
  // ── Gemini Live native-audio path (server opts this account in via SESSION_READY.useGeminiAudio) ──
  const [geminiMode, setGeminiMode] = useState(false);        // this interview runs on Gemini full-duplex voice
  const [geminiCost, setGeminiCost] = useState(null);         // { monthUsd, capUsd, capped } live spend readout

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
  const [videoLessonsOpen, setVideoLessonsOpen] = useState(false);     // $0 video-lesson engine (animated slides + native TTS)

  const phaseRef       = useRef('idle');
  const startingRef    = useRef(false);     // synchronous single-flight guard for start()
  const levelRef       = useRef('a2-b1');   // read inside the WS handler when starting
  const bossPickRef    = useRef('');         // boss-picker selection, read when sending START_FIGHT
  const fightModeRef   = useRef('daily');   // 'daily' | 'bosstor' — read when sending START_FIGHT
  const volRef         = useRef(0);   // mic volume — a ref, NOT state (see WaveformRing)
  const wsRef          = useRef(null);
  const recorderRef    = useRef(null);
  const pingRef        = useRef(null);
  // Gemini native-audio path: a synchronous mode flag (read inside WS handlers), the PCM player for
  // the boss voice, the continuous mic recorder, and the accumulating boss-subtitle line.
  const geminiModeRef    = useRef(false);
  const geminiPlayerRef  = useRef(null);
  const geminiMicRef     = useRef(null);
  const geminiBossLineRef = useRef('');
  const geminiPendingTextRef = useRef('');   // transcript chunks held back until the boss's VOICE starts
  const geminiVoiceOnRef     = useRef(false); // this turn's first audio chunk has arrived (voice is audible)
  const partialIdRef   = useRef(null);
  const bossPartialIdRef = useRef(null);   // live boss subtitle line in the transcript
  const clipRecRef      = useRef(null);    // ClipRecorder for spoken answers
  const bargeRef        = useRef(null);    // barge-in monitor (lets the user interrupt the boss; gated on BARGE_IN_LIVE)
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

  // ── Gemini Live native-audio mode ───────────────────────────────────────────
  // Entered on SESSION_READY{useGeminiAudio:true} (server allowlists the account + checks budget).
  // The boss voice now arrives as PCM over the WS (played by GeminiVoicePlayer) instead of MP3-over-
  // HTTP, and the mic streams CONTINUOUSLY — Gemini owns turn-taking + barge-in, so the client VAD
  // (startHandsFreeTurn) is bypassed while this is active.
  const enterGeminiMode = useCallback(async () => {
    if (geminiModeRef.current) return;
    geminiModeRef.current = true;
    setGeminiMode(true);
    // Kill any hands-free turn already in flight: phase goes 'active' at ws.onopen, so the client
    // VAD can have opened its own mic (clipRecRef) BEFORE this second SESSION_READY arrives —
    // without this, TWO mics stream AUDIO_CHUNK to Gemini simultaneously.
    if (hfTimerRef.current) { clearInterval(hfTimerRef.current); hfTimerRef.current = null; }
    try { await clipRecRef.current?.stop(); } catch { /* not recording */ }
    clipRecRef.current = null;
    hfActiveRef.current = false;
    try {
      geminiPlayerRef.current = new GeminiVoicePlayer({
        onSpeakStart: () => { setBossSpeak(true); setBossThinking(false); setShowBriefing(false); },
      });
      geminiPlayerRef.current.resume();
    } catch { /* Web Audio unavailable → boss transcript still shows; owner would report no voice */ }
    try {
      const rec = new ClipRecorder({
        onVolume: (v) => { volRef.current = v; },
        onChunk:  (b64) => { try { wsRef.current?.send(JSON.stringify({ type: C.AUDIO_CHUNK, data: b64 })); } catch { /* socket closing */ } },
      });
      await rec.start();
      // Teardown may have raced the await above (e.g. GEMINI_ENDED or session close while the mic
      // permission prompt was open) — geminiMicRef was still null then, so nothing stopped this
      // recorder. Never leave a mic streaming with no owner.
      if (!geminiModeRef.current) { try { await rec.stop(); } catch { /* already stopped */ } return; }
      geminiMicRef.current = rec;
      setRecording(true);
    } catch { setError('mic_denied'); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const stopGeminiMode = useCallback(() => {
    geminiModeRef.current = false;
    setGeminiMode(false);
    try { geminiMicRef.current?.stop?.(); } catch { /* already stopped */ }
    geminiMicRef.current = null;
    try { geminiPlayerRef.current?.close?.(); } catch { /* already closed */ }
    geminiPlayerRef.current = null;
    geminiBossLineRef.current = '';
    geminiPendingTextRef.current = '';
    geminiVoiceOnRef.current = false;
    setRecording(false);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS message dispatch ────────────────────────────────────────────────────
  const handleMsg = useCallback((msg) => {
    switch (msg.type) {
      case S.SESSION_READY:
        // The server sends SESSION_READY twice: once plain at connect (→ START_FIGHT), and again
        // WITH useGeminiAudio once the Gemini native-audio session is live for this account. The 2nd
        // one must NOT re-start the fight (that errors 'fight_already_active') — it switches the
        // client to the Gemini voice path.
        if (msg.useGeminiAudio) { enterGeminiMode(); break; }
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
            'yasmin': 'aura-2-elara-de', 'hana': 'aura-2-viktoria-de', 'frau-mona-adel': 'aura-2-aurelia-de',
            'karim': 'aura-2-fabian-de', 'tarek': 'aura-2-julius-de',
            'frau-mueller': 'aura-2-lara-de', 'herr-tariq': 'aura-2-julius-de', 'direktor-vogel': 'aura-2-fabian-de',
          };
          bossVoiceRef.current = msg.voice || VOICE_BY_BOSS[msg.bossId] || 'aura-2-julius-de';
          bossElevenVoiceRef.current = msg.elevenVoice || '';   // ElevenLabs voice for this character
          const f = typeof msg.forcefulness === 'number' ? msg.forcefulness : 0.4;
          // Turn-taking patience scales with persona (easier interviewer → a bit more grace). RAISED
          // 07-02 (450→700, owner: SMOOTH > fast — he was still being talked over mid-sentence): a
          // gentle interviewer now adds ~0.6s, a forceful one ~0.04s. Even the most forceful persona
          // must never grab the floor inside a thinking pause — forcefulness shows in WORDS, not in
          // stealing the turn.
          bossPatienceRef.current = Math.round(Math.pow(1 - f, 1.3) * 700);
          // Pre-generate short thinking sounds in THIS interviewer's own voice so the dead-air gap can be
          // filled instantly (mic off → echo-safe). Fire-and-forget; stays silent until ready. Revokes the
          // previous session's blobs first so they don't leak.
          if (THINKING_FILLER_ENABLED && !ttsMutedRef.current) {
            precacheFillers({
              apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current, elevenVoice: bossElevenVoiceRef.current,
              forceful: f >= 0.6,
            }).then((urls) => {
              try { fillerUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)); } catch {}
              fillerUrlsRef.current = urls;
            }).catch(() => {});
          }
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
        stopGeminiMode();   // interview over → stop the continuous mic + boss-voice player
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
        stopGeminiMode();
        setDebrief(null); setDebriefPending(false); setNoSession(true);
        break;

      case S.PAYWALL:
        // Server refused to start the session — trial exhausted. Show the upgrade wall.
        setPhaseSync('idle');
        recorderRef.current?.stop().catch(() => {});
        recorderRef.current = null;
        stopGeminiMode();
        try { wsRef.current?.close(1000, 'paywall'); } catch {}
        wsRef.current = null;
        setPaywall(msg);
        break;

      case S.AUDIO_DELTA:
        // Boss has no audio in the OpenAI-free text interview — ignore (kept for safety).
        break;

      // ── Gemini Live native-audio path ──────────────────────────────────────
      case S.BOSS_AUDIO_DELTA:
        // Boss voice (PCM16@24k) over the WS → play it. (Barge-in flush arrives via BOSS_INTERRUPTED.)
        if (!geminiModeRef.current || !geminiPlayerRef.current) break;
        geminiPlayerRef.current.enqueue(msg.data);
        // Voice-first ordering: the transcript held back for this turn is released only now, when
        // her voice is actually audible — the text follows the speech, never announces it.
        if (!geminiVoiceOnRef.current) {
          geminiVoiceOnRef.current = true;
          if (geminiPendingTextRef.current) {
            geminiBossLineRef.current += geminiPendingTextRef.current;
            geminiPendingTextRef.current = '';
            setBossText(geminiBossLineRef.current);
          }
          setBossSpeak(true); setBossThinking(false); setShowBriefing(false);
        }
        break;

      case S.BOSS_INTERRUPTED:
        // User barged in → drop any queued boss audio immediately so it stops talking over them.
        if (geminiModeRef.current) geminiPlayerRef.current?.flush();
        break;

      case S.LIVE_BOSS_TRANSCRIPT: {
        // Boss's words, streamed chunk-by-chunk. Gemini streams the transcript ~0.5s AHEAD of the
        // audio; showing it immediately made the reply feel gated on text. Hold chunks back until
        // the voice starts (BOSS_AUDIO_DELTA releases them), then append live as she speaks.
        if (!geminiModeRef.current) break;
        if (!geminiVoiceOnRef.current) { geminiPendingTextRef.current += (msg.text || ''); break; }
        geminiBossLineRef.current += (msg.text || '');
        setBossText(geminiBossLineRef.current);
        break;
      }

      case S.LIVE_USER_TRANSCRIPT_PARTIAL:
        // Your words, as Gemini transcribes them → live subtitle (committed later via TRANSCRIPT_DONE).
        if (geminiModeRef.current) setLiveTranscript((prev) => (prev || '') + (msg.text || ''));
        break;

      case S.LIVE_USER_TRANSCRIPT_DONE:
        // The final user line is committed by the scoring path (TRANSCRIPT_DONE); just clear the live one.
        if (geminiModeRef.current) setLiveTranscript('');
        break;

      case S.GEMINI_COST:
        setGeminiCost({ monthUsd: msg.monthUsd, capUsd: msg.capUsd, capped: !!msg.capped });
        break;

      case S.GEMINI_ENDED:
        // Paid path ended mid-fight (budget cap or error) → leave Gemini mode so the normal $0
        // hands-free flow resumes (mic re-opens via the VAD effect; boss replies return via MP3).
        stopGeminiMode();
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
          if (!geminiModeRef.current) setBossThinking(true);   // (filler already started at turn-end for zero perceived gap; no replay here). Gemini already voiced the reply → no "thinking" wait.
          const id = ++_lineId;
          setTranscript(prev => [...prev.slice(-39), { id, speaker: 'player', text: msg.transcript, partial: false, words: msg.words ?? [] }]);
        }
        break;
      }

      case S.BOSS_SPEECH_EARLY: {
        // First sentence of the boss's reply, streamed ahead of the full line — start SPEAKING it
        // now. The full line still arrives via BOSS_SPEECH(+DONE), which splices in the remainder.
        if (geminiModeRef.current) break;              // Gemini path: boss voice is PCM over the WS, never MP3
        if (!msg.text || ttsMutedRef.current) break;   // muted → the normal text-only path handles it
        setBossSpeak(true);        // immediately, like BOSS_SPEECH — keeps the auto-mic gate closed (no echo window)
        setBossThinking(false);
        setShowBriefing(false);
        setBossText(msg.text);     // subtitle shows the first words at once; the full line replaces it
        _latTtsStart = Date.now(); // [LAT] TTS clock starts at the early sentence
        playBossEarlySentence({
          apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current,
          elevenVoice: bossElevenVoiceRef.current, emotion: emotionRef.current, text: msg.text,
          onStart: () => reportClientLat(API_URL),
        });
        break;
      }

      case S.BOSS_SPEECH: {
        if (geminiModeRef.current) break;   // Gemini path: boss text arrives via LIVE_BOSS_TRANSCRIPT, voice via BOSS_AUDIO_DELTA
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
        // Gemini path: the boss voice already streamed as PCM (BOSS_AUDIO_DELTA) and its words as
        // LIVE_BOSS_TRANSCRIPT — there is NO MP3 to synth here. Just end the boss's turn: clear the
        // subtitle accumulator so the next turn starts fresh and re-announces "speaking".
        if (geminiModeRef.current) {
          geminiBossLineRef.current = '';
          geminiPendingTextRef.current = '';
          geminiVoiceOnRef.current = false;   // next turn holds its text again until the voice starts
          geminiPlayerRef.current?.markTurnEnd();
          setBossSpeak(false);
          break;
        }
        // Boss line is not in the transcript log (single-place render) — nothing to finalize there.
        // Speak the boss's German line aloud (playBossVoice → ElevenLabs if opted in, else Deepgram
        // Aura-2 native German; never browser TTS). bossSpeak
        // stays true while speaking, then clears on end, so the avatar animates and
        // the debrief waits until the final line has finished being read out.
        {
          stopFiller();   // the real reply is ready → end the thinking-sound bridge (also handled by stopBossVoice below)
          const spokenLine = bossLineRef.current || '';
          try { console.log(`[DIAG] BRAIN (boss reply): ${JSON.stringify(spokenLine)}`); } catch {}
          if (!ttsMutedRef.current && spokenLine) {
            // If the EARLY first sentence is already playing (BOSS_SPEECH_EARLY), splice in only the
            // remainder of the line — the boss has been speaking since ~first-token time. Otherwise
            // play the full line as before (streamed progressive audio, buffered clips as fallback).
            const spliced = continueBossLineEarly({
              full: spokenLine, apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current,
              elevenVoice: bossElevenVoiceRef.current, emotion: emotionRef.current,
              onEnd: () => setBossSpeak(false),
            });
            if (!spliced) {
              _latTtsStart = Date.now();   // [LAT] TTS clock: boss text ready, about to synth+play
              playBossVoice({
                apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current, elevenVoice: bossElevenVoiceRef.current, text: spokenLine,
                emotion: emotionRef.current,   // the boss's felt state → its VOICE, not just its face
                onStart: () => { reportClientLat(API_URL); setBossSpeak(true); }, onEnd: () => setBossSpeak(false),
              });
            }
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
        if (msg.emotion) { setEmotion(msg.emotion); emotionRef.current = msg.emotion; }
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
        // Gemini: stop the MIC now (halts streaming + billing) but leave the player so the boss's
        // final line plays out; the following DEBRIEF/NO_SESSION does the full player teardown.
        if (geminiModeRef.current) { try { geminiMicRef.current?.stop?.(); } catch { /* already stopped */ } geminiMicRef.current = null; setRecording(false); }
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
      stopGeminiMode();   // socket gone → tear down the Gemini mic + player (no-op on the $0 path)
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
    // Gemini: stop the continuous mic now (halts streaming + billing); the player + mode flag are
    // torn down on the DEBRIEF/SESSION_CLOSED that follows, so the boss's final line still plays.
    try { await geminiMicRef.current?.stop?.(); } catch {}
    geminiMicRef.current = null;
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
    if (geminiModeRef.current) return;   // Gemini owns the mic continuously — the client VAD must never open a second one
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

    let spoke = false, volSpoke = false, silenceMs = 0, elapsed = 0, floor = 0.02;
    let lastPartial = '', partialStableMs = 0;   // transcript-stopped-growing detector (noisy-mic safety net)
    livePartialRef.current = '';   // fresh transcript for this turn's classification
    // ADAPTIVE end-of-turn. Instead of one fixed silence value we pick how long to wait based
    // on whether the live transcript looks finished (classifyTurnDE): a clearly-complete
    // sentence yields fast, an ambiguous one gets real thinking grace, and a mid-clause
    // utterance ("…ich habe drei Jahre bei …") waits a long time. cancel-on-resume is the
    // load-bearing mechanic: the moment the user speaks again, silenceMs resets to 0, so a
    // pause between sentences can NEVER end the turn. These windows already include the
    // non-native (L2) speaker grace from the turn-taking research.
    // Owner (07-02, PRIORITY FLIPPED BACK): after a live run he was still being TALKED OVER mid-sentence —
    // SMOOTH now beats fast. The windows are raised so a thinking pause can never read as "done":
    // an L2 speaker pauses 0.7–1.5s BETWEEN sentences of one answer, so even a punctuated "complete"
    // sentence waits ~0.9s (a real interviewer's natural gap) before the boss may take the floor.
    // The dead air AFTER the turn commits is masked by the instant thinking-filler, so the felt
    // latency cost of these raises is small; the felt cost of a wrong cut-off was the #1 crisis.
    const SIL_COMPLETE = 900, SIL_AMBIGUOUS = 1400, SIL_INCOMPLETE = 2500;
    const STEP = 50, K = 2.6, MIN_SPEAK_MS = 180, MAX_MS = 60000;
    hfTimerRef.current = setInterval(async () => {
      elapsed += STEP;
      const v = volRef.current || 0;
      if (!spoke) floor = floor * 0.92 + v * 0.08;          // adapt to room noise until speech
      const thresh = Math.max(0.02, floor * K);
      if (v > thresh) { if (elapsed > MIN_SPEAK_MS) { spoke = true; volSpoke = true; } silenceMs = 0; }
      else if (spoke) { silenceMs += STEP; }
      // SAFETY NET (fixes "my words just hang, it never sends"): if the live transcript has STOPPED
      // GROWING for a while, the candidate has clearly stopped talking — even if a noisy mic keeps the
      // volume above the silence threshold (which would otherwise never end the turn). Grows again →
      // resets, so it can't cut off someone who's still speaking.
      // SOFT-SPEAKER SENSITIVITY (owner 07-02: "the sensor must catch ANYTHING the student said"):
      // a quiet voice / weak mic can stay under the volume threshold for the whole turn, yet Deepgram
      // still hears words. The transcript is definitive evidence of speech — without this, such a turn
      // hung for the full 60s cap and was then DISCARDED as "said nothing". When volume never registered
      // (!volSpoke), the transcript also drives the silence clock, so quiet speech is never cut mid-word.
      if (livePartialRef.current !== lastPartial) {
        lastPartial = livePartialRef.current; partialStableMs = 0;
        if (!volSpoke && lastPartial.trim()) { spoke = true; silenceMs = 0; }
      }
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
      if (stageIdxRef.current <= 1) needSilence += 350;   // open-question grace (restored 07-02 — multi-sentence answers live here)
      needSilence += bossPatienceRef.current;             // per-persona patience: gentle interviewers wait longer before taking the floor, forceful ones stay snappy
      // TURN-TAKING (owner directive 07-01): a real interviewer LETS you talk and only cuts in when you go
      // OFF-TOPIC for a LONG stretch — NEVER on mere length, a list, or a thinking pause. Off-topic is not
      // detectable client-side and length ≠ rambling, so we NO LONGER shorten the wait for long/enumerated
      // turns (that reduction was grabbing the floor at ~300ms and cutting people off mid-sentence "for no
      // reason"). The turn now ends ONLY on a genuine sustained silence; cancel-on-resume resets the timer
      // the instant you speak again, so as long as you're talking you always keep the floor.
      const turnWords = (livePartialRef.current.trim().match(/\S+/g) || []).length;
      //  Opening grace: extra patience on the first few words so an early thinking pause right after the
      //  boss's question is never mistaken for "finished" (kills the reasonless early cut-off).
      if (turnWords > 0 && turnWords < 12) needSilence += 500;
      // End the turn when: silence-after-speech hits the adaptive window, OR the transcript froze
      // (noisy-mic safety net — they've stopped, volume just isn't registering it), OR the hard cap.
      // The frozen-transcript net must be CLASSIFICATION-AWARE: a flat 1800ms silently capped every
      // wait (silence ⇒ frozen transcript), so a mid-clause thinking pause >1.8s was STILL cut no
      // matter how patient the SIL windows were — the exact "talks over me aggressively" bug. It now
      // never fires earlier than the adaptive window it exists to backstop.
      const needStable = Math.max(1800, needSilence + 800);
      const transcriptDone = spoke && livePartialRef.current.trim() && partialStableMs >= needStable;
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
      // PERCEIVED-LATENCY (owner's #1 complaint = the dead wait): start the HR "thinking out loud" the
      // INSTANT you stop — not ~0.5s later when the server finishes transcribing. This masks the whole
      // server gap (STT flush + LLM + TTS), so the dead air before the reply is gone. Echo-safe: this
      // turn's mic is already stopped. bossThinking also blocks the mic from re-triggering early.
      // TIMING MICRO-DETAIL (07-02): a human doesn't hum "Mhm…" thoughtfully after a two-word answer —
      // they just reply. Short answers skip the filler (the streamed reply arrives fast anyway); only
      // substantive answers earn the audible thinking beat.
      setBossThinking(true);
      // Always play a thinking filler so the boss never sits in dead silence after ANY answer.
      // A 300ms bridge beats a 2–6s gap every time; the real reply cuts it off the instant it arrives.
      if (spoke) { try { playFiller(fillerUrlsRef.current); } catch {} }
    }, STEP);
  }, [recording, transcribing]);

  // Drive hands-free: when it's your idle turn (boss finished, nothing in flight), auto-begin
  // capturing after a short settle. Does nothing while handsFree is off.
  useEffect(() => {
    if (!handsFree || phase !== 'active' || geminiMode) return;   // Gemini owns the mic continuously → never run the client VAD
    if (recording || transcribing || bossThinking || bossSpeak || hfActiveRef.current) return;
    const t = setTimeout(() => startHandsFreeTurn(), 150);
    return () => clearTimeout(t);
  }, [handsFree, phase, geminiMode, recording, transcribing, bossThinking, bossSpeak, startHandsFreeTurn]);

  useEffect(() => () => { if (hfTimerRef.current) clearInterval(hfTimerRef.current); }, []);

  // BARGE-IN (OFF until BARGE_IN_LIVE — see flag): a dedicated mic monitor for the whole active hands-free
  // phase. When the user speaks OVER the boss, cut the boss off (stopBossVoice) and flip bossSpeak false —
  // which the hands-free driver above already turns into the user's turn. Fail-safe: if the monitor can't
  // start (mic denied, no AudioContext), it just never fires and the boss finishes normally (no regression).
  // When the flag is off we never even open the extra mic stream.
  useEffect(() => {
    if (!BARGE_IN_LIVE || phase !== 'active' || !handsFree) return;
    const mon = new BargeInMonitor({ onBargeIn: () => { stopBossVoice(); setBossSpeak(false); } });
    bargeRef.current = mon;
    mon.start();
    return () => { bargeRef.current = null; mon.stop(); };
  }, [phase, handsFree]);

  // Arm the monitor ONLY while the boss is actually speaking; disarm otherwise so it can never
  // self-trigger during the user's own turn.
  useEffect(() => {
    const mon = bargeRef.current;
    if (!mon) return;
    if (bossSpeak) mon.arm(); else mon.disarm();
  }, [bossSpeak]);

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
      stopGeminiMode();
      wsRef.current?.close(1000, 'unmount');
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Global BACK — a persistent control on every screen (owner request). Closes the top-most open
  // overlay/drill; inside a live interview it offers a clean exit to the home screen. ──
  const _overlays = [
    [guideOpen, setGuideOpen], [assessmentOpen, setAssessmentOpen], [shadowingOpen, setShadowingOpen],
    [fluencyOpen, setFluencyOpen], [listeningOpen, setListeningOpen], [spokenReviewOpen, setSpokenReviewOpen],
    [satzbauOpen, setSatzbauOpen],
    [pressureOpen, setPressureOpen], [trainingslagerOpen, setTrainingslagerOpen], [nachweisOpen, setNachweisOpen],
    [videoLessonsOpen, setVideoLessonsOpen],
    [leaderboardOpen, setLeaderboardOpen], [zielplanOpen, setZielplanOpen], [dailyOpen, setDailyOpen],
    [showBriefing, setShowBriefing],
  ];
  const canGoBack = _overlays.some(([o]) => o) || !!funnel || isActive || isConnecting;
  const goBack = () => {
    for (const [o, close] of _overlays) { if (o) { close(false); return; } }   // close the top-most overlay
    if (funnel || isActive || isConnecting) {                                    // in a live interview → clean exit
      const msg = feedbackLang === 'ar' ? 'تسيب المقابلة وترجع للصفحة الرئيسية؟' : 'Interview verlassen und zurück zur Startseite?';
      if (window.confirm(msg)) window.location.reload();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell ${shakeScreen ? 'shake' : ''}`} style={{
      minHeight:'100svh',
      display:'flex', flexDirection:'column', position:'relative', overflowX:'hidden',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>

      {/* Global BACK button — persistent on every screen (closes the top overlay, or exits the interview) */}
      {canGoBack && (
        <button onClick={goBack} aria-label="Zurück" title="Zurück" style={{
          position:'fixed', top:10, left:10, zIndex:400, width:38, height:38, borderRadius:'50%', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, lineHeight:1, paddingBottom:3,
          color:'#e2e8f0', background:'rgba(2,6,16,0.82)', border:'1px solid var(--line)', backdropFilter:'blur(4px)' }}>
          ‹
        </button>
      )}

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

      {/* Satzbau-Schmiede — verb-final word-order builder (PAID; deterministic order grading, zero cost) */}
      {satzbauOpen && (
        <SatzbauSchmiede token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={() => setSatzbauOpen(false)}
          onGoPricing={() => { setSatzbauOpen(false); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Pressure Ladder — overload training (native Aura-2 voice via the server TTS route, zero cost) */}
      {pressureOpen && (
        <PressureLadder lang={feedbackLang} onClose={() => setPressureOpen(false)} token={auth.token} apiUrl={API_URL} />
      )}

      {/* Alhassan mentor chat (persistent memory; cheap text model; never Realtime).
          onAction: the mentor's "do THIS next" becomes a tappable chip → jumps straight into the
          named surface (the brain→mentor→action loop closes instead of dying in the chat). */}
      {guideOpen && (
        <Alhassan token={auth.token} apiUrl={API_URL} lang={feedbackLang} onClose={() => setGuideOpen(false)}
          onAction={(id) => {
            setGuideOpen(false);
            const go = { interview: () => beginSession(), review: () => setSpokenReviewOpen(true),
              shadowing: () => setShadowingOpen(true), fluency: () => setFluencyOpen(true),
              listening: () => setListeningOpen(true), spokenreview: () => setSpokenReviewOpen(true),
              pressure: () => setPressureOpen(true), assessment: () => setAssessmentOpen(true) }[id];
            go?.();
          }} />
      )}

      {/* Video lessons — the $0 "video" engine: animated slides + native German narration */}
      {videoLessonsOpen && (
        <VideoLessons token={auth.token} apiUrl={API_URL} lang={feedbackLang} onClose={() => setVideoLessonsOpen(false)} />
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
            background:'linear-gradient(180deg, rgba(0,22,44,0.98), rgba(0,8,18,0.99))', border:'1px solid rgba(59,130,246,0.5)', boxShadow:'0 0 40px rgba(59,130,246,0.2)' }}>
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
          onTrainSkill={(drill) => ({ fluency: setFluencyOpen, shadowing: setShadowingOpen,
            pressure: setPressureOpen, trainingslager: setTrainingslagerOpen }[drill]?.(true))}
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
        {/* Connection status is only meaningful DURING a session. On the idle home it showed a scary
            "GETRENNT" (disconnected) as the first thing a new user sees — pure noise. Hide when idle. */}
        {(isActive || isConnecting) && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
          <div style={{ width:7, height:7, borderRadius:'50%',
            background: isActive ? 'var(--accent)' : 'var(--action)',
            boxShadow: isActive ? '0 0 6px var(--accent)' : 'none',
            animation: isActive ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize:10, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase' }}>
            {isActive ? 'VERBUNDEN' : 'VERBINDE…'}
          </span>
        </div>
        )}

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
            {/* STATUS STRIP (uplift): one calm 44px row — streak + daily habit entry. No card walls. */}
            <button onClick={() => setDailyOpen(true)} style={{ width:'100%', textAlign:'left', cursor:'pointer',
              display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'10px 14px', minHeight:44,
              borderRadius:'var(--r-pill)', background:'var(--surface)',
              border:`1px solid ${daily.completedToday ? 'rgba(59,130,246,0.35)' : streak > 0 ? 'rgba(249,115,22,0.4)' : 'var(--line)'}`,
              transition:'all var(--dur-slow)' }}>
              <span style={{ color: streak > 0 ? 'var(--action)' : 'var(--text-faint)', display:'flex' }}>
                <Icon name="flame" size={18} />
              </span>
              <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'baseline', gap:8 }}>
                <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'var(--fs-label)',
                  color: streak > 0 ? 'var(--action)' : 'var(--text-dim)' }}>
                  Serie: {streak} {streak === 1 ? 'Tag' : 'Tage'}
                </span>
                {daily.streakShield && (
                  <span title="Schutzschild aktiv — ein verpasster Tag wird vergeben" style={{ fontSize:12, lineHeight:1, cursor:'default' }}>🛡</span>
                )}
                <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {daily.completedToday ? '✓ Heute erledigt' : 'Tägliches Training · 3–5 Min'}
                </span>
              </div>
              <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'var(--fs-meta)', whiteSpace:'nowrap',
                padding:'6px 12px', borderRadius:'var(--r-pill)',
                color: daily.completedToday ? 'var(--accent-2)' : '#081019',
                background: daily.completedToday ? 'transparent' : 'var(--grad-action)',
                border: daily.completedToday ? '1px solid var(--accent-dim)' : 'none' }}>
                {daily.completedToday ? '✓' : 'START ▸'}
              </span>
            </button>
            {/* Loss-aversion (evidence-based retention): the pending LOSS, framed gently, drives return. */}
            {streak > 0 && !trainedToday && (
              <div style={{ marginTop:-4, marginBottom:10, padding:'6px 10px', borderRadius:8,
                background:'rgba(249,115,22,0.10)', border:'1px solid rgba(249,115,22,0.35)',
                fontSize:'var(--fs-meta)', color:'var(--action)', textAlign:'center', lineHeight:1.4 }}>
                Heute üben, sonst endet deine {streak}-Tage-Serie · درّب النهاردة عشان متخسرش سلسلتك
              </div>
            )}

            {/* HERO CARD "Dein Interview" (uplift) — the one place everything about starting lives:
                readiness, level, interviewer, options. The glass card + the orange button below read
                as ONE hero object; nothing else on the page competes. */}
            <div style={{ borderRadius:'var(--r-xl)', padding:'18px 16px 16px', background:'var(--glass)',
              border:'var(--glass-border)', boxShadow:'var(--e2), var(--glass-highlight)',
              backdropFilter:'blur(14px) saturate(1.1)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <div>
                  <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'var(--fs-h1)', color:'var(--text)', lineHeight:1.1 }}>
                    Dein Interview
                  </div>
                  <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4, display:'flex', alignItems:'center', gap:5 }}>
                    <Icon name="clock" size={12} /> Dein Interviewer wartet
                  </div>
                </div>
                {rank && <RankLadder rank={rank} />}
              </div>

              {/* Level — segmented control (was three shouting cards) */}
              <div style={{ display:'flex', gap:0, background:'rgba(255,255,255,0.05)', borderRadius:'var(--r-pill)', padding:3, marginBottom:8 }}>
                {[['a2-b1','A2–B1'],['b2','B2'],['c1','C1']].map(([id, lbl]) => {
                  const sel = level === id;
                  return (
                    <button key={id} onClick={() => chooseLevel(id)} disabled={!canStart}
                      style={{ flex:1, padding:'10px', minHeight:44, cursor: canStart ? 'pointer' : 'default',
                        borderRadius:'var(--r-pill)', border:'none', fontFamily:'var(--font-display)',
                        fontWeight:600, fontSize:'var(--fs-label)', transition:'all 200ms var(--ease)',
                        background: sel ? 'rgba(59,130,246,0.18)' : 'transparent',
                        color: sel ? 'var(--accent-2)' : 'var(--text-faint)',
                        boxShadow: sel ? 'inset 0 0 0 1px var(--accent-dim)' : 'none' }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <div style={{ textAlign:'center', fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginBottom:10, minHeight:15 }}>
                {{ 'a2-b1':'Langsamer · verzeiht Fehler', 'b2':'Natürliches Tempo · komplex', 'c1':'Schweizer Niveau · formell' }[level]}
              </div>

            {/* Interviewer picker — ALWAYS visible: choosing WHO you face is core to the app, not a hidden
                setting. (It was buried behind "Optionen" during the declutter → users only ever saw Yasmin.) */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap',
              padding:'10px 12px', minHeight:44, borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid var(--line)' }}>
              <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)' }}>Interviewer · اختر المُحاوِر</span>
              <select value={bossPick} onChange={(e) => chooseBoss(e.target.value)} disabled={!canStart}
                style={{ fontSize:'var(--fs-label)', padding:'8px 10px', minHeight:36, borderRadius:8, background:'rgba(2,6,16,0.7)',
                  color:'#e2e8f0', border:'1px solid var(--line-strong)', fontFamily:'inherit', cursor: canStart ? 'pointer' : 'default' }}>
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
            </div>{/* /hero card */}
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
      {/* (uplift) the idle "Bereit, wenn du es bist" line + decorative mic circle are gone —
          the hero card + the one orange button ARE the invitation now. */}
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
              <div className={userSpeak ? 'listening' : (isActive && !bossSpeak ? 'breathe' : '')} style={{ width:'100%', height:'100%' }}>
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
                      background: answerText.trim() ? 'linear-gradient(135deg,var(--accent-2),var(--accent))' : 'rgba(59,130,246,0.15)',
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

        {isConnecting && <WaveformRing volRef={volRef} active={isActive} bossSpeak={bossSpeak} />}

        <div style={{ margin:'6px 0 12px' }}>
          {(isActive || isConnecting) && (
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:'0.18em',
            fontSize: (isActive && !bossSpeak && !userSpeak) ? 24 : 13,
            color: bossSpeak ? boss.color : isActive ? 'var(--accent)' : 'var(--warn)',
            textShadow: (isActive && !bossSpeak) ? '0 0 16px rgba(59,130,246,0.6)' : bossSpeak ? `0 0 12px ${boss.color}` : 'none',
            transition:'all 0.3s' }}>
            {isActive ? (bossThinking ? 'CHEF DENKT NACH…' : bossSpeak ? `${funnel?.displayName ?? 'GEGNER'} SPRICHT` : 'DU BIST DRAN') : 'VERBINDE…'}
          </div>
          )}
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
          /* THE BUTTON (uplift): the single orange fill on the whole home — 56px, gradient, mic icon.
             It was a thin blue outline while a secondary button screamed orange; hierarchy now matches
             what the app IS: this is the arena door. */
          <button
            onClick={beginSession}
            disabled={isConnecting}
            style={{
              width:'100%', padding:'16px 20px', minHeight:56, cursor: isConnecting ? 'wait' : 'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:10,
              fontFamily:'var(--font-display)', fontSize:16, fontWeight:700, letterSpacing:'0.02em',
              borderRadius:16, border:'none', color:'#081019',
              background:'var(--grad-action)', boxShadow:'var(--shadow-action)',
              transition:'transform 100ms var(--ease)',
              opacity: isConnecting ? 0.55 : 1,
            }}>
            <Icon name="mic" size={19} /> {isConnecting ? 'Verbinde…' : 'Interview starten'}
          </button>
        ) : null}

        {/* Secondary home menu. On a phone it's a normal single-column stack; on a laptop it flows into
            2–3 columns (side-by-side, no endless scroll). See .home-grid in index.html. */}
        <div className="home-grid">

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
              'satzbau-schmiede': setSatzbauOpen,
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

        {/* (uplift) Trainingsnachweis + Diese Woche + Fortschritt now live in ONE quiet footer list
            card BELOW the Übungen grid — check-in-later items, no per-row color chrome. */}

        {/* Einstufung — DUPLICATE KILLED (uplift): this was the second, orange-screaming EINSTUFUNG
            button competing with the one inside the mission card. Now a quiet text link; the hero
            stays the only loud object on the page. */}
        {canStart && (
          <button onClick={() => setAssessmentOpen(true)} style={{ width:'100%', marginTop:10, padding:'10px', minHeight:44,
            cursor:'pointer', background:'none', border:'none', fontFamily:'var(--font-body)',
            fontSize:'var(--fs-label)', color:'var(--accent-2)', textAlign:'center' }}>
            Niveau noch unbekannt? <span style={{ textDecoration:'underline', textUnderlineOffset:3 }}>Einstufung machen (gratis)</span> · تقييم مستواك →
          </button>
        )}

        {/* Trainingslager study-map teaser (idle only) → opens the full game-map route */}
        {canStart && (
          <GameMapCompact token={auth.token} apiUrl={API_URL} lang={feedbackLang}
            onOpen={() => setTrainingslagerOpen(true)} />
        )}

        {/* ÜBUNGEN GRID (uplift): the 7-button drill wall becomes one titled card with icon tiles —
            2 columns, real SVG icons, every tile the same quiet weight (the #ef4444 red is gone;
            Druck-Leiter carries a neutral SCHWER badge instead). */}
        {canStart && (
          <div style={{ marginTop:14, borderRadius:'var(--r-lg)', padding:'14px', background:'var(--glass)',
            border:'var(--glass-border)', boxShadow:'var(--e1), var(--glass-highlight)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'var(--fs-h2)', color:'var(--text)', marginBottom:3 }}>
              Übungen
            </div>
            <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginBottom:11 }}>تمارين إضافية</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { icon:'waveform',     de:'Shadowing',      ar:'تمرين الترديد', open:() => setShadowingOpen(true) },
                { icon:'bolt',         de:'Flow-Drill',     ar:'سرعة الكلام',   open:() => setFluencyOpen(true) },
                { icon:'headphones',   de:'Hör-Check',      ar:'فهم السمع',     open:() => setListeningOpen(true) },
                { icon:'messageCheck', de:'Sag es richtig', ar:'قولها صح',      open:() => setSpokenReviewOpen(true) },
                { icon:'layers',       de:'Satzbau-Schmiede', ar:'',            open:() => setSatzbauOpen(true), badge:'NEU' },   /* OWNER-AR slot */
                { icon:'gauge',        de:'Druck-Leiter',   ar:'سُلّم الضغط',   open:() => setPressureOpen(true), badge:'SCHWER' },
                { icon:'play',         de:'Video-Lektionen', ar:'دروس فيديو',   open:() => setVideoLessonsOpen(true), badge:'NEU' },
                { icon:'compass',      de:'الحسن — dein Guide', ar:'اسأل دليلك', open:() => setGuideOpen(true) },
              ].map((t, i) => (
                <button key={i} onClick={t.open} style={{ minHeight:88, padding:'12px', cursor:'pointer', textAlign:'left',
                  borderRadius:14, background:'var(--surface)', border:'1px solid var(--line)', position:'relative',
                  display:'flex', flexDirection:'column', justifyContent:'space-between', gap:8,
                  transition:'background 150ms var(--ease), transform 150ms var(--ease)' }}>
                  {t.badge && (
                    <span style={{ position:'absolute', top:9, right:9, fontSize:9, fontWeight:600, letterSpacing:'0.06em',
                      color:'var(--text-dim)', border:'1px solid var(--line-strong)', borderRadius:'var(--r-pill)', padding:'2px 7px' }}>
                      {t.badge}
                    </span>
                  )}
                  <span style={{ color:'var(--accent)', display:'flex' }}><Icon name={t.icon} size={22} /></span>
                  <span>
                    <span style={{ display:'block', fontFamily:'var(--font-display)', fontWeight:600, fontSize:'var(--fs-label)', color:'var(--text)' }}>{t.de}</span>
                    <span style={{ display:'block', fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginTop:2 }}>{t.ar}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* FOOTER LIST (uplift): the check-in-later rows — one card, hairline dividers, no shouting. */}
        {canStart && (
          <div style={{ marginTop:10, borderRadius:'var(--r-lg)', background:'var(--surface)', border:'1px solid var(--line)', overflow:'hidden' }}>
            {[
              { icon:'chartUp',   de:'Fortschritt & Wiederholung', ar:'',                     open: openDashboard },
              { icon:'fileBadge', de:'Trainingsnachweis',           ar:'اطبع تقدمك كـPDF',     open: () => setNachweisOpen(true) },
              { icon:'trophy',    de:'Diese Woche',                 ar:'مين بيتدرب أكتر؟',     open: () => { setLeaderboardOpen(true); setLeaderboard(null); } },
            ].map((r, i) => (
              <button key={i} onClick={r.open} style={{ width:'100%', minHeight:48, padding:'12px 14px', cursor:'pointer',
                display:'flex', alignItems:'center', gap:11, textAlign:'left', background:'none', border:'none',
                borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                <span style={{ color:'var(--text-dim)', display:'flex' }}><Icon name={r.icon} size={17} /></span>
                <span style={{ flex:1, fontSize:'var(--fs-label)', color:'var(--text)', fontFamily:'var(--font-display)', fontWeight:500 }}>
                  {r.de} {r.ar && <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginRight:4 }}> · {r.ar}</span>}
                </span>
                <span style={{ color:'var(--text-faint)', display:'flex' }}><Icon name="chevronRight" size={15} /></span>
              </button>
            ))}
          </div>
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
        </div>{/* /home-grid */}

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
