import { WebSocketServer } from 'ws';
import { randomUUID }      from 'crypto';
import { RealtimeClient }  from './realtimeClient.js';
import { DeepgramStreamer } from './streamingTranscribe.js';
import { generateDebrief } from './coach.js';
import { isSpeakableRule } from './grammarCheck.js';
import { gradeTranscript } from './scoring/panelscorer.mjs';
import { textFeatures } from './hireReadiness.js';
import { recordTurn } from './latencyLog.js';
import { loadUser, saveUser } from './store.js';
import { loadGuide, saveGuide } from './guideStore.js';
import { addItem, dueCount, seedBPOPhrases } from './srs.js';
import { BPO_PHRASES } from './scenarios.js';
import { bossForLevel, levelFor, xpForSession, levelProgress, nextBoss, computeStreak, computeRank, BOSS_LADDER } from './progression.js';
import { verifyToken, getAccountById, entitlement, planOf, dailyMinutesFor, freeFightAvailable, consumeFreeFight } from './auth.js';
import { classifyGrammar }       from './errorTags.js';
import { buildBossMemory }        from './bossMemory.js';
import { refreshRecommendations, allRecommendedDone } from './trainingslager.js';
import { getLesson }              from './lessons.config.js';
import { dayKey }                 from './time.js';

// Gemini Live native-audio path is active only when explicitly enabled. Defined here (not just in
// server.js) because the fight-start path references it — a bare reference would ReferenceError.
const USE_GEMINI_LIVE = process.env.USE_GEMINI_LIVE === '1';

const PING_INTERVAL_MS   = 25_000;
const SESSION_TIMEOUT_MS = 300_000;
const MAX_MESSAGE_BYTES  = 65_536;
// Hard wall-clock cap: a single fight can NEVER bill the OpenAI Realtime API longer
// than this, no matter how active the mic is. (The idle timeout above never fires
// while audio is streaming.) 8 minutes is well past a complete 3-part interview.
const MAX_FIGHT_MS = 8 * 60_000;
// When the daily-minute (or global) cap is hit we end GRACEFULLY: the boss finishes its
// current turn (no mid-sentence cut). This is the hard backstop if it never wraps.
const GRACE_CLOSE_MS = 30_000;
// PCM16 mono @ 24 kHz = 48000 bytes per second of audio — used to convert the billed
// audio byte counts into seconds for the per-fight cost log.
const PCM16_BYTES_PER_SEC = 48_000;

// ── HP / scoring tuning ───────────────────────────────────────────────────────
// Damage is deliberately gradual so a session lasts many exchanges and never ends
// in one or two hits. Caps are per-exchange.
const MIN_SCORED_WORDS  = 3;     // ignore VAD fragments (0-2 word transcription bursts)
const SCORE_COOLDOWN_MS = 1500;  // one burst of fragments = at most one scored hit
const MAX_PLAYER_DMG    = 12;    // weakest answer costs the player at most this
const MAX_BOSS_DMG      = 15;    // strongest answer costs the boss at most this

// ── Funnel stage advancement (UI tracker) ─────────────────────────────────────
// The boss prompt drives the actual 3-part conversation; this maps cumulative
// scored answers to the displayed stage. Thresholds match the prompt's pacing
// (~1-2 intro exchanges, ~2 behavioral, then roleplay for the rest).
const STAGE_AFTER = [2, 4];      // <2 → intro(0), <4 → behavioral(1), else roleplay(2)
function stageForAnswers(n) {
  if (n < STAGE_AFTER[0]) return 0;
  if (n < STAGE_AFTER[1]) return 1;
  return 2;
}

// The candidate's most recurring grammar weakness (for the boss memory dossier):
// the still-unmastered grammar rule they've relapsed on most.
function topWeakRule(profile) {
  const items = (profile?.srs || []).filter((i) => i.type === 'grammar' && !i.mastered && i.content && isSpeakableRule(i.content));
  if (!items.length) return null;
  items.sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || (b.reps || 0) - (a.reps || 0));
  return items[0].content;
}
// All three parts are "complete" once the roleplay (final part) has had this many
// scored exchanges. The SERVER alone decides the session is over (never the client),
// and only after the boss finishes its current turn — so screen and voice stay in sync.
const ROLEPLAY_EXCHANGES = 4;

// ── "Real session" floor (single source of truth) ────────────────────────────
// A session only earns feedback/scores/recommendations if the user ACTUALLY spoke:
// at least MIN_REAL_ANSWERS scored utterance(s) AND MIN_REAL_WORDS total words. Opening a
// fight and closing it without speaking does NOT clear this floor → no debrief is generated
// (see _finishSession), and nothing is persisted (see _persistProgress). An utterance is only
// counted when it has ≥2 words (see _onTranscriptDone), so VAD blips don't fake a session.
const MIN_REAL_ANSWERS = 1;
const MIN_REAL_WORDS   = 8;

// ── Outbound message types (server → browser) ─────────────────────────────────
const S = {
  SESSION_READY:      'session_ready',
  SESSION_CLOSED:     'session_closed',
  AUDIO_DELTA:        'audio_delta',
  TRANSCRIPT_DELTA:   'transcript_delta',
  TRANSCRIPT_DONE:    'transcript_done',
  TRANSCRIPT_PARTIAL: 'transcript_partial',   // Deepgram streaming interim result
  BOSS_SPEECH:        'boss_speech',
  BOSS_SPEECH_DONE:   'boss_speech_done',
  // ── Gemini Live audio path (replaces TTS when USE_GEMINI_LIVE=1) ────────────
  BOSS_AUDIO_DELTA:  'boss_audio_delta',   // b64 PCM16 @ 24 kHz — streamed boss voice
  LIVE_USER_TRANSCRIPT_PARTIAL: 'live_user_transcript_partial',
  LIVE_USER_TRANSCRIPT_DONE:    'live_user_transcript_done',
  LIVE_BOSS_TRANSCRIPT:        'live_boss_transcript',  // sentinel '__TURN_COMPLETE__' ends turn
  // ───────────────────────────────────────────────────────────────────────────
  SCENARIO_INFO:      'scenario_info',
  STAGE_UPDATE:       'stage_update',
  DEBRIEF_PENDING:    'debrief_pending',
  DEBRIEF:            'debrief',
  NO_SESSION:         'no_session',   // closed without real participation → no feedback card
  PAYWALL:            'paywall',
  HP_UPDATE:          'hp_update',
  LIVE_STATS:         'live_stats',
  ERROR:              'error',
  PONG:               'pong',
};

// ── Abuse / insult detector (deterministic, no API call) ───────────────────────
// Explicit Arabic + German insults only. Owner must review and expand this list.
// Tier 1 = mild (warn + continue); Tier 2 = severe (professional end-of-call).
const ABUSE_T1 = /\b(?:حقير|حمار|وسخ|منحط|حيوان|خنزير|كلب|عبيط)\b/iu;
const ABUSE_T2 = /\b(?:hurensohn|hure|schlampe|wichser|arschloch|drecksau|fotze|spast|spasti|vollidiot|arsch|scheiß|kacke|pisser|ficker|ficken)\b/iu;
const ABUSE_WARN = 'Ich muss Sie darauf hinweisen: Ihre Ausdrucksweise ist nicht akzeptabel. Bitte bleiben Sie professionell.';
const ABUSE_END  = 'Damit ist Schluss. Ich beende das Gespräch.';

// ── Inbound message types (browser → server) ──────────────────────────────────
const C = {
  START_FIGHT:  'start_fight',
  STOP_FIGHT:   'stop_fight',
  // Turn-based: ONE answer per turn. Can arrive as TEXT (typed/transcribed client-side)
  // or via streaming PCM audio: AUDIO_CHUNK streams raw b64 PCM to the server, which
  // pipes it to Deepgram LiveTranscription and fires ANSWER internally on speech_final.
  ANSWER:       'answer',
  AUDIO_CHUNK:  'audio_chunk',   // b64-encoded linear16 PCM chunk (hands-free streaming)
  AUDIO_END:    'audio_end',     // client: VAD silence detected — finalize the stream
  PING:         'ping',
};

export class WebSocketManager {
  constructor(httpServer) {
    /** @type {Map<string, SessionContext>} */
    this._sessions = new Map();
    // Account IDs with a fight currently in flight — a per-user single-flight lock so a
    // double-click (which opens TWO browser sockets) cannot open two Realtime sessions.
    this._activeFightUsers = new Set();

    // Same origin allowlist as the HTTP CORS layer — the WS upgrade must validate Origin
    // too, otherwise any website could open sockets against us. No Origin header (native
    // clients / health checks) is allowed; a browser Origin must be on the list.
    const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
      .split(',').map((s) => s.trim()).filter(Boolean);

    this._wss = new WebSocketServer({
      server:     httpServer,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      verifyClient: ({ origin }, cb) => {
        const ok = !origin || allowedOrigins.includes(origin);
        if (!ok) console.warn(`[wsManager] Rejected WS upgrade — origin not allowed: ${origin}`);
        cb(ok, ok ? undefined : 403, 'forbidden_origin');
      },
    });

    this._wss.on('connection', (socket, request) => this._onConnection(socket, request));
    this._wss.on('error',      (err) => console.error('[wsManager] WSS error:', err.message));

    this._pingTimer = setInterval(() => this._heartbeat(), PING_INTERVAL_MS);
    this._pingTimer.unref?.();

    console.log('[wsManager] Ready');
  }

  // ── New browser connection ──────────────────────────────────────────────────

  _onConnection(socket, request) {
    const sessionId = randomUUID();
    const remoteIp  = request.headers['x-forwarded-for'] ?? request.socket.remoteAddress ?? 'unknown';

    console.log(`[wsManager] New connection  session=${sessionId}  ip=${remoteIp}`);

    /** @type {SessionContext} */
    const ctx = {
      sessionId,
      socket,
      realtimeClient: null,
      isAlive:        true,
      createdAt:      Date.now(),
      lastActivityAt: Date.now(),
      bossHp:         100,
      playerHp:       100,
      lastScoredAt:   0,
      scoredAnswers:  0,
      stageIdx:       0,
      level:          'a2-b1',
      stages:         [],
      utterances:     [],     // candidate's real sentences, for the end-of-session debrief
      dialogue:       [],     // FULL ordered exchange (boss question → candidate answer) for the dialogue-aware debrief
      totalSpeechMs:  0,       // summed VAD speech segments, for WPM
      fightStartedAt: 0,       // wall-clock start of the billed Realtime session
      audioInBytes:   0,       // total PCM16 audio bytes sent to OpenAI (user mic)
      audioOutBytes:  0,       // total PCM16 audio bytes received from OpenAI (boss voice)
      maxTimer:       null,    // hard MAX_FIGHT_MS cap timer
      accountLocked:  null,    // account id held in _activeFightUsers (for release)
      debriefSent:    false,
      ending:         false,   // true once the session is being ended
      closed:         false,   // guards _endSession against double-firing
      completePending: false,  // all 3 parts done; end after the boss finishes talking
      userId:         'anon',
      bossId:         'yasmin',
      scoreSum:       0,
      scoreCount:     0,
      csScoreSum:     0,       // de-escalation proxy: sum of CS-roleplay (stage 2) answer scores
      csScoreCount:   0,
      confSum:        0,       // intelligibility proxy: sum of Deepgram word confidences
      confCount:      0,
      latSum:         0,       // composure proxy: sum of per-turn reaction latencies (s)
      latCount:       0,
      _bossEndedMs:   null,    // wall-clock when the boss finished speaking (for reaction latency)
      fillerTotal:    0,       // cumulative filler words this session (for the live counter)
      combo:          0,       // consecutive strong answers (for the combo multiplier)
      comboBest:      0,       // best combo reached this session
      weakStreak:     0,       // consecutive broken answers (triggers the rescue move)
      // ── Legacy Groq text path ──────────────────────────────────────────────────
      dgStreamer:     null,    // DeepgramStreamer for hands-free streaming STT (one per turn)
      // ── Gemini Live path (active when USE_GEMINI_LIVE=1) ──────────────────────
      geminiLive:     null,    // GeminiLiveProxy instance (or null on Groq path)
      geminiLiveMode: false,   // true when this session runs on native audio
      // Turn accumulation — Deepgram only TRANSCRIBES; the client's adaptive VAD owns the
      // turn boundary. We concatenate every Deepgram segment of the current turn here and
      // commit ONCE when the client sends AUDIO_END (never on Deepgram's own speech_final —
      // that 700ms endpoint was the real "cuts me off mid-thought" bug).
      _turnText:   '',
      _turnWords:  [],
      _commitTimer: null,
      _lastInterim:  '',
      _speechStartMs: null,
      _lastWords:    null,
      // Correction-probe budget — a real interviewer corrects RARELY (research: ≤1 per ~3 turns,
      // ≤2 per session, never twice in a row, never a barrage). These caps stop the boss feeling
      // like it interrupts "for no reason."
      correctionCooldown:    0,
      correctionsUsed:       0,
      lastTurnWasCorrection: false,
      errorCounts:           {},
      errorLabels:           [],
      // ── Gemini Live audio path (USE_GEMINI_LIVE=1) ──────────────────────────────
      geminiProxy:       null,  // GeminiLiveProxy instance for this session
      geminiActive:      false, // true while the boss is "speaking" via Gemini audio stream (half-duplex)
      geminiUserParts:   [],    // accumulated user-transcript parts this Gemini turn (for scoring)
      geminiBossParts:   [],    // accumulated boss-transcript parts this Gemini turn (display + debrief)
      _geminiTurnStartMs: 0,    // wall-clock start of the current Gemini user turn (for durationMs)
    };

    this._sessions.set(sessionId, ctx);

    socket.on('message', (data, isBinary) => this._onMessage(ctx, data, isBinary));
    socket.on('close',   (code, reason)   => this._onClose(ctx, code, reason));
    socket.on('error',   (err)            => console.error(`[wsManager] socket error session=${sessionId}:`, err.message));
    socket.on('pong',    ()               => { ctx.isAlive = true; });

    this._send(ctx, {
      type:      S.SESSION_READY,
      sessionId,
      bossHp:    ctx.bossHp,
      playerHp:  ctx.playerHp,
    });
  }

  // ── Inbound message dispatch ────────────────────────────────────────────────

  _onMessage(ctx, data, isBinary) {
    ctx.lastActivityAt = Date.now();

    if (isBinary) return; // we only use text frames

    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      this._sendError(ctx, 'invalid_json');
      return;
    }

    if (typeof msg.type !== 'string') {
      this._sendError(ctx, 'missing_type');
      return;
    }

    switch (msg.type) {
      case C.PING:
        this._send(ctx, { type: S.PONG, ts: Date.now() });
        break;

      case C.START_FIGHT:
        this._handleStartFight(ctx, msg);
        break;

      case C.STOP_FIGHT:
        this._handleStopFight(ctx);
        break;

      case C.ANSWER:
        this._handleAnswer(ctx, msg);
        break;

      case C.AUDIO_CHUNK:
        // Gemini Live path: forward raw PCM directly to the proxy; skip Deepgram entirely.
        if (ctx.geminiLiveMode && ctx.geminiProxy) {
          const buf = Buffer.from(msg.data, 'base64');
          ctx.audioInBytes += buf.length;
          const sent = ctx.geminiProxy.sendAudioChunk(buf.toString('base64'));
          if (!sent && !ctx._glChunkWarned) {
            ctx._glChunkWarned = true;
            console.warn(`[wsManager] Gemini proxy not ready — audio chunk dropped  session=${ctx.sessionId}`);
          }
        } else {
          this._handleAudioChunk(ctx, msg);
        }
        break;

      case C.AUDIO_END:
        // In GL mode the turn boundary is owned by Gemini's native VAD — just release the
        // half-duplex gate so the browser knows the user can start speaking again.
        if (ctx.geminiLiveMode) {
          ctx._glChunkWarned = false;
          this._send(ctx, { type: S.LIVE_USER_TRANSCRIPT_DONE, transcript: ctx.geminiUserParts.join('').trim() });
        } else {
          this._handleAudioEnd(ctx);
        }
        break;

      default:
        console.warn(`[wsManager] Unknown message type="${msg.type}" session=${ctx.sessionId}`);
    }
  }

  // ── Fight lifecycle ─────────────────────────────────────────────────────────

  async _handleStartFight(ctx, msg) {
    if (ctx.realtimeClient) {
      this._sendError(ctx, 'fight_already_active');
      return;
    }

    // ── Auth + subscription gate (server-side; cannot be bypassed by the client) ──
    const payload = verifyToken(msg.token);
    const account = payload ? await getAccountById(payload.uid) : null;
    if (!account) { this._sendError(ctx, 'auth_required'); return; }

    // ── Plan gate: paid plan has live minutes; a free account gets ONE free 7-min fight, then upsell ──
    const minutes = dailyMinutesFor(account);   // free 0 / basic 7 / elite 15
    let freeFightSec = 0;
    if (minutes <= 0) {
      if (!freeFightAvailable(account)) {
        console.log(`[wsManager] Paywall (free fight already used)  user=${account.id}  session=${ctx.sessionId}`);
        this._send(ctx, { type: S.PAYWALL, ...entitlement(account) });
        return;
      }
      freeFightSec = 7 * 60;   // grant the one-time free 7-minute interview
      console.log(`[wsManager] Granting one-time FREE 7-min fight  user=${account.id}  session=${ctx.sessionId}`);
    }

    // Per-user single-flight lock (check + set are atomic: no await between them) so a
    // double-click that opens two sockets cannot start two paid Realtime sessions.
    if (this._activeFightUsers.has(account.id)) {
      console.warn(`[wsManager] Duplicate start blocked  user=${account.id}  session=${ctx.sessionId}`);
      this._sendError(ctx, 'fight_already_active');
      return;
    }
    this._activeFightUsers.add(account.id);
    ctx.accountLocked = account.id;

    ctx.userId   = account.id;
    const level  = ['b2', 'c1'].includes(msg.level) ? msg.level : 'a2-b1';
    const viaBossTor = msg.mode === 'bosstor';

    // Boss is chosen by the user's progression (warm-up → standard → final boss).
    let bossId = 'yasmin';
    let dossier = null;
    let memory = null;
    let focusTitle = null;
    let prof = null;
    let candidateName = null;
    try {
      prof = await loadUser(ctx.userId);
      bossId  = bossForLevel(prof.level).id;
      dossier = topWeakRule(prof);   // recurring weak grammar rule → boss memory dossier
      ctx.targetWeakRule = dossier;  // the PURE weak rule we re-test this session → measure its delta at debrief
      focusTitle = getLesson(prof.lastCompletedLesson)?.title_de || null; // Trainingslager fight focus
      // Enrich dossier with recurring error labels from recent sessions
      const recentErrs = (prof.recentErrors || []).slice(0, 2).filter(Boolean);
      if (recentErrs.length) {
        const errsStr = `Wiederkehrendes Muster aus der letzten Sitzung: ${recentErrs.join(', ')}`;
        dossier = [dossier, errsStr].filter(Boolean).join('. ');
      }
      // Growth-aware cross-session memory (separate from the weak-rule re-test): trajectory,
      // persistent mistakes, an absence — so the boss acts like a returning interviewer who
      // watched this candidate grow. Deterministic, never fabricated; see bossMemory.js.
      memory = buildBossMemory(prof);
      // Name recall from the guide profile (detectName in alhassan.js stores it when the candidate
      // says their name in chat). If we have it, the opening line will address them naturally.
      try {
        const guide = await loadGuide(account.id);
        candidateName = guide?.name || null;
      } catch {}
    } catch {}

    // Boss-picker: let the client choose a specific interviewer so all 5 voices/personas
    // can be tested directly (otherwise the boss is gated by level). Validated against the ladder.
    if (msg.bossId && BOSS_LADDER.some(b => b.id === msg.bossId)) {
      bossId = msg.bossId;
      console.log(`[wsManager] boss-picker override → ${bossId}  session=${ctx.sessionId}`);
    }

    // ── Daily live-minute remaining (reset midnight Africa/Cairo) — hard-cap this fight ──
    const today      = dayKey();
    const usedSec    = (prof?.liveUsage?.day === today) ? (prof.liveUsage.sec || 0) : 0;
    // Free fight → a fixed 7-min cap; paid → the remaining daily minutes.
    const remainingSec = freeFightSec > 0 ? freeFightSec : (minutes * 60 - usedSec);
    if (remainingSec <= 0) {
      console.log(`[wsManager] Daily limit reached  user=${ctx.userId}  plan=${planOf(account)}  usedSec=${usedSec}/${minutes * 60}  session=${ctx.sessionId}`);
      this._releaseFight(ctx);
      this._sendError(ctx, 'daily_limit');
      return;
    }
    ctx.dailyCapSec = remainingSec;
    // Spend the one-time free fight now that it's actually starting (so it's granted exactly once).
    if (freeFightSec > 0) { try { await consumeFreeFight(account); } catch {} }

    // Boss-Tor gate: challenging the next boss requires the recommended lessons done. The
    // normal daily fight (no mode) is NEVER gated by lessons. (Payment is the minute gate above.)
    if (viaBossTor && !allRecommendedDone(prof)) {
      this._releaseFight(ctx); this._sendError(ctx, 'lessons_incomplete'); return;
    }

    ctx.bossId = bossId;
    // NO-REPEAT interview content: the seen-id lists the script builder must avoid so a returning
    // candidate never gets the same behavioral question / screening filter / customer scenario twice
    // until each pool is exhausted. Persisted back below once the picks are made.
    const recent = {
      behavioral: Array.isArray(prof?.behavioralSeen) ? prof.behavioralSeen : [],
      screening:  Array.isArray(prof?.screeningSeen)  ? prof.screeningSeen  : [],
      cs:         Array.isArray(prof?.csSeen)         ? prof.csSeen         : [],
    };
    if (focusTitle) console.log(`[trainingslager] fight focus injected  user=${ctx.userId}  title="${focusTitle}"`);
    console.log(`[wsManager] Starting fight  user=${ctx.userId}  bossId=${bossId}  level=${level}  mode=${viaBossTor ? 'bosstor' : 'daily'}  dossier=${dossier ?? '—'}  focus=${focusTitle ?? '—'}  session=${ctx.sessionId}`);

    try {
      ctx.realtimeClient = new RealtimeClient({
        sessionId: ctx.sessionId,
        bossId,
        level,
        dossier,
        memory,
        focusTitle,
        candidateName,
        recent,
        // Boss turns are plain text (no audio). Send the full line, then mark it done.
        // Also RECORD it: the debrief needs the interviewer's question paired with the answer
        // that follows, so it can judge whether the candidate actually answered what was asked.
        onBossSpeech:      (text)   => {
          this._recordTurnLatency(ctx);   // [LAT] boss text ready (non-streaming path)
          ctx.dialogue.push({ role: 'boss', text, stage: ctx.stageIdx, stageLabel: ctx.stages[ctx.stageIdx]?.label });
          this._send(ctx, { type: S.BOSS_SPEECH, text });
        },
        onBossPartial:     (text)   => {
          if (!text || !text.trim()) return;
          this._recordTurnLatency(ctx);   // [LAT] first boss token (streaming path = true TTFT)
          const prevLen = ctx.lastBossPartialLen || 0;
          const delta = text.slice(prevLen);
          ctx.lastBossPartialLen = text.length;
          if (delta) this._send(ctx, { type: S.BOSS_SPEECH_DELTA, text: delta });
        },
        onBossSpeechDone:  ()       => {
          ctx.lastBossPartialLen = 0;
          ctx._bossEndedMs = Date.now();   // start the reaction-latency clock for the candidate's next turn
          this._send(ctx, { type: S.BOSS_SPEECH_DONE });
          // Server is the single source of truth: end ONLY after the boss has finished
          // its turn, and only once all three parts are complete.
          if (ctx.completePending && !ctx.closed) this._endSession(ctx, 'completed');
        },
        onError:           (err)    => {
          const code = err?.code || 'realtime_error';
          console.error(`[wsManager] RealtimeClient error session=${ctx.sessionId}: ${err.message}  code=${code}`);
          // Fatal, non-recoverable errors (no credit, key problem, OpenAI outage): tell the
          // user plainly and END the fight so the mic stops streaming / billing immediately.
          const FATAL = new Set(['insufficient_quota', 'rate_limit_exceeded',
                                 'authentication_error', 'invalid_api_key', 'server_error']);
          this._sendError(ctx, FATAL.has(code) ? 'service_unavailable' : 'realtime_error');
          if (FATAL.has(code) && !ctx.closed) this._endSession(ctx, 'service_error');
        },
        onClose: () => {
          console.log(`[wsManager] RealtimeClient closed  session=${ctx.sessionId}`);
          // During a deliberate stop we close the boss ourselves and send SESSION_CLOSED
          // only AFTER the debrief — don't let this fire early and race the debrief.
          if (ctx.ending) return;
          this._send(ctx, { type: S.SESSION_CLOSED, reason: 'fight_ended' });
        },
      });

      await ctx.realtimeClient.connect();
      console.log(`[wsManager] RealtimeClient connected  session=${ctx.sessionId}`);

      // ── Gemini Live (native-audio speech-to-speech) — only when USE_GEMINI_LIVE=1 ──
      // Runs in ADDITION to the Groq path; same scoring/debrief pipeline. If it fails
      // to connect we silently fall back to the Groq text + Deepgram TTS path (already
      // wired). The user cannot tell the difference — they just hear the same content.
      const geminiLiveEnabled = USE_GEMINI_LIVE && !!process.env.GEMINI_API_KEY;
      if (geminiLiveEnabled) {
        try {
          const { GeminiLiveProxy } = await import('./geminiLiveProxy.js');
          const proxy = new GeminiLiveProxy({
            handlers: {
              onReady: () => {
                console.log(`[wsManager] GeminiLive ready  session=${ctx.sessionId}`);
                ctx.geminiActive = true;
                this._send(ctx, { type: S.SESSION_READY, useGeminiAudio: true, sessionId: ctx.sessionId, bossHp: ctx.bossHp, playerHp: ctx.playerHp });
              },
              onBossAudio: (buf) => {
                // Stream boss voice PCM to the browser in small base64 chunks.
                // The client sends `AUDIO_CHUNK` as base64; the server reconstructs
                // audio bytes with Buffer.from(b64, 'base64'). Wave the same way back.
                this._send(ctx, { type: S.BOSS_AUDIO_DELTA, data: buf.toString('base64') });
                ctx.audioOutBytes += buf.length;
              },
              onBossText: (chunk) => {
                if (chunk === '__TURN_COMPLETE__') {
                  // Boss's turn just ended. Record the full boss transcript into dialogue,
                  // score the accumulated user transcript, then release the half-duplex.
                  const bossFull = ctx.geminiBossParts.join('').trim();
                  const userFull = ctx.geminiUserParts.join('').trim();
                  ctx.geminiBossParts = [];
                  ctx.geminiUserParts = [];
                  ctx._geminiTurnStartMs = 0;
                  ctx.geminiProxy?.sendText?.('');
                  // Record boss turn into dialogue for debrief
                  if (bossFull && bossFull !== '[INTERVIEWER SPRICHT]') {
                    ctx.dialogue.push({ role: 'boss', text: bossFull, stage: ctx.stageIdx, stageLabel: ctx.stages[ctx.stageIdx]?.label });
                  }
                  ctx.geminiActive = false;
                  this._send(ctx, { type: S.BOSS_SPEECH_DONE });
                  // If a boss turn has text, surface it; otherwise just signal done.
                  if (bossFull.length > 2) this._send(ctx, { type: S.LIVE_BOSS_TRANSCRIPT, text: bossFull });
                  else this._send(ctx, { type: S.BOSS_SPEECH, text: '' });
                  // Score the user's answer (ctx.geminiUserParts already cleared above)
                  if (userFull.trim().length >= 2) {
                    const durMs = ctx._geminiTurnStartMs ? 0 : 0; // already cleared; use proxy duration if available
                    this._handleAnswer(ctx, { text: userFull.trim(), durationMs: 0 });
                  }
                } else {
                  ctx.geminiBossParts.push(chunk);
                  this._send(ctx, { type: S.LIVE_BOSS_TRANSCRIPT, text: chunk });
                }
              },
              onUserText: (chunk) => {
                ctx.geminiUserParts.push(chunk);
                this._send(ctx, { type: S.LIVE_USER_TRANSCRIPT_PARTIAL, text: chunk });
              },
              onInterrupted: () => {
                ctx.geminiActive = false;
                this._send(ctx, { type: S.BOSS_SPEECH_DONE });
              },
              onClose: (code, reason) => {
                console.log(`[wsManager] GeminiLive closed  code=${code} reason=${code}:${reason}  session=${ctx.sessionId}`);
                ctx.geminiActive = false;
                ctx.geminiProxy = null;
                // If Gemini dies mid-fight the user loses voice but can still text-answer.
                if (!ctx.closed) this._send(ctx, { type: S.BOSS_SPEECH, text: '(Die Verbindung zum Interviewer wurde unterbrochen. Bitte tippen Sie Ihre Antwort.)' });
              },
              onError: (e) => {
                console.error(`[wsManager] GeminiLive error session=${ctx.sessionId}: ${e.message}`);
                ctx.geminiActive = false;
                ctx.geminiProxy = null;
                if (!ctx.closed) {
                  this._send(ctx, { type: S.BOSS_SPEECH, text: '(Es gibt ein technisches Problem — Ihre Antwort als Text.)' });
                  this._sendError(ctx, 'service_unavailable');
                }
              },
            },
          });
          await proxy.start({
            apiKey: process.env.GEMINI_API_KEY,
            model:   process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash',
            voiceName: process.env.GEMINI_LIVE_VOICE || 'Charon',
            systemInstruction: ctx.realtimeClient._session?.instructions ||
              'Du bist ein deutscher HR-Manager in einem BPO-Unternehmen. Sprich nur Deutsch, Sie-Form.',
          });
          ctx.geminiProxy = proxy;
          console.log(`[wsManager] GeminiLive proxy started  session=${ctx.sessionId}`);
        } catch (e) {
          console.warn(`[wsManager] GeminiLive failed to start — falling back to Groq text path  session=${ctx.sessionId}: ${e.message}`);
          ctx.geminiProxy = null;
        }
      }

      // Billing starts now: stamp the start time and arm the cap at the SMALLER of the global
      // max and the user's remaining daily minutes.
      ctx.fightStartedAt = Date.now();
      const capMs = Math.min(MAX_FIGHT_MS, (ctx.dailyCapSec || MAX_FIGHT_MS / 1000) * 1000);
      ctx.maxTimer = setTimeout(() => {
        // GRACEFUL end: stop after the boss finishes its current turn (no mid-sentence cut)…
        console.log(`[wsManager] live-minute/cap soft-limit (${Math.round(capMs / 1000)}s) — graceful close  session=${ctx.sessionId}`);
        ctx.completePending = true;
        // …with a hard backstop if the boss never wraps (e.g. the user keeps talking).
        ctx.hardCapTimer = setTimeout(() => { if (!ctx.closed) this._endSession(ctx, 'time_limit'); }, GRACE_CLOSE_MS);
        ctx.hardCapTimer.unref?.();
      }, capMs);
      ctx.maxTimer.unref?.();

      // Persist the no-repeat seen-lists with this session's picks (reset → start the cycle
      // fresh from this pick; otherwise append). Best-effort: a save failure must not block the
      // fight — worst case is one possible repeat, never a crash.
      const picks = ctx.realtimeClient.picks;
      if (picks && prof) {
        try {
          prof.behavioralSeen = picks.behavioral.reset ? [picks.behavioral.id] : [...recent.behavioral, picks.behavioral.id];
          prof.screeningSeen  = picks.screening.reset  ? [picks.screening.id]  : [...recent.screening, picks.screening.id];
          prof.csSeen         = picks.cs.reset         ? [picks.cs.id]         : [...recent.cs, picks.cs.id];
          // FIRE-AND-FORGET: do NOT await — this DB write must not delay the boss's first line.
          // (worst case on failure = one possible repeat, never a crash, never a slow start.)
          saveUser(prof).catch((e) => console.error('[wsManager] no-repeat seen-list save failed:', e.message));
        } catch (e) { console.error('[wsManager] no-repeat seen-list prep failed:', e.message); }
      }

      // Tell the browser which level + funnel + scenario it's facing, and open on Teil 1.
      const info = ctx.realtimeClient.sessionInfo;
      ctx.level      = info.level;
      ctx.stages     = info.stages;
      ctx.stageIdx   = 0;
      ctx.csScenario = info.csScenario;
      try { this._send(ctx, { type: S.SCENARIO_INFO, ...info }); } catch (e) { console.warn('[wsManager] send SCENARIO_INFO failed:', e.message); }
      const firstStage = (Array.isArray(info.stages) && info.stages.length) ? info.stages[0] : { label: 'Teil 1', type: 'intro' };
      try { this._send(ctx, { type: S.STAGE_UPDATE, index: 0, ...firstStage }); } catch (e) { console.warn('[wsManager] send STAGE_UPDATE failed:', e.message); }
    } catch (err) {
      console.error(`[wsManager] Failed to start fight session=${ctx.sessionId}:`, err.message);
      ctx.realtimeClient = null;
      this._releaseFight(ctx);   // free the per-user lock + cap timer so the user can retry
      this._sendError(ctx, 'fight_start_failed');
      // Surface the actual error for debugging — client shows this alongside the generic text.
      try { this._send(ctx, { type: S.ERROR, code: 'fight_start_detail', detail: String(err.message || 'unknown').slice(0, 500) }); } catch {}
    }
  }

  // Release the per-user single-flight lock and the cap timers for this session.
  _releaseFight(ctx) {
    if (ctx.maxTimer)     { clearTimeout(ctx.maxTimer); ctx.maxTimer = null; }
    if (ctx.hardCapTimer) { clearTimeout(ctx.hardCapTimer); ctx.hardCapTimer = null; }
    if (ctx.accountLocked) { this._activeFightUsers.delete(ctx.accountLocked); ctx.accountLocked = null; }
    // Gracefully close Gemini Live proxy if active
    if (ctx.geminiProxy) { try { ctx.geminiProxy.close(); } catch {} ctx.geminiProxy = null; ctx.geminiActive = false; }
  }

  // Add this fight's wall-seconds to the user's daily live-minute usage (Cairo day, persisted).
  async _recordLiveUsage(ctx, wallSec) {
    if (!ctx.userId || !(wallSec > 0)) return;
    try {
      const p = await loadUser(ctx.userId);
      const today = dayKey();
      if (!p.liveUsage || p.liveUsage.day !== today) p.liveUsage = { day: today, sec: 0 };
      p.liveUsage.sec += Math.round(wallSec);
      await saveUser(p);
    } catch (e) { console.error('[wsManager] live usage record failed:', e.message); }
  }

  // base64 → decoded byte count (for the audio-seconds cost log; padding-approximate).
  _b64Bytes(s) { return typeof s === 'string' ? Math.floor((s.length * 3) / 4) : 0; }

  // ── Streaming STT: Deepgram LiveTranscription ─────────────────────────────────
  // Audio arrives as base64 PCM16 chunks from the client's ClipRecorder. We open ONE
  // DeepgramStreamer per user turn, pipe each chunk into it, and fire _handleAnswer when
  // Deepgram returns speech_final. This removes the ~750ms REST round-trip latency that
  // existed with the old prerecorded path (POST /api/transcribe after silence).

  _handleAudioChunk(ctx, msg) {
    if (!ctx.realtimeClient || ctx.closed) return;
    if (!msg.data) return;

    // ── Gemini Live path (USE_GEMINI_LIVE=1): half-duplex — only forward mic audio
    // while the boss is NOT speaking. If the boss IS speaking (geminiActive = true),
    // drop the chunk silently (echo protection; client is responsible for gating but
    // this belt-and-suspenders drop prevents a race condition).
    if (ctx.geminiProxy) {
      if (ctx.geminiActive) return;   // boss is talking → drop user mic (anti-echo)
      // Track the start of the user's first audio chunk this turn (for durationMs in scoring).
      if (!ctx._geminiTurnStartMs) ctx._geminiTurnStartMs = Date.now();
      const sent = ctx.geminiProxy.sendAudioChunk(msg.data);
      // If send failed (e.g. proxy closed between frames), fall through to Deepgram
      if (sent) return;
      console.warn(`[wsManager] Gemini proxy reject chunk → fallback Deepgram  session=${ctx.sessionId}`);
    }

    // Create the streamer lazily on the first chunk of each turn. Deepgram now only
    // TRANSCRIBES — it never ends the turn. Every finalized segment is appended to
    // ctx._turnText; the turn is committed only when the client's adaptive VAD sends
    // AUDIO_END (see _handleAudioEnd → _commitTurn).
    if (!ctx.dgStreamer) {
      if (!ctx._speechStartMs) ctx._speechStartMs = Date.now();   // real speech duration for WPM
      const streamer = new DeepgramStreamer({
        onPartial: (text) => {
          // Keep the latest interim as a CAPTURE FALLBACK: if the turn ends before Deepgram emits a
          // final segment (its trailing final can arrive after the flush), _commitTurn uses this so the
          // answer is still captured instead of dropped → no more false "no session" on a real answer.
          ctx._lastInterim = text || '';
          // Show accumulated committed segments + the live interim of the current segment.
          const full = (ctx._turnText ? ctx._turnText + ' ' : '') + text;
          this._send(ctx, { type: S.TRANSCRIPT_PARTIAL, text: full });
        },
        onFinal: (text, words) => {
          if (ctx.closed) return;
          if (text && text.trim()) {
            // A Deepgram segment finalized (a pause inside the turn, or the AUDIO_END flush).
            // Accumulate — do NOT commit, do NOT tear down. The client owns the turn end.
            ctx._turnText = (ctx._turnText ? ctx._turnText + ' ' : '') + text.trim();
            if (words?.length) ctx._turnWords.push(...words);
            this._send(ctx, { type: S.TRANSCRIPT_PARTIAL, text: ctx._turnText });
          } else if (ctx.dgStreamer === streamer) {
            // Empty final = silence endpoint or Deepgram closed the socket. Drop the streamer
            // so the next chunk opens a fresh one; the accumulated _turnText is preserved.
            ctx.dgStreamer = null;
          }
        },
        onError: (err) => {
          console.error(`[wsManager] DeepgramStreamer error session=${ctx.sessionId}:`, err?.message);
          if (ctx.dgStreamer === streamer) ctx.dgStreamer = null;   // reconnect on next chunk; keep _turnText
        },
      });
      ctx.dgStreamer = streamer;
      streamer.start();
    }

    const buf = Buffer.from(msg.data, 'base64');
    ctx.dgStreamer.sendChunk(buf);
  }

  // [LAT] Record the server-side turn-latency breakdown ONCE per spoken turn, the moment the boss's
  // first text is ready (TTFT). Guarded by ctx._tAudioEnd so it fires once and never on typed turns.
  _recordTurnLatency(ctx) {
    if (!ctx._tAudioEnd) return;
    const now = Date.now();
    const tCommit = ctx._tCommit || now;
    const tResp = ctx._tRespondStart || tCommit;
    const flushMs = tCommit - ctx._tAudioEnd;
    const prepMs = tResp - tCommit;
    const llmMs = now - tResp;
    const serverTotalMs = now - ctx._tAudioEnd;
    const provider = ctx.realtimeClient?._lastProvider || ctx._lastProvider || (process.env.USE_GEMINI_LIVE === '1' ? 'gemini' : '?');
    try { recordTurn({ flushMs, prepMs, llmMs, serverTotalMs, provider }); } catch {}
    try { console.log(`[LAT] flush=${flushMs} prep=${prepMs} llm=${llmMs} serverTotal=${serverTotalMs}ms provider=${provider} session=${ctx.sessionId}`); } catch {}
    ctx._tAudioEnd = null;   // consume — one record per turn
  }

  _handleAudioEnd(ctx) {
    ctx._tAudioEnd = Date.now();   // [LAT] turn clock: user stopped speaking (AUDIO_END received)
    // The client's adaptive VAD has decided the turn is over (this is now the ONLY thing
    // that ends a turn). Flush Deepgram, give the final segment ~450ms to arrive, then
    // commit the whole accumulated turn at once.
    const streamer = ctx.dgStreamer;
    ctx.dgStreamer = null;
    try { streamer?.close(); } catch {}   // CloseStream → a trailing onFinal may still append
    if (ctx._commitTimer) { clearTimeout(ctx._commitTimer); ctx._commitTimer = null; }
    // 320ms flush: Deepgram trailing final usually lands in ~200–400ms. The fallback in _commitTurn
    // (last interim) prevents empty commits if the final missed the window.
    ctx._commitTimer = setTimeout(() => { ctx._commitTimer = null; this._commitTurn(ctx); }, 160);
    ctx._commitTimer.unref?.();
  }

  // Commit the accumulated turn as ONE answer. Called only from _handleAudioEnd's flush
  // timer — never from Deepgram's own endpoint, so a mid-thought pause can no longer
  // trigger the boss.
  _commitTurn(ctx) {
    if (ctx.closed) return;
    ctx._tCommit = Date.now();   // [LAT] flush done, committing the turn
    // Prefer the accumulated FINAL segments; if none arrived (final missed the flush window), fall
    // back to the last INTERIM so a real answer is still captured rather than dropped as "no session".
    const text  = ((ctx._turnText || '').trim()) || ((ctx._lastInterim || '').trim());
    const words = ctx._turnWords || [];
    ctx._lastInterim = '';
    // Real SPEAKING time from Deepgram word timestamps (start/end, seconds) — reflects PACE, not
    // wall-clock pauses, so WpM is honest. Falls back to wall-clock only if timestamps are absent.
    let speakingMs = 0;
    if (words.length) {
      const f = words[0], l = words[words.length - 1];
      if (Number.isFinite(f?.start) && Number.isFinite(l?.end)) speakingMs = Math.round((l.end - f.start) * 1000);
    }
    const wallMs = ctx._speechStartMs ? Date.now() - ctx._speechStartMs : 0;
    const durationMs = speakingMs > 0 ? speakingMs : wallMs;
    ctx._turnText = '';
    ctx._turnWords = [];
    ctx._speechStartMs = null;
    // No usable speech → reset the mic to retry. Gate ONLY on empty text: the streaming Deepgram
    // path already returns empty on true silence, so real text = a real answer. (The old extra
    // `speakingMs < 300` discard was removed — it false-dropped legitimate terse replies like "Ja."
    // / "Sofort.", which the DRUCKTEST rubric explicitly demands, making a real answer read as a
    // freeze. Dropping a genuine short answer is worse than rarely scoring a noise word.)
    if (!text) {
      this._send(ctx, { type: S.TRANSCRIPT_DONE, transcript: '', wordCount: 0 });
      return;
    }
    ctx._lastWords = words;   // threaded to TRANSCRIPT_DONE for the confidence heat-map
    this._handleAnswer(ctx, { text, durationMs });
  }

  async _handleStopFight(ctx) {
    // User pressed "end". This is one of only TWO ways a session ends — the other is
    // the server confirming all three parts complete (_endSession 'completed').
    console.log(`[wsManager] Stopping fight (user)  session=${ctx.sessionId}`);
    await this._endSession(ctx, 'user_stopped');
  }

  // The single, authoritative session-end path. Closes the boss, builds the debrief
  // while the browser socket stays open, then confirms closure to the client.
  async _endSession(ctx, reason) {
    if (ctx.closed) return;
    ctx.closed = true;
    ctx.ending = true;
    this._releaseFight(ctx);   // free the per-user lock + cancel the hard-cap timer + close Gemini

    // Per-fight cost visibility (the founder's only window into OpenAI Realtime spend).
    const wallSec = ctx.fightStartedAt ? Math.round((Date.now() - ctx.fightStartedAt) / 1000) : 0;
    const inSec   = Math.round(ctx.audioInBytes  / PCM16_BYTES_PER_SEC);
    const outSec  = Math.round(ctx.audioOutBytes / PCM16_BYTES_PER_SEC);
    console.log(`[wsManager] FIGHT COST  user=${ctx.userId}  reason=${reason}  wallSec=${wallSec}  audioInSec=${inSec}  audioOutSec=${outSec}  session=${ctx.sessionId}`);

    // Charge the wall time against the user's daily live-minute allowance (persisted).
    await this._recordLiveUsage(ctx, wallSec);

    // Close any in-flight Deepgram streaming connection (hands-free turn interrupted).
    if (ctx.dgStreamer) { try { ctx.dgStreamer.close(); } catch {} ctx.dgStreamer = null; }
    if (ctx._commitTimer) { clearTimeout(ctx._commitTimer); ctx._commitTimer = null; }

    console.log(`[wsManager] Ending session  reason=${reason}  session=${ctx.sessionId}`);
    await ctx.realtimeClient?.close().catch(() => {});
    ctx.realtimeClient = null;
    await this._finishSession(ctx);
    this._send(ctx, { type: S.SESSION_CLOSED, reason });
  }

  // ── End-of-session debrief ────────────────────────────────────────────────────

  async _finishSession(ctx) {
    if (ctx.debriefSent) return;
    ctx.debriefSent = true;

    const metrics = this._computeMetrics(ctx);

    // ── No-session gate ───────────────────────────────────────────────────────────
    // Feedback is ONLY ever generated from what the user actually did. If they opened the
    // interview and closed it without meaningfully speaking, there is nothing to evaluate:
    // generate NO debrief, NO scores, NO recommendations, NO lesson (and skip the costly
    // generateDebrief call). The client shows an honest "you didn't start" message instead of
    // a fake card with "0 WpM". A zero from no input means "no session", not "you scored zero".
    const realSession = (metrics.answers || 0) >= MIN_REAL_ANSWERS && (metrics.words || 0) >= MIN_REAL_WORDS;
    if (!realSession) {
      console.log(`[wsManager] No real session — skipping debrief  answers=${metrics.answers}  words=${metrics.words}  session=${ctx.sessionId}`);
      this._send(ctx, { type: S.NO_SESSION, reason: 'no_real_input' });
      return;
    }

    this._send(ctx, { type: S.DEBRIEF_PENDING });

    // Prior sessions (this one is not persisted yet) → deterministic progress deltas in the debrief.
    let history = [];
    try {
      const prior = await loadUser(ctx.userId);
      history = (prior.sessions || []).slice(-10).map((s) => ({
        date: s.date, fluency: s.fluency ?? null, fillers: s.fillers ?? null, level: s.level,
      }));
    } catch { /* history is optional — debrief still works without it */ }

    let debrief;
    try {
      debrief = await generateDebrief({
        utterances:   ctx.utterances,
        dialogue:     ctx.dialogue,   // ordered boss-question → candidate-answer exchange
        history,                      // prior sessions, for the "you progressed" narrative
        metrics,
        level:        ctx.level,
        csScenarioId: ctx.csScenario,
      });
    } catch (err) {
      console.error(`[wsManager] Debrief generation error session=${ctx.sessionId}:`, err.message);
      debrief = { grammar: [], strengths: [], studyNext: [], metrics, generated: false };
    }

    // Compute the result (rank/verdict/jobLabel) BEFORE persisting — the session record stores it.
    const result   = await this._computeResult(ctx, metrics, debrief);
    const progress = await this._persistProgress(ctx, metrics, debrief, result);

    console.log(`[wsManager] Debrief ready  generated=${debrief.generated}  outcome=${result.outcome}  rank=${result.rank}  bossHp=${result.bossHp}  answers=${metrics.answers}  session=${ctx.sessionId}`);
    this._send(ctx, { type: S.DEBRIEF, ...debrief, result, progress });
  }

  // Persist this session: history, vocab growth, SRS items from errors, XP/level.
  async _persistProgress(ctx, metrics, debrief, result = {}) {
    try {
      const p   = await loadUser(ctx.userId);
      const now = Date.now();

      // ── Anti-farm gate ──────────────────────────────────────────────────────────
      // Only a session with REAL speech counts toward XP / level / streak / rank. Without
      // this, a user could start a fight, stay silent (or say one word), end it, and still
      // bank XP and a streak day — farming progress with no learning (and burning API cost).
      // Below the floor we persist NOTHING progression-wise; the debrief is still shown.
      const meaningful = (metrics.answers || 0) >= MIN_REAL_ANSWERS && (metrics.words || 0) >= MIN_REAL_WORDS;
      if (!meaningful) {
        console.log(`[wsManager] session NOT counted (insufficient speech) answers=${metrics.answers} words=${metrics.words} session=${ctx.sessionId}`);
        const flAll = p.sessions.map((s) => s.fluency ?? 0);
        const fiAll = p.sessions.map((s) => s.fillers ?? 0);
        return {
          xpGained: 0, level: p.level, leveledUp: false,
          levelProgress: levelProgress(p.xp),
          dueReviews:    dueCount(p),
          nextBoss:      nextBoss(p.level),
          bossId:        ctx.bossId,
          sessionCount:  p.sessions.length,
          streak:        computeStreak(p.sessions, p.lessonDays),
          rank:          computeRank(p.sessions),
          trend:         { fluency: flAll.slice(-5), fillers: fiAll.slice(-5) },
          personalBest:  false,
          bestFluency:   flAll.length ? Math.max(...flAll) : 0,
          notCounted:    true,   // client may show "session too short to count"
        };
      }

      // Vocab growth — record the strong words the user actually produced.
      for (const w of (metrics.c1WordsUsed || [])) {
        if (!p.vocabLearned.includes(w)) p.vocabLearned.push(w);
      }

      // Spaced repetition: schedule what they got wrong as PRODUCTION tasks.
      for (const g of (debrief.grammar || [])) {
        const ex = (g.summaryExamples || [])[0] || (g.allExamples || [])[0] || null;
        addItem(p, {
          type:    'grammar',
          content: g.rule,
          prompt:  ex ? `Korrigiere auf Deutsch: „${ex.wrong}“` : `Wende korrekt an: ${g.rule}`,
          answer:  ex ? ex.right : g.rule,
          example: ex,
        }, now);
      }
      for (const v of (debrief.vocabTargets || [])) {
        addItem(p, {
          type:    'vocab',
          content: v.de,
          prompt:  `Sag auf Deutsch: „${v.en}“${v.note ? ' — ' + v.note : ''}`,
          answer:  v.de,
        }, now);
      }

      // Seed BPO call-center phrases as SRS production tasks (won't duplicate already-tracked ones).
      seedBPOPhrases(p, BPO_PHRASES);

      // XP + level (light progression).
      const beforeLevel = levelFor(p.xp);
      const xpGained    = xpForSession(metrics);
      p.xp   += xpGained;
      p.level = levelFor(p.xp);
      const leveledUp = p.level > beforeLevel;

      if (ctx.bossHp <= 0 && !p.bossesDefeated.includes(ctx.bossId)) p.bossesDefeated.push(ctx.bossId);

      // FREE diagnostic features from the candidate's own transcript (deterministic, no API):
      // subordinate-clause rate (range) + vocab diversity. Feeds the hire-readiness diagnostic.
      const _candTurns = (ctx.dialogue || []).filter((d) => d.role === 'candidate');
      const _candidateText = _candTurns.map((d) => d.text).join(' ');
      const _tf = textFeatures(_candidateText);
      // give-up rate: share of candidate turns that were empty/near-silent (<3 words).
      const _giveUpRate = _candTurns.length ? _candTurns.filter((d) => (d.words || 0) < 3).length / _candTurns.length : null;
      // de-escalation proxy: average CS-roleplay (stage 2) answer score, 0..1.
      const _deescalation = ctx.csScoreCount ? Math.max(0, Math.min(1, (ctx.csScoreSum / ctx.csScoreCount) / 100)) : null;
      // intelligibility proxy: average STT word confidence, 0..1. reaction latency: avg seconds.
      const _intelligibility = ctx.confCount ? Math.max(0, Math.min(1, ctx.confSum / ctx.confCount)) : null;
      const _latencyS = ctx.latCount ? ctx.latSum / ctx.latCount : null;

      p.sessions.push({
        date: now, level: ctx.level, bossId: ctx.bossId,
        fluency: metrics.fluency, wpm: metrics.wpm, fillers: metrics.fillers,
        ...(_tf.subClauseRate != null ? { subClauseRate: _tf.subClauseRate, vocabDiversity: _tf.vocabDiversity } : {}),
        ...(_giveUpRate != null ? { giveUpRate: _giveUpRate } : {}),
        ...(_deescalation != null ? { deescalation: _deescalation } : {}),
        ...(_intelligibility != null ? { intelligibility: _intelligibility } : {}),
        ...(_latencyS != null ? { latencyS: _latencyS } : {}),
        c1Hits: metrics.c1Hits, konjunktivHits: metrics.konjunktivHits,
        connectorHits: metrics.connectorHits, answers: metrics.answers,
        vocabTotal: p.vocabLearned.length,
        xpGained,   // per-session XP → honest "ETA to next level" from the student's real pace
        // The HIRING RESULT of this fight — so Alhassan (and any later view) can speak to exactly
        // how the interview went: the CEFR rank, the pass/weak/fail verdict, the one-line job label,
        // and the single fix we told them to work on. Without these the mentor had no idea of the result.
        rank: result?.rank ?? null, verdict: result?.verdict ?? null, jobLabel: result?.jobLabel ?? null,
        priorityFix: debrief?.priorityFix?.de || null,

        errorTags: classifyGrammar(debrief.grammar),   // Trainingslager: per-fight error tags
        // Per-session grammar errors with BOTH the canonical Trainingslager ruleId (the STABLE id the
        // brain matches on — fixes the free-text-drift that silently broke weak-rule matching) AND the
        // raw LanguageTool name (human-readable). Absent rule = 0 errors of it this session.
        grammarRules: (debrief.grammar || []).map((g) => ({
          ruleId: classifyGrammar([{ ...g, count: 1 }])[0] ?? null,
          rule:   g.rule,
          count:  g.count || 1,
        })),
      });

      // Trainingslager: refresh study recommendations from the last 3 fights (rule-based, no AI).
      refreshRecommendations(p);

      // Cross-session error memory: save top 3 recurring error labels so the next session's
      // boss dossier references the candidate's known weak patterns.
      if ((ctx.errorLabels || []).length) {
        const freq = {};
        for (const lbl of ctx.errorLabels) freq[lbl] = (freq[lbl] || 0) + 1;
        p.recentErrors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([lbl]) => lbl);
      }

      // ── BRAIN SPINE: a per-weakness event log keyed by the canonical ruleId. Every surface appends
      // here (this interview, and the drills via POST /api/drill-event) so the brain can tell ONE
      // student's cause→effect story over time. Additive + deterministic; no AI, no cost. ──
      p.weakLog = p.weakLog || {};
      const _thisSession = p.sessions[p.sessions.length - 1];
      for (const gr of (_thisSession.grammarRules || [])) {
        const key = gr.ruleId || ('lt:' + gr.rule);
        const entry = p.weakLog[key] || { ruleId: gr.ruleId || null, ltName: gr.rule, firstSeen: now, errCounts: [], drills: [] };
        entry.errCounts.push({ date: now, count: gr.count });
        if (entry.errCounts.length > 30) entry.errCounts = entry.errCounts.slice(-30);
        p.weakLog[key] = entry;
      }
      // The rule the brain TARGETED this session (canonical id), persisted so the NEXT session can
      // prove the delta — `weakRuleDelta`/`targetWeakRule` were computed-then-thrown-away before.
      if (ctx.targetWeakRule) {
        p.lastTargetRule = {
          ltName: ctx.targetWeakRule,
          ruleId: classifyGrammar([{ rule: ctx.targetWeakRule, count: 1 }])[0] ?? null,
        };
      }

      await saveUser(p);

      // ── Visible-progress signals for the end screen ──
      // Trend of the last few sessions (the user must SEE improvement, not be told it),
      // a personal-best flag, and the interview-readiness rank — all from stored scores.
      const flAll = p.sessions.map((s) => s.fluency ?? 0);
      const fiAll = p.sessions.map((s) => s.fillers ?? 0);
      const prevFl = flAll.slice(0, -1);                       // sessions before this one
      const personalBest = prevFl.length > 0 && (metrics.fluency ?? 0) > Math.max(...prevFl);

      // Trainingslager delta: the focus rule's error count last fight → this fight.
      let trainingDelta = null;
      const focusRule = p.lastCompletedLesson;
      if (focusRule) {
        const cnt = (s) => (Array.isArray(s?.errorTags) ? s.errorTags.filter((t) => t === focusRule).length : 0);
        const cur  = p.sessions[p.sessions.length - 1];
        const prev = p.sessions[p.sessions.length - 2];
        const before = prev ? cnt(prev) : null, after = cnt(cur);
        if (before !== null && (before > 0 || after > 0)) {
          const l = getLesson(focusRule);
          trainingDelta = { ruleId: focusRule, title_de: l?.title_de || focusRule, title_ar: l?.title_ar || focusRule, before, after };
        }
      }

      // Provable weakness delta: did the candidate improve on the SAME weak rule we targeted this
      // session? Compare its LanguageTool error count last session → this session, from stored
      // per-session counts. HONEST: ruleCnt returns null only when a session never tracked grammar
      // rules (predates this feature) → no fabricated baseline; a tracked-but-absent rule = 0 (real).
      let weakRuleDelta = null;
      const targetRule = ctx.targetWeakRule;
      if (targetRule) {
        const ruleCnt = (s) => (Array.isArray(s?.grammarRules)
          ? (s.grammarRules.find((r) => r.rule === targetRule)?.count ?? 0)
          : null);
        const cur  = p.sessions[p.sessions.length - 1];
        const prev = p.sessions[p.sessions.length - 2];
        const before = prev ? ruleCnt(prev) : null;
        const after  = ruleCnt(cur) ?? 0;
        if (before !== null) weakRuleDelta = { rule: targetRule, before, after };
      }

      // Week-over-week macro signal (deterministic, honest): average fluency over the last 7 days
      // vs the 7 days before. Fluency is the composite headline (higher = always better), so the
      // delta is unambiguous. Only emitted when BOTH windows have a real session — no fabricated week.
      let weekTrend = null;
      {
        const DAY = 86400000;
        const win = (lo, hi) => p.sessions.filter((s) => s.date != null && s.date > lo && s.date <= hi);
        const thisW = win(now - 7 * DAY, now);
        const lastW = win(now - 14 * DAY, now - 7 * DAY);
        const avgFl = (arr) => Math.round(arr.reduce((x, s) => x + (s.fluency || 0), 0) / arr.length);
        if (thisW.length && lastW.length) {
          const tv = avgFl(thisW), lv = avgFl(lastW);
          weekTrend = { fluency: { this: tv, last: lv, delta: tv - lv }, thisCount: thisW.length, lastCount: lastW.length };
        }
      }

      return {
        xpGained, level: p.level, leveledUp,
        levelProgress: levelProgress(p.xp),
        dueReviews:    dueCount(p),
        nextBoss:      nextBoss(p.level),
        bossId:        ctx.bossId,
        sessionCount:  p.sessions.length,   // = 1 on the user's first-ever fight
        streak:        computeStreak(p.sessions, p.lessonDays),
        rank:          computeRank(p.sessions),
        trainingDelta,
        weakRuleDelta,
        weekTrend,
        trend:         { fluency: flAll.slice(-5), fillers: fiAll.slice(-5) },
        personalBest,
        bestFluency:   Math.max(...flAll),
      };
    } catch (err) {
      console.error(`[wsManager] persist progress failed session=${ctx.sessionId}:`, err.message);
      return null;
    }
  }

  // Deterministic objective metrics computed from the candidate's collected speech.
  _computeMetrics(ctx) {
    const text   = ' ' + ctx.utterances.map(u => (u.text || '').toLowerCase()).join('  ') + ' ';
    const words  = ctx.utterances.reduce((s, u) => s + (u.words || 0), 0);
    const speechSec = Math.max(1, Math.round(ctx.totalSpeechMs / 1000));
    const wpm    = ctx.totalSpeechMs > 0 ? Math.round(words / (speechSec / 60)) : 0;

    const countList = (list) => list.reduce((n, w) => n + (text.includes(` ${w} `) ? 1 : 0), 0);
    const matchAll  = (re) => (text.match(re) ?? []).length;

    const fillers = matchAll(/\b(äh+|ähm+|ehm+|also|halt|irgendwie|quasi|sozusagen)\b/g);

    const connectors = ['weil','obwohl','damit','sodass','dennoch','trotzdem','deshalb','außerdem','während','sobald','falls','indem','zwar','jedoch'];
    const konjunktiv = ['würde','würden','könnte','könnten','hätte','wäre','müsste','dürfte','sollte','möchte'];
    const c1Words    = ['lösungsorientiert','nachvollziehbar','transparent','verbindlich','zielführend','wertschätzend','eigenverantwortlich','konstruktiv','diesbezüglich','maßgeblich','professionell','kompetenz'];
    const polite     = ['könnten sie','würden sie','dürfte ich','ich würde vorschlagen','es tut mir leid','entschuldigung','gerne'];

    const c1WordsUsed   = c1Words.filter((w) => text.includes(w));
    const connectorHits = countList(connectors);
    const konjunktivHits = countList(konjunktiv);
    const c1Hits        = c1WordsUsed.length;

    // Composite fluency 0–100: mostly the mean answer score, nudged by pace + range.
    const avgScore = ctx.scoreCount ? Math.round(ctx.scoreSum / ctx.scoreCount) : 0;
    const wpmFit   = (wpm >= 140 && wpm <= 160) ? 100 : (wpm >= 110 && wpm <= 180) ? 70 : (wpm > 0 ? 40 : 0);
    const fluency  = Math.max(0, Math.min(100, Math.round(
      0.7 * avgScore + 0.2 * wpmFit + 0.1 * Math.min(100, (c1Hits + connectorHits) * 12)
    )));

    return {
      answers:         ctx.utterances.length,
      words,
      speechSec,
      wpm,
      wpmTarget:       [140, 160],
      fillers,
      connectorHits,
      konjunktivHits,
      c1Hits,
      c1WordsUsed,
      politenessHits:  polite.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0),
      avgScore,
      fluency,
      level:           ctx.level,
    };
  }

  // End-of-fight result: outcome, rank, headline score, and per-skill "damage" — all
  // derived from the SAME metric signals so the cinematic results screen is display-only.
  async _computeResult(ctx, metrics, debrief = null) {
    const bossHp   = Math.max(0, Math.round(ctx.bossHp));
    const playerHp = Math.max(0, Math.round(ctx.playerHp));
    const outcome  = (bossHp <= 0 || bossHp <= playerHp) ? 'win' : 'loss';
    const score    = metrics.avgScore ?? 0;
    const clamp    = (n) => Math.max(0, Math.min(100, Math.round(n)));

    // The Grammatik bar reflects ACTUAL grammar: density of LanguageTool errors (the app's
    // authoritative deterministic grammar source, already computed for the debrief) per 100 words.
    // The old `38 + connectors*15 − fillers*3` contained NO grammar, so a learner with chronic case
    // errors could read 83/100. Only trust it when the debrief actually ran — otherwise fall back,
    // so a failed debrief never paints a fake perfect "100". (Note: this still undercounts to the
    // degree the STT launders errors before LanguageTool sees them — tracked separately as Tier-1 #6.)
    let grammarBar;
    if (debrief?.generated) {
      const grammarErrs = (debrief.grammar || []).reduce((n, g) => n + (g.count || 1), 0);
      const errPer100   = (grammarErrs / Math.max(metrics.words || 0, 1)) * 100;
      grammarBar        = clamp(100 - errPer100 * 8);   // ~0 err→100, ~3/100w→76, ~6→52, ~13→0
    } else {
      grammarBar        = clamp(38 + metrics.connectorHits * 15 - metrics.fillers * 3);
    }

    // Per-skill damage 0–100 — DISPLAY BARS ONLY. These do NOT decide the grade.
    const categories = {
      fluency:      clamp(metrics.fluency),
      grammar:      grammarBar,
      vocab:        clamp(40 + metrics.c1Hits * 18),
      deescalation: clamp(34 + metrics.politenessHits * 15 + metrics.konjunktivHits * 6),
    };

    // ── Headline CEFR grade — from the validated transcript scorer, NOT a fluency
    // heuristic. The old `score → band` ladder handed out fake B2s on broken German
    // (fluent + low-filler + connectors scored ~70 → "B2" with the grammar ignored).
    // Now the grade reflects grammar/vocab/content. FAIL LOUD: if the scorer is
    // unreachable or returns no level, mark the grade unavailable — never invent one.
    const fullTranscript = (ctx.utterances || []).map((u) => u.text).filter(Boolean).join('\n');
    let rank = null;
    let gradeUnavailable = false;
    let verdict = null;
    try {
      const graded = await gradeTranscript({
        transcript: fullTranscript,
        level:      ctx.level,
        scenarioId: ctx.csScenario || 'general',
        userId:     ctx.userId,
      });
      verdict = graded?.verdict ?? null;
      rank    = graded?.cefrLevel ?? null;
      if (!rank) gradeUnavailable = true;
    } catch (err) {
      console.error(`[wsManager] grade (panelscorer) failed session=${ctx.sessionId}: ${err.message}`);
      gradeUnavailable = true;
    }

    // Honest C1-floor verdict. The pass bar on a real Cairo German line is C1 that
    // HELD under pressure; B2 only clears the HR phone-screen; freezing (verdict
    // 'fail') disqualifies regardless of vocabulary, so it overrides a high CEFR.
    const jobLabel =
        gradeUnavailable                    ? 'Bewertung nicht verfügbar'
      : verdict === 'fail'                  ? 'Unter Druck eingebrochen — noch nicht einstellbar'
      : rank === 'C1' && verdict === 'pass' ? 'C1 — bereit für die Kundenlinie'
      : rank === 'C1'                       ? 'C1-Niveau, unter Druck aber noch instabil'
      : rank === 'B2'                       ? 'B2 — besteht das Telefon-Screening, noch nicht liniensicher'
      : rank === 'B1'                       ? 'B1 — grundsolide, aber unter der Einstellungsschwelle'
      : rank === 'A2'                       ? 'A2 — deutlich unter der Einstellungsschwelle'
      :                                       'Weiter üben — Du schaffst das';

    return {
      outcome, bossHp, playerHp, score,
      rank, gradeUnavailable, verdict, gradeSource: 'panelscorer',
      jobLabel, comboBest: ctx.comboBest, categories,
    };
  }

  // ── Turn-based answer handler (browser → server) ────────────────────────────
  // One complete candidate answer per turn, as TEXT (typed, or spoken+transcribed
  // client-side). We score it (unchanged scoring), then ask the Groq boss for its
  // single next turn. Audio never flows over the socket anymore.

  async _handleAnswer(ctx, msg) {
    if (!ctx.realtimeClient) return;
    // Ignore an answer that arrives while the boss is still producing its turn, and ignore empties.
    // CRITICAL: still send TRANSCRIPT_DONE on these early returns — otherwise the client's `transcribing`
    // flag never clears, the hands-free driver stays gated, and the mic FREEZES for the rest of the
    // session (one dropped turn killed all following turns).
    if (ctx.realtimeClient.isResponding) { this._send(ctx, { type: S.TRANSCRIPT_DONE, transcript: '', wordCount: 0 }); return; }
    const transcript = (typeof msg.text === 'string') ? msg.text.trim().slice(0, 4000) : '';
    if (!transcript) { this._send(ctx, { type: S.TRANSCRIPT_DONE, transcript: '', wordCount: 0 }); return; }

    // ── Name auto-capture: if the guide profile has no name yet, try to extract one from the
    // candidate's first self-introduction (e.g. "Ich bin Karim" / "Ich heiße …" / "Mein Name ist …").
    // Only triggers once per account, never overwrites, never invents.
    if (ctx.userId) {
      try {
        const guide = await loadGuide(ctx.userId);
        if (guide && !guide.name) {
          const m = transcript.match(/\b(?:ich bin|ich heiße|mein name ist)\s+([A-ZÄÖÜ][a-zäöüß]+)/i);
          if (m && m[1]) {
            guide.name = m[1];
            await saveGuide(guide);
            console.log(`[wsManager] Captured candidate name  user=${ctx.userId}  name="${guide.name}"`);
          }
        }
      } catch { /* name capture is best-effort; never block the turn */ }
    }

    // wordCount + durationMs are computed BEFORE the abuse block: the abuse branches reference
    // them in the TRANSCRIPT_DONE payload, and a `const` temporal-dead-zone here threw a
    // ReferenceError on any insult → TRANSCRIPT_DONE never sent → the client's `transcribing`
    // flag stuck → the mic froze for the rest of the session. Declared up here, the crash is gone.
    const wordCount  = transcript.split(/\s+/).filter(Boolean).length;
    // durationMs is supplied for spoken answers (clip length) so WPM works; typed
    // answers omit it (WPM is simply not scored for typed turns).
    const durationMs = Number(msg.durationMs) > 0 ? Math.min(Number(msg.durationMs), 120_000) : 0;

    // Abuse detector: explicit AR/DE insults → professional warning, then end session on severe tier.
    if (ABUSE_T2.test(transcript)) {
      console.warn(`[wsManager] Severe abuse detected session=${ctx.sessionId}`);
      this._send(ctx, { type: S.TRANSCRIPT_DONE, transcript, durationMs, wordCount });
      this._send(ctx, { type: S.BOSS_SPEECH, text: ABUSE_END });
      this._send(ctx, { type: S.BOSS_SPEECH_DONE });
      if (!ctx.closed) this._endSession(ctx, 'abuse');
      return;
    } else if (ABUSE_T1.test(transcript)) {
      console.warn(`[wsManager] Mild abuse detected session=${ctx.sessionId}`);
      this._send(ctx, { type: S.TRANSCRIPT_DONE, transcript, durationMs, wordCount });
      this._send(ctx, { type: S.BOSS_SPEECH, text: ABUSE_WARN });
      this._send(ctx, { type: S.BOSS_SPEECH_DONE });
      // Do not feed the insult to the boss — let the hands-free driver hand the floor
      // back to the user for a fresh, clean turn.
      return;
    }

    if (durationMs > 400) ctx.totalSpeechMs += durationMs;

    // Pick up word-level confidence scores set by the streaming STT handler.
    const words = ctx._lastWords ?? [];
    ctx._lastWords = null;

    // FREE diagnostic signals (no API): intelligibility ≈ average Deepgram word confidence;
    // reaction latency ≈ pause between the boss finishing and this answer landing (minus speaking time).
    for (const w of words) { if (typeof w.confidence === 'number') { ctx.confSum += w.confidence; ctx.confCount += 1; } }
    if (ctx._bossEndedMs) {
      const lat = (Date.now() - ctx._bossEndedMs - (durationMs > 0 ? durationMs : 0)) / 1000;
      if (lat >= 0 && lat < 30) { ctx.latSum += lat; ctx.latCount += 1; }
      ctx._bossEndedMs = null;
    }

    // Boss replies with exactly ONE turn. Fire the LLM request FIRST so generation
    // overlaps with scoring (saves ~100–300 ms on every answer).
    ctx._tRespondStart = Date.now();   // [LAT] boss LLM request fired
    const respondPromise = ctx.realtimeClient.respond(transcript).catch(err => {
      console.error(`[wsManager] boss respond failed session=${ctx.sessionId}: ${err.message}`);
      this._sendError(ctx, 'realtime_error');
      return null;
    });
    // Score this answer + advance the funnel (may set ctx.completePending).
    // Runs synchronously while the boss is generating → latency win.
    this._scoreAnswer(ctx, transcript, durationMs, wordCount, words);
    if (ctx.closed) { await respondPromise; return; }
    const bossResult = await respondPromise;
  }

  // ── Score one candidate answer + advance the funnel ─────────────────────────

  _scoreAnswer(ctx, transcript, durationMs, wordCount, words = []) {
    console.log(`[wsManager] Utterance complete  words=${wordCount}  ms=${durationMs}  session=${ctx.sessionId}`);

    // Always surface the transcript text (drives the live transcript panel),
    // regardless of whether this utterance is scored.
    this._send(ctx, {
      type:       S.TRANSCRIPT_DONE,
      transcript,
      durationMs,
      wordCount,
      words,   // Deepgram word-level confidence — [{word, confidence}] — for client heat-map
    });

    // Keep the candidate's real sentences for the end-of-session debrief.
    if (wordCount >= 2 && transcript) {
      ctx.utterances.push({
        text:       transcript,
        words:      wordCount,
        durationMs,
        stage:      ctx.stageIdx,
        stageLabel: ctx.stages[ctx.stageIdx]?.label,
      });
      // …and into the ordered dialogue, right after the boss question that prompted it,
      // so the debrief can do per-exchange "did you answer what was asked?" analysis.
      ctx.dialogue.push({ role: 'candidate', text: transcript, words: wordCount, durationMs, stage: ctx.stageIdx });
    }

    // ── Live performance HUD stats (DISPLAY-ONLY; backend stays the source of truth).
    // Computed from the SAME signals the scorer uses, then pushed so the WPM meter and
    // filler counter can never drift from the scoring logic. Updates on every real
    // utterance (≈ every pause), not only on scored exchanges, so the meters feel live.
    if (wordCount >= 2) {
      const liveWpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;
      const fillers = (` ${transcript.toLowerCase()} `.match(/\b(äh+|ehm+|um+|also\s|halt\s|irgendwie|quasi|sozusagen)\b/g) ?? []).length;
      ctx.fillerTotal += fillers;
      this._send(ctx, {
        type:        S.LIVE_STATS,
        wpm:         liveWpm,
        fillerDelta: fillers,
        fillerTotal: ctx.fillerTotal,
        combo:       ctx.combo,
      });
    }

    // Only score REAL utterances. Server VAD splits the mic stream into many tiny
    // transcription-completed events (often 0-2 words, ~0ms). Scoring each one with
    // the old formula (up to 40 HP/hit) drained the player to zero in seconds and
    // popped "NIEDERLAGE" at the very start. Require real content, then rate-limit so
    // a burst of fragments produces at most one scored hit.
    const now = Date.now();
    if (wordCount < MIN_SCORED_WORDS) return;
    if (now - ctx.lastScoredAt < SCORE_COOLDOWN_MS) return;
    ctx.lastScoredAt = now;

    // Gradual, bounded damage:
    //   weak answer  (low score)  → player loses up to MAX_PLAYER_DMG, boss ~0
    //   strong answer (high score) → boss loses up to MAX_BOSS_DMG,    player ~0
    // Neither side can drop more than its cap per exchange, so the fight always
    // runs many rounds instead of ending in one or two.
    // Cause-driven scoring: every HP change is the sum of SPECIFIC detected signals,
    // each with its own label (see _scoreFactors). Nothing here is random.
    const { score, factors } = this._scoreFactors(transcript, durationMs, wordCount, { levelId: ctx.level, stage: ctx.stageIdx });
    ctx.scoreSum += score; ctx.scoreCount += 1;
    if (ctx.stageIdx === 2) { ctx.csScoreSum += score; ctx.csScoreCount += 1; }   // CS roleplay → de-escalation proxy

    // Combo: consecutive STRONG answers build a multiplier; a clear MISS breaks it.
    // 45–64 holds the current streak (neither builds nor breaks). Display-only meter —
    // it does NOT alter HP, so the tuned damage balance is untouched.
    if      (score >= 65) { ctx.combo += 1; if (ctx.combo > ctx.comboBest) ctx.comboBest = ctx.combo; }
    else if (score < 45)  { ctx.combo = 0; }
    const exWpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;

    // Rescue move: two broken answers in a row → the boss eases up on its next turn.
    if (score < 40) ctx.weakStreak += 1; else ctx.weakStreak = 0;
    if (ctx.weakStreak >= 2) { ctx.weakStreak = 0; ctx.realtimeClient?.requestRescue?.('weak'); }

    // In-session correction loop. A skilled interviewer corrects RARELY and only when a
    // pattern is undeniable — never every weak turn (that's the "interrupts for no reason"
    // feeling). Doctrine (from interruption research): react to ONE thing, only when the SAME
    // error has now recurred ≥3 times, gated by a cooldown + a per-session cap, and never on
    // back-to-back turns. Everything else goes silently to the post-session feedback report.
    if (ctx.correctionCooldown > 0) ctx.correctionCooldown -= 1;
    const topPlayerFactor = factors.filter(f => f.side === 'player').sort((a, b) => b.hp - a.hp)[0];
    if (score < 45 && topPlayerFactor) {
      ctx.errorLabels.push(topPlayerFactor.label);  // for cross-session memory at end
    }
    const CORRECTION_THRESHOLD = 3;   // same error must recur 3× before the boss reacts to it
    const CORRECTION_SESSION_CAP = 2; // at most 2 in-character corrections per ~10-min session
    if (score >= 45) {
      ctx.lastTurnWasCorrection = false;  // a good answer clears the back-to-back guard
    } else if (
      topPlayerFactor &&
      !ctx.lastTurnWasCorrection &&
      ctx.correctionCooldown === 0 &&
      ctx.correctionsUsed < CORRECTION_SESSION_CAP &&
      ctx.scoredAnswers >= 1            // never on the very first answer — let them settle in
    ) {
      const lbl = topPlayerFactor.label;
      ctx.errorCounts[lbl] = (ctx.errorCounts[lbl] || 0) + 1;
      if (ctx.errorCounts[lbl] >= CORRECTION_THRESHOLD) {
        ctx.realtimeClient?.requestCorrection?.(lbl);
        ctx.lastTurnWasCorrection = true;
        ctx.correctionsUsed     += 1;
        ctx.correctionCooldown   = 3;   // no further probe for the next 3 turns
        ctx.errorCounts[lbl]     = 0;   // reset so a genuinely persistent pattern can recur later
      }
    }

    // Boss emotion (display-only, backend-driven so the client never invents it):
    //   cornered (low boss HP) → WÜTEND; strong answer → BEEINDRUCKT;
    //   weak answer → SKEPTISCH; otherwise composed GEFASST.
    let emotion = 'gefasst';
    if      (ctx.bossHp <= 25) emotion = 'wuetend';
    else if (score >= 68)      emotion = 'beeindruckt';
    else if (score <= 40)      emotion = 'skeptisch';
    ctx.emotion = emotion;

    // Sum each side's factor magnitudes, then CAP — proportional, never a giant drop.
    //   side 'boss'   = player did well  → boss loses HP (player gains ground)
    //   side 'player' = player slipped   → player loses HP
    const sumSide   = (s) => factors.filter((f) => f.side === s).reduce((a, f) => a + f.hp, 0);
    const bossDmg   = Math.min(MAX_BOSS_DMG,   sumSide('boss'));
    const playerDmg = Math.min(MAX_PLAYER_DMG, sumSide('player'));

    // Dominant cause per side drives the tiny on-screen floating label.
    const topSide    = (s) => factors.filter((f) => f.side === s).sort((a, b) => b.hp - a.hp)[0] ?? null;
    const bossTop    = topSide('boss');
    const playerTop  = topSide('player');

    ctx.bossHp   = Math.max(0, ctx.bossHp   - bossDmg);
    ctx.playerHp = Math.max(0, ctx.playerHp - playerDmg);

    // Log EVERY HP change with its full cause breakdown so it is verifiably not random.
    const causeStr = factors.length
      ? factors.map((f) => `${f.side === 'boss' ? '+' : '-'}${f.hp} ${f.label}`).join(', ')
      : 'neutral (no signals)';
    console.log(`[wsManager] HP change  boss ${ctx.bossHp} (-${bossDmg})  player ${ctx.playerHp} (-${playerDmg})  score=${score}  causes=[${causeStr}]  session=${ctx.sessionId}`);

    this._send(ctx, {
      type:       S.HP_UPDATE,
      bossHp:     ctx.bossHp,
      playerHp:   ctx.playerHp,
      score,
      damage:     playerDmg,
      bossDamage: bossDmg,
      // Live HUD values bundled with the scored exchange (display-only).
      wpm:         exWpm,
      fillerTotal: ctx.fillerTotal,
      combo:       ctx.combo,
      emotion,
      // Tiny floating reason labels: net delta + the dominant cause for each side.
      reasons: {
        boss:   bossDmg   > 0 && bossTop   ? { label: bossTop.label,   amount: bossDmg }   : null,
        player: playerDmg > 0 && playerTop ? { label: playerTop.label, amount: playerDmg } : null,
      },
    });

    // Advance the funnel stage tracker once this answer is counted.
    ctx.scoredAnswers += 1;
    const newIdx = stageForAnswers(ctx.scoredAnswers);
    if (newIdx !== ctx.stageIdx && ctx.stages[newIdx]) {
      ctx.stageIdx = newIdx;
      this._send(ctx, { type: S.STAGE_UPDATE, index: newIdx, ...ctx.stages[newIdx] });
    }

    // Mark the session for completion once the roleplay (final part) has run its
    // course. _handleAnswer still asks the boss for ONE closing turn after this; the
    // session then ends in onBossSpeechDone, so the boss's final line is always shown.
    if (ctx.stageIdx === 2 && (ctx.scoredAnswers - STAGE_AFTER[1]) >= ROLEPLAY_EXCHANGES) {
      ctx.completePending = true;
    }
  }

  _onHpUpdate(ctx, { bossHp, playerHp }) {
    ctx.bossHp   = bossHp;
    ctx.playerHp = playerHp;
    this._send(ctx, { type: S.HP_UPDATE, bossHp, playerHp });
  }

  // ── Quick scoring (synchronous fast-path, no ML) ────────────────────────────

  // Returns { score, factors } where each factor is { side, label, hp }:
  //   side 'boss'   → player did something good (boss loses hp)
  //   side 'player' → player slipped          (player loses hp)
  // hp is a small positive magnitude; the caller sums + caps them. Every factor maps
  // to a concrete, detectable cause and a short German label shown on screen.
  // This REPLACES _quickScore (kept below, now unused) as the active scorer.
  _scoreFactors(transcript, durationMs, wordCount, opts = {}) {
    const factors = [];
    const add = (side, label, hp) => { const v = Math.round(hp); if (v > 0) factors.push({ side, label, hp: v }); };

    if (!transcript || wordCount < 2) {
      return { score: 0, factors: [{ side: 'player', label: 'keine Antwort', hp: 4 }] };
    }

    const lenient = opts.levelId === 'a2-b1'; // A2-B1 forgives; B2 and C1 both demand range
    const strict  = opts.levelId === 'c1';   // C1: highest bar — formal register required
    const stage   = opts.stage ?? 0;         // 2 = customer-service roleplay
    const text    = ' ' + transcript.toLowerCase() + ' ';

    // Non-German: English words mid-German or Arabic script. Heavy penalty, no reward.
    const englishWords = ['the','is','are','was','were','this','that','have','with','they','you','can'];
    const arabicChars  = /[؀-ۿ]/;
    const englishScore = englishWords.filter(w => text.includes(` ${w} `)).length;
    if (englishScore >= 3 || arabicChars.test(text)) {
      return { score: 0, factors: [{ side: 'player', label: 'kein Deutsch', hp: MAX_PLAYER_DMG }] };
    }
    if      (englishScore === 2) add('player', 'Englisch im Satz', 5);
    else if (englishScore === 1) add('player', 'englisches Wort',  3);

    let score = lenient ? 58 : 46; // level-aware baseline (A2-B1 friendlier)

    // Filler words — penalty only when EXCESSIVE (a single "also" is normal speech).
    const fillers = (text.match(/\b(äh+|ehm+|um+|also\s|halt\s|irgendwie|quasi|sozusagen)\b/g) ?? []).length;
    if (fillers > 0) {
      const pen = fillers * (lenient ? 2 : 4);
      score -= pen;
      if (fillers >= 2) add('player', 'Füllwörter', pen);
    }

    // Pace: fluent delivery rewards; long freezes (very low wpm = lots of dead air) cost.
    const wpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;
    if (lenient) {
      if      (wpm >= 90 && wpm <= 170) { score += 8; add('boss', 'fließend', 6); }
      else if (wpm > 0 && wpm < 45)     { score -= 6; add('player', 'langes Zögern', 5); }
    } else {
      if      (wpm >= 130 && wpm <= 165) { score += 10; add('boss', 'fließend', 7); }
      else if (wpm < 90)                 { score -= 8;  add('player', 'langes Zögern', 6); }
      else if (wpm > 205)                { score -= 5;  add('player', 'zu hastig', 4); }
    }

    // Length / elaboration.
    const [lenA, lenB] = lenient ? [12, 28] : [20, 45];
    let lenBonus = 0;
    if (wordCount >= lenA) lenBonus += 8;
    if (wordCount >= lenB) lenBonus += 8;
    if (lenBonus > 0) { score += lenBonus; add('boss', 'ausführlich', lenBonus * 0.4); }
    else if (wordCount < (lenient ? 6 : 10)) add('player', 'zu kurz', 3);

    // C1 vocabulary — good word choice.
    const c1Words = ['lösungsorientiert','nachvollziehbar','transparent','verbindlich',
                     'zielführend','wertschätzend','eigenverantwortlich','konstruktiv',
                     'diesbezüglich','maßgeblich','professionell','kompetenz'];
    const c1Hits = c1Words.filter(w => text.includes(w)).length;
    if (c1Hits > 0) { score += c1Hits * 4; add('boss', 'Wortschatz', c1Hits * 3); }

    // Subordinate clauses / connectors — correct B1/B2 structure.
    const connectors = ['weil','obwohl','damit','sodass','dennoch','trotzdem','deshalb',
                        'außerdem','während','sobald','falls','indem','zwar','jedoch'];
    const connHits = connectors.filter(w => text.includes(` ${w} `)).length;
    if (connHits > 0) { score += connHits * (lenient ? 3 : 5); add('boss', 'guter Satzbau', connHits * (lenient ? 2.5 : 3.5)); }
    if (!lenient && wordCount >= 25 && connHits === 0) { score -= 10; add('player', 'kein Satzbau', 6); } // B2: range or no credit

    // Konjunktiv II / politeness markers.
    const konjunktiv = ['würde','würden','könnte','könnten','hätte','wäre','müsste','dürfte','sollte','möchte'];
    const konjHits = konjunktiv.filter(w => text.includes(` ${w} `)).length;
    if (konjHits > 0) { score += konjHits * (lenient ? 3 : 4); add('boss', 'Höflichkeit', konjHits * 2.5); }

    // Self-correction — repairing one's own mistake mid-answer is a real skill.
    const selfCorr = ['ich meine','ich wollte sagen','ich meinte','beziehungsweise',
                      'genauer gesagt','besser gesagt','also ich meinte'];
    if (selfCorr.some(w => text.includes(w))) { score += 4; add('boss', 'Selbstkorrektur', 4); }

    // Customer-service roleplay: reward empathy → ownership → clear next step (on-topic).
    if (stage === 2) {
      const empathy   = ['verstehe','tut mir leid','entschuldigung','entschuldige','nachvollziehen','verständlich','bedauere'];
      const ownership = ['ich kümmere','ich übernehme','ich sorge','ich kläre','ich prüfe','ich schaue','ich veranlasse'];
      const nextStep  = ['ich würde vorschlagen','ich schlage vor','als nächstes','ich werde','wir werden','umgehend'];
      if (empathy.some(w => text.includes(w)))   { score += 10; add('boss', 'Empathie', 6); }
      if (ownership.some(w => text.includes(w))) { score += 8;  add('boss', 'Verantwortung', 5); }
      if (nextStep.some(w => text.includes(w)))  { score += 8;  add('boss', 'klare Lösung', 5); }
      if (text.includes('könnten sie') || text.includes('würden sie') || text.includes('dürfte ich')) { score += 4; add('boss', 'höfliche Rückfrage', 3); }
      // C1 BPO register: reward sophisticated de-escalation phrases from the playbook
      const c1Deesc = ['zusammenfassen','ihr anliegen','zuständige stelle','sachlich bleiben','umgehend darum','konkret für sie','nicht rückgängig machen'];
      if (c1Deesc.some(w => text.includes(w))) { score += 6; add('boss', 'C1-Deeskalation', 4); }
    }

    // C1 formal register bonuses: Nominalisierung, Funktionsverbgefüge, Passiversatzformen
    if (strict) {
      const fvg = ['eine entscheidung treffen','zur verfügung stellen','in anspruch nehmen','in betracht ziehen','einen schritt unternehmen','in frage stellen'];
      const passErsatz = ['lässt sich','ist zu klären','ist zu beachten','ist zu bearbeiten','ist zu lösen'];
      if (fvg.some(w => text.includes(w)))       { score += 8; add('boss', 'Nominalisierung', 5); }
      if (passErsatz.some(w => text.includes(w))) { score += 8; add('boss', 'Passiversatz',   5); }
      // C1 penalizes short answers — no STAR structure possible under 25 words
      if (wordCount < 25 && wordCount >= MIN_SCORED_WORDS) { score -= 10; add('player', 'zu kurz für C1', 7); }
    }

    return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
  }

  _quickScore(transcript, durationMs, wordCount, opts = {}) {
    if (!transcript || wordCount < 2) return 0;

    const lenient = opts.levelId === 'a2-b1'; // A2-B1 forgives; B2/C1 both demand range
    const stage   = opts.stage ?? 0;         // 2 = customer-service roleplay
    const text    = ' ' + transcript.toLowerCase() + ' ';

    // Instant death: non-German languages
    const englishWords = ['the','is','are','was','were','this','that','have','with','they','you','can'];
    const arabicChars  = /[\u0600-\u06FF]/;
    const englishScore = englishWords.filter(w => text.includes(` ${w} `)).length;
    if (englishScore >= 3 || arabicChars.test(text)) return 0;

    let score = lenient ? 58 : 46; // level-aware baseline (A2-B1 friendlier)

    // Filler word penalty
    const fillers = (text.match(/\b(äh+|ehm+|um+|also\s|halt\s|irgendwie|quasi|sozusagen)\b/g) ?? []).length;
    score -= fillers * (lenient ? 2 : 4);

    // WPM: A2-B1 just needs to keep moving; B2 targets a natural 130-165 wpm.
    const wpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;
    if (lenient) {
      if      (wpm >= 90 && wpm <= 170) score += 8;
      else if (wpm > 0 && wpm < 45)     score -= 6;
    } else {
      if      (wpm >= 130 && wpm <= 165) score += 10;
      else if (wpm < 90)                 score -= 8;
      else if (wpm > 205)                score -= 5;
    }

    // Length bonus (lower bar for A2-B1)
    const [lenA, lenB] = lenient ? [12, 28] : [20, 45];
    if (wordCount >= lenA) score += 8;
    if (wordCount >= lenB) score += 8;

    // C1 vocabulary bonus
    const c1Words = ['lösungsorientiert','nachvollziehbar','transparent','verbindlich',
                     'zielführend','wertschätzend','eigenverantwortlich','konstruktiv',
                     'diesbezüglich','maßgeblich','professionell','kompetenz'];
    const c1Hits = c1Words.filter(w => text.includes(w)).length;
    score += c1Hits * 4;

    // Subordinate clauses / connectors — the core B2 demand.
    const connectors = ['weil','obwohl','damit','sodass','dennoch','trotzdem','deshalb',
                        'außerdem','während','sobald','falls','indem','zwar','jedoch'];
    const connHits = connectors.filter(w => text.includes(` ${w} `)).length;
    score += connHits * (lenient ? 3 : 5);
    if (!lenient && wordCount >= 25 && connHits === 0) score -= 10; // B2: no range, no credit

    // Konjunktiv II / politeness markers.
    const konjunktiv = ['würde','würden','könnte','könnten','hätte','wäre','müsste','dürfte','sollte','möchte'];
    const konjHits = konjunktiv.filter(w => text.includes(` ${w} `)).length;
    score += konjHits * (lenient ? 3 : 4);

    // Customer-service roleplay: reward empathy → ownership → facts → clear next step.
    if (stage === 2) {
      const empathy   = ['verstehe','tut mir leid','entschuldigung','entschuldige','nachvollziehen','verständlich','bedauere'];
      const ownership = ['ich kümmere','ich übernehme','ich sorge','ich kläre','ich prüfe','ich schaue','ich veranlasse'];
      const nextStep  = ['ich würde vorschlagen','ich schlage vor','als nächstes','ich werde','wir werden','umgehend'];
      if (empathy.some(w => text.includes(w)))   score += 10;
      if (ownership.some(w => text.includes(w))) score += 8;
      if (nextStep.some(w => text.includes(w)))  score += 8;
      if (text.includes('könnten sie') || text.includes('würden sie') || text.includes('dürfte ich')) score += 4;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── Connection close ────────────────────────────────────────────────────────

  async _onClose(ctx, code, reason) {
    const reasonStr = reason?.toString('utf8') ?? '';
    console.log(`[wsManager] Connection closed  session=${ctx.sessionId}  code=${code}  reason=${reasonStr}`);
    this._releaseFight(ctx);   // free the per-user lock + cap timer even on an abrupt drop

    // Bill any live minutes when the tab was killed mid-fight (abrupt disconnect).
    // The normal path (_endSession) already sets ctx.closed = true before recording;
    // if it's still false here, _endSession never ran → record now to prevent a bypass.
    if (!ctx.closed && ctx.fightStartedAt) {
      ctx.closed = true;
      const wallSec = Math.round((Date.now() - ctx.fightStartedAt) / 1000);
      const inSec   = Math.round(ctx.audioInBytes  / PCM16_BYTES_PER_SEC);
      const outSec  = Math.round(ctx.audioOutBytes / PCM16_BYTES_PER_SEC);
      console.log(`[wsManager] FIGHT COST (abrupt close)  user=${ctx.userId}  wallSec=${wallSec}  audioInSec=${inSec}  audioOutSec=${outSec}  session=${ctx.sessionId}`);
      await this._recordLiveUsage(ctx, wallSec);
    }

    await ctx.realtimeClient?.close().catch(() => {});
    ctx.dgStreamer?.close(); ctx.dgStreamer = null;   // prevent stale Deepgram socket after disconnect
    if (ctx._commitTimer) { clearTimeout(ctx._commitTimer); ctx._commitTimer = null; }
    this._sessions.delete(ctx.sessionId);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────

  _heartbeat() {
    const now = Date.now();
    for (const ctx of this._sessions.values()) {
      if (now - ctx.lastActivityAt > SESSION_TIMEOUT_MS) {
        console.log(`[wsManager] Session idle timeout  session=${ctx.sessionId}`);
        ctx.socket.terminate();
        this._sessions.delete(ctx.sessionId);
        continue;
      }
      if (!ctx.isAlive) {
        console.warn(`[wsManager] Dead socket  session=${ctx.sessionId}`);
        ctx.socket.terminate();
        this._sessions.delete(ctx.sessionId);
        continue;
      }
      ctx.isAlive = false;
      ctx.socket.ping();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _send(ctx, payload) {
    if (ctx.socket.readyState !== 1) return;
    try {
      ctx.socket.send(JSON.stringify(payload));
    } catch (err) {
      console.warn(`[wsManager] Send failed session=${ctx.sessionId}:`, err.message);
    }
  }

  _sendError(ctx, code) {
    this._send(ctx, { type: S.ERROR, code });
  }

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  async shutdown() {
    console.log(`[wsManager] Shutting down  sessions=${this._sessions.size}`);
    clearInterval(this._pingTimer);

    const closes = [...this._sessions.values()].map(async (ctx) => {
      await ctx.realtimeClient?.close().catch(() => {});
      this._send(ctx, { type: S.SESSION_CLOSED, reason: 'server_shutdown' });
      ctx.socket.close(1001, 'server_shutdown');
    });

    await Promise.allSettled(closes);
    this._sessions.clear();

    return new Promise((resolve) => this._wss.close(resolve));
  }
}
