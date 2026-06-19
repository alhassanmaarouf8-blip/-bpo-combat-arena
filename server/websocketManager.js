import { WebSocketServer } from 'ws';
import { randomUUID }      from 'crypto';
import { RealtimeClient }  from './realtimeClient.js';
import { generateDebrief } from './coach.js';
import { loadUser, saveUser } from './store.js';
import { addItem, dueCount }  from './srs.js';
import { bossForLevel, levelFor, xpForSession, levelProgress, nextBoss, computeStreak, computeRank } from './progression.js';
import { verifyToken, getAccountById, entitlement, planOf, dailyMinutesFor } from './auth.js';
import { classifyGrammar }       from './errorTags.js';
import { refreshRecommendations, allRecommendedDone } from './trainingslager.js';
import { getLesson }              from './lessons.config.js';
import { dayKey }                 from './time.js';

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
  const items = (profile?.srs || []).filter((i) => i.type === 'grammar' && !i.mastered && i.content);
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
  SESSION_READY:    'session_ready',
  SESSION_CLOSED:   'session_closed',
  AUDIO_DELTA:      'audio_delta',
  TRANSCRIPT_DELTA: 'transcript_delta',
  TRANSCRIPT_DONE:  'transcript_done',
  BOSS_SPEECH:      'boss_speech',
  BOSS_SPEECH_DONE: 'boss_speech_done',
  SCENARIO_INFO:    'scenario_info',
  STAGE_UPDATE:     'stage_update',
  DEBRIEF_PENDING:  'debrief_pending',
  DEBRIEF:          'debrief',
  NO_SESSION:       'no_session',   // closed without real participation → no feedback card
  PAYWALL:          'paywall',
  HP_UPDATE:        'hp_update',
  LIVE_STATS:       'live_stats',
  ERROR:            'error',
  PONG:             'pong',
};

// ── Inbound message types (browser → server) ──────────────────────────────────
const C = {
  START_FIGHT:  'start_fight',
  STOP_FIGHT:   'stop_fight',
  AUDIO_CHUNK:  'audio_chunk',
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
      bossId:         'herr-tariq',
      scoreSum:       0,
      scoreCount:     0,
      fillerTotal:    0,       // cumulative filler words this session (for the live counter)
      combo:          0,       // consecutive strong answers (for the combo multiplier)
      comboBest:      0,       // best combo reached this session
      weakStreak:     0,       // consecutive broken answers (triggers the rescue move)
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

      case C.AUDIO_CHUNK:
        this._handleAudioChunk(ctx, msg);
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

    // ── Plan gate: a free account has 0 live minutes → upsell BEFORE any Realtime opens ──
    const minutes = dailyMinutesFor(account);   // free 0 / basic 7 / elite 15
    if (minutes <= 0) {
      console.log(`[wsManager] Paywall (free, no live plan)  user=${account.id}  session=${ctx.sessionId}`);
      this._send(ctx, { type: S.PAYWALL, ...entitlement(account) });
      return;
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
    let bossId = 'herr-tariq';
    let dossier = null;
    let focusTitle = null;
    let prof = null;
    try {
      prof = await loadUser(ctx.userId);
      bossId  = bossForLevel(prof.level).id;
      dossier = topWeakRule(prof);   // recurring weak grammar rule → boss memory dossier
      focusTitle = getLesson(prof.lastCompletedLesson)?.title_de || null; // Trainingslager fight focus
    } catch {}

    // ── Daily live-minute remaining (reset midnight Africa/Cairo) — hard-cap this fight ──
    const today      = dayKey();
    const usedSec    = (prof?.liveUsage?.day === today) ? (prof.liveUsage.sec || 0) : 0;
    const remainingSec = minutes * 60 - usedSec;
    if (remainingSec <= 0) {
      console.log(`[wsManager] Daily limit reached  user=${ctx.userId}  plan=${planOf(account)}  usedSec=${usedSec}/${minutes * 60}  session=${ctx.sessionId}`);
      this._releaseFight(ctx);
      this._sendError(ctx, 'daily_limit');
      return;
    }
    ctx.dailyCapSec = remainingSec;

    // Boss-Tor gate: challenging the next boss requires the recommended lessons done. The
    // normal daily fight (no mode) is NEVER gated by lessons. (Payment is the minute gate above.)
    if (viaBossTor && !allRecommendedDone(prof)) {
      this._releaseFight(ctx); this._sendError(ctx, 'lessons_incomplete'); return;
    }

    ctx.bossId = bossId;
    if (focusTitle) console.log(`[trainingslager] fight focus injected  user=${ctx.userId}  title="${focusTitle}"`);
    console.log(`[wsManager] Starting fight  user=${ctx.userId}  bossId=${bossId}  level=${level}  mode=${viaBossTor ? 'bosstor' : 'daily'}  dossier=${dossier ?? '—'}  focus=${focusTitle ?? '—'}  session=${ctx.sessionId}`);

    try {
      ctx.realtimeClient = new RealtimeClient({
        sessionId: ctx.sessionId,
        bossId,
        level,
        dossier,
        focusTitle,
        onAudioDelta:      (chunk)  => { ctx.audioOutBytes += this._b64Bytes(chunk); this._send(ctx, { type: S.AUDIO_DELTA, audio: chunk }); },
        onTranscriptDelta: (text)   => this._send(ctx, { type: S.TRANSCRIPT_DELTA, text }),
        onTranscriptDone:  (data)   => this._onTranscriptDone(ctx, data),
        onBossSpeech:      (text)   => this._send(ctx, { type: S.BOSS_SPEECH,      text }),
        onBossSpeechDone:  ()       => {
          this._send(ctx, { type: S.BOSS_SPEECH_DONE });
          // Server is the single source of truth: end ONLY after the boss has finished
          // its turn, and only once all three parts are complete.
          if (ctx.completePending && !ctx.closed) this._endSession(ctx, 'completed');
        },
        onSpeechSegment:   (ms)     => { if (ms > 400) ctx.totalSpeechMs += ms; },
        onHpUpdate:        (hp)     => this._onHpUpdate(ctx, hp),
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

      // Tell the browser which level + funnel + scenario it's facing, and open on Teil 1.
      const info = ctx.realtimeClient.sessionInfo;
      ctx.level      = info.level;
      ctx.stages     = info.stages;
      ctx.stageIdx   = 0;
      ctx.csScenario = info.csScenario;
      this._send(ctx, { type: S.SCENARIO_INFO, ...info });
      this._send(ctx, { type: S.STAGE_UPDATE, index: 0, ...info.stages[0] });
    } catch (err) {
      console.error(`[wsManager] Failed to start fight session=${ctx.sessionId}:`, err.message);
      ctx.realtimeClient = null;
      this._releaseFight(ctx);   // free the per-user lock + cap timer so the user can retry
      this._sendError(ctx, 'fight_start_failed');
    }
  }

  // Release the per-user single-flight lock and the cap timers for this session.
  _releaseFight(ctx) {
    if (ctx.maxTimer)     { clearTimeout(ctx.maxTimer); ctx.maxTimer = null; }
    if (ctx.hardCapTimer) { clearTimeout(ctx.hardCapTimer); ctx.hardCapTimer = null; }
    if (ctx.accountLocked) { this._activeFightUsers.delete(ctx.accountLocked); ctx.accountLocked = null; }
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
    this._releaseFight(ctx);   // free the per-user lock + cancel the hard-cap timer

    // Per-fight cost visibility (the founder's only window into OpenAI Realtime spend).
    const wallSec = ctx.fightStartedAt ? Math.round((Date.now() - ctx.fightStartedAt) / 1000) : 0;
    const inSec   = Math.round(ctx.audioInBytes  / PCM16_BYTES_PER_SEC);
    const outSec  = Math.round(ctx.audioOutBytes / PCM16_BYTES_PER_SEC);
    console.log(`[wsManager] FIGHT COST  user=${ctx.userId}  reason=${reason}  wallSec=${wallSec}  audioInSec=${inSec}  audioOutSec=${outSec}  session=${ctx.sessionId}`);

    // Charge the wall time against the user's daily live-minute allowance (persisted).
    await this._recordLiveUsage(ctx, wallSec);

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

    let debrief;
    try {
      debrief = await generateDebrief({
        utterances:   ctx.utterances,
        metrics,
        level:        ctx.level,
        csScenarioId: ctx.csScenario,
      });
    } catch (err) {
      console.error(`[wsManager] Debrief generation error session=${ctx.sessionId}:`, err.message);
      debrief = { grammar: [], strengths: [], studyNext: [], metrics, generated: false };
    }

    const progress = await this._persistProgress(ctx, metrics, debrief);
    const result   = this._computeResult(ctx, metrics);

    console.log(`[wsManager] Debrief ready  generated=${debrief.generated}  outcome=${result.outcome}  rank=${result.rank}  bossHp=${result.bossHp}  answers=${metrics.answers}  session=${ctx.sessionId}`);
    this._send(ctx, { type: S.DEBRIEF, ...debrief, result, progress });
  }

  // Persist this session: history, vocab growth, SRS items from errors, XP/level.
  async _persistProgress(ctx, metrics, debrief) {
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

      // XP + level (light progression).
      const beforeLevel = levelFor(p.xp);
      const xpGained    = xpForSession(metrics);
      p.xp   += xpGained;
      p.level = levelFor(p.xp);
      const leveledUp = p.level > beforeLevel;

      if (ctx.bossHp <= 0 && !p.bossesDefeated.includes(ctx.bossId)) p.bossesDefeated.push(ctx.bossId);

      p.sessions.push({
        date: now, level: ctx.level, bossId: ctx.bossId,
        fluency: metrics.fluency, wpm: metrics.wpm, fillers: metrics.fillers,
        c1Hits: metrics.c1Hits, konjunktivHits: metrics.konjunktivHits,
        connectorHits: metrics.connectorHits, answers: metrics.answers,
        vocabTotal: p.vocabLearned.length,
        errorTags: classifyGrammar(debrief.grammar),   // Trainingslager: per-fight error tags
      });

      // Trainingslager: refresh study recommendations from the last 3 fights (rule-based, no AI).
      refreshRecommendations(p);

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
  _computeResult(ctx, metrics) {
    const bossHp   = Math.max(0, Math.round(ctx.bossHp));
    const playerHp = Math.max(0, Math.round(ctx.playerHp));
    const outcome  = (bossHp <= 0 || bossHp <= playerHp) ? 'win' : 'loss';
    const score    = metrics.avgScore ?? 0;
    const clamp    = (n) => Math.max(0, Math.min(100, Math.round(n)));

    // Per-skill damage 0–100 (higher = harder hit on the boss in that category).
    const categories = {
      fluency:      clamp(metrics.fluency),
      grammar:      clamp(38 + metrics.connectorHits * 15 - metrics.fillers * 3),
      vocab:        clamp(40 + metrics.c1Hits * 18),
      deescalation: clamp(34 + metrics.politenessHits * 15 + metrics.konjunktivHits * 6),
    };

    const s = score;
    const rank = s >= 90 ? 'C1' : s >= 80 ? 'B2+' : s >= 70 ? 'B2'
               : s >= 60 ? 'B1+' : s >= 48 ? 'B1' : s >= 35 ? 'A2+' : 'A2';
    const jobLabel = s >= 90 ? 'Sehr gute Bewerbungsrede'
                 : s >= 80 ? 'Gut — fast berufsreif'
                 : s >= 70 ? 'Grundsolide'
                 : s >= 60 ? 'Ausbaufähig mit Potenzial'
                 :            'Weiter üben — Du schaffst das';

    return { outcome, bossHp, playerHp, score, rank, jobLabel, comboBest: ctx.comboBest, categories };
  }

  // ── Audio relay browser → OAI ───────────────────────────────────────────────

  _handleAudioChunk(ctx, msg) {
    if (!ctx.realtimeClient) return;
    if (typeof msg.audio !== 'string' || msg.audio.length > 20_000) return;
    ctx.audioInBytes += this._b64Bytes(msg.audio);   // billed input audio (for the cost log)
    ctx.realtimeClient.sendAudio(msg.audio);
  }

  // ── OAI callbacks ───────────────────────────────────────────────────────────

  _onTranscriptDone(ctx, { transcript, durationMs, wordCount }) {
    console.log(`[wsManager] Utterance complete  words=${wordCount}  ms=${durationMs}  session=${ctx.sessionId}`);

    // Always surface the transcript text (drives the live transcript panel),
    // regardless of whether this utterance is scored.
    this._send(ctx, {
      type:       S.TRANSCRIPT_DONE,
      transcript,
      durationMs,
      wordCount,
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

    // Combo: consecutive STRONG answers build a multiplier; a clear MISS breaks it.
    // 45–64 holds the current streak (neither builds nor breaks). Display-only meter —
    // it does NOT alter HP, so the tuned damage balance is untouched.
    if      (score >= 65) { ctx.combo += 1; if (ctx.combo > ctx.comboBest) ctx.comboBest = ctx.combo; }
    else if (score < 45)  { ctx.combo = 0; }
    const exWpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;

    // Rescue move: two broken answers in a row → the boss eases up on its next turn.
    if (score < 40) ctx.weakStreak += 1; else ctx.weakStreak = 0;
    if (ctx.weakStreak >= 2) { ctx.weakStreak = 0; ctx.realtimeClient?.requestRescue?.('weak'); }

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
    // course. We wait for the boss to finish its current turn (onBossSpeechDone) so the
    // voice never gets cut off mid-sentence — but if the boss is already idle, end now.
    if (ctx.stageIdx === 2 && (ctx.scoredAnswers - STAGE_AFTER[1]) >= ROLEPLAY_EXCHANGES) {
      ctx.completePending = true;
      if (ctx.realtimeClient && !ctx.realtimeClient.isResponding && !ctx.closed) {
        this._endSession(ctx, 'completed');
      }
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
