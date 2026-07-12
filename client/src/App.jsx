import { useState, useEffect, useRef, useCallback, useReducer, Component } from 'react';
import { AudioRecorder, checkAudioSupport } from './audioRecorder.js';
import { ClipRecorder } from './clipRecorder.js';
import { GeminiVoicePlayer } from './geminiVoice.js';
import PlacementPrompt from './PlacementPrompt.jsx';
import DailyTraining from './DailyTraining.jsx';
import { HomeFeedback, FirstFightCard, AdminFeedback } from './Feedback.jsx';
import { PushReminder } from './PushReminder.jsx';
import { Assessment } from './Assessment.jsx';
import { Shadowing } from './Shadowing.jsx';
import { FluencyDrill } from './FluencyDrill.jsx';
import { Listening } from './Listening.jsx';
import { SpokenReview } from './SpokenReview.jsx';
import { SatzbauSchmiede } from './SatzbauSchmiede.jsx';
import { PressureLadder } from './PressureLadder.jsx';
import { BargeInMonitor } from './bargeInMonitor.js';
import { BrainGuide } from './BrainGuide.jsx';
import { SalmaTakeover, ASSESS_BOSS_MAP, ASSESS_LEVEL_MAP } from './SalmaTakeover.jsx';
import { salmaLine, salmaName, salmaRole } from './salmaCopy.js';
import { playNative } from './nativeVoice.js';
import { VideoLessons } from './VideoLessons.jsx';
import { API_URL, WS_URL, BUILD_ID, IS_PRODUCTION } from './config.js';

const SALMA_NATIVE_VOICE = 'aura-2-kara-de';

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
        {!IS_PRODUCTION && <div style={{ fontSize:11, color:'#94a3b8', maxWidth:340, wordBreak:'break-word' }}>
          {String(this.state.error?.message || this.state.error)}
        </div>}
        <div style={{ fontSize:12, color:'#94a3b8' }}>Bitte die Ansicht schließen oder die Seite neu laden. Konto und Zahlung wurden nicht verändert.</div>
        <button onClick={this.props.onClose} style={{ fontFamily:'var(--font-display)', fontSize:11,
          padding:'10px 18px', borderRadius:8, cursor:'pointer', border:'1px solid var(--accent)',
          color:'var(--accent)', background:'rgba(59,130,246,0.06)' }}>SCHLIESSEN</button>
      </div>
    );
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
// ── First-load instrumentation + pre-warm (module scope = earliest possible moment) ──────────
// Wake the free Render dyno the second ANYONE loads the page: it sleeps between keep-warm pings,
// and a cold START click meant up to 60s of "VERBINDE…" — pre-warming moves that wake into the
// seconds the visitor spends reading/signing up. Fire-and-forget, never blocks boot.
try { fetch(`${API_URL}/health`).catch(() => {}); } catch { /* never block boot */ }
// Facebook/Messenger/Instagram in-app browsers break getUserMedia (the mic) — and the 07-06
// cohort arrived from exactly those links (7 of 8 signups never reached interview #1). Detect
// once; the shell shows an escape banner and beginSession fails honestly instead of "mic blocked".
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|; wv\)/i.test(
  (typeof navigator !== 'undefined' && navigator.userAgent) || '');
// A getUserMedia failure means different things in different shells, so the message must match the
// real cause. In an in-app browser (Messenger/Facebook/Instagram/WebView) the mic can NEVER be
// granted — sending the user to "allow it in browser settings" (mic_denied) is a dead end. Some of
// these shells report the capture APIs as present (so checkAudioSupport passes and the session
// opens), then throw only when the mic is actually opened. Route those to the honest "open in
// Chrome/Safari" guidance. A real browser with no device → mic_not_found; anything else → a genuine
// permission block.
function micErrorCode(err) {
  if (IN_APP_BROWSER) return 'audio_unsupported';
  const name = (err && err.name) || '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'mic_not_found';
  return 'mic_denied';
}
// Channel tag: the owner posts per-group links with ?src=<slug> (e.g. ?src=fb-jobs1); the PWA
// start_url already carries ?src=pwa. Persisted for the visit so every funnel event reports
// which channel this visitor came from — a slug the owner chose, never PII.
let SRC = '';
try {
  const q = new URLSearchParams(window.location.search).get('src');
  if (q) sessionStorage.setItem('bpo_src', q);
  SRC = (sessionStorage.getItem('bpo_src') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
} catch { /* tagging is optional */ }
// PII-free funnel beacon (counts only — server/funnelBeacon.js). Telemetry must never throw.
const beacon = (e) => {
  try {
    const body = JSON.stringify(SRC ? { e, src: SRC } : { e });
    if (!navigator.sendBeacon?.(`${API_URL}/api/beacon`, new Blob([body], { type: 'application/json' })))
      fetch(`${API_URL}/api/beacon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* telemetry must never break the app */ }
};
beacon(IN_APP_BROWSER ? 'open_inapp' : 'open');
// ── PWA install capture ───────────────────────────────────────────────────────────────────
// beforeinstallprompt fires ONCE and often before React mounts, so the listener lives at module
// scope. Why installing matters beyond convenience: an INSTALLED app is exempt from iOS/Safari's
// 7-day script-storage eviction — install = the durable-login fix on iPhones (07-11 audit).
let _pwaPrompt = null;
const IS_STANDALONE = (() => {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
  catch { return false; }
})();
try {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _pwaPrompt = e; });
  window.addEventListener('appinstalled', () => { _pwaPrompt = null; });
} catch { /* exotic UA */ }
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
// The live-brain guide (GET /api/brain) is built + wired but stays OFF until the owner authors the
// masri in BrainGuide.jsx (no fake Arabic ships to users). Flip to true to activate it on the home screen.
const BRAIN_GUIDE_LIVE = true;
// Salma, the recruiter cold-open (SalmaTakeover.jsx): fires ONCE per account (server-side
// salmaIntroAt flag + localStorage mirror). Kill switch — flip false to disable instantly.
const SALMA_LIVE = true;
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
  realtime_error:       { de: 'Verbindungsproblem mit dem Interviewer. Bitte starte das Interview neu.', ar: 'في مشكلة في الاتصال بالمحاوِر. من فضلك ابدأ الإنترفيو من جديد.' },
  fight_start_failed:   { de: 'Das Interview konnte nicht gestartet werden. Bitte versuche es erneut.', ar: 'مقدرناش نبدأ الإنترفيو. من فضلك جرّب تاني.' },
  fight_already_active: { de: 'Es läuft bereits ein Interview.', ar: 'في إنترفيو شغّال بالفعل.' },
  auth_required:        { de: 'Bitte melde dich erneut an.', ar: 'من فضلك سجّل دخول تاني.' },
  email_verification_required: { de: 'Bestätige zuerst deine E-Mail-Adresse.', ar: 'أكد إيميلك الأول.' },
  mic_denied:           { de: 'Mikrofon ist blockiert. Erlaube es in den Website-/App-Berechtigungen und versuche es erneut.', ar: 'المايك مقفول. اسمح بيه من صلاحيات الموقع أو التطبيق وجرب تاني.' },
  mic_not_found:        { de: 'Kein Mikrofon gefunden. Schließe ein Mikrofon an oder erlaube es und starte neu.', ar: 'مفيش مايك متوصّل. وصّل مايك أو اسمح بيه وابدأ من جديد.' },
  mic_lost:             { de: 'Verbindung zum Mikrofon verloren. Du kannst per Text fortfahren oder neu starten.', ar: 'الاتصال بالمايك اتقطع. تقدر تكمل بالكتابة أو تبدأ من جديد.' },
  plan_required:        { de: 'Dein Trainingsplan ist fertig — wähle einen Plan, um ihn freizuschalten.', ar: 'خطتك جاهزة — اختار خطة عشان تفتحها.' },
  daily_limit:          { de: 'Dein heutiges Training ist erledigt. Morgen wartet das nächste — heute: Drills & Lektionen.', ar: 'تمرين النهارده خلص. بكرة في جولة جديدة — النهارده: تمارين ودروس.' },
  ws_connect_failed:    { de: 'Keine Verbindung zum Server. Prüfe dein Internet und starte neu.', ar: 'مفيش اتصال بالسيرفر. اتأكد من النت وابدأ من جديد.' },
  connection_lost:      { de: 'Verbindung unterbrochen. Bitte starte das Interview neu.', ar: 'الاتصال اتقطع. من فضلك ابدأ الإنترفيو من جديد.' },
  // Honest wall for in-app/legacy browsers that CANNOT do mic capture — before this, they got
  // the misleading "mic blocked, allow it in settings" text for a mic that was never blocked.
  audio_unsupported:    { de: 'Dieser Browser unterstützt kein Mikrofon (z. B. der Facebook/Messenger-Browser). Öffne die Seite in Chrome oder Safari — dann funktioniert alles.', ar: '' /* OWNER-AR slot */ },
};
function wsErrorText(code, lang) {
  const e = WS_ERROR_TEXT[code];
  if (!e) return null;               // not a known code → caller shows the raw message
  return lang === 'ar' ? (e.ar || e.de) : e.de;   // an unfilled OWNER-AR slot falls back to German
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
    invalid_number:      { de: 'Bitte gib eine gültige WhatsApp-Nummer ein.', ar: 'من فضلك دخّل رقم واتساب صحيح.' },
    weak_password:       { de: 'Passwort muss mindestens 10 Zeichen haben.', ar: 'الباسورد لازم ١٠ حروف على الأقل.' },
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
  REQUEST_TEXT_MODE: 'request_text_mode',
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
// ── ADAPTIVE per-user turn-taking (owner 2026-07-05: "let the tech decide the ms per person — don't
// make me the standard, everyone is a different human"). A fixed silence window fits one speaker and
// cuts off the next. Instead we LEARN: every pause the user RESUMES from was a think-pause, not an
// ending — so we sample those durations and set the cutoff just above the user's high percentile.
// Calibrates from the first turns, persists per-device so next session starts pre-tuned, and
// classifyTurnDE still scales it (a finished-sounding sentence needs less margin than a trailing one). ──
const _PAUSE_KEY = 'ff_pauseProfile_v1';
let _pauseSamples = [];
try { const v = JSON.parse(localStorage.getItem(_PAUSE_KEY) || 'null'); if (Array.isArray(v?.samples)) _pauseSamples = v.samples.slice(-40); } catch { /* first run */ }
function recordThinkPause(ms) {                        // a pause the user resumed from → learn it
  if (!(ms >= 250 && ms <= 4000)) return;             // ignore micro-gaps + implausibly-long (between-turn) gaps
  _pauseSamples.push(Math.round(ms)); if (_pauseSamples.length > 40) _pauseSamples.shift();
  try { localStorage.setItem(_PAUSE_KEY, JSON.stringify({ samples: _pauseSamples })); } catch { /* storage full */ }
}
function userPauseCeiling() {                          // p85 of THIS user's think-pauses; sane default until enough data
  const s = _pauseSamples.filter((x) => x >= 200 && x <= 4000).sort((a, b) => a - b);
  if (s.length < 4) return 1000;                       // cold start (07-09 latency fix: was 1400) — still patient for L2
  const p85 = s[Math.min(s.length - 1, Math.floor(s.length * 0.85))];
  return Math.max(550, Math.min(1600, p85));           // 07-09 latency fix: ceiling 2600→1600, floor 800→550
}
function adaptiveNeedSilence(cls, words, patienceMs = 0, stageIdx = 0) {   // the per-user wait, scaled by how finished the sentence sounds
  // PATIENCE DOCTRINE (owner 07-05 + 07-09 "it doesn't even allow 5 sentences — it interrupts and probes
  // aggressively; make it ASCEND from Yasmin up"): the audience are Arabic-L1 German learners who pause
  // mid-answer AND between the sentences of a multi-sentence answer (a self-introduction is 4–6 sentences
  // with 1s+ thinking gaps). Being cut off mid-build is the #1 unnaturalness; an extra second of silence is
  // not — the instant thinking-filler masks it anyway. A single completed sentence is usually just the FIRST
  // of several, so even "complete" gets generous room.
  const ceil = userPauseCeiling();
  // 07-09 LATENCY FIX: lead time felt "unhuman" (up to ~4.2s of silence before a turn committed).
  // Finished-sounding sentences now hand over FAST; only clearly-trailing turns keep generous margin.
  let ms = cls === 'complete'   ? Math.round(ceil * 0.6)          // finished sentence → hand over quickly (was 0.9)
         : cls === 'incomplete' ? Math.round(ceil * 1.1) + 250    // trailing cue → still patient, but less (was 1.4+350)
         :                        Math.round(ceil * 0.85) + 150;  // default (was 1.1+250)
  if (words > 0 && words < 6) ms += 250;              // early short answer → small cushion (was 400)
  // ASCENDING DIFFICULTY at the turn-taking layer (owner 07-09): a gentle interviewer (Yasmin) hands over
  // the floor much later than a forceful one (Tarek). This is what makes the LEVEL felt in the pacing —
  // previously bossPatienceRef was computed but never applied, so every persona cut you off identically.
  ms += Math.max(0, Math.round(patienceMs || 0));
  // Self-introduction (Teil 1 / stage 0) is inherently multi-sentence — give the MOST room so the boss never
  // cuts a "Ich heiße… Ich komme aus… Ich habe … Jahre Erfahrung…" build after the first sentence.
  if (stageIdx === 0) ms += 300;                      // 07-09: self-intro cushion halved (was 600)
  return Math.max(600, Math.min(2400, ms));           // 07-09 latency fix: worst case 4200→2400ms
}

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
  return 'ambiguous';                                          // no completion signal → use the user's OWN pause window (adaptive), not the max
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

// ── THE reused, gesture-unlocked boss audio element (iOS-bulletproof, "TalkPal-style") ──
// iOS Safari reliably plays audio ONLY through an element that was unlocked inside a real user
// gesture. Minting `new Audio(url)` per boss line meant each new element was un-unlocked, so iOS
// blocked it ~half the time → "sometimes it speaks, sometimes it doesn't." The cure every polished
// web voice app uses: ONE element, unlocked once in the start tap, and EVERY boss line replays
// through that same element (just swap .src). _bossWd centralizes the stall watchdog so a new line
// or a stop always kills the previous watcher (no leaked intervals when we reuse one element).
let _bossEl = null;
let _bossWd = null;
// Level-based boss PACE: measured Aura-2 output is ~175 WpM (native-fast German) while comfortable
// A2-B1 listening is ~100-130 — the level picker promised "Langsamer" but only the WORDS were
// simpler, never the audio. A2-B1 fights now play at 0.9× (≈157 WpM). Browsers preserve pitch by
// default at these rates (no chipmunk/robot effect), and the owner's robotic floor is 0.8× —
// 0.9 stays well above it. Loading new media resets playbackRate, so apply AFTER setting .src.
let _bossPlaybackRate = 1.0;
function setBossPlaybackRate(r) { _bossPlaybackRate = r; }
function _applyBossRate(el) { try { el.defaultPlaybackRate = _bossPlaybackRate; el.playbackRate = _bossPlaybackRate; } catch { /* older engines: native pace */ } }
function _dbgA(tag, extra) { try { console.log('[DIAG-AUDIO] ' + tag + (extra != null ? ' ' + extra : '')); } catch {} }
function getBossEl() {
  if (!_bossEl && typeof Audio !== 'undefined') { _bossEl = new Audio(); _bossEl.preload = 'auto'; }
  return _bossEl;
}
function _clearBossWd() { if (_bossWd) { clearInterval(_bossWd); _bossWd = null; } }
function stopBossVoice() {
  _dbgA('■ stopBossVoice  seq→' + (_streamSeq + 1));
  _streamSeq++;        // cancel any sentence-stream in progress
  _earlyBoss = null;   // an in-flight early first sentence is superseded too (seq guard makes stale callbacks inert)
  _clearBossWd();      // kill the previous line's stall watchdog before the element is reused
  // Null handlers BEFORE clearing src. Clearing src causes the browser to fire onerror/onemptied
  // on the element; if handlers are still attached they call onEnd() → setBossSpeak(false) on
  // the OLD audio, which races with a newly-started audio and clears bossSpeak prematurely.
  try {
    if (_bossAudio) {
      const a = _bossAudio;
      _bossAudio = null;
      a.onplay = null; a.onended = null; a.onerror = null; a.onstalled = null; a.onwaiting = null;
      // Pause + rewind, but DO NOT drop the reference (_bossEl stays alive & unlocked for the next
      // line). Clearing .src on some iOS builds re-locks the element, so we only rewind it.
      try { a.pause(); a.currentTime = 0; } catch {}
    }
  } catch {}
  stopFiller();   // a real boss line is starting (or we're tearing down) → kill any thinking-sound bridge
}

// ── Mobile audio unlock (fixes "captions show, no voice" + "no reply after I speak" on phones) ──
// Mobile browsers (iOS Safari most strictly) reject any .play() that isn't started INSIDE a real
// user gesture, and the code silently swallows the rejection — so the boss's TTS, which plays
// asynchronously ~1s AFTER the start tap (once the WS reply lands), was being blocked every turn:
// text appeared, no sound. The user's ear can't tell "boss didn't reply" from "boss replied but
// silent," so this reads as BOTH bugs. Fix: the instant the user taps "Interview starten", play a
// silent clip AND resume a Web-Audio context — both inside the gesture. That satisfies the gesture
// requirement so every later boss `new Audio().play()` is allowed. Idempotent; safe to call on every start.
let _sharedAC = null;      // reused so the Gemini-audio path + priming share one unlocked context
let _sharedMicAC = null;   // ONE 24kHz mic-CAPTURE context, unlocked in the start tap & reused every
                           // turn — a per-turn context created outside a gesture stays suspended on
                           // mobile, so the mic "doesn't hear me until I tap." Unlock once → auto-listen.
function getSharedMicAC() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_sharedMicAC || _sharedMicAC.state === 'closed') _sharedMicAC = new AC({ sampleRate: 24000 });
    if (_sharedMicAC.state === 'suspended') _sharedMicAC.resume().catch(() => {});
    return _sharedMicAC;
  } catch { return null; }
}
function unlockAudioPlayback() {
  try {
    // 1) Unlock THE ONE reused boss element by playing a silent clip through it, inside the gesture.
    //    Every later boss line replays through this same (now-unlocked) element — the iOS fix.
    const el = getBossEl();
    if (el) {
      el.muted = true;
      el.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA';
      const p = el.play();
      if (p && typeof p.then === 'function') p.then(() => { try { el.pause(); el.currentTime = 0; el.muted = false; } catch {} }).catch(() => { try { el.muted = false; } catch {} });
    }
  } catch {}
  try {
    // 2) Unlock/resume a shared Web-Audio context (Gemini native-audio path + general priming).
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!_sharedAC || _sharedAC.state === 'closed') _sharedAC = new AC();
      if (_sharedAC.state === 'suspended') _sharedAC.resume().catch(() => {});
    }
  } catch {}
  // 3) Unlock the mic-CAPTURE context in the SAME gesture so every later hands-free turn can
  //    auto-listen without a tap (the "it doesn't hear me until I click" fix).
  getSharedMicAC();
  _dbgA('unlockAudioPlayback', 'micAC=' + (_sharedMicAC && _sharedMicAC.state) + ' playAC=' + (_sharedAC && _sharedAC.state));
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
  void elevenVoice;
  const urls = [];
  for (const ph of phrases) {
    try {
      urls.push(await fetchTtsUrl(apiUrl, token, voice, ph));
    } catch {}
  }
  return urls;
}

// Fetch ONE clip's audio (POST → normalized WAV blob) and return an object URL. Throws on failure.
// [LAT] real client timing → POSTed to the server so /api/diag/latency shows the FULL split
// (vad wait + tts) with the client build id (catches stale cache as "zero improvement").
let _latTtsStart = 0, _latAudioEndAt = 0, _latVadWait = 0;
function reportClientLat(apiUrl, token) {
  try {
    const now = Date.now();
    const ttsMs = _latTtsStart ? now - _latTtsStart : 0;
    const fullMs = _latAudioEndAt ? _latVadWait + (now - _latAudioEndAt) : 0;
    const build = (typeof document !== 'undefined' && document.querySelector('meta[name=build]')?.content) || 'dev';
    fetch(`${apiUrl}/api/diag/clientlat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ vadWaitMs: _latVadWait, ttsMs, fullMs, build }) }).catch(() => {});
    _latTtsStart = 0;
  } catch {}
}

async function fetchTtsUrl(apiUrl, token, voice, text) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 12000);
  try {
    const ticketRes = await fetch(`${apiUrl}/api/media-ticket`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ kind: 'aura', text, voice }),
      signal:  ctrl.signal,
    });
    if (!ticketRes.ok) throw new Error('media ticket ' + ticketRes.status);
    const ticket = await ticketRes.json();
    if (!ticket?.ticket) throw new Error('missing media ticket');
    const res = await fetch(`${apiUrl}/api/tts-stream?ticket=${encodeURIComponent(ticket.ticket)}`, { signal: ctrl.signal });
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
  const done = () => { if (ended) return; ended = true; _dbgA('⏹ end(clip)'); try { onEnd?.(); } catch {} };
  try {
    const audio = getBossEl();
    if (!audio) { done(); return; }
    _dbgA('▶ play(clip)', 'seq=' + _streamSeq);
    _clearBossWd();                                             // kill any prior watcher on this shared element
    audio.onplay = audio.onended = audio.onerror = audio.onstalled = audio.onwaiting = null;
    try { audio.pause(); } catch {}
    audio.muted = false; audio.volume = 1.0;                    // undo the muted state left by the gesture-unlock prime
    audio.src = url;
    _applyBossRate(audio);                                      // level-based pace (set AFTER src — loading resets playbackRate)
    _bossAudio = audio;
    const cleanup = () => { _clearBossWd(); try { URL.revokeObjectURL(url); } catch {} if (_bossAudio === audio) _bossAudio = null; };
    audio.onplay = () => {
      try { onStart?.(); } catch {}
      let last = -1, stuck = 0;
      _bossWd = setInterval(() => {
        if (ended) { _clearBossWd(); return; }
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
    const audio = getBossEl();
    if (!audio) { onEnd?.(); resolve(false); return; }
    _dbgA('▶ play(stream)', 'seq=' + _streamSeq + ' …' + String(url).slice(-24));
    _clearBossWd();                                            // kill any prior watcher on this shared element
    audio.onplay = audio.onended = audio.onerror = audio.onstalled = audio.onwaiting = null;
    try { audio.pause(); } catch {}
    audio.muted = false; audio.volume = 1.0;                   // undo the muted state left by the gesture-unlock prime
    audio.src = url;
    _applyBossRate(audio);                                     // level-based pace (set AFTER src — loading resets playbackRate)
    _bossAudio = audio;
    let started = false, resolved = false, stallInterval = null;
    const finish = (fallback) => {
      if (resolved) return;
      resolved = true;
      _dbgA('⏹ end(stream)', 'started=' + started + ' fellBack=' + fallback);
      if (stallInterval) { const si = stallInterval; clearInterval(si); stallInterval = null; if (_bossWd === si) _bossWd = null; }
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
      const endNow = () => { if (_bossAudio === audio) _bossAudio = null; try { onEnd?.(); } catch {} finish(false); };
      stallInterval = setInterval(() => {
        if (resolved) { const si = stallInterval; clearInterval(si); stallInterval = null; if (_bossWd === si) _bossWd = null; return; }
        const ct = audio.currentTime, dur = audio.duration;
        // GENUINE end → finish immediately (even if the browser never fired 'ended', common for
        // chunked/streamed MP3). This is the ONLY thing that should clear "boss speaking": if we
        // guessed "done" early (a slow-network buffer freeze), bossSpeak cleared while he was still
        // faintly playing → the mic opened → his voice echoed in → false turn → 15s "denkt nach".
        if (audio.ended || (isFinite(dur) && dur > 0 && ct >= dur - 0.35)) { endNow(); return; }
        if (ct === lastTime) {
          stuckCount++;
          // Frozen but NOT at the end = buffering on a slow connection, NOT finished. Be patient so
          // we never cut the interviewer off or open the mic mid-sentence; only give up after a long
          // freeze (the 40s guard is the final backstop).
          if (stuckCount >= 8) endNow();   // 8 × 1.5s = 12s truly frozen mid-file → dead stream
        } else { stuckCount = 0; lastTime = ct; }
      }, 1500);
      _bossWd = stallInterval;   // register so stopBossVoice()/a new line clears this watcher on the shared element
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
async function bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text, drill = false }) {
  const kind = elevenVoice ? 'eleven' : 'aura';
  const r = await fetch(`${apiUrl}/api/media-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, voice: elevenVoice || voice, emotion, text, drill }),
  });
  if (!r.ok) throw new Error(`media ticket ${r.status}`);
  const data = await r.json();
  if (!data?.ticket) throw new Error('missing media ticket');
  return `${apiUrl}/api/${kind === 'eleven' ? 'voice' : 'tts-stream'}?ticket=${encodeURIComponent(data.ticket)}`;
}

async function playBossVoice({ apiUrl, token, voice, elevenVoice, text, emotion, onStart, onEnd }) {
  if (!text) { onEnd?.(); return; }
  stopBossVoice();
  // PRIMARY: a STREAMING GET <audio> source — sound starts ~350ms in, killing the ~6s dead air the
  // buffered (whole-clip) path had. ElevenLabs if opted in (paid), else the free Deepgram Aura-2 stream.
  let streamUrl;
  try { streamUrl = await bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text }); }
  catch { return speakBossStreamed({ apiUrl, token, voice, text, onStart, onEnd }); }
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
  const st = { text, seq, clipDone: false, failed: false, streamStarted: false,
    pendingRest: null, onLineEnd: null, onFailure: null };
  _earlyBoss = st;
  bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text })
    .then((url) => {
      // The full LLM line can arrive before the media ticket. If it already took ownership,
      // never start this late clip on top of the full-line playback.
      if (seq !== _streamSeq || _earlyBoss !== st) return false;
      st.streamStarted = true;
      return playProgressiveAudio(url, onStart, () => {
      st.clipDone = true;
      if (seq !== _streamSeq) return;
      if (st.pendingRest)     { const go = st.pendingRest;  st.pendingRest = null; _earlyBoss = null; go(); }
      else if (st.onLineEnd)  { const end = st.onLineEnd;   st.onLineEnd = null;   _earlyBoss = null; try { end(); } catch {} }
      });
    })
    .then((fellBack) => {
      if (!fellBack) return;
      st.failed = true;
      if (seq === _streamSeq && st.onFailure) {
        const fallback = st.onFailure;
        st.onFailure = null;
        _earlyBoss = null;
        fallback();
      }
    })
    .catch(() => {
      st.failed = true;
      if (seq === _streamSeq && st.onFailure) {
        const fallback = st.onFailure;
        st.onFailure = null;
        _earlyBoss = null;
        fallback();
      }
    });
}
// Called by BOSS_SPEECH_DONE with the full sanitized line. Returns true if the early clip took
// ownership (the caller must NOT start its own playback), false to play the whole line normally.
function continueBossLineEarly({ full, apiUrl, token, voice, elevenVoice, emotion, onEnd }) {
  const st = _earlyBoss;
  if (!st) return false;
  if (st.seq !== _streamSeq || st.failed || !st.streamStarted || !String(full || '').startsWith(st.text)) {
    _earlyBoss = null;                               // stale / failed / guard replaced the line → full restart
    return false;
  }
  st.onFailure = () => playBossVoice({ apiUrl, token, voice, elevenVoice, emotion, text:full, onEnd });
  const rest = String(full).slice(st.text.length).trim();
  const playRest = async () => {
    // NO stopBossVoice here — that would bump _streamSeq and orphan this line's cancellation contract.
    let url;
    try { url = await bossStreamUrl({ apiUrl, token, voice, elevenVoice, emotion, text: rest }); }
    catch { return speakBossStreamed({ apiUrl, token, voice, text: rest, onStart: () => {}, onEnd }); }
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
  html, body {
    min-height: 100svh;            /* grow with content — do NOT lock to 100% (clips the start button) */
    background: var(--bg-0);       /* deep navy base ONLY; the aurora (body::before) paints on top of this */
    color: var(--text);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    overflow-y: auto;
  }
  /* ARENA SPOTLIGHTS (07-11 v4) — two hard-edged diagonal light beams sweeping the ring like
     stage rigs over a fight arena. Crisp stops (not soft radials — those read flat on phones),
     visible motion within ~2s, transform-only (GPU), brand blue+orange, frozen under reduce-motion. */
  body::before {                       /* BLUE beam pair — main sweep, left→right */
    content:'';
    position: fixed;
    inset: -35%;                       /* oversized so the moving beams never show canvas edges */
    z-index: 0;
    pointer-events: none;
    background:
      linear-gradient(115deg,
        transparent 30%,
        rgba(59,130,246,0.06) 30.2%,
        rgba(96,165,250,0.30) 34%,
        rgba(147,197,253,0.42) 36%,
        rgba(96,165,250,0.30) 38%,
        rgba(59,130,246,0.06) 41.8%,
        transparent 42%),
      linear-gradient(115deg,
        transparent 55%,
        rgba(59,130,246,0.20) 55.3%,
        rgba(59,130,246,0.20) 58%,
        transparent 58.3%);
    animation: beam-sweep 11s ease-in-out infinite alternate;
    will-change: transform;
  }
  body::after {                        /* ORANGE counter-beam + static arena-floor glow */
    content:'';
    position: fixed;
    inset: -35%;
    z-index: 0;
    pointer-events: none;
    background:
      linear-gradient(-70deg,
        transparent 40%,
        rgba(249,115,22,0.05) 40.2%,
        rgba(251,146,60,0.22) 44%,
        rgba(253,186,116,0.30) 45.5%,
        rgba(251,146,60,0.22) 47%,
        rgba(249,115,22,0.05) 50.8%,
        transparent 51%),
      linear-gradient(to top,
        rgba(249,115,22,0.16) 0%,
        rgba(249,115,22,0.05) 7%,
        transparent 16%);
    animation: beam-counter 17s ease-in-out infinite alternate;
    will-change: transform;
  }
  #root { position: relative; z-index: 1; min-height: 100svh; background: transparent; }  /* transparent so the beams behind it are visible */
  @keyframes beam-sweep {              /* translate only — compositor-cheap on Android */
    0%   { transform: translate3d(-16%, 0, 0); }
    100% { transform: translate3d(16%, 0, 0); }
  }
  @keyframes beam-counter {
    0%   { transform: translate3d(12%, 0, 0); }
    100% { transform: translate3d(-12%, 0, 0); }
  }
  /* Edutainment (07-11): flying damage numbers — punch in, hang, drift up and fade. */
  @keyframes dmg-pop {
    0%   { opacity: 0; transform: translateX(-50%) translateY(14px) scale(0.5); }
    12%  { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1.18); }
    24%  { transform: translateX(-50%) translateY(0) scale(1); }
    70%  { opacity: 1; }
    100% { opacity: 0; transform: translateX(-50%) translateY(-34px) scale(0.92); }
  }
  @keyframes combo-pop {
    0%   { opacity: 0; transform: translateX(-50%) scale(0.6); }
    18%  { opacity: 1; transform: translateX(-50%) scale(1.1); }
    30%  { transform: translateX(-50%) scale(1); }
    75%  { opacity: 1; }
    100% { opacity: 0; transform: translateX(-50%) scale(1); }
  }
  /* Bewerbungs-Dossier print rules: paper prints ONLY the sheet — app chrome, beams, and the
     on-screen buttons all vanish. */
  @media print {
    body { background: #fff !important; }
    body::before, body::after { display: none !important; }
    #root * { visibility: hidden; }
    /* !important: #root * (id selector) otherwise outweighs these class rules. */
    .dossier-sheet, .dossier-sheet * { visibility: visible !important; }
    .dossier-sheet { position: fixed !important; inset: 0 !important; max-width: none !important;
      max-height: none !important; overflow: visible !important; border-radius: 0 !important;
      box-shadow: none !important; }
    .dossier-hidep { display: none !important; }
  }
  /* CRT scanline overlay REMOVED (07-02 uplift) — premium surfaces are clean; the gamer-HUD
     texture read as a toy. (the old scanline body::before is gone; this one is the aurora.) */
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
    .landing-grid { display:grid; grid-template-columns: 1.1fr 0.9fr; gap:48px; align-items:start; }
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
function BossAvatar({ emotion = 'composed', speaking = false, color = 'var(--accent-2)', name = '' }) {
  // Premium initials ring (aesthetic pass 2026-07-10, owner-approved): the hand-drawn cartoon face
  // read as a MALE with a tie under "YASMIN" (female voice) — hearing a woman while seeing a man
  // broke exactly the illusion the naturalness work builds, and clip-art clashed with the glass
  // system everywhere else. The ring matches the landing's own mockup ("Y · HR"). Emotion still
  // reaches the screen: the ring carries the live emotion color and its glow strength; only the
  // SPEAKING halo animates (one meaningful loop — never an idle pulse).
  const glow = ({ composed: 0.45, skeptical: 0.5, smug: 0.5, impressed: 0.7, furious: 0.9, shaken: 0.7 })[emotion] ?? 0.45;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center' }}>
      <div style={{ position:'relative', width:'min(62%, 190px)', aspectRatio:'1', display:'grid', placeItems:'center' }}>
        {speaking && (
          <div style={{ position:'absolute', inset:-14, borderRadius:'50%',
            border:`2px solid ${color}`, opacity:0.5, animation:'pulse 1.1s ease-in-out infinite' }} />
        )}
        <div style={{ position:'absolute', inset:0, borderRadius:'50%',
          border:`2.5px solid ${color}`,
          boxShadow:`0 0 ${Math.round(28 * glow + 12)}px ${color}${speaking ? 'aa' : '55'}, inset 0 0 22px ${color}22`,
          transition:'box-shadow 0.6s var(--ease), border-color 0.6s' }} />
        <div style={{ position:'absolute', inset:10, borderRadius:'50%',
          background:'radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,0.09), rgba(6,10,18,0.92) 60%)',
          border:'1px solid rgba(255,255,255,0.08)', display:'grid', placeItems:'center' }}>
          {/* Elite pass: weight 800 + white glow read as a placeholder shouting. A lighter, smaller
              glyph with air around it reads as a deliberate monogram (fashion-house rule: negative
              space is the luxury). */}
          <span style={{ fontFamily:'var(--font-display)', fontWeight:500, fontSize:'clamp(34px, 12vw, 54px)',
            color:'rgba(255,255,255,0.92)', lineHeight:1, transform:'translateY(-4px)', letterSpacing:'0.02em' }}>{initial}</span>
        </div>
        <div style={{ position:'absolute', bottom:'15%', fontFamily:'var(--font-display)', fontWeight:600,
          fontSize:10, letterSpacing:'0.22em', color, opacity:0.85 }}>HR</div>
      </div>
    </div>
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
  // Aesthetic pass 2026-07-10: the boss bar opened every fight as a full-width RED wall (red
  // reserved for true errors; a job-interview screen shouldn't look like a raid). Boss now reads
  // blue (composed) → orange (you're breaking through) — progress feels warm, not alarming.
  // Player keeps red ONLY at critical (<25) — that IS a genuine warning.
  const solid = isPlayer
    ? (pct > 50 ? 'var(--accent)' : pct > 25 ? 'var(--action)' : '#ef4444')
    : (pct > 50 ? '#3b82f6' : pct > 25 ? '#f97316' : '#fb923c');
  const rColor = isPlayer ? '#f87171' : 'var(--accent)';   // player loss = red, gain = green
  const rSign  = isPlayer ? '−' : '+';

  return (
    <div style={{ marginBottom: 'var(--sp-2)', position:'relative' }}>
      {reason && (
        <div key={reason.id} style={{ position:'absolute', right:0, top:-15, zIndex:6, pointerEvents:'none',
          fontFamily:'var(--font-display)', fontSize:11, fontWeight:700, color:rColor,
          whiteSpace:'nowrap', animation:'hp-reason 2s var(--ease-out) forwards' }}>
          {rSign}{reason.amount} {reason.label}
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
        <span style={{ fontFamily:'var(--font-display)', fontSize:10, fontWeight:600, letterSpacing:'0.18em',
          color:'var(--text-dim)' }}>
          {label}
        </span>
        <span style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, color:solid,
          fontVariantNumeric:'tabular-nums', transition:'color 0.4s' }}>
          {shown}<span style={{ opacity:0.4, fontSize:10, color:'#94a3b8' }}> / 100</span>
        </span>
      </div>
      {/* Elite pass (owner: "doesn't feel elite"): the 15px candy gauge — segment ticks, moving
          sheen, glowing colored labels — was the screen's loudest video-game tell. Same mechanic,
          instrument voice: a 5px hairline meter, flat fill, quiet dim label. Color still carries
          the state (blue → orange → red), the low-pulse warning stays (genuine alarm). */}
      <div className={low ? 'hp-low-pulse' : ''} style={{ height:5, borderRadius:99,
        background:'rgba(255,255,255,0.07)', overflow:'hidden', position:'relative',
        border:'1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ position:'absolute', inset:0, width:`${pct}%`, borderRadius:'inherit',
          background:solid,
          transition:'width 0.55s var(--ease-spring), background 0.4s var(--ease)' }} />
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
        color:'var(--text-dim)', marginBottom:3 }}>SERIE</div>
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
            {line.speaker === 'boss' ? (bossName || 'INTERVIEWER') : 'DU'}
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
        {win ? 'TRAININGSZIEL ERREICHT' : 'WEITER TRAINIEREN'}
      </div>
      <div style={{ fontSize:12, color:'#94a3b8', marginBottom:28, textAlign:'center', lineHeight:1.6 }}>
        {win ? 'Du hast das Ziel dieser Simulation erreicht.' : 'Die Auswertung zeigt dir den nächsten Trainingsschritt.'}
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
// Elite-prompt pass 2026-07-10: instrument, never arcade. Blue/neutral only (the home's one
// orange belongs to the CTA), no glow/pulse/emoji, type floor 11px, header collision-proofed
// (label + rank used to touch at 390px). Semantics unchanged — same tiers, same numbers.
function RankLadder({ rank }) {
  if (!rank?.ranks?.length) return null;
  const tier = rank.tier ?? 0;
  return (
    <div style={{ padding:'10px 12px', borderRadius:'var(--r-md)', background:'rgba(0,0,0,0.3)', border:'1px solid var(--line)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', marginBottom:9 }}>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:'var(--fs-meta)', letterSpacing:'0.1em', color:'var(--text-dim)' }}>INTERVIEW-BEREITSCHAFT</span>
        <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, color:'var(--text)' }}>{rank.label}</span>
      </div>
      <div style={{ display:'flex', alignItems:'center' }}>
        {rank.ranks.map((r, i) => (
          <div key={r} style={{ display:'flex', alignItems:'center', flex: i < rank.ranks.length - 1 ? 1 : '0 0 auto' }}>
            <div title={r} style={{ width:9, height:9, borderRadius:'50%', flexShrink:0, boxSizing:'border-box',
              background: i < tier ? 'var(--accent-dim)' : i === tier ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
              border: i === tier ? '1.5px solid var(--accent-2)' : '1px solid rgba(255,255,255,0.10)' }} />
            {i < rank.ranks.length - 1 && (
              <div style={{ flex:1, height:1, margin:'0 4px',
                background: i < tier ? 'var(--accent-dim)' : 'rgba(255,255,255,0.08)' }} />
            )}
          </div>
        ))}
      </div>
      {rank.nextLabel ? (
        <div style={{ marginTop:9 }}>
          <div style={{ height:3, borderRadius:'var(--r-pill)', overflow:'hidden', background:'rgba(255,255,255,0.07)' }}>
            <div style={{ height:'100%', width:`${rank.toNextPct}%`, borderRadius:'inherit',
              background:'var(--accent)', transition:'width 0.7s var(--ease-out)' }} />
          </div>
          <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginTop:5 }}>
            {rank.nextBy === 'sessions'
              ? <>Score erreicht — noch <b style={{ color:'#cbd5e1' }}>{rank.sessionsToNext}</b> {rank.sessionsToNext === 1 ? 'Sitzung' : 'Sitzungen'} bis <b style={{ color:'#cbd5e1' }}>{rank.nextLabel}</b></>
              : <>{rank.toNextPct}% bis <b style={{ color:'#cbd5e1' }}>{rank.nextLabel}</b></>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:9, fontWeight:600 }}>Höchster Rang erreicht — interview-bereit.</div>
      )}
    </div>
  );
}

// ── Component: Debrief (end-of-session feedback) ──────────────────────────────
// lang: 'de' | 'ar' — toggles the EXPLANATION prose only. German targets/phrases/
// corrections always stay German. All values are backend-supplied (display-only).
// The one-tap interview→drill handoff: the hire-readiness judge names the ONE blocking skill,
// this maps it to the drill that trains exactly that skill (drill key + on-screen name kept
// together so the button label can never drift from what actually opens). `confidence`
// (hesitation/latency) trains with the 4-3-2 fluency drill; `grammar`/`complexity`
// (Satzbau/Nebensätze — the verb-final wall) train with the dedicated Satzbau-Schmiede drill.
const TRAIN_FOR_SKILL = {
  fluency:         { drill: 'fluency',   label: 'FLUENCY 4-3-2' },
  confidence:      { drill: 'fluency',   label: 'FLUENCY 4-3-2' },
  intelligibility: { drill: 'shadowing', label: 'SHADOWING' },
  deescalation:    { drill: 'pressure',  label: 'DRUCK-LEITER' },
  grammar:         { drill: 'satzbau',   label: 'SATZBAU-SCHMIEDE' },
  complexity:      { drill: 'satzbau',   label: 'SATZBAU-SCHMIEDE' },
};

// The honest hire-readiness verdict — ONE source of truth, used on BOTH the post-interview results
// screen AND the home, so "am I hireable yet?" is answered where the user actually asks it (every
// session on the home), not only once after a fight. Honest by construction: tri-state (BEREIT / FAST
// BEREIT / your biggest lever), shows how many of the 9 signals were really measured, and returns null
// rather than guess. `compact` = the calmer home variant (no entrance animation). See hireReadiness.js.
function HireVerdict({ h, onTrain, compact = false }) {
  if (!h) return null;
  const SKILL = {
    fluency:         { de: 'Flüssigkeit — sprich in ganzen Sätzen, ohne lange Pausen', ar: 'الطلاقة — اتكلم بجمل كاملة من غير وقفات طويلة' },
    grammar:         { de: 'Grammatik — zu viele Fehler pro Antwort', ar: 'القواعد — أخطاء كتير في كل إجابة' },
    intelligibility: { de: 'Verständlichkeit — deine Aussprache kommt noch nicht klar an', ar: 'وضوح النطق — نطقك لسه مش واصل بوضوح' },
    confidence:      { de: 'Sicherheit — weniger zögern, schneller antworten', ar: 'الثقة — تردد أقل ورد أسرع' },
    deescalation:    { de: 'Deeskalation — wütende Kunden ruhig und sicher auffangen', ar: 'التهدئة — استيعاب العميل الغضبان بهدوء وثقة' },
    complexity:      { de: 'Satzbau & Wortschatz — mehr Nebensätze, mehr Vielfalt', ar: 'تركيب الجمل والمفردات — جمل مركّبة أكتر وتنوّع أكبر' },
  }[h.limitingSkill] || null;
  const levelOk = { B1: 1, B2: 1, C1: 1 }[h.level] === 1;
  let v = null;
  if (h.hireReady === true) {
    v = { label: 'INTERVIEW-BEREIT', color: 'var(--accent)', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)',
          de: 'Alle gemessenen Interview-Signale sind im grünen Bereich — du bist bereit, dich in einem echten Interview zu testen.',
          ar: 'كل إشارات التوظيف المتقاسة في النطاق الأخضر — انت جاهز لمقابلة حقيقية.' };
  } else if (h.hireReady === false && levelOk && SKILL) {
    v = { label: 'FAST INTERVIEW-BEREIT', color: 'var(--action)', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.4)',
          de: `Was dich gerade am stärksten blockiert: ${SKILL.de}`, ar: `أكتر حاجة بتعطّلك دلوقتي: ${SKILL.ar}` };
  } else if (SKILL) {
    v = { label: 'DEIN GRÖSSTER HEBEL', color: '#94a3b8', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.15)',
          de: SKILL.de, ar: SKILL.ar };
  }
  if (!v) return null;   // no verdict AND no measurable lever → say nothing rather than guess
  const T = TRAIN_FOR_SKILL[h.limitingSkill];
  return (
    <div style={{ padding:'12px 14px', borderRadius:'var(--r-md)', background:v.bg, border:`1px solid ${v.border}`,
      animation: compact ? 'none' : 'result-rise 0.5s var(--ease-out)', textAlign:'center' }}>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, letterSpacing:'0.18em', color:v.color, marginBottom:6 }}>
        INTERVIEW-BEREITSCHAFT · {v.label}
      </div>
      <div style={{ fontSize:13, color:'#e2e8f0', lineHeight:1.5 }}>{v.de}</div>
      <div dir="rtl" style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>{v.ar}</div>
      {(h.partial || h.readyCaveat) && (
        <div style={{ fontSize:10, color:'#64748b', marginTop:7 }}>
          vorläufig · {h.measuredSignals}/{h.totalSignals} Signale gemessen{h.readyCaveat ? ' · Aussprache als klar angenommen' : ''}
        </div>
      )}
      {SKILL && onTrain && T && (
        <button onClick={() => onTrain(T.drill, v.de)}
          style={{ width:'100%', marginTop:10, padding:'12px', minHeight:46, cursor:'pointer',
            fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.1em', fontWeight:700,
            borderRadius:9, border:`1px solid ${v.border}`, color:v.color, background:'rgba(0,0,0,0.25)' }}>
          ▶ JETZT GEZIELT TRAINIEREN: {T.label}
        </button>
      )}
    </div>
  );
}

function Debrief({ data, pending, verdictHold = false, onRestart, onRevanche, onDone, lang = 'de', onLang, bossName, token, apiUrl, studentName, onTrainSkill, ent, onSeePlans }) {
  // The student's first name — so the most personal moment in the app actually speaks to THEM.
  const _fn = (studentName || '').toString().trim().split(/\s+/)[0];
  const nm  = _fn ? _fn.charAt(0).toUpperCase() + _fn.slice(1) : '';
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied]   = useState(false);
  // FEEDBACK ESSENCE (owner 07-02): "never give a million advice." The debrief opens with ONLY the
  // verdict, the readiness judge, and the plan for today — everything else (17 sections of analysis)
  // lives behind one toggle for the learner who wants to dig.
  const [showDetails, setShowDetails] = useState(false);
  const [rankCeremony, setRankCeremony] = useState(null);
  useEffect(() => {
    if (data?.progress?.rank?.rankUp) setRankCeremony(data.progress.rank.rankUp);
  }, [data?.progress?.rank?.rankUp]);
  useEffect(() => {
    if (!rankCeremony || lang === 'ar' || !token) return undefined;
    const key = ({ Anwärter: 'rank_anwaerter', Geübt: 'rank_geuebt', Profi: 'rank_profi',
      'Interview-Bereit': 'rank_ready' })[rankCeremony.to] || 'rank_anwaerter';
    const stop = playNative({ apiUrl, token, text: salmaLine(key, 'de'), voice: SALMA_NATIVE_VOICE });
    return () => { try { stop?.(); } catch { /* fail silent */ } };
  }, [rankCeremony, lang, token, apiUrl]);
  // THE REVEAL (R2, WOW plan): on the FIRST debrief only, the diagnosis becomes a ceremony — named
  // Baustellen + the journey ahead. Brain fetch mirrors BrainGuide's (fail-silent: no fake card).
  const isFirstDebrief = data?.progress?.sessionCount === 1;
  const [revealJourney, setRevealJourney] = useState(null);
  useEffect(() => {
    if (!isFirstDebrief || !token) return;
    let alive = true;
    fetch(`${apiUrl}/api/brain`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.directive?.journey) setRevealJourney(d.directive.journey); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isFirstDebrief, token, apiUrl]);
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

  const shareUrl  = (typeof window !== 'undefined' && window.location?.origin) || 'https://omni-perform.vercel.app';
  const shareTier = Number(data?.progress?.rank?.tier ?? -1);
  const canShareArtifact = shareTier >= 2;
  const interviewReady = data?.progress?.hireReadiness?.hireReady === true;
  const shareVariant = interviewReady ? 'training-record'
    : win ? 'conquest' : ((data?.progress?.streak ?? 0) >= 3 ? 'streak' : 'invitation');
  const bossTitle = (bossName || r.bossId || 'INTERVIEWER').toString().toUpperCase();
  const shareHero = shareVariant === 'training-record'
    ? 'TRAININGSNACHWEIS · INTERVIEW-BEREIT'
    : shareVariant === 'conquest'
    ? `${bossTitle} · BESIEGT`
    : shareVariant === 'streak'
      ? `${data.progress.streak} TAGE SERIE`
      : 'EINLADUNG ZUR NÄCHSTEN RUNDE';
  const shareText = [
    `DIE ARENA · ${shareHero}`,
    ...(shareVariant === 'training-record' ? ['Trainingsnachweis — kein offizielles Sprach- oder Arbeitgeberzertifikat.'] : []),
    `Rang: ${rank}`,
    ``,
    `Trainiere dein deutsches Bewerbungsgespräch:`,
    shareUrl,
  ].join('\n');
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
      x.fillStyle = '#94a3b8'; x.font = 'bold 36px system-ui,sans-serif'; x.fillText('DIE ARENA', W / 2, 130);
      x.fillStyle = '#e2e8f0'; x.font = 'bold 40px system-ui,sans-serif'; x.fillText('DEUTSCHES INTERVIEW-TRAINING', W / 2, 195);
      x.fillStyle = (shareVariant === 'conquest' || shareVariant === 'training-record') ? '#3b82f6' : '#f97316';
      x.font = 'bold 72px system-ui,sans-serif';
      const heroWords = shareHero.split(' '); let heroLine = '', heroY = 420;
      for (const word of heroWords) {
        if (x.measureText(`${heroLine}${word}`).width > W - 150) { x.fillText(heroLine.trim(), W / 2, heroY); heroLine = ''; heroY += 90; }
        heroLine += `${word} `;
      }
      if (heroLine.trim()) x.fillText(heroLine.trim(), W / 2, heroY);
      x.fillStyle = '#e2e8f0'; x.font = 'bold 54px system-ui,sans-serif';
      x.fillText(shareVariant === 'training-record' && nm ? nm.toUpperCase() : `RANG · ${rank}`, W / 2, 700);
      x.fillStyle = '#94a3b8'; x.font = '32px system-ui,sans-serif';
      x.fillText(shareVariant === 'invitation' ? 'SALMA · RECRUITING DESK'
        : shareVariant === 'training-record'
          ? `${data.progress.hireReadiness.measuredSignals}/${data.progress.hireReadiness.totalSignals} TRAININGSSIGNALE GEMESSEN · ${new Date().toLocaleDateString('de-DE')}`
          : 'VERIFIZIERT AUS EINER ECHTEN TRAININGSSITZUNG', W / 2, 810);
      x.fillStyle = '#f97316'; x.font = 'bold 38px system-ui,sans-serif'; x.fillText('DEINE NÄCHSTE RUNDE WARTET', W / 2, 930);
      if (shareVariant === 'training-record') {
        x.fillStyle = '#64748b'; x.font = '24px system-ui,sans-serif';
        x.fillText('TRAININGSNACHWEIS · KEIN OFFIZIELLES SPRACH- ODER ARBEITGEBERZERTIFIKAT', W / 2, 970);
      }
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

      {rankCeremony && (
        <div style={{ position:'absolute', inset:0, zIndex:20, display:'flex', alignItems:'center',
          justifyContent:'center', padding:24, background:'rgba(2,4,9,0.98)' }}>
          <div style={{ width:'min(100%,420px)', textAlign:'center', padding:'28px 22px',
            borderRadius:'var(--r-lg)', border:'1px solid var(--accent)', background:'rgba(59,130,246,0.08)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:11, fontWeight:800,
              letterSpacing:'0.18em', color:'var(--accent)' }}>RANG BESTÄTIGT</div>
            <div style={{ marginTop:16, fontFamily:'var(--font-display)', fontSize:34,
              fontWeight:900, color:'var(--action)' }}>{rankCeremony.to}</div>
            <div style={{ marginTop:9, fontSize:12, color:'#94a3b8' }}>
              Erreicht durch deine gespeicherten Interviews · bleibt als Bestmarke erhalten.
            </div>
            <button onClick={() => setRankCeremony(null)} style={{ width:'100%', minHeight:48, marginTop:20,
              cursor:'pointer', borderRadius:'var(--r-md)', border:'1px solid var(--accent)',
              background:'var(--accent)', color:'#020409', fontFamily:'var(--font-display)',
              fontWeight:900, letterSpacing:'0.1em' }}>WEITER ZUR AUSWERTUNG</button>
          </div>
        </div>
      )}

      {pending && !data ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14 }}>
          <div className="spin" style={{ width:34, height:34, borderRadius:'50%',
            border:'3px solid rgba(59,130,246,0.2)', borderTopColor:'var(--accent)' }} />
          <div style={{ fontFamily:'var(--font-display)', fontSize:12, letterSpacing:'0.14em', color:'#94a3b8' }}>
            {verdictHold ? 'ENTSCHEIDUNG…' : 'Analyse deiner Antworten läuft…'}
          </div>
        </div>
      ) : (
        <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 16px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* ── THE REVEAL (R2): first debrief = the diagnosis ceremony. Named Baustellen come ONLY
              from the deterministic grammar data (never invented); the journey bar only renders when
              the brain answered (fail-silent). This is the "it understands me and will lead me"
              moment, staged once. ── */}
          {isFirstDebrief && (
            <div style={{ padding:'14px 16px', borderRadius:'var(--r-lg)', background:'rgba(59,130,246,0.08)',
              border:'1px solid var(--accent)', textAlign:'left' }}>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:13, letterSpacing:'0.08em', color:'var(--accent)' }}>
                DIAGNOSE ABGESCHLOSSEN{nm ? ` — ${nm.toUpperCase()}` : ''} · التشخيص خلص
              </div>
              {(data?.grammar || []).filter((g) => g.summaryExamples?.length).slice(0, 3).length > 0 && (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)' }}>Deine Baustellen — gemessen, nicht geraten: <span dir="rtl">دي نقط ضعفك — متقاسة مش تخمين:</span></div>
                  {(data.grammar || []).filter((g) => g.summaryExamples?.length).slice(0, 3).map((g, i) => (
                    <div key={i} style={{ fontSize:'var(--fs-label)', color:'var(--text)', marginTop:4 }}>
                      {i + 1}. {g.rule}{g.count > 1 ? ` · ${g.count}×` : ''}
                    </div>
                  ))}
                </div>
              )}
              {revealJourney && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginBottom:4 }}>
                    Dein Weg zum Interview-Niveau: {revealJourney.entryDone ?? 0}/{revealJourney.entryTotal ?? 0} Schritte geschafft{/* OWNER-AR slot */}
                  </div>
                  <div style={{ height:8, borderRadius:6, background:'rgba(255,255,255,0.08)', overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.max(0, Math.min(100, revealJourney.pctToApply || 0))}%`,
                      background:'linear-gradient(90deg,var(--accent),var(--accent-2))' }} />
                  </div>
                </div>
              )}
              <div style={{ fontSize:'var(--fs-label)', color:'var(--text)', marginTop:10, lineHeight:1.6 }}>
                Ab jetzt führe ich dich: <b>ein</b> Problem, <b>ein</b> Training, dann der Beweis im Interview.
                Du musst den Weg nicht kennen — nur den nächsten Schritt gehen. <span dir="rtl">من دلوقتي أنا معاك خطوة بخطوة: مشكلة واحدة، تمرين واحد، وبعدها الدليل في الإنترفيو.</span>
              </div>
            </div>
          )}

          {/* ── Cinematic outcome + rank reveal ─────────────────────────────── */}
          <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, letterSpacing:'0.22em',
              color:accent, textShadow:`0 0 16px ${accent}88`, animation:'result-rise 0.4s var(--ease-out)' }}>
              {win ? 'TRAININGSZIEL ERREICHT' : 'WEITER TRAINIEREN'}
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
                {/* Best answer streak of the fight — comboBest was computed+sent since day one and
                    never rendered (panel find). Only shown when a real streak happened. */}
                {(r.comboBest ?? 0) >= 3 && (
                  <div style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:10.5, letterSpacing:'0.14em',
                    color:'#94a3b8', marginTop:5 }}>
                    BESTE SERIE · {r.comboBest} STARKE ANTWORTEN IN FOLGE
                  </div>
                )}
              </>
            )}
            {/* Motivating loss / win line */}
            <div style={{ marginTop:8, fontSize:12, color: win ? 'var(--accent-2)' : 'var(--action)', lineHeight:1.5,
              animation:'result-rise 0.6s var(--ease-out)' }}>
              {win
                ? `Stark${nm ? ', ' + nm : ''}! Du hast das Trainingsziel dieser Simulation erreicht.`
                : `Weiter so${nm ? ', ' + nm : ''}: Die Auswertung zeigt dir jetzt den wichtigsten nächsten Trainingsschritt.`}
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

          {!win && data?.revancheMoment?.quote && onRevanche && (
            <div style={{ padding:'14px 16px', borderRadius:'var(--r-lg)', textAlign:'left',
              background:'rgba(249,115,22,0.09)', border:'1px solid rgba(249,115,22,0.48)' }}>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:11,
                letterSpacing:'0.13em', color:'var(--action)' }}>
                DER MOMENT · {data.revancheMoment.stageLabel || 'DEINE SCHWÄCHSTE ANTWORT'}
              </div>
              <div style={{ marginTop:8, fontSize:13, lineHeight:1.55, color:'#e2e8f0' }}>
                „{data.revancheMoment.quote}“
              </div>
              {data.revancheMoment.reason && (
                <div style={{ marginTop:5, fontSize:10.5, color:'#94a3b8' }}>
                  Größter Hebel: {data.revancheMoment.reason}
                </div>
              )}
              <button onClick={onRevanche} style={{ width:'100%', minHeight:48, marginTop:12,
                cursor:'pointer', borderRadius:'var(--r-md)', border:'1px solid var(--action)',
                background:'var(--action)', color:'#020409', fontFamily:'var(--font-display)',
                fontWeight:900, fontSize:13, letterSpacing:'0.12em' }}>
                REVANCHE · NOCHMAL UNTER DRUCK
              </button>
            </div>
          )}

          {/* ── Hiring decision — maps the CEFR VERDICT (not the game score) to the real
                Cairo bar: C1-held-under-pressure = seated; B2 = screen only; freeze = out.
                Mirrors the server jobLabel so the screen never shows two competing verdicts. ── */}
          {!gradeUnavailable && (() => {
            const d = r.verdict === 'fail'
                ? { icon:'↻', label:'NOCH INSTABIL', de:'In dieser Simulation wurden deine Antworten unter Druck instabil. Das ist ein Trainingssignal, keine Einstellungsentscheidung.', ar:'في المحاكاة دي إجاباتك ما كانتش ثابتة تحت الضغط. دي إشارة تدريب، مش قرار توظيف.', color:'var(--bad)', bg:'rgba(248,113,113,0.08)', border:'rgba(248,113,113,0.3)' }
              : (rank === 'C1' && r.verdict === 'pass')
                ? { icon:'✓', label:'STARKES SIMULATIONSERGEBNIS', de:'Du hast in dieser Simulation C1-Signale auch unter Druck gezeigt.', ar:'أظهرت إشارات C1 تحت الضغط في المحاكاة دي.', color:'var(--accent)', bg:'rgba(59,130,246,0.12)', border:'rgba(59,130,246,0.4)' }
              : rank === 'C1'
                ? { icon:'📋', label:'C1-SIGNALE', de:'Dein Sprachniveau war stark; unter Druck war die Leistung noch nicht konstant.', ar:'مستوى اللغة كان قوي، لكن الأداء تحت الضغط محتاج ثبات أكتر.', color:'var(--action)', bg:'rgba(249,115,22,0.10)', border:'rgba(249,115,22,0.4)' }
              : rank === 'B2'
                ? { icon:'📋', label:'SOLIDE BASIS', de:'In dieser Simulation wurden B2-Signale gemessen. Der nächste Hebel steht unten.', ar:'في المحاكاة دي اتقاست إشارات B2. أهم خطوة جاية موجودة تحت.', color:'var(--action)', bg:'rgba(249,115,22,0.10)', border:'rgba(249,115,22,0.4)' }
              : rank === 'B1'
                ? { icon:'⏸', label:'BASIS VORHANDEN', de:'In dieser Simulation wurden B1-Signale gemessen. Trainiere jetzt den größten Hebel.', ar:'في المحاكاة دي اتقاست إشارات B1. درّب أهم نقطة دلوقتي.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' }
              : rank === 'A2'
                ? { icon:'🌱', label:'AUFBAUSTUFE', de:'In dieser Simulation wurden A2-Signale gemessen. Baue dein Fundament Schritt für Schritt aus.', ar:'في المحاكاة دي اتقاست إشارات A2. ابنِ الأساس خطوة بخطوة.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' }
              // A1/unknown → match the server jobLabel's gentle tone, NOT a harsh red "DIESMAL NICHT".
              : { icon:'🌱', label:'DEIN ANFANG', de:'Jeder Profi hat hier angefangen. Bleib dran — du schaffst das, Schritt für Schritt.', ar:'كل محترف بدأ من هنا. كمّل — هتعملها خطوة بخطوة.', color:'#94a3b8', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.15)' };
            return (
              <div style={{ padding:'12px 14px', borderRadius:'var(--r-md)', background:d.bg, border:`1px solid ${d.border}`,
                animation:'result-rise 0.5s var(--ease-out)', textAlign:'center' }}>
                <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10, letterSpacing:'0.18em', color:d.color, marginBottom:6 }}>
                  {d.icon} SIMULATIONS-EINSCHÄTZUNG · {d.label}
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
          {HIRE_VERDICT_LIVE && !gradeUnavailable && data?.progress?.hireReadiness && (
            <HireVerdict h={data.progress.hireReadiness} onTrain={onTrainSkill} />
          )}

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
              {/* Deep audit D20: the server has always sent notCounted for too-short sessions — the
                  client showed a silent +0 XP with no reason. Say it honestly. */}
              {data.progress.notCounted && (
                <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4, lineHeight:1.5 }}>
                  Zu kurz gesprochen, um zu zählen — XP und Serie gibt es ab einer echten Antwort.
                  {' '}<span dir="rtl">الجلسة كانت قصيرة — اتكلم إجابة حقيقية عشان النقط تتحسب.</span>
                </div>
              )}
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
                  Nächster Interviewer ab Level {data.progress.nextBoss.minLevel}: {data.progress.nextBoss.name}
                </div>
              )}
              {data.progress.trainingDelta && (
                <div style={{ fontSize:10.5, color:'#cbd5e1', marginTop:6, paddingTop:6, borderTop:'1px solid rgba(255,255,255,0.06)', ...rtl }}>
                  <b style={{ color:'var(--action)' }}>{ar ? data.progress.trainingDelta.title_ar : data.progress.trainingDelta.title_de}</b>:{' '}
                  {ar ? 'الجولة اللي فاتت' : 'letzte Simulation'} {data.progress.trainingDelta.before} {ar ? '→ النهارده' : 'Fehler → heute'}{' '}
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
              {/* The receipts (R7): the accuracy moat, stated where the student READS corrections.
                  Every claim in this line is true by construction (feedback-accuracy doctrine). */}
              <div style={{ fontSize:9.5, color:'var(--text-faint)', marginTop:8, lineHeight:1.5, fontStyle:'italic' }}>
                Jede Korrektur stammt aus deinem eigenen Satz — deterministisch geprüft, nie erfunden.
                Gelobt wird nur, was du wörtlich gesagt hast.{/* OWNER-AR slot */}
              </div>
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

          {(data?.nextTime?.targetWeakRule || data?.progress?.rank?.nextLabel) && (
            <div style={{ padding:'12px 14px', borderRadius:'var(--r-md)',
              background:'rgba(59,130,246,0.07)', border:'1px solid rgba(59,130,246,0.32)' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:10, fontWeight:800,
                letterSpacing:'0.14em', color:'var(--accent)' }}>NÄCHSTES MAL</div>
              {data.nextTime?.targetWeakRule && (
                <div style={{ marginTop:6, fontSize:12, color:'#e2e8f0', lineHeight:1.5 }}>
                  Deine Akte bleibt offen: <b>{data.nextTime.targetWeakRule}</b> wird erneut geprüft.
                </div>
              )}
              {data.progress?.rank?.nextLabel && (
                <div style={{ marginTop:5, fontSize:11, color:'#94a3b8' }}>
                  {data.progress.rank.toNextPct}% bis {data.progress.rank.nextLabel}
                  {data.progress.rank.nextBy === 'sessions' && data.progress.rank.sessionsToNext > 0
                    ? ` · noch ${data.progress.rank.sessionsToNext} ${data.progress.rank.sessionsToNext === 1 ? 'Sitzung' : 'Sitzungen'}` : ''}
                </div>
              )}
            </div>
          )}

          {/* One-time feedback prompt, only after the user's first-ever fight. Skippable; never blocks restart. */}
          {data?.sessionCount === 1 && token && (
            <FirstFightCard token={token} apiUrl={API_URL} />
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


      {/* THE OFFER AT THE PEAK — they just read their own errors corrected; this is the moment of
          highest belief in the product (elite-marketer teardown 2026-07-10: only 8 of ~120 openers
          ever SAW a price — the paywall lived behind a quiet link and trial expiry). Shown only to
          non-paying accounts. Quiet blue by design — the screen's single orange stays on the rank. */}
      {onSeePlans && ent && (ent.plan || 'free') === 'free' && !pending && data && (
        <div style={{ margin:'2px 16px 0', padding:'13px 15px', borderRadius:'var(--r-md)',
          background:'rgba(59,130,246,0.08)', border:'1px solid var(--accent)' }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:13, color:'var(--text)', lineHeight:1.5 }}>
            {typeof data.progress?.sessionCount === 'number' && data.progress.sessionCount > 0
              ? `Das war Interview Nr. ${data.progress.sessionCount}.` : 'Das war dein Interview.'}{' '}
            Bleib dran bis zur nächsten Bewerbung.
          </div>
          <div dir="rtl" style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:3, lineHeight:1.6 }}>
            كمّل تدريب — انت في السكة الصح.
          </div>
          {ent.trial?.active && ent.trial.daysLeft > 0 && (
            <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4 }}>
              Testphase: noch {ent.trial.daysLeft} {ent.trial.daysLeft === 1 ? 'Tag' : 'Tage'} — danach entscheidest du.
            </div>
          )}
          <button onClick={onSeePlans} style={{ marginTop:10, width:'100%', minHeight:44, cursor:'pointer',
            fontFamily:'var(--font-display)', fontWeight:700, fontSize:12, letterSpacing:'0.06em',
            padding:'11px', borderRadius:'var(--r-md)', border:'1px solid var(--accent)',
            color:'var(--accent)', background:'transparent' }}>
            PLÄNE ANSEHEN →{/* OWNER-AR slot */}
          </button>
        </div>
      )}

      <div style={{ padding:'10px 16px 20px', display:'flex', gap:10 }}>
        <button onClick={onRestart} style={{ flex:2, fontFamily:'var(--font-display)', fontWeight:700, fontSize:13,
          letterSpacing:'0.1em', padding:'14px', borderRadius:'var(--r-md)', cursor:'pointer',
          border:'1px solid var(--accent)', color:'#04070d',
          background:'linear-gradient(135deg, var(--accent-2), var(--accent))',
          boxShadow:'0 0 22px rgba(59,130,246,0.4)' }}>
          NOCH EIN INTERVIEW
        </button>
        {canShareArtifact && (
          <button onClick={onShare} style={{ flex:1, fontFamily:'var(--font-display)', fontWeight:700, fontSize:12,
            letterSpacing:'0.08em', padding:'14px', borderRadius:'var(--r-md)', cursor:'pointer',
            border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)' }}>
            {copied ? '✓ KOPIERT' : `↗ ${shareVariant === 'training-record' ? 'NACHWEIS' : shareVariant === 'conquest' ? 'SIEG' : shareVariant === 'streak' ? 'SERIE' : 'EINLADUNG'} TEILEN`}
          </button>
        )}
      </div>

      {/* The way OUT that isn't another fight: before this button the debrief's only exits were
          NOCHMAL KÄMPFEN or a full page reload — the home guide (the brain's next step) was
          unreachable at the exact moment of highest motivation. Quiet by design (law: one accent). */}
      {onDone && (
        <div style={{ padding:'0 16px 24px' }}>
          <button onClick={onDone} style={{ width:'100%', minHeight:48, fontFamily:'var(--font-display)',
            fontWeight:700, fontSize:12, letterSpacing:'0.08em', padding:'13px', borderRadius:'var(--r-md)',
            cursor:'pointer', border:'1px solid var(--line)', color:'var(--text-dim)',
            background:'rgba(255,255,255,0.04)' }}>
            ✓ FERTIG — ZUR ÜBERSICHT{/* OWNER-AR slot */}
          </button>
        </div>
      )}
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
// ── Bewerbungs-Dossier — the REAL artifact: a printable one-pager of MEASURED training evidence
// (rank, sessions, streak, vocab/rules, honest hire-readiness state). Nothing estimated, nothing
// promised (legal redline: no job/outcome claims). White paper look — it's a document, not UI.
const DOSSIER_SKILL_DE = { fluency: 'Flüssigkeit', grammar: 'Grammatik', intelligibility: 'Verständlichkeit',
  confidence: 'Sicherheit', deescalation: 'Deeskalation', complexity: 'Satz-Komplexität' };
function DossierSheet({ token, data, account, onClose }) {
  const [guideName, setGuideName] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/guide/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (alive && p?.name) setGuideName(p.name); })
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);

  const hr     = data?.hireReadiness || {};
  const rank   = data?.rank || {};
  const totals = data?.totals || {};
  const flu    = (data?.trends?.fluency || []).filter(Number.isFinite);
  const fluDelta = flu.length >= 2 ? Math.round(flu[flu.length - 1] - flu[0]) : null;
  const today  = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  const readiness = hr.hireReady === true
    ? 'Interview-bereit (alle Signale gemessen)'
    : hr.hireReady === false
      ? `In Arbeit — größter Hebel: ${DOSSIER_SKILL_DE[hr.limitingSkill] || hr.limitingSkill || '—'}`
      : `In Messung (${hr.measuredSignals ?? 0}/${hr.totalSignals ?? 9} Signale erfasst)`;

  const rows = [
    ['Geschätztes Deutsch-Niveau', hr.level || '—'],
    ['Interview-Rang', `${rank.label || 'Rekrut'} (Stufe ${(rank.tier ?? 0) + 1}/${(rank.ranks || []).length || 5})`],
    ['Live-Interviews absolviert', String(totals.sessions ?? 0)],
    ['Trainings-Serie (aktuell)', `${data?.streak ?? 0} Tage`],
    ['Vokabeln gelernt', String(totals.vocabLearned ?? 0)],
    ['Grammatik-Regeln gemeistert', String(totals.rulesMastered ?? 0)],
    ...(fluDelta !== null ? [['Flüssigkeit (Trend über die letzten Interviews)', `${fluDelta >= 0 ? '+' : ''}${fluDelta} Punkte`]] : []),
    ['Hire-Readiness', readiness],
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 260, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 16, background: 'rgba(2,4,9,0.9)', backdropFilter: 'blur(5px)' }}>
      <div className="dossier-sheet" style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto',
        background: '#fdfdfb', color: '#111827', borderRadius: 10, padding: '26px 26px 20px',
        boxShadow: '0 22px 70px rgba(0,0,0,0.7)', fontFamily: 'var(--font-body)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          borderBottom: '2px solid #111827', paddingBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, letterSpacing: '0.1em' }}>OMNI-PERFORM</div>
            <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.06em', marginTop: 2 }}>DEUTSCH-INTERVIEW-TRAINING · KAIRO</div>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>{today}</div>
        </div>

        <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19 }}>Bewerbungs-Dossier</div>
        <div style={{ fontSize: 11.5, color: '#374151', marginTop: 3 }}>
          Leistungsnachweis aus echten Trainings-Interviews — {guideName || account?.email || ''}
        </div>

        <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '9px 0', fontSize: 11.5, color: '#374151' }}>{k}</td>
                <td style={{ padding: '9px 0', fontSize: 12.5, fontWeight: 700, textAlign: 'right' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 9.5, color: '#6b7280', lineHeight: 1.6, marginTop: 16 }}>
          Alle Werte wurden in gesprochenen Trainings-Interviews und Übungen GEMESSEN — nichts ist
          geschätzt, nichts wird versprochen. Verifizierbar unter omni-perform.vercel.app.
        </div>

        <div className="dossier-hidep" style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => { try { window.print(); } catch { /* print blocked */ } }}
            style={{ flex: 1, minHeight: 44, padding: '11px', borderRadius: 9, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em',
              color: '#fff', background: '#111827' }}>
            DRUCKEN / ALS PDF SPEICHERN
          </button>
          <button onClick={onClose} style={{ minHeight: 44, padding: '11px 14px', borderRadius: 9, cursor: 'pointer',
            border: '1px solid #9ca3af', background: 'transparent', color: '#374151', fontSize: 11 }}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ data, loading, account, onClose, onReview, onLogout, token }) {
  const [dossier, setDossier] = useState(false);
  const t   = data?.totals ?? {};
  const lp  = data?.levelProgress ?? { level: 1, pct: 0, intoLevel: 0, perLevel: 120 };
  const acc = data?.account ?? account;
  const sub = acc?.subscription ?? {};
  const ent = acc?.entitlement ?? {};
  const planName = (ent.plan || 'free').toUpperCase();
  const tierLabel = ent.dailyLiveMinutes > 0
    ? `${planName} · ${ent.dailySessions > 0 ? `${ent.dailySessions} Interview${ent.dailySessions > 1 ? 's' : ''}/Tag` : `${ent.dailyLiveMinutes} Min/Tag`}`
    : 'GRATIS · Einstufung';
  const isFreePlan = (ent.plan || 'free') === 'free';
  return (
    <div style={{ position:'absolute', inset:0, zIndex:210, display:'flex', flexDirection:'column',
      background:'rgba(2,4,9,0.97)', backdropFilter:'blur(6px)', animation:'flash-in 0.3s ease' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 16px 8px' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:900, letterSpacing:2,
          color:'var(--accent)', textShadow:'0 0 20px rgba(59,130,246,0.5)' }}>FORTSCHRITT</div>
        <div style={{ display:'flex', gap:8 }}>
          {/* The real artifact: a printable evidence one-pager for real applications. */}
          {!loading && data && (
            <button onClick={() => setDossier(true)} style={{ fontFamily:'var(--font-display)', fontSize:10, cursor:'pointer',
              padding:'6px 12px', minHeight:32, borderRadius:6, border:'1px solid rgba(59,130,246,0.5)',
              background:'rgba(59,130,246,0.12)', color:'var(--accent-2)' }}>
              DOSSIER
            </button>
          )}
          <button onClick={onClose} style={{ fontFamily:'var(--font-display)', fontSize:10, cursor:'pointer',
            padding:'6px 12px', borderRadius:6, border:'1px solid rgba(59,130,246,0.3)', background:'transparent', color:'var(--accent)' }}>
            ✕ ZURÜCK
          </button>
        </div>
      </div>
      {dossier && <DossierSheet token={token} data={data} account={acc} onClose={() => setDossier(false)} />}

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
              Aktueller Interviewer: <b style={{ color:'#fca5a5' }}>{data?.currentBoss?.name}</b>
              <span style={{ color:'#64748b' }}> · {data?.currentBoss?.tier}</span>
            </div>
            {data?.nextBoss && (
              <div style={{ fontSize:10, color:'#64748b', marginTop:3 }}>
                Nächster Interviewer ab Level {data.nextBoss.minLevel}: {data.nextBoss.name} ({data.nextBoss.tier})
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
function VoiceReadinessCheck() {
  const [state, setState] = useState('idle');
  const run = async () => {
    if (IN_APP_BROWSER || !checkAudioSupport().supported) { setState('unsupported'); return; }
    setState('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      try { localStorage.setItem('bpo_mic_ready', '1'); } catch { /* private mode */ }
      setState('ready');
    } catch { setState('blocked'); }
  };
  const ready = state === 'ready';
  const failed = state === 'blocked' || state === 'unsupported';
  return (
    <div style={{ maxWidth:420, margin:'0 auto 18px', padding:'12px 14px', borderRadius:'var(--r-lg)',
      background: ready ? 'rgba(34,197,94,0.07)' : failed ? 'rgba(239,68,68,0.07)' : 'rgba(59,130,246,0.06)',
      border:`1px solid ${ready ? 'rgba(34,197,94,0.35)' : failed ? 'rgba(239,68,68,0.35)' : 'rgba(59,130,246,0.28)'}` }}>
      <div dir="rtl" style={{ fontSize:12.5, fontWeight:700, color:ready ? '#bbf7d0' : failed ? '#fecaca' : '#dbeafe' }}>
        {ready ? '✓ المايك جاهز للتدريب الصوتي' : failed ? 'المايك مش متاح هنا — افتح صلاحيات الموقع أو استخدم Chrome' : 'اختبر المايك قبل ما تعمل أكونت'}
      </div>
      <div style={{ fontSize:10.5, color:'var(--text-dim)', marginTop:3 }}>
        {ready ? 'Mikrofon bereit — die Sprachinterviews können starten.' : 'Kostenloser Gerätecheck; es wird nichts aufgenommen oder gespeichert.'}
      </div>
      {!ready && (
        <button type="button" onClick={run} disabled={state === 'checking'}
          style={{ width:'100%', minHeight:42, marginTop:9, borderRadius:9, cursor:state === 'checking' ? 'wait' : 'pointer',
            border:'1px solid var(--accent)', background:'rgba(59,130,246,0.14)', color:'var(--accent-2)', fontWeight:800 }}>
          {state === 'checking' ? 'PRÜFE…' : '🎤 المايك · MIKROFON TESTEN'}
        </button>
      )}
      <details style={{ marginTop:10, textAlign:'left' }}>
        <summary style={{ cursor:'pointer', minHeight:36, color:'var(--accent-2)', fontSize:11.5, fontWeight:700 }}>
          شوف مثال للنتيجة قبل التسجيل · Feedback-Beispiel
        </summary>
        <div style={{ marginTop:7, padding:'9px 10px', borderRadius:8, background:'rgba(2,6,16,0.55)',
          border:'1px solid var(--line)', fontSize:11, lineHeight:1.55, color:'#cbd5e1' }}>
          <div><b style={{ color:'var(--accent-2)' }}>HR:</b> Erzählen Sie von einem schwierigen Kunden.</div>
          <div><b>Antwort:</b> „Ich habe den Kunde geholfen und Problem gelöst.“</div>
          <div style={{ marginTop:5 }}><b style={{ color:'var(--action)' }}>Konkretes Feedback:</b> „dem Kunden“ (Dativ),
            „das Problem“ — plus Ergebnis ergänzen: „Danach blieb der Kunde und bestätigte die Lösung.“</div>
          <div dir="rtl" style={{ marginTop:5, color:'#94a3b8' }}>
            المثال توضيحي؛ تقييمك الحقيقي بيتبني من كلامك إنت، من غير نتائج أو شهادات مزيفة.
          </div>

        </div>
      </details>
    </div>
  );
}

function AuthScreen({ onAuth, verificationNotice = null, initialMode = null }) {
  // cold link-clickers are NEW visitors → signup first (conversion); a ?reset= link → login context
  const [mode, setMode]   = useState(() => {
    if (initialMode === 'login' || initialMode === 'signup') return initialMode;
    try { return new URLSearchParams(window.location.search).get('reset') ? 'login' : 'signup'; }
    catch { return 'signup'; }
  });
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  // Self-serve EMAIL password reset (owner order 2026-07-10 — the WhatsApp-manual flow is dead).
  // forgotState: null → closed · 'form' → email input · 'sent' → link on its way ·
  // 'unavailable' → SMTP not configured yet (honest, no false promise, no WhatsApp copy).
  const [forgotState, setForgotState] = useState(null);
  const [forgotBusy, setForgotBusy]   = useState(false);
  // A ?reset=<token> URL (from the reset e-mail) switches the card into "new password" mode.
  const [resetToken] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('reset') || '';
      if (token) {
        params.delete('reset');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      }
      return token;
    } catch { return ''; }
  });
  const sendForgot = async () => {
    if (forgotBusy) return;
    if (!email) { setErr({ de: 'Bitte gib oben deine E-Mail ein.', ar: 'اكتب إيميلك الأول فوق.' }); return; }
    setErr(''); setForgotBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/auth/forgot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const d = await r.json().catch(() => null);
      setForgotState(d?.ok ? 'sent' : 'unavailable');
    } catch { setErr({ de: 'Server nicht erreichbar. Bitte versuche es gleich erneut.', ar: 'مفيش اتصال بالسيرفر. حاول تاني بعد شوية.' }); }
    setForgotBusy(false);
  };
  const submitReset = async () => {
    if (busy) return;
    if (String(pw).length < 10) { setErr({ de: 'Neues Passwort: mindestens 10 Zeichen.', ar: 'الباسورد الجديد لازم ١٠ حروف على الأقل.' }); return; }
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/auth/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: pw }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error === 'invalid_or_expired'
          ? { de: 'Der Link ist abgelaufen oder wurde schon benutzt.', ar: 'اللينك خلص أو اتستخدم قبل كده.', expired: true }
          : authErrText(d?.error));
        setBusy(false); return;
      }
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* cosmetic */ }
      onAuth({ token: d.token, account: d.account });
    } catch { setErr({ de: 'Server nicht erreichbar. Bitte versuche es gleich erneut.', ar: 'مفيش اتصال بالسيرفر. حاول تاني بعد شوية.' }); setBusy(false); }
  };
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [busyHint, setBusyHint] = useState(false);
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
    if (mode === 'signup' && String(pw).length < 10) { setErr(authErrText('weak_password')); return; }
    setErr(''); setBusy(true); setBusyHint(false);
    const ctrl = new AbortController();
    const hintTimer = setTimeout(() => setBusyHint(true), 1200);
    const timeout = setTimeout(() => ctrl.abort(), 65_000);
    try {
      const r = await fetch(`${API_URL}/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pw, ...(mode === 'signup' ? { ref: getRefCode() } : {}) }),
        signal: ctrl.signal,
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
    } catch (error) {
      setErr(error?.name === 'AbortError'
        ? { de: 'Der Server braucht zu lange. Deine Eingaben sind erhalten — bitte erneut versuchen.', ar: 'السيرفر اتأخر. بياناتك لسه موجودة — جرّب تاني.' }
        : { de: 'Server nicht erreichbar. Bitte versuche es gleich erneut.', ar: 'مفيش اتصال بالسيرفر. حاول تاني بعد شوية.' });
      setBusy(false);
    } finally {
      clearTimeout(hintTimer); clearTimeout(timeout); setBusyHint(false);
    }
  };

  // "Private Bank Arena" landing (07-02 uplift): quiet lockup, the Arabic headline AS the hero,
  // a CSS-drawn phone showing the REAL fight UI (the blue-vs-orange moat — $0 product proof),
  // a boxless feature checklist, and a glass auth card whose KONTO-ERSTELLEN button is the ONE
  // orange fill on the page. All DE/AR copy verbatim from the previous landing.
  const rise = (i) => ({ animation:`rise-in 0.36s var(--ease-out) both`, animationDelay:`${i * 60}ms` });
  return (
    <div className="auth-shell" style={{ minHeight:'100svh', display:'flex', flexDirection:'column',
      justifyContent:'center', padding:'24px', position:'relative', overflow:'hidden' }}>
      {/* Craft pass #10 — a DECIDED atmosphere: one light source (top-left, behind the hero) and a
          whisper of grain. Depth that's felt, never noticed. */}
      <div style={{ position:'fixed', top:-220, left:-160, width:680, height:680, borderRadius:'50%', pointerEvents:'none',
        background:'radial-gradient(circle, rgba(59,130,246,0.11) 0%, transparent 62%)' }} />
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', opacity:0.028, mixBlendMode:'overlay',
        backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")` }} />
      <div className="landing-grid" style={{ maxWidth:1120, margin:'0 auto', width:'100%' }}>
      <div>
      <div style={{ textAlign:'center', marginBottom:20, ...rise(0) }}>
        {/* Craft pass #9 — the mark (owner yes/no pending): two voice bars in a machined square. */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:9 }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="0.75" y="0.75" width="20.5" height="20.5" rx="5" fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="1.5" />
            <rect x="7" y="7.5" width="2.6" height="7" rx="1.3" fill="var(--accent)" />
            <rect x="12.4" y="5.5" width="2.6" height="11" rx="1.3" fill="var(--action)" />
          </svg>
          <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:700, letterSpacing:'0.08em', color:'var(--text)' }}>
            OMNI-PERFORM
          </div>
        </div>
        {/* Craft pass #4 — ONE short line carries the page (real Arabic display face, set like a
            headline); everything below steps down. Niche = the BPO industry IN Egypt (owner 07-10). */}
        <div dir="rtl" style={{ fontFamily:"'IBM Plex Sans Arabic', var(--font-body)", fontSize:'clamp(30px, 5vw, 44px)', fontWeight:700, color:'#f8fafc', marginTop:22, lineHeight:1.3 }}>
          تدريب إنترفيو ألماني عملي
        </div>
        <div dir="rtl" style={{ fontFamily:"'IBM Plex Sans Arabic', var(--font-body)", fontSize:'var(--fs-body)', fontWeight:500, color:'var(--text-dim)', marginTop:10, lineHeight:1.8, maxWidth:430, marginInline:'auto' }}>
          علشان توصل للشغل في الكول سنتر الألماني في مصر أو شغل ريموت بالألماني.{/* OWNER-AR pass invited */}
        </div>
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', marginTop:10, lineHeight:1.6, maxWidth:440, marginInline:'auto' }}>
          Deutsches Interview-Training für BPO- und Call-Center-Jobs in Ägypten — und für deutsche Remote-Jobs.
        </div>
        {/* Craft pass #3 — the assessment promise, demoted from a shouting orange chip to one quiet line. */}
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:14, lineHeight:1.7 }}>
          Nach Anmeldung und E-Mail-Bestätigung: kostenlose Einstufung deines Niveaus.
          {' '}<span dir="rtl">بعد التسجيل وتأكيد الإيميل: تقييم مجاني لمستواك.</span>
        </div>
        <button onClick={() => document.getElementById('signup-card')?.scrollIntoView({ behavior:'smooth', block:'center' })}
          style={{ marginTop:18, width:'100%', maxWidth:420, minHeight:50, borderRadius:12, cursor:'pointer',
            border:'1px solid var(--action)', background:'linear-gradient(135deg,var(--action-2),var(--action))',
            color:'#071018', fontFamily:'var(--font-display)', fontWeight:800, fontSize:14 }}>
          ابدأ تقييمك المجاني · KOSTENLOS STARTEN
        </button>
        <div style={{ fontSize:11.5, color:'var(--text-faint)', marginTop:7 }}>
          Nach E-Mail-Bestätigung: Einstufung + erstes Interview kostenlos; danach 3 Tage Basic ab Interviewstart · keine Karte nötig
        </div>
      </div>

      <figure style={{ maxWidth:420, margin:'24px auto 4px', padding:0, ...rise(2) }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:9, letterSpacing:'0.16em', color:'var(--accent)', marginBottom:8 }}>
          ECHTE PRODUKTANSICHT · BEISPIELKONTO
        </div>
        <img src="/product-home.png" width="390" height="844" loading="lazy" decoding="async"
          alt="OMNI-PERFORM mobile training home with interview start, readiness tracker, and level assessment"
          style={{ display:'block', width:'100%', height:'auto', maxHeight:430, objectFit:'cover', objectPosition:'top',
            borderRadius:'var(--r-lg)', border:'1px solid var(--line)', boxShadow:'0 22px 55px rgba(0,0,0,0.38)' }} />
        <figcaption style={{ fontSize:10.5, color:'var(--text-faint)', lineHeight:1.5, marginTop:8 }}>
          Aktuelle mobile Oberfläche, aufgenommen aus dem laufenden Produkt mit einem synthetischen Testkonto.
          {' '}<span dir="rtl">صورة حقيقية من المنتج الحالي بحساب تجريبي.</span>
        </figcaption>
      </figure>

      {/* Feature checklist — boxless, real icons (copy verbatim) */}
      <div style={{ maxWidth:420, margin:'26px auto 26px', display:'flex', flexDirection:'column', gap:18, ...rise(3) }}>
        {[
          { icon:'mic',     ar:'محاكاة واقعية لإنترفيو ألماني بالصوت مع HR صعب',  de:'Realistische deutsche Voice-Interview-Simulation mit anspruchsvollem HR' },
          { icon:'target',  ar:'فيدباك دقيق على أخطائك انت — مش كلام عام',        de:'Präzises Feedback auf DEINE Fehler (Grammatik via LanguageTool) — nie generisch' },
          { icon:'chartUp', ar:'شوف تقدّمك أسبوع بأسبوع واستعد للتقديم الجاي',     de:'Die App führt dich Schritt für Schritt — du siehst deinen Fortschritt bis zur nächsten Bewerbung' },
          // KB-depth row (P4, 2026-07-10): the moat nobody else can claim — drills built on the
          // REAL hiring bar. Masri verified per masri-verification-law (أكونت = owner's canon).
          { icon:'fileBadge', ar:'بندرّبك على متطلبات شائعة في الشغل: التحقق من بيانات العميل، معايير الجودة، ومصطلحات الأكونتات الألمانية — من الموبايل لشركات الطيران', de:'Trainiert typische Arbeitsanforderungen: Datenschutz-Verifizierung, QA-Kriterien und die Sprache deutscher Konten — vom Mobilfunk bis zur Airline' },
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
        {/* The anti-chatbot line (R7): the accuracy moat, stated where a skeptic decides. */}
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', lineHeight:1.6, marginTop:4, textAlign:'center' }}>
          Konkretes Feedback aus deinen eigenen Antworten — mit nachvollziehbaren Beispielen statt allgemeiner Tipps.{/* OWNER-AR slot */}
        </div>
      </div>
      </div>

      {/* Column 2 of the desktop landing-grid. Without this wrapper the grid treated the ratings,
          the auth card, and the legal links as SEPARATE grid children — on ≥900px they scattered
          into whichever cell came next (the ★-rating floated beside the hero, legal links hung in
          mid-air beside the form: the broken desktop landing, aesthetic pass 2026-07-10). One
          column div = hero left, everything actionable right. Phones unaffected (grid is ≥900 only). */}
      <div>

      {/* PUBLIC RATINGS (owner 2026-07-02: real user ratings, publicly shown) — only renders once
          the server confirms a real, non-thin sample exists (never a placeholder/fabricated stat).
          The average is always computed over EVERY rating ever submitted, not just the quotes
          shown below — that's what keeps a curated quote sample honest rather than cherry-picked. */}
      {publicRatings && (
        <div style={{ maxWidth:420, margin:'0 auto 22px', ...rise(3.5) }}>
          {/* Craft pass #2: the ★ line no longer shouts in orange from empty space — one quiet,
              honest line above the real quotes (the quotes carry the proof, not the numeral). */}
          <div style={{ textAlign:'center', fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginBottom:12 }}>
            ★ {publicRatings.avgRating.toFixed(1)} · {publicRatings.ratingCount} echte Bewertungen{/* OWNER-AR slot */}
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

      <VoiceReadinessCheck />

      {/* AUTH CARD — glass, one orange fill on the whole page */}
      <div id="signup-card" style={{ borderRadius:'var(--r-xl)', padding:24, maxWidth:420, margin:'0 auto', width:'100%',
        background:'var(--glass)', border:'var(--glass-border)', boxShadow:'var(--e3), var(--glass-highlight)',
        backdropFilter:'blur(14px) saturate(1.1)', ...rise(4) }}>
        {verificationNotice && (
          <div role="status" style={{ marginBottom:14, padding:'11px 13px', borderRadius:10,
            border:`1px solid ${verificationNotice.state === 'success' ? 'rgba(34,197,94,0.42)' : 'rgba(248,113,113,0.42)'}`,
            background:verificationNotice.state === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
            color:verificationNotice.state === 'success' ? '#bbf7d0' : '#fecaca', fontSize:12, lineHeight:1.55 }}>
            {verificationNotice.state === 'success'
              ? <>E-Mail bestätigt. Du kannst dich jetzt anmelden. <span dir="rtl">تم تأكيد الإيميل — سجّل دخول.</span></>
              : <>Der Bestätigungslink ist ungültig oder abgelaufen. Melde dich an und fordere einen neuen an. <span dir="rtl">اللينك غير صالح أو انتهى.</span></>}
          </div>
        )}
        {resetToken ? (
          <div style={{ marginBottom:4 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:700, color:'var(--text)' }}>Neues Passwort setzen</div>
            <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4, lineHeight:1.5 }}>
              Privater Link aus deiner E-Mail — wähle unten dein neues Passwort. <span dir="rtl">اختار الباسورد الجديد.</span>
            </div>
          </div>
        ) : (
        <div style={{ display:'flex', gap:0, marginBottom:18, background:'rgba(255,255,255,0.05)', borderRadius:'var(--r-pill)', padding:3 }}>
          {['login','signup'].map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setErr(''); }}
              style={{ flex:1, padding:'11px', minHeight:44, cursor:'pointer', fontFamily:'var(--font-display)', fontSize:'var(--fs-label)',
                fontWeight:600, letterSpacing:'0.04em', borderRadius:'var(--r-pill)', border:'none', transition:'all 200ms var(--ease)',
                background: mode===m?'rgba(59,130,246,0.18)':'transparent', color: mode===m?'var(--accent-2)':'var(--text-faint)' }}>
              {m === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          ))}
        </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); if (resetToken) submitReset(); else submit(); }}>
        {/* Visible labels: placeholder-only inputs disappear while typing and reduce trust. */}
        {!resetToken && (
          <>
            <label htmlFor="auth-email" style={{ display:'block', fontSize:11, fontWeight:600, letterSpacing:'0.05em', color:'var(--text-dim)', margin:'0 2px 5px' }}>E-MAIL</label>
            <input id="auth-email" name="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="name@gmail.com"
              autoComplete="email" required className="uplift-input" style={inputStyle} />
          </>
        )}
        <label htmlFor="auth-password" style={{ display:'block', fontSize:11, fontWeight:600, letterSpacing:'0.05em', color:'var(--text-dim)', margin:'12px 2px 5px' }}>{resetToken ? 'NEUES PASSWORT' : 'PASSWORT'}</label>
        <input id="auth-password" name="password" type="password" value={pw} onChange={(e)=>setPw(e.target.value)} placeholder="mind. 10 Zeichen"
          required minLength={10} maxLength={128}
          autoComplete={mode==='signup' || resetToken ? 'new-password' : 'current-password'}
          className="uplift-input" style={inputStyle} />


        {err && (
          <div style={{ marginTop:10 }}>
            <div style={{ color:'#fca5a5', fontSize:12 }}>⚠ {err.de}</div>
            {err.ar && <div dir="rtl" style={{ color:'#fca5a5', fontSize:12, marginTop:2 }}>{err.ar}</div>}
            {/* Expired-link escape hatch (review catch): in reset mode every other control is
                hidden — without this button a stale-link user had literally no way forward. */}
            {err.expired && (
              <button type="button" onClick={() => { window.location.href = window.location.pathname; }}
                style={{ display:'block', marginTop:8, padding:'8px 0', minHeight:40, width:'100%', cursor:'pointer',
                  background:'none', border:'none', fontFamily:'var(--font-body)', fontSize:'var(--fs-meta)',
                  color:'var(--accent)', textDecoration:'underline', textUnderlineOffset:3 }}>
                Neuen Link anfordern → zurück zur Anmeldung
              </button>
            )}
            {/* In-app-browser signup block → the one escape: copy the link for real Chrome. */}
            {err.inapp && (
              <button onClick={async () => {
                  beacon('inapp_escape_tap');
                  try { await navigator.clipboard?.writeText(window.location.origin); setErr((e) => (e ? { ...e, copied: true } : e)); } catch { /* clipboard blocked */ }
                }}
                style={{ display:'block', marginTop:8, padding:'10px 0', minHeight:44, width:'100%', cursor:'pointer',
                  borderRadius:8, border:'1px solid rgba(59,130,246,0.5)', background:'rgba(59,130,246,0.12)',
                  fontFamily:'var(--font-body)', fontSize:'var(--fs-label)', fontWeight:700, color:'var(--accent-2)' }}>
                {err.copied ? '✓ Kopiert! Jetzt Chrome öffnen & einfügen' : 'Link kopieren'}
              </button>
            )}
          </div>
        )}

        {/* Self-serve password reset via e-mail (owner order 2026-07-10 — the WhatsApp-manual
            instructions are dead: "the reset password is done through email"). The link mails a
            single-use, 45-minute token; ?reset=<token> switches this card into new-password mode. */}
        {mode === 'login' && !resetToken && !forgotState && (
          <button type="button" onClick={() => setForgotState('form')} style={{ display:'block', margin:'10px auto 0', padding:'6px 10px',
            background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)',
            fontSize:'var(--fs-meta)', color:'var(--text-dim)', textDecoration:'underline', textUnderlineOffset:3 }}>
            Passwort vergessen? · نسيت كلمة السر؟
          </button>
        )}
        {mode === 'login' && !resetToken && forgotState === 'form' && (
          <div style={{ marginTop:12, padding:'12px 14px', borderRadius:12, background:'var(--surface)',
            border:'1px solid var(--line)', fontSize:'var(--fs-meta)', lineHeight:1.6, color:'var(--text-dim)' }}>
            <div>Wir schicken dir einen Link an deine E-Mail-Adresse (oben eintragen) — damit setzt du dein Passwort selbst zurück.</div>
            <div dir="rtl" style={{ marginTop:4 }}>هنبعتلك لينك على إيميلك تغيّر بيه الباسورد بنفسك.</div>
            <button type="button" onClick={sendForgot} disabled={forgotBusy}
              style={{ display:'block', width:'100%', marginTop:10, padding:'11px', minHeight:44, cursor:forgotBusy?'wait':'pointer',
                fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, letterSpacing:'0.06em', borderRadius:9,
                border:'1px solid var(--accent)', color:'var(--accent)', background:'rgba(59,130,246,0.08)', opacity:forgotBusy?0.6:1 }}>
              {forgotBusy ? '…' : 'RESET-LINK SENDEN'}
            </button>
          </div>
        )}
        {mode === 'login' && !resetToken && forgotState === 'sent' && (
          <div style={{ marginTop:12, padding:'12px 14px', borderRadius:12, background:'var(--surface)',
            border:'1px solid var(--line)', fontSize:'var(--fs-meta)', lineHeight:1.6, color:'var(--text-dim)' }}>
            <div>Wenn ein Konto mit dieser Adresse existiert, ist der Link unterwegs — <b style={{ color:'var(--text)' }}>Posteingang und Spam-Ordner</b> prüfen. Gültig 45 Minuten.</div>
            <div dir="rtl" style={{ marginTop:4 }}>لو في حساب بالإيميل ده، اللينك في السكة — بص في الإنبوكس والسبام. صالح ٤٥ دقيقة.</div>
          </div>
        )}
        {mode === 'login' && !resetToken && forgotState === 'unavailable' && (
          <div style={{ marginTop:12, padding:'12px 14px', borderRadius:12, background:'var(--surface)',
            border:'1px solid var(--line)', fontSize:'var(--fs-meta)', lineHeight:1.6, color:'var(--text-dim)' }}>
            Der automatische Reset ist gerade nicht verfügbar — bitte versuch es in Kürze noch einmal.
          </div>
        )}

        {/* Craft pass #6 — machined, not inflated: solid fill, tight radius, no glow bloom. */}
        <button type="submit" disabled={busy}
          style={{ width:'100%', marginTop:18, padding:'15px', minHeight:52, cursor:busy?'wait':'pointer',
            fontFamily:'var(--font-display)', fontSize:15, fontWeight:700, letterSpacing:'0.04em', borderRadius:11,
            border:'none', color:'#081019', background:'var(--action)',
            opacity:busy?0.6:1, transition:'transform 100ms var(--ease)' }}>
          {busy ? (busyHint ? 'Server wird gestartet… · السيرفر بيفتح…' : 'Wird gesendet…') : resetToken ? 'Passwort speichern' : mode==='login' ? 'Anmelden' : 'Konto erstellen'}
        </button>
        <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', textAlign:'center', marginTop:12, lineHeight:1.6 }}>
          {mode === 'signup'
            ? <>Bestätigungslink per E-Mail öffnen, dann kostenlos starten · افتح لينك تأكيد الإيميل وبعدها ابدأ مجانًا</>
            : <>Kostenlos starten: Einstufung + erstes Interview · شرح عربي في الخطوات الأساسية · مجاني للبداية</>}
        </div>
        </form>
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
      </div>{/* /column 2 */}
      </div>{/* /landing-grid */}
    </div>
  );
}
function VerificationLinkScreen({ state = 'working', onRetry }) {
  const retryable = state === 'network' || state === 'rate_limited';
  const title = state === 'rate_limited'
    ? 'Zu viele Versuche'
    : state === 'network'
      ? 'Bestätigung unterbrochen'
      : 'E-Mail wird bestätigt…';
  const detail = state === 'rate_limited'
    ? 'Bitte kurz warten und denselben Link erneut versuchen. Dein Link bleibt auf diesem Gerät erhalten.'
    : state === 'network'
      ? 'Die Verbindung zum Server ist abgebrochen. Dein Link bleibt auf diesem Gerät erhalten.'
      : null;
  return (
    <div style={{ minHeight:'100svh', display:'grid', placeItems:'center', padding:24, background:'var(--bg)', color:'var(--text)' }}>
      <div role={retryable ? 'alert' : 'status'} aria-live="polite" style={{ width:'100%', maxWidth:420, padding:24, textAlign:'center',
        borderRadius:'var(--r-xl)', background:'var(--glass)', border:'var(--glass-border)', boxShadow:'var(--e3)' }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:'0.06em', color:'var(--accent)' }}>OMNI-PERFORM</div>
        <div style={{ marginTop:14, fontSize:15, fontWeight:700 }}>{title}</div>
        {detail ? (
          <>
            <div style={{ marginTop:8, color:'var(--text-dim)', fontSize:13, lineHeight:1.6 }}>{detail}</div>
            <div dir="rtl" style={{ marginTop:6, color:'var(--text-dim)', fontSize:13, lineHeight:1.6 }}>
              اللينك لسه محفوظ هنا. جرّب تاني من غير ما تطلب لينك جديد.
            </div>
            <button type="button" onClick={onRetry} style={{ width:'100%', minHeight:48, marginTop:18, border:0,
              borderRadius:11, cursor:'pointer', background:'var(--action)', color:'#081019',
              fontFamily:'var(--font-display)', fontWeight:700 }}>
              ERNEUT VERSUCHEN · جرّب تاني
            </button>
          </>
        ) : <div dir="rtl" style={{ marginTop:6, color:'var(--text-dim)', fontSize:13 }}>بنأكد الإيميل…</div>}
      </div>
    </div>
  );
}

function EmailVerificationGate({ auth, onLogout, linkState = null }) {
  const [state, setState] = useState('idle');
  const resend = async () => {
    if (state === 'sending') return;
    setState('sending');
    try {
      const r = await fetch(`${API_URL}/api/auth/verification/resend`, {
        method:'POST', headers:{ Authorization:`Bearer ${auth.token}` },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setState(d?.error === 'email_unavailable' ? 'unavailable' : 'error'); return; }
      setState(d?.cooldown ? 'cooldown' : 'sent');
    } catch { setState('error'); }
  };
  const message = state === 'sent' ? 'Neuer Link gesendet. Bitte Posteingang und Spam prüfen.'
    : state === 'cooldown' ? 'Ein Link wurde gerade schon vorbereitet. Bitte Posteingang und Spam prüfen.'
    : state === 'unavailable' ? 'E-Mail-Versand ist gerade nicht verfügbar. Bitte später erneut versuchen.'
    : state === 'error' ? 'Senden fehlgeschlagen. Bitte gleich erneut versuchen.' : null;
  return (
    <div style={{ minHeight:'100svh', display:'grid', placeItems:'center', padding:24, background:'var(--bg)', color:'var(--text)' }}>
      <div style={{ width:'100%', maxWidth:440, padding:26, textAlign:'center', borderRadius:'var(--r-xl)',
        background:'var(--glass)', border:'var(--glass-border)', boxShadow:'var(--e3)' }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:700, letterSpacing:'0.06em', color:'var(--accent)' }}>OMNI-PERFORM</div>
        <h1 style={{ margin:'18px 0 8px', fontSize:22 }}>E-Mail bestätigen</h1>
        <div style={{ color:'var(--text-dim)', fontSize:13, lineHeight:1.65 }}>
          Öffne den Bestätigungslink für <b style={{ color:'var(--text)', overflowWrap:'anywhere' }}>{auth.account.email}</b>.
          Erst danach wird dein gesamtes Training freigeschaltet.
        </div>
        <div dir="rtl" style={{ marginTop:8, color:'var(--text-dim)', fontSize:13, lineHeight:1.65 }}>
          افتح لينك التأكيد اللي اتبعت على إيميلك. كل التدريب بيفتح بعد التأكيد.
        </div>
        {linkState === 'invalid' && <div style={{ marginTop:13, color:'#fecaca', fontSize:12 }}>Der Link ist abgelaufen oder wurde bereits benutzt — fordere unten einen neuen an.</div>}
        {message && <div role="status" style={{ marginTop:13, color:state === 'error' || state === 'unavailable' ? '#fecaca' : '#bbf7d0', fontSize:12 }}>{message}</div>}
        <button type="button" onClick={resend} disabled={state === 'sending'} style={{ width:'100%', minHeight:50, marginTop:18,
          border:0, borderRadius:11, cursor:state === 'sending'?'wait':'pointer', background:'var(--action)', color:'#081019',
          fontFamily:'var(--font-display)', fontWeight:700, opacity:state === 'sending'?0.65:1 }}>
          {state === 'sending' ? 'Wird gesendet…' : 'NEUEN LINK SENDEN'}
        </button>
        <button type="button" onClick={onLogout} style={{ marginTop:12, padding:8, border:0, background:'transparent',
          color:'var(--text-dim)', textDecoration:'underline', cursor:'pointer' }}>Andere E-Mail verwenden / Abmelden</button>
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
// Outcome-first (value-prop law): every bullet says what it does FOR THE JOB GOAL, not which
// feature it is. Honest — each line describes something the app verifiably does today.
// ── WhatsApp opt-in — the app's ONLY $0 re-engagement channel (no email infra, no push).
// Shown on the home AFTER interview #1 (the learner has just experienced the personal
// diagnosis, so the value exchange is real), max 2 asks ever, dismissible, hidden forever
// once saved (the server flag hides it on other devices too). The "persönlich vom Coach,
// kein Spam" promise is honest by construction: the owner messages by hand — nothing sends
// automatically anywhere.
function WhatsAppOptIn({ token, apiUrl }) {
  const [state, setState] = useState('idle');   // idle | saving | saved | error
  const [num, setNum] = useState('');
  const [visible, setVisible] = useState(() => {
    try {
      if (localStorage.getItem('bpo_wa_done')) return false;
      return Number(localStorage.getItem('bpo_wa_asks') || 0) < 2;
    } catch { return false; }
  });
  const shownRef = useRef(false);
  useEffect(() => {
    if (!visible || shownRef.current) return;
    shownRef.current = true;
    try { localStorage.setItem('bpo_wa_asks', String(Number(localStorage.getItem('bpo_wa_asks') || 0) + 1)); } catch { /* ok */ }
    beacon('whatsapp_prompt_shown');
  }, [visible]);
  if (!visible) return null;
  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      const r = await fetch(`${apiUrl}/api/auth/whatsapp`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ number: num }) });
      if (!r.ok) { setState('error'); return; }
      try { localStorage.setItem('bpo_wa_done', '1'); } catch { /* ok */ }
      beacon('whatsapp_saved');
      setState('saved');
      setTimeout(() => setVisible(false), 2500);
    } catch { setState('error'); }
  };
  return (
    <div style={{ marginTop: 14, borderRadius: 'var(--r-lg)', padding: '14px', background: 'var(--glass)',
      border: 'var(--glass-border)', boxShadow: 'var(--e1), var(--glass-highlight)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="messageCheck" size={18} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--fs-h2)', color: 'var(--text)' }}>
          Coach-Erinnerung per WhatsApp
        </span>
      </div>
      {state === 'saved' ? (
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--accent-2)' }}>✓ Gespeichert — bis bald!{/* OWNER-AR slot */}</div>
      ) : (<>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>
          Dein Interviewer führt deine Akte. Hinterlass deine Nummer und der Coach erinnert dich persönlich,
          wenn dein nächster gezielter Test bereit ist. Kein Spam — jederzeit stopp.{/* OWNER-AR slot */}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={num} onChange={(e) => setNum(e.target.value)} type="tel" inputMode="tel"
            placeholder="01X XXX XXXXX"
            style={{ flex: 1, minWidth: 0, minHeight: 44, padding: '10px 12px', borderRadius: 'var(--r-md)',
              background: 'rgba(2,6,23,0.5)', border: '1px solid var(--line)', color: 'var(--text)', fontSize: 15 }} />
          <button onClick={save} disabled={state === 'saving'} style={{ minHeight: 44, padding: '0 16px', cursor: 'pointer',
            borderRadius: 'var(--r-md)', border: '1px solid var(--accent)', color: 'var(--accent-2)',
            background: 'rgba(59,130,246,0.12)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12 }}>
            {state === 'saving' ? '…' : 'SPEICHERN'}
          </button>
        </div>
        {state === 'error' && (
          <div style={{ fontSize: 'var(--fs-meta)', color: '#fca5a5', marginTop: 6 }}>
            Nummer prüfen (z. B. 01012345678) und nochmal versuchen.{/* OWNER-AR slot */}
          </div>
        )}
        <button onClick={() => setVisible(false)} style={{ marginTop: 6, minHeight: 44, width: '100%', background: 'none',
          border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 'var(--fs-meta)', fontFamily: 'var(--font-body)' }}>
          Später{/* OWNER-AR slot */}
        </button>
      </>)}
    </div>
  );
}

// Perks receive the whole plan object (07-11 quota redesign: plans are sold as FULL daily
// interviews, not minutes — p.dailySessions is the number a buyer actually gets).
const PERKS_DE = {
  basic: (p) => [`${p.dailySessions} vollständige, realistische KI-HR-Interview-Simulationen pro Tag — mit Stimme (${p.dailyLiveMinutes} Min Live-Übung täglich)`,
                 'unbegrenzte Drills — auf DEINE Fehler zugeschnitten, nicht generisch',
                 'die App führt dich: Diagnose → EIN Training → Beweis im Interview',
                 'dein Interviewer kennt deine Akte und testet deine Schwachstelle erneut',
                 'Szenarien nach echten deutschen Konto-Typen (Mobilfunk, Bank, Airline …)',
                 'Feedback auch auf Arabisch — du verstehst genau, was zu tun ist'],
  // Adversarial audit #2 (2026-07-10): "Gegner passend zu DEINER Ziel-Stelle" was a PHANTOM —
  // then BUILT for real the same day (owner order): scenarios.js pickCsScenario + BEWERBUNGSZIEL
  // framing, entitlement-gated (plans.config zielStelle). The perk is TRUE again.
  // Musk-cull (same day): the replacement perk "das komplette Trainingslager" was ITSELF a phantom —
  // the Trainingslager UI was deleted in a92c9ec; its server engine has zero client consumers.
  // Perk law: every line here must name a mechanism a buyer can reach (perk-truth-pinning memory).
  elite: (p) => [`${p.dailySessions} vollständige, realistische KI-HR-Interview-Simulationen pro Tag — doppelt so viel Übung wie Basic (${p.dailyLiveMinutes} Min täglich)`,
                 'Interviews passend zu DEINER Ziel-Stelle — Szenarien aus deiner Branche',
                 'monatliche Neu-Einstufung — dein Fortschritt schwarz auf weiß',
                 'trainiert die echte QA-Latte: Datenschutz-Verifizierung & Gesprächsabschluss',
                 'alles aus Basic'],
  // 'job' (Bis zum Job one-time plan): owner-vetoed 2026-07-10 evening — plan deleted server-side
  // (plans.config.js); its perks/sub-lines die with it (phantom-perk law: no copy without a plan).
};
const SUB_AR = {
  basic: (m) => `لحد ${m} دقايق إنترفيو مباشر كل يوم + تمارين بلا حدود متفصّلة على أخطائك.`,
  elite: (m) => `لحد ${m} دقيقة إنترفيو مباشر كل يوم + كل مزايا Basic + إعادة تقييم شهرية + خصم مخصص.`,
};

function paywallSalmaKey(info, trialEnded) {
  if (info?.trial?.active) return 'paywall_trial_active';
  if (trialEnded || info?.trial) return 'paywall_trial_over';
  return 'paywall_free_file';
}

function PaywallScreen({ token, info, onUpgraded, onPaymentPending, onClose, lang = 'de' }) {
  const [email, setEmail]   = useState('');
  const [plans, setPlans]   = useState(null);
  const [offer, setOffer]   = useState(null);   // { active, pct, endsAt, label } from server, or null
  const [yearly, setYearly] = useState(false);
  const [vodafone, setVodafone] = useState(null);
  const [paymentAvailable, setPaymentAvailable] = useState(null);
  const [whatsapp, setWhatsapp] = useState(null);
  useEffect(() => { beacon('paywall_shown'); }, []);   // funnel: how many people ever SEE a price
  useEffect(() => {
    if (lang === 'ar' || !token) return undefined;
    const key = paywallSalmaKey(info, false);
    const text = salmaLine(key, 'de', { days: info?.trial?.daysLeft ?? 0 });
    const stop = playNative({ apiUrl: API_URL, token, text, voice: SALMA_NATIVE_VOICE });
    return () => { try { stop?.(); } catch { /* native voice fails silently */ } };
  }, [lang, token, info]);
  const [pay, setPay]       = useState(null);   // { planId, label, amountEGP, period } | chosen plan to pay
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [pendingPayment, setPendingPayment] = useState(null); // server source of truth
  const [paymentRejected, setPaymentRejected] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [copied, setCopied] = useState('');
  const [senderLast4, setSenderLast4] = useState('');
  const paymentWatchRef = useRef(false);
  const blockedAccessRef = useRef(info?.allowed === false);
  const [trialEnded, setTrialEnded] = useState(false);   // had a time-limited plan that has now lapsed
  const refreshBillingStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const d = await r.json();
      setBillingError('');
      setEmail(d.account?.email || '');
      if (Array.isArray(d.plans)) setPlans(d.plans);
      setOffer(d.offer?.active ? d.offer : null);   // deal shows ONLY when the server honors it
      setVodafone(d.vodafoneNumber || null);
      setPaymentAvailable(d.paymentAvailable === undefined
        ? !!d.vodafoneNumber
        : !!d.paymentAvailable && !!d.vodafoneNumber);
      setWhatsapp(d.whatsappNumber || null);
      setPendingPayment(d.pendingPayment || null); setPaymentRejected(!!d.paymentRejected);
      if (d.pendingPayment) paymentWatchRef.current = true;
      if (!d.pendingPayment && d.paymentIntent) {
        setPay({ ...d.paymentIntent, planId: d.paymentIntent.plan, period: d.paymentIntent.billingPeriod,
          label: String(d.paymentIntent.plan || '').toUpperCase() });
      }
      if (d.paymentRejected) {
        paymentWatchRef.current = false;
        setSubmitted(false);
        setPay(null);
      }
      // "Your free trial ended" — true when a non-comp, time-limited plan (e.g. the 2-day Basic
      // pass) has passed its billing end. Drives the honest expiry banner below.
      const s = d.account?.subscription;
      setTrialEnded(!!(s && s.plan && s.billingPeriodEnd && s.billingPeriodEnd < Date.now() && !s.comp));
      if ((paymentWatchRef.current || blockedAccessRef.current) && d.account?.entitlement?.allowed && !d.pendingPayment) {
        paymentWatchRef.current = false;
        blockedAccessRef.current = false;
        onUpgraded?.(d.account);
      }
      return d;
    } catch {
      setBillingError('Die Zahlungsdaten konnten nicht geladen werden. Bitte erneut versuchen.');
      return null;
    }
  }, [token, onUpgraded]);
  useEffect(() => { refreshBillingStatus(); }, [refreshBillingStatus]);

  const shouldPollPayment = submitted || !!pendingPayment;
  useEffect(() => {
    if (!shouldPollPayment) return undefined;
    const refresh = () => { refreshBillingStatus(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, 25_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    refresh();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shouldPollPayment, refreshBillingStatus]);

  const ar  = lang === 'ar';
  const fmt = (n) => Number(n || 0).toLocaleString('de-DE');   // 1299 → "1.299"
  // Internal support reference. Vodafone Cash has no transfer-note field, so matching uses sender last four digits.
  const refCode = pay?.referenceCode || pendingPayment?.referenceCode || '------';

  const preparePayment = async (choice) => {
    if (submitting) return;
    if (paymentAvailable !== true || !vodafone) {
      setPaymentError(ar ? 'الدفع غير متاح حاليًا. ما تحوّلش أي مبلغ.' : 'Zahlung ist gerade nicht verfügbar. Bitte nichts überweisen.');
      return;
    }
    setSubmitting(true); setPaymentError('');
    try {
      const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const r = await fetch(`${API_URL}/api/billing/intent`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}`, 'Idempotency-Key':idempotencyKey },
        body:JSON.stringify({ plan:choice.planId, billingPeriod:choice.period }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.intentId || !d.referenceCode) throw new Error(d.error || `intent ${r.status}`);
      setPay({ ...choice, ...d });
    } catch {
      setPaymentError(ar ? 'تعذر تجهيز الدفع. ما تحوّلش أي مبلغ وحاول تاني.' : 'Zahlung konnte nicht vorbereitet werden. Bitte noch nichts überweisen und erneut versuchen.');
    }
    setSubmitting(false);
  };

  // Post-payment "send proof" actions: copy the reference code, and (if a WhatsApp number is
  // configured) one-tap open WhatsApp prefilled with the code so the customer isn't stranded
  // during the manual-activation wait. Copy works always; the WhatsApp button appears once
  // WHATSAPP_NUMBER is set on the server. Reduces the post-payment black-box anxiety.
  const copyText = async (value, kind) => {
    const text = String(value || '');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        if (!document.execCommand('copy')) throw new Error('copy_failed');
        ta.remove();
      }
      setCopied(kind); setTimeout(() => setCopied(''), 1500);
    } catch {
      setPaymentError(ar ? 'النسخ التلقائي مش متاح. حدّد الرقم وانسخه يدويًا.' : 'Automatisches Kopieren ist nicht verfügbar. Bitte manuell markieren und kopieren.');
    }
  };
  const waLink = (code) => {
    // wa.me needs full international digits — an Egyptian local "01009…" (leading 0, no +20)
    // produces an invalid link, so normalize the leading 0 to the 20 country code.
    const digits = (whatsapp ? String(whatsapp).replace(/\D/g, '') : '').replace(/^0/, '20');
    if (!digits) return null;
    const planLabel = pay?.label || (pendingPayment?.plan ? pendingPayment.plan.toUpperCase() : '');
    const msg = ar
      ? `أهلاً، دفعت اشتراك OMNI-PERFORM ${planLabel}. رقم الطلب: ${code}${senderLast4 ? `، آخر ٤ أرقام من محفظتي: ${senderLast4}` : ''}`
      : `Hallo, ich habe für OMNI-PERFORM ${planLabel} bezahlt. Vorgang: ${code}${senderLast4 ? `, letzte 4 Ziffern meiner Wallet: ${senderLast4}` : ''}`;
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
      <button onClick={() => copyText(code, 'code')}
        style={{ width:'100%', padding:'11px', minHeight:44, cursor:'pointer', fontFamily:'var(--font-display)', fontSize:11,
          borderRadius:8, border:'1px dashed var(--action)', background:'rgba(249,115,22,0.08)', color:'var(--action)' }}>
        {copied === 'code' ? (ar ? 'تم نسخ رقم الطلب ✓' : 'Vorgang kopiert ✓') : (ar ? `انسخ رقم الطلب · ${code}` : `Vorgang kopieren · ${code}`)}
      </button>
    </div>
  );

  // Tap "I paid": record a PENDING request. Grants NO access — the owner verifies & activates.
  const onPaid = async () => {
    if (submitting || !pay) return;
    if (!/^\d{4}$/.test(senderLast4)) {
      setPaymentError(ar ? 'اكتب آخر ٤ أرقام من رقم المحفظة اللي حوّلت منها.' : 'Bitte die letzten 4 Ziffern der sendenden Wallet eingeben.');
      return;
    }
    setSubmitting(true); setPaymentError('');
    try {
      const r = await fetch(`${API_URL}/api/billing/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ intentId: pay.intentId, senderLast4 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `pay ${r.status}`);
      paymentWatchRef.current = true;
      setSubmitted(true);
      onPaymentPending?.();
    } catch { setPaymentError(ar ? 'ما قدرناش نثبت طلبك. حاول تاني — متحوّلش المبلغ مرة تانية.' : 'Deine Bestätigung wurde nicht gespeichert. Bitte erneut versuchen — nicht erneut überweisen.'); }
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
          تم استلام طلبك ✅ — التفعيل بيتم يدويًا بعد مطابقة المبلغ وآخر ٤ أرقام من محفظتك، وعادة خلال ساعتين في مواعيد العمل. رقم الطلب: <b style={{ color:'var(--action)' }}>{refCode}</b>.
        </div>
        <div style={{ fontSize:12.5, color:'#cbd5e1', marginTop:14, lineHeight:1.65 }}>
          Anfrage erhalten! Wir gleichen Betrag und Wallet-Endziffern manuell ab. Während der Geschäftszeiten erfolgt die Aktivierung normalerweise innerhalb von zwei Stunden. Vorgang: <b style={{ color:'var(--action)' }}>{refCode}</b>.
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
          {pay.label?.toUpperCase()} — <b>{fmt(pay.amountEGP)} EGP</b> {pay.period === 'once' ? (ar?'مرة واحدة':'einmalig') : pay.period === 'yearly' ? (ar?'سنويًا':'/Jahr') : (ar?'شهريًا':'/Monat')}
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
            <button type="button" onClick={() => copyText(vodafone, 'wallet')}
              style={{ width:'100%', marginTop:7, padding:'9px', minHeight:42, cursor:'pointer', borderRadius:8,
                border:'1px solid rgba(96,165,250,0.35)', background:'rgba(96,165,250,0.08)', color:'var(--accent-2)', fontWeight:700 }}>
              {copied === 'wallet' ? (ar ? 'تم نسخ الرقم ✓' : 'Nummer kopiert ✓') : (ar ? 'انسخ رقم المحفظة' : 'Wallet-Nummer kopieren')}
            </button>
          </div>

          {/* Step 2 — payer identity; Vodafone Cash has no transfer-note field. */}
          <div style={{ borderRadius:10, padding:'12px 13px', marginBottom:10, background:'rgba(249,115,22,0.07)', border:'1px solid rgba(249,115,22,0.4)' }}>
            <div style={{ fontSize:11.5, color:'#e2e8f0', lineHeight:1.5 }}>
              <b style={{ color:'var(--action)' }}>2)</b> Gib die letzten 4 Ziffern der Wallet ein, von der du sendest:
            </div>
            <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:3 }}>اكتب آخر ٤ أرقام من رقم المحفظة اللي هتحوّل منها:</div>
            <input value={senderLast4} onChange={(e) => setSenderLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric" autoComplete="off" maxLength={4} aria-label="Letzte 4 Ziffern der sendenden Wallet"
              placeholder="••••" style={{ width:'100%', boxSizing:'border-box', textAlign:'center', fontFamily:'Share Tech Mono, monospace',
                fontSize:26, fontWeight:900, color:'var(--action)', background:'rgba(0,0,0,0.4)', border:'1px dashed var(--action)',
                borderRadius:8, padding:'10px', marginTop:8, letterSpacing:'0.25em' }} />
            <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:7, lineHeight:1.5 }}>
              Vorgangsnummer: <b style={{ color:'var(--action)' }}>{refCode}</b> · رقم الطلب للدعم فقط، مش بيتكتب في التحويل.
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ fontSize:11.5, color:'#cbd5e1', lineHeight:1.6, marginBottom:6 }}>
            <b style={{ color:'var(--accent)' }}>3)</b> Tippe danach unten auf «Ich habe bezahlt».
            <br /><span dir="rtl">وبعد ما تحوّل، دوس تحت على «دفعت».</span>
          </div>

          {/* TRUST at the money moment: the buyer is sending cash to a bare number — give it a
              face, a receipt promise, and the guarantee that already exists on /refund.html.
              Every claim here is as-built (manual founder verification, live refund policy). */}
          <div style={{ borderRadius:10, padding:'11px 13px', marginBottom:6, background:'rgba(59,130,246,0.07)',
            border:'1px solid rgba(59,130,246,0.3)', fontSize:11.5, color:'#cbd5e1', lineHeight:1.65 }}>
            Du zahlst direkt an <b>Alhassan</b>, den Gründer — kein Zwischenhändler. Du bekommst eine
            Bestätigung per WhatsApp, und es gilt die <a href="/refund.html" target="_blank" rel="noopener noreferrer"
            style={{ color:'var(--accent-2)' }}>14-Tage-Geld-zurück-Garantie auf den ersten Kauf</a>.{/* OWNER-AR slot */}
          </div>

          {/* "I paid" → records a PENDING request (verify-first). Grants NO access. */}
          <button onClick={onPaid} disabled={submitting || !/^\d{4}$/.test(senderLast4)}
            style={{ width:'100%', marginTop:8, padding:'13px', minHeight:48, cursor: submitting ? 'wait' : 'pointer', fontFamily:'var(--font-display)',
              fontSize:12, letterSpacing:'0.08em', borderRadius:9, fontWeight:700, border:'1px solid var(--accent)', color:'#04130c',
              background:'linear-gradient(135deg,var(--accent),var(--accent))', opacity: (submitting || !/^\d{4}$/.test(senderLast4)) ? 0.5 : 1 }}>
            {submitting ? '…' : 'دفعت · ICH HABE BEZAHLT'}
          </button>
          {paymentError && <div role="alert" style={{ marginTop:10, color:'#fca5a5', fontSize:12, lineHeight:1.5 }}>{paymentError}</div>}
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
          طلبك وصلنا ✅ وبنتأكد من الدفع — التفعيل عادة خلال ساعتين في مواعيد العمل. الكود بتاعك: <b style={{ color:'var(--action)' }}>{code}</b>.
        </div>
        <div style={{ fontSize:12.5, color:'#94a3b8', marginTop:14, lineHeight:1.65 }}>
          Deine Anfrage ist da ✅ — wir prüfen die Zahlung manuell. Während der Geschäftszeiten erfolgt die Aktivierung normalerweise innerhalb von zwei Stunden. Code: <b style={{ color:'var(--action)' }}>{code}</b>.
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
        {/* was a 🥊 emoji — emoji is never chrome (design law); Icon renders in the accent like everywhere else */}
        <div style={{ marginBottom:6, color:'var(--accent)' }}><Icon name="fileBadge" size={30} /></div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:900, letterSpacing:2,
          color:'var(--action)', textShadow:'0 0 18px rgba(249,115,22,0.5)' }}>PLAN WÄHLEN · اختار خطتك</div>
        {/* Outcome first (value-prop law): the buyer pays for the JOB, not for features. */}
        <div style={{ fontSize:12.5, color:'#e2e8f0', marginTop:6, lineHeight:1.6, fontWeight:600 }}>
          Ein Ziel: dass du dein echtes Interview bestehst.{/* OWNER-AR slot */}
        </div>
        <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:4, lineHeight:1.6 }}>
          Beide Pläne: Live-Interview JEDEN TAG. Die kostenlose Einstufung bleibt immer frei.
          <br /><span dir="rtl">الخطتين: إنترفيو مباشر كل يوم. تقييم المستوى المجاني دايمًا متاح.</span>
        </div>
      </div>

      {/* Salma fronts the money moment — one honest recruiter line picked deterministically from
          the entitlement (trial running / trial over / free file). Neutral blue; the pay CTA and
          expiry banner keep the paywall's orange. */}
      {(() => {
        const key = paywallSalmaKey(info, trialEnded);
        const text = salmaLine(key, lang, { days: info?.trial?.daysLeft ?? 0 });
        return (
          <div style={{ display:'flex', gap:9, alignItems:'flex-start', marginBottom:12, padding:'10px 12px',
            borderRadius:10, background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.25)' }}>
            <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center',
              justifyContent:'center', fontWeight:800, fontSize:13, color:'#dbeafe',
              background:'rgba(59,130,246,0.16)', border:'1.5px solid rgba(59,130,246,0.55)' }}>
              {salmaName(lang).charAt(0)}
            </div>
            <div style={{ textAlign:'left' }}>
              <div style={{ fontSize:10, color:'#94a3b8', letterSpacing:'0.05em' }}>{salmaName(lang)} · {salmaRole(lang)}</div>
              <div dir="auto" style={{ fontSize:12, color:'#e2e8f0', lineHeight:1.6, marginTop:3 }}>{text}</div>
            </div>
          </div>
        );
      })()}

      {/* Expiry alert — shown the moment a lapsed-trial user (e.g. the 2-day Basic pass) hits the
          paywall: the honest "pay or lose" moment. Action-colored (single accent on the paywall). */}
      {trialEnded && (
        <div style={{ marginBottom:12, padding:'11px 13px', borderRadius:10, textAlign:'center',
          background:'linear-gradient(135deg, rgba(249,115,22,0.16), rgba(249,115,22,0.05))', border:'1px solid var(--action)' }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:13.5, color:'var(--action)' }}>
            Deine kostenlose Testphase ist vorbei
          </div>
          <div style={{ fontSize:11, color:'#e2e8f0', marginTop:4, lineHeight:1.55 }}>
            Zahle, um weiter für dein echtes Interview zu trainieren.<br/>
            <span style={{ color:'#94a3b8' }}>Your free trial ended — pay to keep training.</span>
            {/* OWNER-AR slot: "خلصت الفترة المجانية — ادفع علشان تكمّل تدريب" */}
          </div>
        </div>
      )}

      {paymentRejected && (
        <div style={{ fontSize:10.5, color:'#fca5a5', textAlign:'center', lineHeight:1.6, marginBottom:10,
          background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'8px 10px' }}>
          Zahlung konnte nicht bestätigt werden — bitte versuche es erneut.
          <br /><span dir="rtl">لم نتمكن من تأكيد الدفع — حاول مرة أخرى.</span>
        </div>
      )}

      {paymentAvailable === false && (
        <div role="status" style={{ fontSize:10.5, color:'var(--action)', textAlign:'center', lineHeight:1.6, marginBottom:10,
          background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.35)', borderRadius:8, padding:'9px 11px' }}>
          Zahlung ist vorübergehend nicht verfügbar — bitte nichts überweisen.
          <br /><span dir="rtl">الدفع غير متاح حاليًا — ما تحوّلش أي مبلغ.</span>
        </div>
      )}

      {/* limited-time offer banner — rendered ONLY when the server reports the offer active, so the
          ad can never outlive the actual discounted price. German copy; Arabic is an OWNER-AR slot. */}
      {offer?.active && (() => {
        const ends     = new Date(offer.endsAt);
        const endsTxt  = ends.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' });
        const daysLeft = Math.max(1, Math.ceil((offer.endsAt - Date.now()) / 86400000));
        return (
          <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, textAlign:'center',
            background:'linear-gradient(135deg, rgba(249,115,22,0.18), rgba(249,115,22,0.05))',
            border:'1px solid var(--action)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontWeight:900, fontSize:14, letterSpacing:'0.04em', color:'var(--action)' }}>
              🔥 {offer.pct}% RABATT · {offer.label}
            </div>
            <div style={{ fontSize:11, color:'#e2e8f0', marginTop:3 }}>
              Nur noch {daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'} — endet {endsTxt}.
            </div>
          </div>
        );
      })()}

      {/* monthly / yearly toggle */}
      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {toggleBtn(false, ar ? 'شهري' : 'MONATLICH')}
        {toggleBtn(true, ar ? 'سنوي' : 'JÄHRLICH', ar ? 'شهرين هدية' : '2 Monate geschenkt')}
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:11 }}>
        {(plans || []).map((p) => {
          const on     = !!offer?.active;   // discounted prices come from the server (offerPriceEGP)
          const once   = !!p.once;          // one-time plan: no monthly/yearly toggle, pay once
          const base   = (yearly && !once) ? p.yearlyEGP : p.priceEGP;
          const price  = on ? ((yearly && !once) ? (p.offerYearlyEGP ?? base) : (p.offerPriceEGP ?? base)) : base;
          const period = once ? (ar ? 'مرة واحدة' : 'einmalig') : yearly ? (ar ? '/سنة' : '/Jahr') : (ar ? '/شهر' : '/Monat');
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
                <span style={{ fontSize:14, color:'#e2e8f0', fontWeight:700, display:'inline-flex', alignItems:'baseline', gap:6 }}>
                  {on && <span style={{ fontSize:11, fontWeight:600, color:'#64748b', textDecoration:'line-through' }}>{fmt(base)}</span>}
                  <span style={{ color: on ? 'var(--good)' : '#e2e8f0' }}>{fmt(price)} EGP</span>
                  <span style={{ fontSize:10, color:'#94a3b8' }}>{period}</span>
                </span>
              </div>
              {yearly && !once && (
                <div style={{ fontSize:9.5, color:'var(--accent)', marginBottom:7 }}>
                  {ar ? `شهرين هدية · وفّر ${fmt(saving)} جنيه` : `2 Monate geschenkt · spare ${fmt(saving)} EGP`}
                </div>
              )}
              {once && (
                <div style={{ fontSize:9.5, color:'var(--accent)', marginBottom:7 }}>
                  {ar ? '' : 'Einmal zahlen — 12 Monate trainieren. Kein Abo.'}{/* OWNER-AR slot */}
                </div>
              )}
              {(PERKS_DE[p.id]?.(p) || []).map((perk) => (
                <div key={perk} style={{ fontSize:11, color:'#cbd5e1', marginBottom:3 }}>✓ {perk}</div>
              ))}
              <div dir="rtl" style={{ fontSize:10.5, color:'#94a3b8', marginTop:6, lineHeight:1.6 }}>{SUB_AR[p.id]?.(p.dailyLiveMinutes)}</div>
              <button disabled={submitting || paymentAvailable !== true}
                onClick={() => preparePayment({ planId: p.id, label: p.label, amountEGP: price, period: once ? 'once' : yearly ? 'yearly' : 'monthly' })}
                style={{ width:'100%', marginTop:11, padding:'12px', minHeight:46, cursor:submitting?'wait':paymentAvailable===true?'pointer':'not-allowed',
                  fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.1em', borderRadius:8, fontWeight:700,
                  border:`1px solid ${accent}`, color:'#04070d', background:accent,
                  opacity:(submitting || paymentAvailable !== true) ? 0.45 : 1 }}>
                {paymentAvailable === false
                  ? (ar ? 'الدفع غير متاح حاليًا' : 'ZAHLUNG DERZEIT NICHT VERFÜGBAR')
                  : `${p.label?.toUpperCase()} ${ar ? 'اختار' : 'WÄHLEN'} ▸`}
              </button>
            </div>
          );
        })}
        {!plans && !billingError && <div role="status" aria-live="polite" style={{ textAlign:'center', color:'#64748b', fontSize:11, padding:20 }}>…</div>}
        {billingError && <div role="alert" style={{ textAlign:'center', color:'#fca5a5', fontSize:12, padding:14 }}>{billingError}</div>}
        {paymentError && <div role="alert" style={{ textAlign:'center', color:'#fca5a5', fontSize:12, padding:14 }}>{paymentError}</div>}

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
  const waDigits = (whatsapp ? String(whatsapp).replace(/\D/g, '') : '').replace(/^0/, '20');   // wa.me needs intl format, not the local leading-0
  const waLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent((ar ? 'كود الدفع: ' : 'Zahlungs-Code: ') + code)}` : null;
  return (
    <div onClick={() => setOpen((o) => !o)} style={{ marginBottom: 8, padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
      background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.4)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--action)', lineHeight: 1.5, textAlign: 'center' }}>
        {ar ? 'اشتراكك قيد التأكيد ⏳ — التفعيل عادة خلال ساعتين في مواعيد العمل' : 'Zahlung wird geprüft — meist innerhalb von 2 Stunden während der Geschäftszeiten'}
        <span style={{ color: '#94a3b8' }}> {open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 8, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 9.5, color: '#94a3b8', lineHeight: 1.5 }}>
            {ar ? 'كود الدعم — ما تكتبوش في تحويل فودافون كاش؛ ابعته مع إثبات الدفع' : 'Support-Code — NICHT in die Vodafone-Cash-Überweisung schreiben; mit dem Beleg senden'}
          </div>
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
  const [lastTurnLatencyMs, setLastTurnLatencyMs] = useState(null);   // display-only: measured stop→boss-voice gap
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
  const [typeOpen, setTypeOpen]       = useState(IN_APP_BROWSER);  // social browsers begin on the reliable typed path
  const [bossThinking, setBossThinking] = useState(false); // waiting for the boss's next turn
  const [recording, setRecording]     = useState(false);   // mic clip in progress
  const [transcribing, setTranscribing] = useState(false); // clip → text in flight
  const [error, setError]         = useState(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [scoreFlash, setScoreFlash] = useState(null);
  const [screenFlash, setScreenFlash] = useState(null); // 'green' | 'red' | null
  const [bossHurt, setBossHurt]   = useState(false);
  const [shakeScreen, setShakeScreen] = useState(false);
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
  // First-run: a brand-new user (never started an interview, no streak, no result yet) gets a
  // deliberately BARE home — hero + ONE button — instead of the full 8-drill wall + mission + map +
  // footer. Everything reveals after their first interview. (owner: "make my app very simple to
  // navigate for a novel user.") Based on flicker-free signals only (localStorage flag + cached streak).
  const [seenInterview, setSeenInterview] = useState(() => { try { return localStorage.getItem('ff_interviewed') === '1'; } catch { return false; } });
  const [daily, setDaily]   = useState({ streak: 0, completedToday: false, streakShield: false, best: 0 }); // daily-training loop
  const [trainedToday, setTrainedToday] = useState(true); // any practice today? (drives loss-aversion line)
  const [rank, setRank]     = useState(null);              // interview-readiness rank ladder
  const [etaSessions, setEtaSessions] = useState(null);    // honest velocity: server-computed, null below the evidence floor (never a guess)
  const [hireReadiness, setHireReadiness] = useState(null); // honest "am I hireable + my one wall" verdict (server-computed), shown on the home
  const [dailyOpen, setDailyOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('daily') === '1'; }
    catch { return false; }
  });       // Tägliches Training overlay; notification deep-links open it directly
  const [dueReviews, setDueReviews] = useState(0);         // due SRS cards (home-screen CTA)
  const [totals, setTotals] = useState({});                // from /api/progress totals
  const [lastDebrief, setLastDebrief] = useState(null);    // unseen feedback from an interview whose debrief never reached the user (tab closed mid-fight)
  const [topWeakness, setTopWeakness] = useState(null);    // /api/progress topWeakness — Salma's home-card note
  const [pipeline, setPipeline] = useState(null);          // { currentBoss, nextBoss } — her bookings ladder
  const [rival, setRival] = useState(null);                // { key, slots } — the leaderboard rival note
  const [salma, setSalma] = useState(null);                // recruiter cold-open ctx | null (SalmaTakeover)
  const [salmaResume, setSalmaResume] = useState(0);       // bumped when the assessment closes → her flow resumes
  // Deep audit D10 (2026-07-10): the level was NEVER persisted (a B2 user restarted at slow A2–B1
  // German every visit) and "dein Niveau wird automatisch erkannt" had no mechanism behind it.
  // Now: a manual pick persists; with no manual pick, the assessment's MEASURED estimatedLevel
  // sets it (mount effect below) — the claim is finally true.
  const [level, setLevel]         = useState(() => { try { return ['a2-b1','b2','c1'].includes(localStorage.getItem('omni_level')) ? localStorage.getItem('omni_level') : 'a2-b1'; } catch { return 'a2-b1'; } });
  const [bossPick, setBossPick]   = useState('');          // boss-picker (test): '' = auto by level
  const [handsFree, setHandsFree] = useState(!IN_APP_BROWSER); // social in-app browsers cannot reliably own the microphone
  const [showOpts, setShowOpts]   = useState(false);       // idle home: advanced options (interviewer/freisprech/lang) collapsed by default — declutter
  const [liveTranscript, setLiveTranscript] = useState(''); // Deepgram streaming partial (cleared on transcript_done)
  const [funnel, setFunnel]       = useState(null);        // {stages, idx, levelLabel, displayName}
  const [debrief, setDebrief]     = useState(null);        // end-of-session feedback payload
  const [debriefPending, setDebriefPending] = useState(false);
  const [verdictHold, setVerdictHold] = useState(false);   // brief honest pause between analysis and reveal
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
  // WHY-YOU for a prescribed drill: set when the brain guide / debrief routes into a drill so the
  // drill opens with the honest personal reason it was prescribed; cleared when the drill closes
  // (grid-tile opens stay generic — no why is invented for them).
  const [drillWhy, setDrillWhy] = useState(null);
  const [csBriefing, setCsBriefing] = useState(null);         // {situation, skill, keyPhrases} — shown before boss speaks
  const [showBriefing, setShowBriefing] = useState(false);    // pre-fight briefing card visible
  // ── Gemini Live native-audio path (server opts this account in via SESSION_READY.useGeminiAudio) ──
  const [geminiMode, setGeminiMode] = useState(false);        // this interview runs on Gemini full-duplex voice
  const [geminiCost, setGeminiCost] = useState(null);         // { monthUsd, capUsd, capped } live spend readout

  // THE one first-mount decision point: who greets this user? Salma's cold-open (once per
  // account) owns the flow when eligible; otherwise the legacy behavior runs unchanged
  // (signup → auto-open the free assessment, flag set in AuthScreen). One effect owning BOTH
  // paths makes a double-open race structurally impossible.
  useEffect(() => {
    let pending = false;
    try { pending = localStorage.getItem('bpo_pending_assessment') === '1'; } catch {}
    if (pending) { try { localStorage.removeItem('bpo_pending_assessment'); } catch {} }
    let seenLocal = false;
    try { seenLocal = localStorage.getItem('omni_salma_seen') === '1'; } catch {}

    (async () => {
      let status = null;
      if (pending || (SALMA_LIVE && !seenLocal)) {
        try {
          const r = await fetch(`${API_URL}/api/assessment/status`, { headers: { Authorization: `Bearer ${auth.token}` } });
          status = await r.json();
        } catch { /* offline / cold start — fall through */ }
      }
      // D10 — with no manual pick stored, the assessment's MEASURED level drives the interview
      // level. A manual pick always outranks it. (Unchanged legacy behavior, both branches.)
      try {
        if (!localStorage.getItem('omni_level') && status?.result?.estimatedLevel) {
          const mapped = ASSESS_LEVEL_MAP[status.result.estimatedLevel];
          if (mapped) { levelRef.current = mapped; setLevel(mapped); }
        }
      } catch { /* private mode */ }

      if (SALMA_LIVE && !seenLocal && status) {
        // 2.5s cap: on a Render cold start this fetch would hang ~20s — fail OPEN to legacy
        // and let a later visit introduce her (the server flag makes it once-only anyway).
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 2500);
          const r = await fetch(`${API_URL}/api/guide/profile`, {
            headers: { Authorization: `Bearer ${auth.token}` }, signal: ctrl.signal });
          clearTimeout(timer);
          if (r.ok) {
            const profile = await r.json();
            if (!profile.salmaIntroAt) {
              setSalma({
                variant: (pending && !status.used) ? 'new' : 'returning',
                pending, used: !!status.used, result: status.result || null,
                profile, trialDays: auth.account?.entitlement?.trial?.active ? (auth.account.entitlement.trial.daysLeft ?? 0) : 0,
              });
              beacon('salma_intro_shown');
              return;   // Salma owns the flow — the legacy auto-open below must not also fire
            }
            try { localStorage.setItem('omni_salma_seen', '1'); } catch {}   // server says seen → stop asking
          }
        } catch { /* profile unreachable → legacy */ }
      }

      // LEGACY (unchanged): fresh signup → auto-open the free assessment once.
      if (pending && status && !status.used) { setAssessmentOpen(true); beacon('assessment_shown'); }
    })();
  }, []);   // once, on first mount after login/signup
  const [videoLessonsOpen, setVideoLessonsOpen] = useState(false);     // $0 video-lesson engine (animated slides + native TTS)

  const phaseRef       = useRef('idle');
  const startingRef    = useRef(false);     // synchronous single-flight guard for start()
  const levelRef       = useRef('a2-b1');   // read inside the WS handler when starting
  const bossPickRef    = useRef('');         // boss-picker selection, read when sending START_FIGHT
  const revancheRef    = useRef(null);       // one-shot lowest-answer rematch hint for the next fight
  const fightModeRef   = useRef('daily');   // always 'daily' — Boss-Tor mode was Musk-cut (no caller ever passed it)
  const volRef         = useRef(0);   // mic volume — a ref, NOT state (see WaveformRing)
  const wsRef          = useRef(null);
  const recorderRef    = useRef(null);
  const pingRef        = useRef(null);
  const verdictTimerRef = useRef(null);
  // Gemini native-audio path: a synchronous mode flag (read inside WS handlers), the PCM player for
  // the boss voice, the continuous mic recorder, and the accumulating boss-subtitle line.
  const geminiModeRef    = useRef(false);
  const geminiPlayerRef  = useRef(null);
  const geminiMicRef     = useRef(null);
  const geminiBossLineRef = useRef('');
  const geminiPendingTextRef = useRef('');   // transcript chunks held back until the boss's VOICE starts
  const geminiVoiceOnRef     = useRef(false); // this turn's first audio chunk has arrived (voice is audible)
  // Display-only turn-latency counter (diagnose the felt "4-5s"): adaptive mic-VAD on the volume signal.
  const micPeakRef       = useRef(0);     // decaying peak volume → scale-free speech/silence threshold
  const micSpeakingRef   = useRef(false); // candidate currently above the speech threshold
  const micBelowSinceRef = useRef(0);     // Date.now() the volume first dropped below threshold this dip
  const userStopMsRef    = useRef(0);     // Date.now() the candidate is judged to have STOPPED
  const geminiThinkTimerRef  = useRef(null);  // debounce: your transcript goes quiet → "CHEF DENKT NACH…"
  const partialIdRef   = useRef(null);
  const bossPartialIdRef = useRef(null);   // live boss subtitle line in the transcript
  const bossHasSpokenRef = useRef(false);  // has the interviewer delivered its FIRST line yet? The
                                           // auto-mic must NOT open before the opening plays, or the
                                           // opening bleeds into a live mic → VAD self-triggers → the
                                           // boss replies over its own greeting ("spoke over himself").
  const clipRecRef      = useRef(null);    // ClipRecorder for spoken answers
  const micStartedBeaconRef = useRef(false); // funnel: report 'mic_started' once per page load
  const bargeRef        = useRef(null);    // barge-in monitor (lets the user interrupt the boss; gated on BARGE_IN_LIVE)
  const livePartialRef  = useRef('');      // latest Deepgram partial — read by the adaptive VAD
  const stageIdxRef     = useRef(0);       // current funnel stage — 0/1 (intro+behavioral) = patient
  const pendingDurationRef = useRef(0);    // last clip duration (ms), for WPM; 0 if typed
  const bossLineRef      = useRef('');     // accumulates the current boss line
  const prevBossHpRef  = useRef(100);
  const prevPlayerHpRef = useRef(100);
  const prevIdxRef     = useRef(0);   // tracks the round index to detect advances

  const setPhaseSync = useCallback((p) => { phaseRef.current = p; setPhase(p); }, []);
  const chooseLevel  = useCallback((l) => {
    levelRef.current = l; setLevel(l);
    try { localStorage.setItem('omni_level', l); } catch { /* private mode */ }   // D10: a manual pick sticks across visits (and outranks auto-set)
    // Level-gate the interviewer: if the currently-picked boss outranks the new level, fall back to
    // Auto so a beginner can't start a fight against a locked (too-hard) persona. (owner: "why is a
    // C1 interviewer even an option for an A2/B1 user?")
    const order = ['a2-b1', 'b2', 'c1'];
    const MIN = { hana: 'b2', tarek: 'b2', 'frau-mona-adel': 'c1', lukas: 'c1' };
    const cur = bossPickRef.current;
    if (cur && MIN[cur] && order.indexOf(l) < order.indexOf(MIN[cur])) { bossPickRef.current = ''; setBossPick(''); }
  }, []);
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
  const startGeminiMic = useCallback(async () => {
    if (!geminiModeRef.current || geminiMicRef.current) return;
    try {
      const rec = new ClipRecorder({
        onVolume: (v) => {
          volRef.current = v;
          // ── Display-only latency measurement (does NOT touch the audio stream) ──────────────────
          // Detect when the candidate stops speaking. Skip while the boss voice is audible
          // (geminiVoiceOnRef) so her leaked speaker audio isn't misread as the candidate.
          if (geminiVoiceOnRef.current) { micSpeakingRef.current = false; micBelowSinceRef.current = 0; return; }
          const peak = micPeakRef.current = Math.max(micPeakRef.current * 0.99, v);
          const speaking = v > Math.max(0.03, peak * 0.28);   // 28% of decaying peak (getByteFrequencyData: silence≈0)
          if (speaking) { micBelowSinceRef.current = 0; micSpeakingRef.current = true; }
          else if (micSpeakingRef.current) {
            if (!micBelowSinceRef.current) micBelowSinceRef.current = Date.now();
            else if (Date.now() - micBelowSinceRef.current > 300) {   // 300ms below threshold = stopped
              micSpeakingRef.current = false;
              userStopMsRef.current = micBelowSinceRef.current;       // backdate to the true silence moment
              micBelowSinceRef.current = 0;
            }
          }
        },
        onChunk:  (b64) => { try { wsRef.current?.send(JSON.stringify({ type: C.AUDIO_CHUNK, data: b64 })); } catch { /* socket closing */ } },
      });
      await rec.start();
      // Teardown may have raced the await above (e.g. GEMINI_ENDED or session close while the mic
      // permission prompt was open) — geminiMicRef was still null then, so nothing stopped this
      // recorder. Never leave a mic streaming with no owner.
      if (!geminiModeRef.current) { try { await rec.stop(); } catch { /* already stopped */ } return; }
      geminiMicRef.current = rec;
      setRecording(true);
      setError(null);
      setHandsFree(true);
      setTypeOpen(false);
      if (!micStartedBeaconRef.current) { micStartedBeaconRef.current = true; beacon('mic_started'); }   // was only emitted on the $0 path — the funnel was blind to mic health on Gemini fights
    } catch (err) {
      beacon('mic_failed');
      setError(micErrorCode(err));
      setHandsFree(false);
      // A denied/transient permission prompt must NOT destroy the native Gemini persona session.
      // Keep the proxy/player alive and let the candidate grant permission and retry in place.
      // Text fallback is now an explicit user choice instead of an irreversible automatic downgrade.
      setTypeOpen(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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
    await startGeminiMic();
  }, [startGeminiMic]);

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
    if (geminiThinkTimerRef.current) { clearTimeout(geminiThinkTimerRef.current); geminiThinkTimerRef.current = null; }
    setBossThinking(false);   // never carry a Gemini "denkt nach" into the $0 fallback path
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
        if (msg.useGeminiAudio) { beacon('gemini_fight'); enterGeminiMode(); break; }
        setBossHp(msg.bossHp ?? 100);
        setPlayerHp(msg.playerHp ?? 100);
        setLiveWpm(0); setFillerCount(0); setCombo(0);   // fresh HUD for the new fight
        bossLineRef.current = '';
        setBossPlaybackRate(levelRef.current === 'a2-b1' ? 0.9 : 1.0);   // "Langsamer" now includes the AUDIO, not just the words
        wsRef.current?.send(JSON.stringify({
          type: C.START_FIGHT,
          token: auth.token,
          level: levelRef.current,
          mode: fightModeRef.current,
          bossId: bossPickRef.current || undefined,
          revanche: revancheRef.current || undefined,
          audioCapable: !IN_APP_BROWSER && checkAudioSupport().supported,
        }));
        revancheRef.current = null;
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
          bossId:      msg.bossId ?? '',   // drives the persona-true trait chip on the stage
        });
        // Pre-fight scenario briefing (shown while boss is loading, dismissed on first BOSS_SPEECH)
        if (msg.csBriefing) {
          setCsBriefing({ ...msg.csBriefing, scrutiny: msg.scrutiny || null,
            bossName: msg.displayName || '', bossId: msg.bossId || '' });
          setShowBriefing(true);
          setTimeout(() => setShowBriefing(false), 3_200);
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
          // Turn-taking patience scales with persona so DIFFICULTY ASCENDS from Yasmin up (owner 07-09:
          // "ascending from the least Yasmin, higher the higher the HR level"). RAISED 07-09 (700→1200)
          // AND now actually applied in the turn loop — previously this value was computed but never read,
          // so every persona cut the candidate off identically ("unsensibly aggressive at every level").
          // Yasmin (f=0.12) adds ~1.0s of extra grace; Tarek (f=0.9) adds ~0.06s. Even the most forceful
          // persona never grabs the floor inside a thinking pause — forcefulness shows in WORDS, not by
          // stealing the turn.
          bossPatienceRef.current = Math.round(Math.pow(1 - f, 1.3) * 1200);
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
        beacon('debrief_shown');   // funnel: a full interview reached its results screen
        if (verdictTimerRef.current) clearTimeout(verdictTimerRef.current);
        setVerdictHold(true);
        setDebriefPending(true);
        verdictTimerRef.current = setTimeout(() => {
          setDebrief(msg);
          setDebriefPending(false);
          setVerdictHold(false);
          verdictTimerRef.current = null;
        }, 800);
        if (Number.isFinite(msg.progress?.streak)) { setStreak(msg.progress.streak); saveStreakCache(msg.progress.streak); }
        if (typeof msg.progress?.trainedToday === 'boolean') setTrainedToday(msg.progress.trainedToday);
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
        setError(e => (e === 'realtime_error' ? null : e));   // boss replied → the transient error is stale (see BOSS_SPEECH_EARLY)
        if (!geminiModeRef.current || !geminiPlayerRef.current) break;
        // boss_spoke was only emitted on the text path (BOSS_SPEECH never arrives on Gemini fights),
        // so the funnel undercounted: 07-09 read ws_connected=42 / boss_spoke=23 — half the fights
        // LOOKED silent when they were Gemini fights speaking fine. First audio byte = boss spoke.
        if (!bossHasSpokenRef.current) beacon('boss_spoke');
        bossHasSpokenRef.current = true;
        geminiPlayerRef.current.enqueue(msg.data);
        // Voice-first ordering: the transcript held back for this turn is released only now, when
        // her voice is actually audible — the text follows the speech, never announces it.
        if (!geminiVoiceOnRef.current) {
          geminiVoiceOnRef.current = true;
          // Latency counter: candidate's stop → this first boss byte (his real device, his real voice).
          if (userStopMsRef.current) { setLastTurnLatencyMs(Date.now() - userStopMsRef.current); userStopMsRef.current = 0; }
          // The voice is here — a pending "denkt nach" timer must never fire mid-speech.
          if (geminiThinkTimerRef.current) { clearTimeout(geminiThinkTimerRef.current); geminiThinkTimerRef.current = null; }
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
        if (geminiModeRef.current) {
          setLiveTranscript((prev) => (prev || '') + (msg.text || ''));
          // DEAD-AIR FIX (owner, 07-10, second report): on the Gemini path the boss formulates for
          // ~1-2s while the screen shows your words frozen mid-screen and NO sign he heard you —
          // setBossThinking(true) was deliberately skipped for this path (see TRANSCRIPT_DONE). The
          // $0 path masks the same gap with a filler; the premium path masked nothing. Transcript
          // chunks going QUIET = Gemini heard the whole turn and is now composing: 600ms after the
          // last chunk — and only while this turn's voice hasn't started — light the existing
          // "CHEF DENKT NACH…" state. First audio byte clears it (BOSS_AUDIO_DELTA), the 22s
          // watchdog covers a dead session, and the Gemini mic ignores bossThinking entirely.
          setBossThinking(false);   // a fresh chunk = still transcribing → listening, not thinking yet
          if (geminiThinkTimerRef.current) clearTimeout(geminiThinkTimerRef.current);
          geminiThinkTimerRef.current = setTimeout(() => {
            geminiThinkTimerRef.current = null;
            if (geminiModeRef.current && !geminiVoiceOnRef.current) setBossThinking(true);
          }, 600);
        }
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
        beacon('gemini_fallback');   // voice-path health: silent downgrades must be countable in /diag/funnel
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
        try { console.log(`[DIAG] STT complete words=${msg.transcript ? msg.transcript.trim().split(/\s+/).filter(Boolean).length : 0}`); } catch {}
        if (msg.transcript) {
          // Boss is now generating its reply — block hands-free from re-triggering the mic
          // before BOSS_SPEECH arrives (gap of 1-2s while Groq generates the response).
          // Without this, the mic restarts immediately and can get stuck in transcribing=true.
          if (!geminiModeRef.current) setBossThinking(true);   // (filler already started at turn-end for zero perceived gap; no replay here). Gemini already voiced the reply → no "thinking" wait.
          setTranscript(prev => {
            // Guard against a double-committed turn (a straggler TRANSCRIPT_DONE, or a re-fire)
            // stacking an identical "DU" bubble: if the last line is the same player text, replace
            // it in place instead of appending a duplicate.
            const line = { id: ++_lineId, speaker: 'player', text: msg.transcript, partial: false, words: msg.words ?? [] };
            const last = prev[prev.length - 1];
            if (last && last.speaker === 'player' && (last.text || '').trim() === String(msg.transcript).trim()) {
              return [...prev.slice(0, -1), line];
            }
            return [...prev.slice(-39), line];
          });
        } else if (!geminiModeRef.current) {
          // EMPTY commit (a cough/door-slam turn Deepgram couldn't parse): the server sends
          // TRANSCRIPT_DONE '' and generates NO boss reply — so clear "denkt nach" NOW and let
          // the auto-mic reopen (~450ms). Before this, the interview froze on "CHEF DENKT NACH…"
          // for the full 22s watchdog after every noise spike.
          setBossThinking(false);
        }
        break;
      }

      case S.BOSS_SPEECH_EARLY: {
        // First sentence of the boss's reply, streamed ahead of the full line — start SPEAKING it
        // now. The full line still arrives via BOSS_SPEECH(+DONE), which splices in the remainder.
        // The reply itself is proof the interviewer link works — clear a stale transient error
        // banner (a provider hiccup that failover already recovered; it told the user to restart
        // a working interview). Terminal errors close the session and never reach here.
        setError(e => (e === 'realtime_error' ? null : e));
        if (geminiModeRef.current) break;              // Gemini path: boss voice is PCM over the WS, never MP3
        if (!msg.text || ttsMutedRef.current) break;   // muted → the normal text-only path handles it
        if (!bossHasSpokenRef.current) beacon('boss_spoke');   // funnel: first boss line reached this client
        bossHasSpokenRef.current = true;   // the interviewer is now speaking → the auto-mic may open after it finishes
        setBossSpeak(true);        // immediately, like BOSS_SPEECH — keeps the auto-mic gate closed (no echo window)
        setBossThinking(false);
        setShowBriefing(false);
        setBossText(msg.text);     // subtitle shows the first words at once; the full line replaces it
        _latTtsStart = Date.now(); // [LAT] TTS clock starts at the early sentence
        playBossEarlySentence({
          apiUrl: API_URL, token: tokenRef.current, voice: bossVoiceRef.current,
          elevenVoice: bossElevenVoiceRef.current, emotion: emotionRef.current, text: msg.text,
          onStart: () => reportClientLat(API_URL, tokenRef.current),
        });
        break;
      }

      case S.BOSS_SPEECH: {
        setError(e => (e === 'realtime_error' ? null : e));   // boss replied → the transient error is stale (see BOSS_SPEECH_EARLY)
        if (!bossHasSpokenRef.current) beacon('boss_spoke');   // funnel: the interviewer's FIRST line reached this client
        bossHasSpokenRef.current = true;   // interviewer has spoken → the auto-mic may open once it finishes
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
          try { console.log(`[DIAG] interviewer reply chars=${spokenLine.length}`); } catch {}
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
                onStart: () => { reportClientLat(API_URL, tokenRef.current); setBossSpeak(true); }, onEnd: () => setBossSpeak(false),
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
        // First meaningful, server-scored exchange — only now has the learner actually
        // completed onboarding. A failed connection/start must not unlock the complex home.
        try { localStorage.setItem('ff_interviewed', '1'); } catch {}
        setSeenInterview(true);
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
          // Edutainment pass (07-11, owner: "go all in"): the flying damage number is BACK.
          // hit = damage YOU dealt to the boss (strong answer), taken = damage you took.
          // Both come straight from the server's deterministic scorer — never invented here.
          const fid = ++_lineId;
          setScoreFlash({ id: fid, score: msg.score, hit: msg.bossDamage || 0, taken: msg.damage || 0,
            combo: Number.isFinite(msg.combo) ? msg.combo : 0 });
          setTimeout(() => setScoreFlash(f => (f && f.id === fid ? null : f)), 2200);
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
    // 'error' must be restartable: ws.onclose sets phase='error' and the START button stays on
    // screen telling the user to try again — rejecting 'error' here made that button a silent
    // no-op after ANY dropped connection (the only way out was a full page reload).
    if ((phaseRef.current !== 'idle' && phaseRef.current !== 'error') || startingRef.current) return;
    startingRef.current = true;

    // Turn-based text interview: no mic needed to START (typing works everywhere).
    // The microphone is only requested on demand, when the user records a spoken answer.
    setError(null);
    setErrorDetail('');
    setBossHp(100); setPlayerHp(100);
    setBossText(''); setTranscript([]);
    setEmotion('idle'); setScoreFlash(null);
    setFunnel(null); setDebrief(null); setDebriefPending(false); setNoSession(false);
    setAnswerText(''); setBossThinking(false); setRecording(false); setTranscribing(false);
    pendingDurationRef.current = 0;
    partialIdRef.current = null;
    bossPartialIdRef.current = null;
    bossHasSpokenRef.current = false;   // mic stays shut until the interviewer's opening line plays

    setPhaseSync('connecting');
    startingRef.current = false;   // phaseRef now guards re-entry

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    // Render's free dyno cold-starts (30-60s+); a slow-but-not-failed handshake fires no error and
    // would hang the UI on "VERBINDE…" forever. Hard 60s connect timeout → honest error, not a hang.
    const connectTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) { beacon('connect_timeout'); try { ws.close(); } catch {} setError((prev) => prev || 'ws_connect_failed'); setPhaseSync('error'); }
    }, 60_000);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      beacon('ws_connected');
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
        setHandsFree(false);
        setTypeOpen(true);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    // start recording
    try {
      clipRecRef.current = new ClipRecorder({ onVolume: (v) => { volRef.current = v; }, sharedContext: getSharedMicAC() });
      await clipRecRef.current.start();
      setRecording(true);
    } catch (err) {
      clipRecRef.current = null;
      beacon('mic_failed');
      setError(micErrorCode(err));
      setHandsFree(false);
      setTypeOpen(true);
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
    _dbgA('[MIC] hands-free turn START  micAC=' + (_sharedMicAC && _sharedMicAC.state));
    hfActiveRef.current = true;
    try {
      clipRecRef.current = new ClipRecorder({
        onVolume: (v) => { volRef.current = v; },
        sharedContext: getSharedMicAC(),   // reuse the gesture-unlocked capture context → auto-listen, no tap
        // Stream each PCM chunk live to the server → Deepgram LiveTranscription.
        // This eliminates the ~750ms REST round-trip latency of the old upload path.
        onChunk: (b64) => {
          wsRef.current?.send(JSON.stringify({ type: C.AUDIO_CHUNK, data: b64 }));
        },
      });
      await clipRecRef.current.start();
      setRecording(true);
      if (!micStartedBeaconRef.current) { micStartedBeaconRef.current = true; beacon('mic_started'); }
    } catch (err) {
      clipRecRef.current = null;
      hfActiveRef.current = false;
      beacon('mic_failed');
      setError(micErrorCode(err));
      setHandsFree(false);
      setTypeOpen(true);
      return;
    }

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
    const STEP = 50, K = 2.6, MIN_SPEAK_MS = 180, MAX_MS = 60000;
    hfTimerRef.current = setInterval(async () => {
      elapsed += STEP;
      const v = volRef.current || 0;
      if (!spoke) floor = floor * 0.92 + v * 0.08;          // adapt to room noise until speech
      const thresh = Math.max(0.02, floor * K);
      if (v > thresh) {
        if (spoke && silenceMs >= 250) recordThinkPause(silenceMs);   // resumed after a pause → that pause was thinking; LEARN this user's rhythm
        if (elapsed > MIN_SPEAK_MS) { spoke = true; volSpoke = true; }
        silenceMs = 0;
      }
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
      // ADAPTIVE per-user wait: anchored to how long THIS user pauses mid-thought (learned live from
      // their resume-pauses), scaled by how finished the sentence sounds. Replaces the fixed SIL_*
      // windows + per-persona patience so the wait fits every speaker — never one person's standard.
      const cls = classifyTurnDE(livePartialRef.current);
      const turnWords = (livePartialRef.current.trim().match(/\S+/g) || []).length;
      // patience = per-persona floor-hand-over grace (gentle interviewer waits longer → difficulty ascends);
      // stage 0 = the self-introduction, which is inherently multi-sentence and gets the most room.
      let needSilence = adaptiveNeedSilence(cls, turnWords, bossPatienceRef.current, stageIdxRef.current);
      // End the turn when: silence-after-speech hits the adaptive window, OR the transcript froze
      // (noisy-mic safety net — they've stopped, volume just isn't registering it), OR the hard cap.
      // The frozen-transcript net must be CLASSIFICATION-AWARE: a flat 1800ms silently capped every
      // wait (silence ⇒ frozen transcript), so a mid-clause thinking pause >1.8s was STILL cut no
      // matter how patient the SIL windows were — the exact "talks over me aggressively" bug. It now
      // never fires earlier than the adaptive window it exists to backstop.
      const needStable = Math.max(1200, needSilence + 600);
      const transcriptDone = spoke && livePartialRef.current.trim() && partialStableMs >= needStable;
      if (!((spoke && silenceMs >= needSilence) || transcriptDone || elapsed >= MAX_MS)) return;
      try { console.log(`[DIAG] turn-END reason=${elapsed >= MAX_MS ? 'MAXCAP' : transcriptDone ? 'transcript-frozen' : 'silence'} vadClass=${cls} needSilence=${needSilence}ms silence=${Math.round(silenceMs)}ms stage=${stageIdxRef.current} heardChars=${(livePartialRef.current || '').length}`); } catch {}
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
    // NEVER open the mic before the interviewer has delivered its opening line. At session start
    // bossSpeak is briefly false (the opening hasn't arrived yet); opening the mic in that window
    // made the greeting bleed into the live mic → VAD self-triggered → the boss replied over its
    // own opening ("spoke over himself"). bossSpeakClearsThenReopens on every later turn as normal.
    if (!bossHasSpokenRef.current) return;
    if (recording || transcribing || bossThinking || bossSpeak || hfActiveRef.current) return;
    // Let the speaker's echo/reverb tail die before the mic opens — otherwise the tail of the boss's
    // own voice bleeds into the fresh mic and self-triggers a false turn ("Chef denkt nach" for 15s).
    // 450ms is imperceptible to a human but clears the acoustic tail on a laptop/phone speaker.
    const t = setTimeout(() => startHandsFreeTurn(), 450);
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

  // Screen Wake Lock: hands-free means the screen goes untouched for minutes, and Android's
  // default 30-60s auto-lock then fired the visibility guard above → interview force-ended
  // (the teardown's #1 blocker). Hold a wake lock while a fight is active; re-acquire when the
  // tab returns to visible (the OS silently releases it on hide). Unsupported browsers
  // (older iOS) keep the old behavior — this can only help, never hurt.
  useEffect(() => {
    if (phase !== 'active' || !navigator.wakeLock?.request) return;
    let lock = null, alive = true;
    const acquire = () => navigator.wakeLock.request('screen')
      .then((l) => { if (alive) lock = l; else l.release().catch(() => {}); })
      .catch(() => { /* denied (e.g. battery saver) → pre-wake-lock behavior */ });
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible' && alive) acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}); };
  }, [phase]);

  const handleRestart = useCallback(() => {
    if (verdictTimerRef.current) { clearTimeout(verdictTimerRef.current); verdictTimerRef.current = null; }
    setVerdictHold(false);
    setDebrief(null); setDebriefPending(false); setNoSession(false);
    clearInterval(pingRef.current);
    try { wsRef.current?.close(1000, 'restart'); } catch {}
    wsRef.current = null;
    setPhaseSync('idle');
    setTimeout(start, 250);
  }, [start, setPhaseSync]);

  const handleRevanche = useCallback(() => {
    const moment = debrief?.revancheMoment;
    if (!moment) return;
    revancheRef.current = { stage: moment.stage, stageLabel: moment.stageLabel || '' };
    if (debrief?.result?.bossId) bossPickRef.current = debrief.result.bossId;
    handleRestart();
  }, [debrief, handleRestart]);

  // Debrief "FERTIG" → clean route HOME (not another fight). Clears funnel so the home screen
  // (and the brain's next-step guide) renders instead of the fight chrome, and so the global
  // back arrow stops treating the ended session as a live interview (its old behavior here
  // was confirm + full page reload).
  const handleDebriefDone = useCallback(() => {
    if (verdictTimerRef.current) { clearTimeout(verdictTimerRef.current); verdictTimerRef.current = null; }
    setVerdictHold(false);
    stopBossVoice();        // the boss may still be speaking its closing line (debrief pending,
    setBossSpeak(false);    // screen not yet shown) — home must never render over a talking boss
    setDebrief(null); setDebriefPending(false); setNoSession(false);
    setFunnel(null);
    clearInterval(pingRef.current);
    try { wsRef.current?.close(1000, 'done'); } catch {}
    wsRef.current = null;
    setPhaseSync('idle');
  }, [setPhaseSync]);

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
      .then((r) => { if (!r.ok) throw new Error(`billing ${r.status}`); return r.json(); })
      .then((d) => {
        setBilling(d || null);
        if (d?.account) onAccountUpdate?.(d.account);
      }).catch(() => {});
  }, [authHeaders, onAccountUpdate]);
  // Refresh whenever we're on the idle home (on mount + after every fight).
  useEffect(() => { if (phase === 'idle') loadBilling(); }, [phase, loadBilling]);
  const hasPendingPayment = !!billing?.pendingPayment;
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    const refresh = () => { loadBilling(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = hasPendingPayment ? window.setInterval(refresh, 30_000) : null;
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, hasPendingPayment, loadBilling]);

  // Dismiss the one-time "plan activated" celebration (acknowledge server-side so it shows once).
  const ackActivation = useCallback(() => {
    setBilling((b) => (b ? { ...b, justActivated: false } : b));
    fetch(`${API_URL}/api/billing/ack-activation`, { method: 'POST', headers: authHeaders() }).catch(() => {});
  }, [authHeaders]);

  // ── Begin: run a spaced-repetition recall drill (if any due) before the fight ─
  const beginSession = useCallback(async () => {
    unlockAudioPlayback();   // MUST run synchronously inside the tap — unlocks mobile audio so boss TTS can play
    fightModeRef.current = 'daily';
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return;
    // Don't even open a socket if the trial is spent — show the wall up front.
    beacon('start_clicked');
    // Typing is a complete interview path. Unsupported microphone shells may still start and
    // answer by text; only the microphone button itself needs browser-escape guidance.
    if (auth.account?.entitlement && !auth.account.entitlement.allowed) {
      setPaywall(auth.account.entitlement); return;
    }
    // Voice is the product's primary experience. Verify the microphone BEFORE opening a socket or
    // starting a paid Gemini/persona session. This same browser permission applies to the installed
    // PWA, so the website, PWA and mobile browser now fail safely at the same gate instead of
    // discovering a saved denial after Yasmin has already started speaking.
    if (IN_APP_BROWSER || !checkAudioSupport().supported) {
      beacon('mic_failed');
      setError('audio_unsupported');
      setHandsFree(false);
      setTypeOpen(false);
      return;
    }
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      setError(null);
    } catch (err) {
      beacon('mic_failed');
      setError(micErrorCode(err));
      setHandsFree(false);
      setTypeOpen(false);
      return;
    }
    // Straight into the interview. The typed AUFWÄRMEN pre-fight warm-up was removed: it re-drilled the
    // same SRS due-items as SAG ES RICHTIG (spoken) and Daily Training (typed) — off-mission redundancy.
    start();
  }, [start, auth.account]);

  // ── Salma's booking: she hands the candidate to Yasmin (the ladder's Junior-Recruiterin) at
  // the level her screening measured. result=null (screening skipped) books at the current level.
  const closeSalma = useCallback((why) => { setSalma(null); if (why) beacon(String(why)); }, []);
  const bookSalmaFight = useCallback((result) => {
    const mapped = ASSESS_LEVEL_MAP[result?.estimatedLevel];
    const bookedBoss = ASSESS_BOSS_MAP[result?.estimatedLevel] || 'yasmin';
    // Session-only (levelRef + state, no localStorage write) — a manual Optionen pick still outranks
    // the measured level on the next visit, exactly like the legacy auto-set (D10).
    if (mapped) { levelRef.current = mapped; setLevel(mapped); }
    chooseBoss(bookedBoss);
    setSalma(null);
    beacon('salma_booked');
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

  // One-shot: the proof card is dismissed locally first (instant), then the server flips seen —
  // if the POST fails the worst case is the card showing once more, never a lost dismissal.
  const dismissLastDebrief = useCallback(() => {
    setLastDebrief(null);
    fetch(`${API_URL}/api/progress/debrief-seen`, { method: 'POST', headers: authHeaders() }).catch(() => {});
  }, [authHeaders]);

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
        if (!cancelled && Number.isFinite(data.etaSessions) && data.etaSessions > 0) setEtaSessions(data.etaSessions);   // velocity (R3) — server returns null below 2 measured sessions
        if (!cancelled && data.hireReadiness) setHireReadiness(data.hireReadiness);   // honest hire-readiness verdict for the home
        if (!cancelled && data.lastDebrief) setLastDebrief(data.lastDebrief);         // one-shot proof card (server clears it after debrief-seen)
        if (!cancelled && data.topWeakness) setTopWeakness(data.topWeakness);         // Salma's file note (#1 lapsed rule — was computed but never surfaced)
        if (!cancelled && data.currentBoss) setPipeline({ currentBoss: data.currentBoss, nextBoss: data.nextBoss || null });   // her bookings ladder
      } catch { /* keep cached value */ }
    })();
    // The rival — real weekly leaderboard (server-masked emails). One quiet fetch; fail-silent.
    fetch(`${API_URL}/api/leaderboard`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d?.entries) || !d.entries.length) return;
        const my = d.entries.findIndex((e) => e.id === auth.account?.id);
        if (my === 0) setRival({ key: 'note_rival_leader', slots: {} });
        else if (my > 0) {
          const r = d.entries[my - 1];
          setRival({ key: 'note_rival_ahead', slots: { masked: r.masked, sessions: r.liveSessions } });
        } else {
          const top = d.entries[0];
          setRival({ key: 'note_rival_field', slots: { count: d.entries.length, masked: top.masked, sessions: top.liveSessions } });
        }
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [authHeaders]);

  // ── Derived display state ─────────────────────────────────────────────────
  const isActive     = phase === 'active';
  const isConnecting = phase === 'connecting';
  const canStart     = phase === 'idle' || phase === 'error';
  // A novel user = ready, never interviewed (no local flag), no training streak. Collapses the home to
  // just the hero + Interview-starten button (progressive disclosure). NOTE: do NOT reference `data`
  // here — the fight-result object lives in a child component, not this scope (it crashed the home).
  // seenInterview (set at beginSession) already covers the "has interviewed" case, so `data` is redundant.
  const firstRun     = canStart && !seenInterview && !streak;
  const boss         = EMOTIONS[emotion] ?? EMOTIONS.idle;

  // ── Global BACK — a persistent control on every screen (owner request). Closes the top-most open
  // overlay/drill; inside a live interview it offers a clean exit to the home screen. ──
  const _overlays = [
    [assessmentOpen, setAssessmentOpen], [shadowingOpen, setShadowingOpen],
    [fluencyOpen, setFluencyOpen], [listeningOpen, setListeningOpen], [spokenReviewOpen, setSpokenReviewOpen],
    [satzbauOpen, setSatzbauOpen],
    [pressureOpen, setPressureOpen],
    [videoLessonsOpen, setVideoLessonsOpen],
    [dailyOpen, setDailyOpen],
    [showBriefing, setShowBriefing],
    [!!salma && !assessmentOpen, () => closeSalma('salma_skipped')],
  ];
  // Every drill/panel overlay has its OWN close ("Schließen ✕"), so the global back arrow was a
  // redundant SECOND close AND it overlapped each drill's title (top-left collision). Hide it for
  // those; keep it only for the live interview (which has no own close) + panels without one.
  const ownCloseOverlay = assessmentOpen || shadowingOpen || fluencyOpen || listeningOpen
    || spokenReviewOpen || satzbauOpen || pressureOpen || videoLessonsOpen || !!salma;
  const canGoBack = (_overlays.some(([o]) => o) && !ownCloseOverlay) || !!funnel || isActive || isConnecting;
  const goBack = () => {
    // Closing via the bare setter bypasses the onClose wrappers, so clear the why here too —
    // otherwise the next drill opened from the grid inherits a stale why-you line.
    for (const [o, close] of _overlays) { if (o) { close(false); setDrillWhy(null); return; } }   // close the top-most overlay
    if (debrief || debriefPending) { handleDebriefDone(); return; }             // debrief → clean home, no reload
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

      {/* In-app-browser escape hatch: Facebook/Messenger/Instagram WebViews can't do mic capture,
          and the 07-06 cohort arrived from exactly those links (7/8 signups never reached the
          interview). A prominent blue card (design law: blue keeps the home's single orange object —
          the START button — intact), shown on EVERY screen so the user meets it BEFORE the broken-mic
          moment. Android gets a one-tap Chrome escape; iOS gets the manual Safari route. */}
      {IN_APP_BROWSER && (
        <div style={{ padding:'12px 16px', background:'var(--bg-1)', borderBottom:'1px solid var(--line-strong)' }}>
          <div style={{ display:'flex', gap:12, alignItems:'flex-start',
            background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.35)',
            borderRadius:'var(--r-lg)', padding:'14px 16px', boxShadow:'var(--e2)' }}>
            <div style={{ flex:'0 0 auto', width:38, height:38, borderRadius:'var(--r-md)', color:'var(--accent)',
              display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(59,130,246,0.14)', border:'1px solid rgba(59,130,246,0.3)' }}>
              <Icon name="mic" size={20} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'var(--fs-h2)',
                color:'var(--text)', marginBottom:4 }}>
                Zum Sprechen: in Chrome öffnen{/* OWNER-AR slot */}
              </div>
              <div style={{ fontSize:'var(--fs-label)', lineHeight:1.55, color:'var(--text-dim)' }}>
                Der Facebook- oder Messenger-Browser blockiert das Mikrofon — das Live-Interview braucht es.{/* OWNER-AR slot */}
              </div>
              {/Android/i.test(navigator.userAgent || '') ? (
                <>
                  {/* Bulletproof native path first: the app holds the mic itself, so it NEVER depends on
                      which browser the user has. Then the Chrome escape as the no-install fallback. */}
                  <a href={`intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`}
                    onClick={() => beacon('inapp_escape_tap')}
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:12,
                      minHeight:48, borderRadius:'var(--r-md)', textDecoration:'none',
                      background:'linear-gradient(135deg, var(--accent-2), var(--accent))', color:'#04070d',
                      fontFamily:'var(--font-display)', fontWeight:600, fontSize:13.5 }}>
                    In Chrome öffnen <Icon name="chevronRight" size={16} />
                  </a>
                </>
              ) : (
                <div style={{ marginTop:10, fontSize:'var(--fs-label)', lineHeight:1.55, color:'var(--accent-2)', fontWeight:600 }}>
                  Menü (⋯ oben rechts) → „Im Browser öffnen" → Safari{/* OWNER-AR slot */}
                </div>
              )}
            </div>
          </div>
        </div>
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
          onUpgraded={handleUpgraded} onPaymentPending={loadBilling} onClose={() => setPaywall(null)} />
      )}

      {/* Tägliches Training — the cheap daily habit loop */}
      {dailyOpen && (
        <OverlayBoundary onClose={() => setDailyOpen(false)}>
          <DailyTraining token={auth.token} apiUrl={API_URL} lang={feedbackLang}
            onClose={() => setDailyOpen(false)}
            onComplete={(s) => setDaily(prev => ({ ...prev, streak: s.streak ?? 0, completedToday: true, streakShield: s.streakShield ?? prev.streakShield, best: Math.max(prev.best ?? 0, s.streak ?? 0) }))} />
        </OverlayBoundary>
      )}

      {/* Progress dashboard */}
      {dashboard && (
        <Dashboard data={dashboard.data} loading={dashboard.loading} account={auth.account} token={auth.token}
          onClose={() => setDashboard(null)} onReview={startReviewFromDash} onLogout={onLogout} />
      )}

      {/* Free intelligent assessment (turn-based, cheap models only — never a Realtime session).
          When Salma's cold-open is active, BOTH exits return to HER (she delivers the verdict and
          does the booking herself — the agency handoff), never a raw jump into a fight. */}
      {assessmentOpen && (
        <Assessment token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          onClose={salma
            ? () => { setAssessmentOpen(false); setSalmaResume((n) => n + 1); }
            : () => setAssessmentOpen(false)}
          onStartInterview={salma
            ? () => { setAssessmentOpen(false); setSalmaResume((n) => n + 1); }
            : () => { setAssessmentOpen(false); setTimeout(() => beginSession(), 60); }} />
      )}

      {/* Salma's cold-open — hidden while her screening (the Assessment) runs, and while the
          plan-activated celebration is up (one takeover at a time). */}
      {salma && !assessmentOpen && !billing?.justActivated && (
        <SalmaTakeover token={auth.token} apiUrl={API_URL} lang={feedbackLang}
          ctx={salma} resumeTick={salmaResume}
          onStartScreening={() => { setAssessmentOpen(true); beacon('assessment_shown'); }}
          onBookFight={bookSalmaFight}
          onClose={closeSalma} />
      )}

      {/* Shadowing pronunciation practice (PAID — cheap models + browser TTS, never Realtime) */}
      {shadowingOpen && (
        <Shadowing token={auth.token} apiUrl={API_URL} lang={feedbackLang} why={drillWhy}
          onClose={() => { setShadowingOpen(false); setDrillWhy(null); }}
          onGoPricing={() => { setShadowingOpen(false); setDrillWhy(null); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* 4-3-2 spoken-fluency drill (PAID — Groq Whisper STT, deterministic feedback) */}
      {fluencyOpen && (
        <FluencyDrill token={auth.token} apiUrl={API_URL} lang={feedbackLang} level={level} why={drillWhy}
          onClose={() => { setFluencyOpen(false); setDrillWhy(null); }}
          onGoPricing={() => { setFluencyOpen(false); setDrillWhy(null); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Listening & live data-capture drill (PAID — browser TTS, deterministic grading, zero cost) */}
      {listeningOpen && (
        <Listening token={auth.token} apiUrl={API_URL} lang={feedbackLang} why={drillWhy}
          onClose={() => { setListeningOpen(false); setDrillWhy(null); }}
          onGoPricing={() => { setListeningOpen(false); setDrillWhy(null); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Spoken-production SRS — say YOUR own errors correctly, spaced (PAID; Groq Whisper, deterministic) */}
      {spokenReviewOpen && (
        <SpokenReview token={auth.token} apiUrl={API_URL} lang={feedbackLang} why={drillWhy}
          onClose={() => { setSpokenReviewOpen(false); setDrillWhy(null); }}
          onGoPricing={() => { setSpokenReviewOpen(false); setDrillWhy(null); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Satzbau-Schmiede — verb-final word-order builder (PAID; deterministic order grading, zero cost) */}
      {satzbauOpen && (
        <SatzbauSchmiede token={auth.token} apiUrl={API_URL} lang={feedbackLang} why={drillWhy}
          onClose={() => { setSatzbauOpen(false); setDrillWhy(null); }}
          onGoPricing={() => { setSatzbauOpen(false); setDrillWhy(null); setPaywall(auth.account?.entitlement || {}); }} />
      )}

      {/* Pressure Ladder — overload training (native Aura-2 voice via the server TTS route, zero cost) */}
      {pressureOpen && (
        <PressureLadder lang={feedbackLang} onClose={() => { setPressureOpen(false); setDrillWhy(null); }} token={auth.token} apiUrl={API_URL} why={drillWhy} />
      )}

      {/* (El-Captain mentor chat DELETED on owner order 2026-07-10: the LLM's Egyptian Arabic was
          provably broken — mixed foreign tokens, garbled grammar terms — an active trust-killer.
          The deterministic BrainGuide remains the single guidance voice.) */}

      {/* Video lessons — the $0 "video" engine: animated slides + native German narration */}
      {videoLessonsOpen && (
        <VideoLessons token={auth.token} apiUrl={API_URL} lang={feedbackLang} onClose={() => setVideoLessonsOpen(false)} />
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
        <Debrief data={debrief} pending={debriefPending} verdictHold={verdictHold} onRestart={handleRestart} onRevanche={handleRevanche} onDone={handleDebriefDone}
          lang={feedbackLang} onLang={chooseFeedbackLang} bossName={funnel?.displayName}
          studentName={auth.account?.name || (auth.account?.email || '').split('@')[0]}
          ent={auth.account?.entitlement}
          onSeePlans={() => setPaywall(auth.account?.entitlement || { plan: 'free' })}
          onTrainSkill={(drill, why) => { setDrillWhy(why || null);
            ({ fluency: setFluencyOpen, shadowing: setShadowingOpen,
              pressure: setPressureOpen, satzbau: setSatzbauOpen }[drill]?.(true)); }}
          token={auth.token} apiUrl={API_URL} />
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
            {/* STATUS STRIP (uplift): one calm 44px row — streak + daily habit entry. Hidden on first-run
                (a novel user has no streak/habit to repeat yet — it'd be a second CTA above the hero). */}
            {!firstRun && <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            <button onClick={() => setDailyOpen(true)} style={{ flex:1, minWidth:0, textAlign:'left', cursor:'pointer',
              display:'flex', alignItems:'center', gap:10, padding:'10px 14px', minHeight:44,
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
              {/* Quiet chip (designer pass 2026-07-10): was an ORANGE 'START ▸' — a second orange CTA
                  on the same screen as Interview starten, competing with the one job. Blue outline now;
                  the home's single orange belongs to the interview. */}
              <span style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'var(--fs-meta)', whiteSpace:'nowrap',
                padding:'6px 12px', borderRadius:'var(--r-pill)',
                color:'var(--accent-2)', background:'transparent', border:'1px solid var(--accent-dim)' }}>
                {daily.completedToday ? '✓' : '▸'}
              </span>
            </button>
            {/* Progress, one tap from the top (designer pass): the dashboard was buried in the tile
                grid below the fold — sophistication = the important things are simply WHERE you expect. */}
            <button onClick={openDashboard} title="Fortschritt" aria-label="Fortschritt"
              style={{ flex:'0 0 auto', width:44, minHeight:44, display:'grid', placeItems:'center', cursor:'pointer',
                borderRadius:'var(--r-pill)', background:'var(--surface)', border:'1px solid var(--line)', color:'var(--accent-2)' }}>
              <Icon name="chartUp" size={17} />
            </button>
            </div>}
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
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'var(--fs-h1)', color:'var(--text)', lineHeight:1.1 }}>
                    Dein Interview
                  </div>
                  <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4, display:'flex', alignItems:'center', gap:5 }}>
                    <Icon name="clock" size={12} /> Dein Interviewer wartet
                  </div>
                </div>
                {rank && <RankLadder rank={rank} />}
              </div>

              {/* Honest velocity (R3): measured pace only — the server returns etaSessions null
                  below 2 xp-measured sessions (D4: below the evidence floor, say NOTHING).
                  Audit S16: unbounded, a slow learner could see "noch ~480 Sessions" — accurate
                  but demotivating-screenshot material; beyond 30 the number stops being guidance. */}
              {canStart && !firstRun && Number.isFinite(etaSessions) && etaSessions <= 30 && (
                <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', margin:'0 0 10px', textAlign:'center' }}>
                  Auf deinem Tempo: noch ~{etaSessions} {etaSessions === 1 ? 'Session' : 'Sessions'} bis zum nächsten Level. <span dir="rtl">فاضلك حوالي {etaSessions} سيشن للمستوى الجاي.</span>
                </div>
              )}

              {/* THE FATHER LEADS (R1, WOW plan 2026-07-10): the live brain's ONE next step is the
                  FIRST actionable thing a returning user sees — above level/interviewer choices.
                  Doctrine D2: clear lead + open doors — everything below stays reachable. Hidden on
                  first-run (its prescription would duplicate the diagnosis-interview CTA). */}
              {BRAIN_GUIDE_LIVE && canStart && !firstRun && (
                <BrainGuide token={auth.token} apiUrl={API_URL} externalInterviewCta
                  topWeakness={topWeakness} trial={auth.account?.entitlement?.trial} lang={feedbackLang}
                  pipeline={pipeline} rival={rival}
                  onAction={(d, why) => {
                  const p = d?.prescription || {};
                  const OPEN = { 'shadowing': setShadowingOpen, 'sag-es-richtig': setSpokenReviewOpen,
                    'flow-drill': setFluencyOpen, 'hoer-check': setListeningOpen, 'druck-leiter': setPressureOpen,
                    'satzbau-schmiede': setSatzbauOpen,
                    'srs': setDailyOpen };
                  if (p.action === 'drill') {
                    const fn = OPEN[p.drill];
                    // Hand the WHY only to overlays that actually render it ('srs'/Daily doesn't, and the
                    // beginSession fallback isn't a drill) — otherwise the line goes stale and would
                    // reappear on whatever drill opens next (feedback-accuracy doctrine: never mislabel).
                    setDrillWhy(fn && p.drill !== 'srs' ? (why || null) : null);
                    fn ? fn(true) : beginSession();
                  }
                  else if (p.action === 'interview' || p.action === 'measure') beginSession();
                  else if (p.action === 'assessment') setAssessmentOpen(true);
                  else if (p.action === 'apply') beginSession();  // job-ready → keep sharp with a real interview
                }} />
              )}





            {/* ── Secondary settings behind a quiet disclosure (hands-free + feedback language only). ── */}
            <div style={{ textAlign:'center', marginTop:10 }}>
              <button onClick={() => setShowOpts(o => !o)} style={{ cursor:'pointer', background:'none', border:'none',
                fontSize:10, color:'#64748b', letterSpacing:'0.06em', padding:'4px 6px', fontFamily:'inherit' }}>
                {showOpts ? '▾' : '▸'} Optionen · Niveau {({ 'a2-b1':'A2–B1', 'b2':'B2', 'c1':'C1' })[level]} · خيارات
              </button>
            </div>
            {showOpts && (
            <>
            {/* Level + interviewer moved behind Optionen (designer pass 2026-07-10): returning
                users rarely change them (auto-detect + auto-boss exist), so the home keeps ONE job.
                D2: open doors, one tap away, never locked. */}
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
            {/* Interviewer picker — ALWAYS visible, but LEVEL-GATED: a beginner never gets a too-hard boss
                as a pickable option. Higher tiers show LOCKED (🔒 · ab B2/C1, disabled) so the ladder stays
                visible and aspirational instead of vanishing. (owner: "why is Frau Mona Adel (C1) open as an
                option for an A2/B1 user?") */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap',
              padding:'10px 12px', minHeight:44, borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid var(--line)' }}>
              <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)' }}>Interviewer · اختر المُحاوِر</span>
              <select value={bossPick} onChange={(e) => chooseBoss(e.target.value)} disabled={!canStart}
                style={{ fontSize:'var(--fs-label)', padding:'8px 10px', minHeight:36, borderRadius:8, background:'rgba(2,6,16,0.7)',
                  color:'#e2e8f0', border:'1px solid var(--line-strong)', fontFamily:'inherit', cursor: canStart ? 'pointer' : 'default' }}>
                <option value="">Auto (nach Niveau)</option>
                {[
                  { id:'yasmin',         label:'Yasmin — warm',           L:1, min:'a2-b1' },
                  { id:'karim',          label:'Karim — sachlich',        L:2, min:'a2-b1' },
                  { id:'hana',           label:'Hana — skeptisch',        L:3, min:'b2' },
                  { id:'tarek',          label:'Tarek — Hochdruck',       L:4, min:'b2' },
                  { id:'frau-mona-adel', label:'Frau Mona Adel — streng', L:5, min:'c1' },
                  { id:'lukas',          label:'Lukas — casual Berlin',   L:6, min:'c1' },
                ].map((b) => {
                  const order = ['a2-b1', 'b2', 'c1'];
                  const locked = order.indexOf(level) < order.indexOf(b.min);
                  const tag = { 'a2-b1':'', b2:'ab B2', c1:'ab C1' }[b.min];
                  return (
                    <option key={b.id} value={b.id} disabled={locked}>
                      {locked ? `🔒 ${b.label} · ${tag}` : `${b.label} (L${b.L})`}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Ziel-Stelle (Elite perk, server-enforced): the target account TYPE steers the roleplay
                scenario + boss framing. Storing the pick is free (aspiration + upsell); the row says
                honestly when it only becomes active with Elite. Keys mirror server INDUSTRIES. */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap', marginTop:8,
              padding:'10px 12px', minHeight:44, borderRadius:12, background:'rgba(255,255,255,0.04)', border:'1px solid var(--line)' }}>
              <span style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)' }}>
                Ziel-Stelle{/* OWNER-AR slot: masri label */}{billing && !billing.zielStelle && <span style={{ color:'var(--action)', fontWeight:700 }}> · mit Elite</span>}
              </span>
              <select value={billing?.targetIndustry || ''} disabled={!canStart}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setBilling((b) => (b ? { ...b, targetIndustry: v } : b));
                  fetch(`${API_URL}/api/progress/target-industry`, { method:'POST',
                    headers:{ 'Content-Type':'application/json', ...authHeaders() },
                    body: JSON.stringify({ industry: v }) })
                    .then((r) => { if (!r.ok) loadBilling(); })      // 401/400 → resync, never show a lie
                    .catch(() => loadBilling());
                }}
                style={{ fontSize:'var(--fs-label)', padding:'8px 10px', minHeight:36, borderRadius:8, background:'rgba(2,6,16,0.7)',
                  color:'#e2e8f0', border:'1px solid var(--line-strong)', fontFamily:'inherit', cursor: canStart ? 'pointer' : 'default' }}>
                <option value="">Auto (gemischt)</option>
                {[['telecom','Telekommunikation & Internet'],['ecommerce','E-Commerce & Handel'],['fintech','Banken & Fintech'],
                  ['airline','Airlines & Reisen'],['delivery','Lieferdienste'],['logistik','Logistik & Versand'],
                  ['energie','Energie'],['versicherung','Versicherungen'],['streaming','Streaming & Abo-Dienste'],
                  ['b2b','B2B & Werbekonten']].map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}
              </select>
            </div>

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
            border:'1.5px solid rgba(59,130,246,0.45)', boxShadow:'0 0 60px rgba(59,130,246,0.18)',
            padding:'22px 22px 18px', userSelect:'none' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div>
                <div style={{ fontSize:9, letterSpacing:'0.15em', fontFamily:'var(--font-display)', color:'var(--accent)', marginBottom:3 }}>
                  BRIEFING · {(csBriefing.bossName || 'INTERVIEWER').toUpperCase()}
                </div>
                <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{csBriefing.skill || 'Drei Teile · nur Deutsch'}</div>
              </div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', textAlign:'right', lineHeight:1.4 }}>
                Antippen<br/>um zu starten
              </div>
            </div>
            {/* Situation */}
            <div style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.55, marginBottom:14,
              padding:'10px 12px', background:'rgba(59,130,246,0.06)', borderRadius:10,
              borderLeft:'3px solid rgba(59,130,246,0.4)' }}>
              {csBriefing.situation}
            </div>
            {csBriefing.scrutiny && (
              <div style={{ marginBottom:14, padding:'9px 11px', borderRadius:9,
                background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.32)' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:9, letterSpacing:'0.12em', color:'var(--action)' }}>
                  HEUTE UNTER BEOBACHTUNG
                </div>
                <div style={{ marginTop:4, fontSize:11.5, color:'#e2e8f0' }}>{csBriefing.scrutiny}</div>
              </div>
            )}
            {/* Key phrases */}
            <div style={{ fontSize:9.5, letterSpacing:'0.1em', color:'var(--accent)', fontFamily:'var(--font-display)', marginBottom:8 }}>SCHLÜSSELPHRASEN</div>
            {csBriefing.keyPhrases.map((phrase, i) => (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:7 }}>
                <div style={{ width:18, height:18, borderRadius:'50%', background:'rgba(59,130,246,0.15)',
                  border:'1px solid rgba(59,130,246,0.4)', display:'flex', alignItems:'center', justifyContent:'center',
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
        {/* BOSS HP — top frame. paddingLeft clears the global fixed back button (top:10/left:10,
            z:400) which floated OVER the label — the "sloppy app" screenshot class (audit S23). */}
        <div style={{ paddingLeft:44 }}>
          <HpBar label="INTERVIEW · REST" value={bossHp} isPlayer={false} reason={bossReason} />
        </div>

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
          {/* Elite pass: the drifting teal sci-fi grid died — motion without meaning, and the only
              green in a blue room. The light cone + vignette carry the atmosphere alone. */}
          {/* edge vignette — the dark interview room */}
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:2,
            background:'radial-gradient(135% 100% at 50% 32%, transparent 38%, rgba(0,0,0,0.82) 100%)' }} />

          {/* Stage ribbon (aesthetic pass 2026-07-10): was a RED "⚔ ENDGEGNER" pill — red chrome
              (two-color law: red = errors only) + gaming jargon meaningless to a job-seeker. Plain
              blue, plain German. */}
          <div style={{ position:'absolute', top:10, left:12, zIndex:5,
            fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.16em',
            color:'var(--accent-2)', padding:'3px 9px', borderRadius:'var(--r-pill)',
            background:'rgba(59,130,246,0.10)', border:'1px solid rgba(59,130,246,0.35)' }}>LIVE-INTERVIEW</div>
          {/* emotion badge — the boss's state */}
          <div style={{ position:'absolute', top:10, right:12, zIndex:5,
            fontFamily:'var(--font-display)', fontWeight:600, fontSize:9, letterSpacing:'0.12em',
            color:boss.color, padding:'3px 9px', borderRadius:'var(--r-pill)',
            background:`${boss.color}1a`, border:`1px solid ${boss.color}55`,
            textShadow:`0 0 8px ${boss.color}`, transition:'color 0.5s, border-color 0.5s' }}>{boss.label}</div>

          {/* Damage numbers RE-ENABLED (07-12 owner north star: "not boring at all") — the 10560f1
              hardening had them {false}'d; the panel unanimously ordered the punch replugged, tuned
              premium: crisp 34px, 1.6s, combo bursts only from ×3. A strong German sentence visibly
              wounds the boss — the entertainment IS feedback on language quality. */}
          {scoreFlash && scoreFlash.hit > 0 && (
            <div key={`h${scoreFlash.id}`} style={{ position:'absolute', top:'26%', left:'50%', zIndex:7,
              transform:'translateX(-50%)', pointerEvents:'none',
              fontFamily:'var(--font-display)', fontWeight:800, fontSize:34, lineHeight:1,
              color:'#93c5fd', textShadow:'0 2px 6px rgba(0,0,0,0.8)',
              animation:'dmg-pop 1.6s var(--ease) forwards' }}>
              −{scoreFlash.hit}
            </div>
          )}
          {scoreFlash && scoreFlash.combo >= 3 && scoreFlash.hit > 0 && (
            <div key={`c${scoreFlash.id}`} style={{ position:'absolute', top:'44%', left:'50%', zIndex:7,
              transform:'translateX(-50%)', pointerEvents:'none',
              fontFamily:'var(--font-display)', fontWeight:700, fontSize:14, letterSpacing:'0.2em',
              color:'#fdba74', textShadow:'0 2px 5px rgba(0,0,0,0.8)',
              animation:'combo-pop 1.6s var(--ease) forwards' }}>
              SERIE ×{scoreFlash.combo}
            </div>
          )}

          {/* the lit opponent — leans in to listen while YOU speak; posture shifts with mood */}
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:56, zIndex:3 }}>
            <div style={{ width:'72%', maxWidth:300, height:'84%',
              transform: `${userSpeak ? 'translateY(9px) scale(1.05)' : ''} ${POSTURE[emotion] || ''}`.trim() || 'none',
              transition:'transform 0.5s var(--ease)' }}>
              <div className={userSpeak ? 'listening' : (isActive && !bossSpeak ? 'breathe' : '')} style={{ width:'100%', height:'100%' }}>
                <BossAvatar emotion={boss.face} speaking={bossSpeak} color={boss.color} name={funnel?.displayName} />
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
              letterSpacing:'0.04em', lineHeight:1, textShadow:'0 2px 12px rgba(0,0,0,0.9)' }}>
              {funnel?.displayName ?? 'INTERVIEWER'}
            </div>
            {!funnel && <div style={{ fontSize:9.5, color:'#94a3b8', marginTop:4 }}>Dein nächster Interviewer wartet.</div>}
            <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap', marginTop:7 }}>
              {/* Persona-TRUE trait chip (aesthetic pass 2026-07-10): "HOCHDRUCK" was hardcoded for
                  every boss — under warm Yasmin it directly contradicted the home picker's own
                  "Langsamer · verzeiht Fehler". One word per persona, same words the picker uses. */}
              {/* Elite pass: dingbat icons (◆◈✦) + colored glow borders read as game badges. Neutral
                  hairline chips — the emotion badge (top right) is the ONE colored element here. */}
              {[({ yasmin:'GEDULDIG', karim:'SACHLICH', hana:'SKEPTISCH', tarek:'HOCHDRUCK', 'frau-mona-adel':'STRENG', lukas:'LOCKER' })[funnel?.bossId] || 'PROFESSIONELL', `NIVEAU ${funnel?.levelLabel || (level === 'c1' ? 'C1' : level === 'b2' ? 'B2' : 'A2–B1')}`, 'NUR DEUTSCH'].map((t) => (
                <span key={t} style={{ fontFamily:'var(--font-display)', fontWeight:600, fontSize:8.5, padding:'4px 10px',
                  borderRadius:'var(--r-pill)', letterSpacing:'0.12em',
                  background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.13)', color:'#cbd5e1' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* DEINE HP — bottom frame */}
        <div style={{ marginTop:6, position:'relative' }}>
          <HpBar label="ANTWORTQUALITÄT" value={playerHp} isPlayer={true} reason={playerReason} />
          {/* damage you took this turn — orange burst rising off your own bar (re-enabled 07-12) */}
          {scoreFlash && scoreFlash.taken > 0 && (
            <div key={`t${scoreFlash.id}`} style={{ position:'absolute', top:-8, right:18, zIndex:7,
              pointerEvents:'none', fontFamily:'var(--font-display)', fontWeight:800, fontSize:22,
              lineHeight:1, color:'#fdba74', textShadow:'0 2px 5px rgba(0,0,0,0.8)',
              animation:'dmg-pop 1.6s var(--ease) forwards' }}>
              −{scoreFlash.taken}
            </div>
          )}
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
              {bossSpeak ? `${funnel?.displayName ?? 'INTERVIEWER'} SPRICHT` : userSpeak ? 'DU SPRICHST' : isActive ? 'DIALOG' : 'INTERVIEW'}
            </span>
            {userSpeak && <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--player)', boxShadow:'0 0 6px var(--player)', animation:'pulse 0.8s infinite' }} />}
            <div style={{ flex:1 }} />
            {scoreFlash && (
              <span className="flash" style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:10,
                color: scoreFlash.score >= 60 ? 'var(--accent)' : '#f87171' }}>
                {scoreFlash.score}/100
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
                ? <span style={{ color:'#475569', animation:'pulse 1.2s infinite' }}>{funnel?.displayName ?? 'Der Interviewer'} spricht…</span>
                : <span style={{ color:'#334155' }}>Interview noch nicht gestartet.</span>}
          </div>
          {/* transcript log */}
          <div style={{ flex:1, minHeight:0, padding:'0 6px 6px' }}>
            <TranscriptPanel
              lines={liveTranscript && recording
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
            {geminiMode && (error === 'mic_denied' || error === 'mic_not_found') && (
              <div style={{ display:'flex', justifyContent:'center', gap:8, flexWrap:'wrap', marginTop:10 }}>
                <button onClick={() => startGeminiMic()}
                  style={{ minHeight:40, padding:'8px 13px', borderRadius:8, cursor:'pointer',
                    border:'1px solid var(--accent)', color:'#020409', fontWeight:800,
                    background:'linear-gradient(135deg,var(--accent-2),var(--accent))' }}>
                  MIKROFON ERNEUT AKTIVIEREN
                </button>
                <button onClick={() => {
                  stopGeminiMode();
                  setTypeOpen(true);
                  setError(null);
                  try { wsRef.current?.send(JSON.stringify({ type: C.REQUEST_TEXT_MODE })); } catch { /* socket closing */ }
                }}
                  style={{ minHeight:40, padding:'8px 13px', borderRadius:8, cursor:'pointer',
                    border:'1px solid #64748b', color:'#cbd5e1', background:'rgba(15,23,42,0.8)' }}>
                  Lieber tippen
                </button>
              </div>
            )}
            {!geminiMode && (error === 'mic_denied' || error === 'mic_not_found') && (
              <div style={{ display:'flex', justifyContent:'center', gap:8, flexWrap:'wrap', marginTop:10 }}>
                <button onClick={() => beginSession()}
                  style={{ minHeight:40, padding:'8px 13px', borderRadius:8, cursor:'pointer',
                    border:'1px solid var(--accent)', color:'#020409', fontWeight:800,
                    background:'linear-gradient(135deg,var(--accent-2),var(--accent))' }}>
                  MIKROFON ERLAUBEN &amp; STARTEN
                </button>
                <button onClick={() => {
                  setError(null);
                  setHandsFree(false);
                  setTypeOpen(true);
                  start();
                }}
                  style={{ minHeight:40, padding:'8px 13px', borderRadius:8, cursor:'pointer',
                    border:'1px solid #64748b', color:'#cbd5e1', background:'rgba(15,23,42,0.8)' }}>
                  Ohne Mikrofon tippen
                </button>
              </div>
            )}
            {/* The in-app browser can't do mic. The top escape banner scrolls off on a tall
                interview screen — so repeat the one-tap Chrome escape HERE, right where the user
                is looking for the mic and hit the failure. */}
            {error === 'audio_unsupported' && IN_APP_BROWSER && /Android/i.test(navigator.userAgent || '') && (
              <a href={`intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`}
                onClick={() => beacon('inapp_escape_tap')}
                style={{ display:'inline-block', marginLeft:8, minHeight:44, lineHeight:'24px',
                  color:'var(--accent-2)', fontWeight:700, textDecoration:'underline', textUnderlineOffset:3 }}>
                In Chrome öffnen →
              </a>
            )}
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
              1) „INTERVIEW STARTEN" drücken und laut Deutsch sprechen · 2) dein Niveau wird automatisch erkannt · 3) am Ende sofortiges Feedback.
            </div>
            <div dir="rtl" style={{ fontSize:11.5, color:'#94a3b8', lineHeight:1.6, marginTop:4 }}>
              ١) دوس «ابدأ» واتكلم ألماني بصوت عالي · ٢) مستواك بيتحدد أوتوماتيك · ٣) في الآخر هتاخد تقييم وتصحيح فوري.
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
            ) : (handsFree && !typeOpen) ? (
              /* Voice-first (aesthetic pass 2026-07-10): in hands-free the mic owns the turn, but a
                 large empty textarea + disabled SENDEN dominated the screen while a caption said
                 "just speak" — two competing instructions at once (the owner's own confusion:
                 "what's the correlation between me speaking and the words showing"). The typing
                 path stays one quiet tap away — it's the mic-broken fallback, not the main act. */
              <button onClick={() => setTypeOpen(true)} style={{ display:'block', margin:'0 auto',
                padding:'8px 12px', minHeight:40, background:'none', border:'none', cursor:'pointer',
                fontFamily:'var(--font-body)', fontSize:'var(--fs-meta)', color:'var(--text-faint)',
                textDecoration:'underline', textUnderlineOffset:3 }}>
                ⌨ Lieber tippen? · تحب تكتب؟
              </button>
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
          {/* Elite pass: the turn state jumped 13px→24px with a blue glow — a slot machine
              announcing your turn. Fixed size (no layout shift between states), no glow; a small
              live dot carries the state color. Quiet authority over shouting. */}
          {(isActive || isConnecting) && (
          <div style={{ fontFamily:'var(--font-display)', fontWeight:600, letterSpacing:'0.22em',
            fontSize:12.5, display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            color: bossSpeak ? boss.color : isActive ? 'var(--accent)' : 'var(--warn)',
            transition:'color 0.3s' }}>
            <span aria-hidden style={{ width:6, height:6, borderRadius:'50%', flex:'0 0 auto',
              background:'currentColor', opacity:0.9,
              animation: isActive && !bossThinking ? 'pulse 2.2s ease-in-out infinite' : 'none' }} />
            {isActive ? (bossThinking ? 'INTERVIEWER DENKT NACH…' : bossSpeak ? `${funnel?.displayName ?? 'INTERVIEWER'} SPRICHT` : 'DU BIST DRAN') : 'VERBINDE…'}
          </div>
          )}
          {geminiMode && lastTurnLatencyMs != null && (
            <div style={{ fontFamily:'var(--font-display)', fontSize:11, letterSpacing:'0.08em', marginTop:4,
              color: lastTurnLatencyMs <= 1800 ? 'var(--accent)' : lastTurnLatencyMs <= 3000 ? 'var(--warn)' : '#f87171' }}>
              ⏱ {(lastTurnLatencyMs / 1000).toFixed(1)}s
            </div>
          )}
          {isActive && !bossThinking && (
            <div style={{ fontSize:9, color:'#475569', marginTop:3 }}>
              {handsFree && !typeOpen
                ? 'Sprich einfach auf Deutsch — ich höre zu und sende automatisch.'
                : 'Tippe deine Antwort auf Deutsch — oder sprich sie ein.'}
            </div>
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
            {/* The daily cap is the highest-intent moment on the home screen (an engaged user who
                wants MORE) — before this link it said only "come back tomorrow" and sold nothing. */}
            <button onClick={() => setPaywall(auth.account?.entitlement || {})} style={{ display:'block', width:'100%',
              marginTop:8, padding:'10px', minHeight:44, cursor:'pointer', background:'none',
              border:'none', fontFamily:'var(--font-body)', fontSize:'var(--fs-label)', color:'var(--accent-2)' }}>
              <span style={{ textDecoration:'underline', textUnderlineOffset:3 }}>Mehr Interviews pro Tag? Pläne ansehen →</span>{/* OWNER-AR slot */}
            </button>
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

        {/* First-run reassurance: a novel user's whole home is just the hero + this one button. A short,
            low-stakes note lowers the "live German interview" fear. (Arabic left as an OWNER-AR slot; the
            quiet "Einstufung machen · تقييم مستواك" link below is the already-approved bilingual alternative.) */}
        {firstRun && (
          <div style={{ marginTop:12, textAlign:'center', fontSize:'var(--fs-meta)', color:'var(--text-dim)', lineHeight:1.55 }}>
            ⏱ ~7 Min · dein Niveau wird automatisch erkannt — einfach anfangen.
          </div>
        )}

        {/* THE PROOF CARD — feedback from an interview whose debrief the user never saw (they closed
            the tab / lost connection before it arrived; funnel 07-09: 31 starts → 4 debriefs seen).
            This is the product's core promise ("your German moved") delivered late rather than never.
            Corrections are LanguageTool-verified from the user's OWN sentences — the server stores
            none when there were none, so this card can never show invented noise. Quiet blue surface:
            the start button above keeps the screen's single orange. */}
        {canStart && lastDebrief && (
          <div style={{ marginTop:14, padding:'14px 16px', borderRadius:'var(--r-md)',
            background:'var(--surface)', border:'1px solid var(--accent)', textAlign:'left' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:'var(--fs-label)', fontWeight:700,
              color:'var(--accent)', marginBottom:8 }}>
              Aus deinem letzten Interview · من آخر إنترفيو ليك
            </div>
            {lastDebrief.abandoned && (
              <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginBottom:10, lineHeight:1.5 }}>
                Du warst weg, bevor dein Feedback ankam — hier ist es. <span dir="rtl">خرجت قبل ما الفيدباك يوصلك — أهو وصل دلوقتي.</span>
              </div>
            )}
            {(lastDebrief.corrections || []).filter((c) => String(c.wrong || '').length <= 80).map((c, i) => (
              <div key={i} style={{ marginBottom:8, fontSize:'var(--fs-label)', lineHeight:1.6, fontFamily:'var(--font-body)' }}>
                <span style={{ color:'var(--bad)', textDecoration:'line-through', textDecorationThickness:1 }}>{c.wrong}</span>
                {' → '}
                <span style={{ color:'var(--text)', fontWeight:600 }}>{c.right}</span>
                {/* the fragment gives the minimal word-pair its sentence context (same pattern as the debrief) */}
                {c.ctx && c.ctx !== c.wrong && (
                  <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-faint)', fontStyle:'italic', marginTop:2 }}>{c.ctx}</div>
                )}
              </div>
            ))}
            {lastDebrief.win?.title && (
              <div style={{ fontSize:'var(--fs-meta)', color:'var(--text-dim)', marginTop:4, lineHeight:1.5 }}>
                ✓ {lastDebrief.win.title}{lastDebrief.win.quote ? ` — „${lastDebrief.win.quote}“` : ''}
              </div>
            )}
            <button onClick={dismissLastDebrief} style={{ marginTop:10, padding:'8px 14px', minHeight:40,
              borderRadius:'var(--r-pill)', border:'1px solid var(--line)', background:'transparent',
              color:'var(--text-dim)', fontFamily:'var(--font-body)', fontSize:'var(--fs-meta)', cursor:'pointer' }}>
              Verstanden · تمام
            </button>
          </div>
        )}

        {/* Secondary home menu. On a phone it's a normal single-column stack; on a laptop it flows into
            2–3 columns (side-by-side, no endless scroll). See .home-grid in index.html. */}
        <div className="home-grid">

        {/* "AM I HIREABLE YET?" — the honest hire-readiness verdict, now on the HOME (not only on the
            post-interview results screen). This is the question a job-seeker asks every session; the app
            already computes it honestly (hireReadiness.js: names the ONE blocking skill, shows X/9 signals
            measured, returns null rather than guess). Returning users only — a novel user has no signals
            yet, and the component self-hides when there's nothing measurable. */}
        {canStart && !firstRun && hireReadiness && (
          <HireVerdict h={hireReadiness} compact onTrain={(drill, why) => {
            const OPEN = { fluency: setFluencyOpen, shadowing: setShadowingOpen, pressure: setPressureOpen,
              listening: setListeningOpen, spoken: setSpokenReviewOpen, satzbau: setSatzbauOpen };
            setDrillWhy(why || null);
            (OPEN[drill] || (() => {}))(true);
          }} />
        )}

        {/* Mission KPI: ask returning students for a job-search update (self-hides unless the server says due) */}
        {canStart && <PlacementPrompt token={auth.token} apiUrl={API_URL} lang={feedbackLang} />}

        {/* Quiet footer: the "Fortschritt & Wiederholung" progress view — one check-in-later row
            below the Übungen grid. (Musk-cut: the PDF cert + weekly leaderboard were vanity, off the
            get-hired loop — deleted.) */}

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

        {/* Pricing is reachable at ANY time (teardown blocker: during the whole trial the paywall
            was unreachable — a hot day-1 buyer literally could not find a price). Quiet text link
            per design law (the orange stays on the start button); trial users also see their honest
            remaining-days count so the upgrade moment isn't a day-4 surprise. */}
        {canStart && (
          <button onClick={() => setPaywall(auth.account?.entitlement || {})} style={{ width:'100%', marginTop:2, padding:'10px',
            minHeight:44, cursor:'pointer', background:'none', border:'none', fontFamily:'var(--font-body)',
            fontSize:'var(--fs-label)', color:'var(--accent-2)', textAlign:'center' }}>
            <span style={{ textDecoration:'underline', textUnderlineOffset:3 }}>Preise & Pläne ansehen</span>{/* OWNER-AR slot */}
            {auth.account?.entitlement?.trial?.active && (
              <span style={{ display:'block', marginTop:3, fontSize:'var(--fs-meta)', color:'var(--text-faint)' }}>
                Testphase: noch {auth.account.entitlement.trial.daysLeft} {auth.account.entitlement.trial.daysLeft === 1 ? 'Tag' : 'Tage'} — alle Funktionen freigeschaltet{/* OWNER-AR slot */}
              </span>
            )}
          </button>
        )}

        {/* WhatsApp opt-in — after interview #1 only, hidden once opted in (server flag covers
            other devices). The only $0 comeback channel this product has. */}
        {canStart && !firstRun && !auth.account?.whatsapp && (
          <WhatsAppOptIn token={auth.token} apiUrl={API_URL} />
        )}

        {/* ÜBUNGEN GRID (uplift): the 7-button drill wall becomes one titled card with icon tiles —
            2 columns, real SVG icons, every tile the same quiet weight (the #ef4444 red is gone;
            Druck-Leiter carries a neutral SCHWER badge instead). Hidden on first-run — an 8-tile drill
            wall before the first interview is choice-overload; the interview routes them to the right
            drill afterwards. */}
        {canStart && !firstRun && (
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

        {/* FOOTER LIST (uplift): the check-in-later rows — one card, hairline dividers, no shouting.
            Hidden on first-run — progress is empty before the first interview. */}
        {canStart && !firstRun && (
          <div style={{ marginTop:10, borderRadius:'var(--r-lg)', background:'var(--surface)', border:'1px solid var(--line)', overflow:'hidden' }}>
            {[
              { icon:'chartUp',   de:'Fortschritt & Wiederholung', ar:'',                     open: openDashboard },
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

        {/* Install nudge — the durable-login fix (installed PWA = exempt from iOS storage
            eviction) and a home-screen icon for daily practice. Quiet, once-dismissible. */}
        {canStart && !firstRun && <InstallCard />}
        {/* Permanent feedback button (idle only; hidden on first-run — nothing to give feedback on yet) */}
        {canStart && !firstRun && <PushReminder token={auth.token} apiUrl={API_URL}
          reminderState={{ streak: daily.streak, shield: daily.streakShield, trainedToday,
            sessionsToNext: rank?.sessionsToNext, nextLabel: rank?.nextLabel }} />}
        {canStart && !firstRun && <HomeFeedback token={auth.token} apiUrl={API_URL} />}
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

// ── Install nudge (PWA) ───────────────────────────────────────────────────────
// Android/Chrome: real one-tap install via the captured beforeinstallprompt. iOS Safari: no such
// event exists — a one-time Add-to-Home-Screen instruction instead. Both dismiss forever with one
// tap. Never shown installed / in-app browsers (they can't install) / when neither path applies.
function InstallCard() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('bpo_a2hs_seen') === '1'; } catch { return true; }
  });
  const [done, setDone] = useState(false);
  const canPrompt = !!_pwaPrompt;
  const visible = !IS_STANDALONE && !IN_APP_BROWSER && !dismissed && !done && (canPrompt || IS_IOS);
  useEffect(() => {
    if (visible) beacon(canPrompt ? 'pwa_install_shown' : 'pwa_ios_hint_shown');
  }, [visible, canPrompt]);
  if (!visible) return null;

  const dismiss = () => { try { localStorage.setItem('bpo_a2hs_seen', '1'); } catch {} setDismissed(true); };
  const install = async () => {
    const p = _pwaPrompt;
    if (!p) return dismiss();
    try {
      p.prompt();
      const choice = await p.userChoice;
      if (choice?.outcome === 'accepted') beacon('pwa_install_accepted');
    } catch { /* prompt already consumed */ }
    _pwaPrompt = null; setDone(true);
    try { localStorage.setItem('bpo_a2hs_seen', '1'); } catch {}
  };

  return (
    <div style={{ marginTop: 12, padding: '11px 13px', borderRadius: 12, display: 'flex', gap: 11,
      alignItems: 'center', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.22)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--accent)' }}>
        <Icon name="chartUp" size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>App installieren{/* OWNER-AR slot */}</div>
        <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5, marginTop: 2 }}>
          {canPrompt
            ? 'Dein Login bleibt dauerhaft, Start mit einem Tipp.'
            : 'iPhone: Teilen-Symbol → „Zum Home-Bildschirm“ — dein Login bleibt dann dauerhaft.'}
          {/* OWNER-AR slot */}
        </div>
      </div>
      {canPrompt && (
        <button onClick={install} style={{ flexShrink: 0, padding: '9px 13px', minHeight: 40, cursor: 'pointer',
          borderRadius: 9, border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.14)',
          fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
          color: 'var(--accent-2)' }}>
          INSTALLIEREN
        </button>
      )}
      <button aria-label="Ausblenden" onClick={dismiss} style={{ flexShrink: 0, minWidth: 40, minHeight: 40,
        background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>✕</button>
    </div>
  );
}

// ── Root: authentication gate around the arena ────────────────────────────────
function AuthedApp() {
  const [auth, setAuth] = useState(loadStoredAuth);
  const [verification] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('verify') || '';
      if (token) {
        params.delete('verify');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      }
      return token;
    } catch { return ''; }
  });
  const [verificationState, setVerificationState] = useState(verification ? 'working' : null);
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  useEffect(() => {
    if (!verification) return;
    let cancelled = false;
    setVerificationState('working');
    const verify = async () => {
      try {
        const r = await fetch(`${API_URL}/api/auth/verify`, {
          method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ token:verification }),
        });
        if (!r.ok) {
          if (!cancelled) setVerificationState(r.status === 429 ? 'rate_limited' : r.status >= 500 ? 'network' : 'invalid');
          return;
        }
        if (cancelled) return;
        // A successful verify response is authoritative even if the follow-up /me refresh is
        // temporarily offline. Update the cached account immediately; server routes still enforce it.
        setAuth((cur) => {
          if (!cur) return cur;
          const updated = { token:cur.token, account:{ ...cur.account, emailVerified:true } };
          persistAuth(updated);
          return updated;
        });
        if (auth?.token) {
          try {
            const me = await fetch(`${API_URL}/api/auth/me`, { headers:{ Authorization:`Bearer ${auth.token}` } });
            if (me.ok) {
              const d = await me.json();
              if (!cancelled) setAuth((cur) => {
                if (!cur) return cur;
                const updated = { token:cur.token, account:d.account };
                persistAuth(updated);
                return updated;
              });
            }
          } catch { /* verification succeeded; the regular account refresh can recover later */ }
        }
        if (!cancelled) setVerificationState('success');
      } catch {
        if (!cancelled) setVerificationState('network');
      }
    };
    verify();
    return () => { cancelled = true; };
  }, [verification, verificationAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate / refresh the stored token on mount; drop it if the server rejects.
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${auth.token}` } })
      .then(async (r) => {
        if (r.ok) {
          // Token valid → refresh the cached account.
          const d = await r.json();
          if (!cancelled) { const a = { token: auth.token, account: d.account }; persistAuth(a); setAuth(a); }
        } else if (r.status === 401 || r.status === 403) {
          // Token genuinely rejected → this is the ONLY case that logs you out.
          if (!cancelled) { persistAuth(null); setAuth(null); }
        }
        // Any other status (5xx, Render cold-start error page, etc.) → keep the cached session; the token is almost certainly still good.
      })
      .catch(() => { /* network error / offline / cold-start timeout → keep the cached session, do NOT log out */ });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuth    = useCallback((a) => { persistAuth(a); setAuth(a); }, []);
  const handleLogout  = useCallback(() => { persistAuth(null); setAuth(null); }, []);
  const handleAccount = useCallback((account) => {
    setAuth((cur) => { if (!cur) return cur; const a = { token: cur.token, account }; persistAuth(a); return a; });
  }, []);

  // Tiny build badge on every screen so the running version is provable (kills "nothing changed" guessing).
  const buildId = BUILD_ID || (typeof document !== 'undefined' && document.querySelector('meta[name=build]')?.content) || 'dev';
  const buildBadge = !IS_PRODUCTION ? (
    <div style={{ position:'fixed', bottom:5, right:7, zIndex:99999, fontSize:9, letterSpacing:'0.06em',
      color:'rgba(154,167,189,0.55)', fontFamily:'var(--font-mono)', pointerEvents:'none' }}>
      v·{buildId}
    </div>
  ) : null;
  if (verificationState === 'working' || verificationState === 'network' || verificationState === 'rate_limited') {
    return <>{buildBadge}<VerificationLinkScreen state={verificationState}
      onRetry={() => setVerificationAttempt((n) => n + 1)} /></>;
  }
  if (!auth) return <>{buildBadge}<AuthScreen onAuth={handleAuth}
    initialMode={verificationState === 'success' ? 'login' : null}
    verificationNotice={verificationState === 'success' || verificationState === 'invalid' ? { state:verificationState } : null} /></>;
  if (auth.account?.emailVerified === false) return <>{buildBadge}<EmailVerificationGate auth={auth}
    onLogout={handleLogout} linkState={verificationState} /></>;
  return <>{buildBadge}<Arena auth={auth} onLogout={handleLogout} onAccountUpdate={handleAccount} /></>;
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
          {/* spinner ring + mic (was a pulsing 🥊 — emoji is never chrome; the product is an interview, not a match) */}
          <div style={{ position:'relative', width:74, height:74, display:'grid', placeItems:'center' }}>
            <div style={{ position:'absolute', inset:0, borderRadius:'50%',
              border:'3px solid rgba(59,130,246,0.16)', borderTopColor:'var(--accent)',
              animation:'spin 0.9s linear infinite' }} />
            <div style={{ color:'var(--accent)', animation:'pulse 1.4s ease-in-out infinite', display:'grid', placeItems:'center' }}><Icon name="mic" size={28} /></div>
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

  // Availability must never hide the offer, signup, or typed practice. The wake loop is
  // background-only; live actions already surface their own retryable connection state.
  const legacyBlockingScreen = false;
  return <>{children}{legacyBlockingScreen && <ColdStartScreen phase={phase} elapsed={elapsed} onRetry={wake} />}</>;
}

// ── Root: cold-start gate → auth gate → arena ─────────────────────────────────
// FULL-SCREEN, UN-SKIPPABLE in-app-browser gate. The 07-08 funnel proved the disaster: 22/23 opens
// were inside Messenger/Facebook's browser, the boss voice played 16× but the mic started only 4× —
// people HEARD the interviewer and couldn't answer, then left without a word (that's why "nobody
// gave feedback"). A scroll-past banner wasn't enough. This blocks the ENTIRE app until the visitor
// moves to a real browser. Three escape routes, most-reliable first: (1) Copy link — works on EVERY
// phone/OS even when the Chrome shortcut fails; (2) one-tap Open-in-Chrome (Android intent); (3) the
// native APK (mic works regardless of browser). A tiny "continue anyway" remains as a safety valve
// so a false-positive detection can never hard-trap a user whose mic actually works.
// OWNER-AR slots — the owner fills these masri lines (I must never author Egyptian Arabic). Empty =
// the Arabic simply doesn't render; German + English + the button icons still carry the meaning.
const AR_GATE = { headline: '', copySteps: '', ios: '' };
function InAppBrowserGate({ onContinue }) {
  const [copied, setCopied] = useState(false);
  const url = 'https://omni-perform.vercel.app';
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  useEffect(() => { beacon('inapp_gate_shown'); }, []);
  const copyLink = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* fallback */ }
    if (!ok) { try { const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.focus(); t.select(); ok = document.execCommand('copy'); t.remove(); } catch { /* last resort: manual select below */ } }
    beacon('inapp_gate_copy');
    setCopied(true); setTimeout(() => setCopied(false), 5000);
  };
  const btn = { display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%',
    minHeight:56, borderRadius:14, textDecoration:'none', fontFamily:'Inter, system-ui, sans-serif',
    fontWeight:700, fontSize:16, cursor:'pointer', border:'none', boxSizing:'border-box' };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:99999, background:'#060a12', color:'#e2e8f0',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      padding:'28px 22px', overflowY:'auto', fontFamily:'Inter, system-ui, sans-serif' }}>
      <div style={{ width:'100%', maxWidth:400, textAlign:'center' }}>
        <div style={{ width:72, height:72, margin:'0 auto 20px', borderRadius:20, display:'flex',
          alignItems:'center', justifyContent:'center', background:'rgba(59,130,246,0.12)',
          border:'1px solid rgba(59,130,246,0.4)', fontSize:36 }}>🎤</div>
        <div style={{ fontSize:23, fontWeight:800, lineHeight:1.25, marginBottom:10 }}>
          Zum Sprechen: in Chrome öffnen
        </div>
        {AR_GATE.headline && (
          <div dir="rtl" style={{ fontSize:18, fontWeight:700, color:'#93c5fd', marginBottom:10 }}>
            {AR_GATE.headline}{/* OWNER-AR: "To speak: open the page in Chrome (not in Messenger)" */}
          </div>
        )}
        <div style={{ fontSize:14.5, lineHeight:1.6, color:'#94a3b8', marginBottom:8 }}>
          Der Facebook-/Messenger-Browser blockiert das Mikrofon. Das Interview braucht deine Stimme —
          in Chrome oder Safari läuft alles.
        </div>
        <div style={{ fontSize:13.5, lineHeight:1.6, color:'#64748b', marginBottom:20 }}>
          The Facebook / Messenger browser blocks the microphone. Open this page in Chrome or Safari.
        </div>

        {/* The URL, selectable, so manual copy always works even if the button is blocked */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', marginBottom:16,
          borderRadius:12, background:'#0d1424', border:'1px solid #1e293b', userSelect:'all',
          fontSize:13.5, wordBreak:'break-all', color:'#cbd5e1' }}>{url}</div>

        {/* PRIMARY — Copy link. The single orange object on this screen (design law). Works everywhere. */}
        <button onClick={copyLink} style={{ ...btn, marginBottom:12,
          background: copied ? 'linear-gradient(135deg,#60a5fa,#3b82f6)' : 'linear-gradient(135deg,#fb923c,#f97316)', color:'#0a0f1a' }}>
          {copied ? '✓ Kopiert! Jetzt Chrome öffnen & einfügen' : '📋 Link kopieren'}
        </button>
        {copied && (
          <div style={{ fontSize:13, color:'#93c5fd', marginBottom:14, lineHeight:1.55 }}>
            1) Chrome (or Safari) öffnen → 2) in die Adresszeile tippen → 3) einfügen & öffnen.
            {AR_GATE.copySteps && <><br/><span dir="rtl">{AR_GATE.copySteps}{/* OWNER-AR: "Open Chrome, paste the link at the top, and open it." */}</span></>}
          </div>
        )}

        {/* Android one-tap Chrome escape */}
        {isAndroid && (
          <a href={`intent://${url.replace(/^https?:\/\//,'')}#Intent;scheme=https;package=com.android.chrome;end`}
            onClick={() => beacon('inapp_escape_tap')}
            style={{ ...btn, marginBottom:12, background:'linear-gradient(135deg,#60a5fa,#3b82f6)', color:'#04070d' }}>
            🌐 Direkt in Chrome öffnen
          </a>
        )}

        {/* iOS route (no intent scheme exists on iOS) */}
        {isIOS && (
          <div style={{ fontSize:14, lineHeight:1.6, color:'#93c5fd', marginBottom:12, fontWeight:600 }}>
            iPhone: Menü (⋯ oben) → „In Safari öffnen" · iPhone: menu (⋯ top) → "Open in Safari"
            {AR_GATE.ios && <><br/><span dir="rtl">{AR_GATE.ios}{/* OWNER-AR: "iPhone: from the top menu → open in Safari" */}</span></>}
          </div>
        )}

        {/* Safety valve — never hard-trap a false-positive whose mic actually works */}
        <button onClick={() => { beacon('inapp_gate_bypass'); onContinue(); }}
          style={{ background:'none', border:'none', color:'#475569', fontSize:12, marginTop:10,
            cursor:'pointer', textDecoration:'underline', textUnderlineOffset:3 }}>
          Trotzdem hier fortfahren / continue anyway
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // Inject the global CSS once, app-wide, so the cold-start + auth screens are styled too.
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.prepend(el);
    return () => el.remove();
  }, []);
  // Social in-app browsers can still register, assess, and answer by text. Voice guidance is
  // shown only when relevant; never block the entire acquisition path before value.
  const [bypassGate, setBypassGate] = useState(false);
  const blockingInAppGate = false;
  return <>
    {blockingInAppGate && IN_APP_BROWSER && !bypassGate && <InAppBrowserGate onContinue={() => setBypassGate(true)} />}
    <BackendGate><AuthedApp /></BackendGate>
  </>;
}
