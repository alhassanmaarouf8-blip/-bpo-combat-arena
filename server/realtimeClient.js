import WebSocket from 'ws';
import { createHash, randomUUID } from 'crypto';
import { buildSessionScript } from './scenarios.js';

// Ã¢â€â‚¬Ã¢â€â‚¬ OpenAI Realtime API config Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const OAI_URL   = 'wss://api.openai.com/v1/realtime';
// Newest GA speech-to-speech model (GPT-5-class reasoning). Same audio price as gpt-realtime
// ($32/$64 per 1M audio in/out). Env-overridable: if a key lacks gpt-realtime-2 access and the
// session errors model_not_found, set OAI_MODEL=gpt-realtime (no code change, instant fallback).
const OAI_MODEL = process.env.OAI_MODEL ?? 'gpt-realtime-2';

// Ã¢â€â‚¬Ã¢â€â‚¬ OAI server event types we handle Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const OAI = {
  SESSION_CREATED:       'session.created',
  SESSION_UPDATED:       'session.updated',
  SPEECH_STARTED:        'input_audio_buffer.speech_started',
  SPEECH_STOPPED:        'input_audio_buffer.speech_stopped',
  TRANSCRIPT_DELTA:      'conversation.item.input_audio_transcription.delta',
  TRANSCRIPT_DONE:       'conversation.item.input_audio_transcription.completed',
  RESPONSE_AUDIO_DELTA:  'response.output_audio.delta',
  RESPONSE_AUDIO_DONE:   'response.output_audio.done',
  RESPONSE_TEXT_DELTA:   'response.output_audio_transcript.delta',
  RESPONSE_CREATED:      'response.created',
  RESPONSE_DONE:         'response.done',
  ERROR:                 'error',
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Boss personality configs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const BOSS_CONFIGS = {
  'herr-tariq': {
    displayName: 'HERR TARIQ',
    greeting:    'Gut, fangen wir an.',
    persona:     `Du bist Herr Tariq, ein erfahrener HR-Manager in einem deutschen BPO-Unternehmen. ` +
                 `Du bist RUHIG, KÜHL und KONTROLLIERT — niemals laut, niemals aggressiv. Deine ` +
                 `Oberfläche ist durchgehend höflich und professionell (konsequente Sie-Form). ` +
                 `Der Druck entsteht NICHT durch Lautstärke oder Unterbrechungen, sondern durch: ` +
                 `gezielte, bohrende Nachfragen ("Aha. Und warum genau?", "Können Sie das konkretisieren?"), ` +
                 `milde, spürbare Skepsis, kurze Pausen, in denen du den Kandidaten bewusst weiterreden lässt, ` +
                 `und die Aufforderung, vage Antworten zu präzisieren. Du wirkst leicht unbeeindruckt und ` +
                 `schwer zu überzeugen, bleibst aber stets sachlich und beherrscht. ` +
                 `Du UNTERBRICHST den Kandidaten NIEMALS — du lässt ihn ausreden, auch wenn er zögert oder ` +
                 `mitten im Satz nachdenkt, und reagierst erst danach. ` +
                 `Sichtbare Verärgerung zeigst du NUR, wenn der Kandidat wirklich unhöflich wird oder komplett ` +
                 `versagt — und auch dann kühl und kontrolliert, nie schreiend. ` +
                 `Du sprichst ausschließlich Deutsch und akzeptierst kein Englisch. Bleibe durchgehend in der Rolle.`,
    voice:       'cedar',   // newest, most natural OpenAI Realtime voice (was 'alloy')
    aggression:  0.85,
    patienceMs:  2500,
    systemPrompt: `Du bist Herr Tariq, ein ÃƒÂ¤gyptischer HR-Manager in einem deutschen BPO-Unternehmen.
Du fÃƒÂ¼hrst ein stressiges VorstellungsgesprÃƒÂ¤ch auf Deutsch durch.
Dein Stil: ungeduldig, direkt, fordernd Ã¢â‚¬â€ aber professionell.
Du stellst schwierige Fragen ÃƒÂ¼ber Berufserfahrung, StressbewÃƒÂ¤ltigung und Deutschkenntnisse.
Wenn der Kandidat zÃƒÂ¶gert oder Englisch spricht, wirst du noch ungeduldiger.
Antworte IMMER auf Deutsch. Stelle immer genau eine Frage am Ende.
Beginne das GesprÃƒÂ¤ch mit: "Gut, fangen wir an. Warum sollten wir ausgerechnet SIE einstellen?"`,
    openingLine: 'Gut, fangen wir an. Warum sollten wir ausgerechnet SIE einstellen?',
  },
  'frau-mueller': {
    displayName: 'FRAU MÜLLER',
    greeting:    'Guten Tag.',
    persona:     `Du bist Frau Müller, eine erfahrene Berliner Compliance-Managerin. ` +
                 `Du bist PRÄZISE, METHODISCH und KÜHL — beherrscht und niemals laut. Deine Oberfläche ist ` +
                 `tadellos höflich und formell (konsequente Sie-Form). ` +
                 `Der Druck entsteht durch deine penible Genauigkeit: du hakst bei Ungenauigkeiten ruhig nach ` +
                 `("Das müssten Sie mir genauer erklären.", "Und worauf stützen Sie das?"), zeigst feine, ` +
                 `passiv-aggressive Skepsis, machst kurze Pausen und bittest den Kandidaten, vage Aussagen zu ` +
                 `belegen. Du lobst selten und sparsam. ` +
                 `Du UNTERBRICHST NIEMALS — du lässt den Kandidaten ausreden, auch bei Zögern oder Denkpausen, ` +
                 `und reagierst erst danach. ` +
                 `Sichtbare Verärgerung zeigst du NUR bei echter Unhöflichkeit oder komplettem Versagen — kühl, ` +
                 `nie schreiend. Du sprichst ausschließlich Deutsch. Bleibe durchgehend in der Rolle.`,
    voice:       'marin',   // newest, most natural OpenAI Realtime voice (was 'alloy')
    aggression:  0.5,
    patienceMs:  4000,
    systemPrompt: `Du bist Frau MÃƒÂ¼ller, eine erfahrene Berliner Compliance-Managerin.
Du fÃƒÂ¼hrst ein strukturiertes VorstellungsgesprÃƒÂ¤ch auf Deutsch durch.
Dein Stil: prÃƒÂ¤zise, methodisch, kÃƒÂ¼hl aber fair.
Du bewertest Genauigkeit, Regelkenntnis und professionelle Ausdrucksweise.
Antworte IMMER auf Deutsch. Stelle immer genau eine Frage am Ende.
Beginne mit: "Guten Tag. Bitte schildern Sie kurz Ihren beruflichen Werdegang."`,
    openingLine: 'Guten Tag. Bitte schildern Sie kurz Ihren beruflichen Werdegang.',
  },
  'direktor-vogel': {
    displayName: 'DIREKTOR VOGEL',
    greeting:    'Setzen Sie sich. Wir haben wenig Zeit.',
    persona:     `Du bist Direktor Vogel, der gefürchtete Standortleiter eines großen deutschen BPO-Konzerns. ` +
                 `Du bist EISKALT, BEHERRSCHT und LEISE BEDROHLICH — gerade WEIL du nie die Stimme erhebst. ` +
                 `Deine Oberfläche ist makellos höflich und distanziert (konsequente Sie-Form). ` +
                 `Der Druck entsteht durch deine ruhige Autorität: knappe, durchdringende Nachfragen ` +
                 `("Interessant. Und das soll mich überzeugen?", "Sie weichen aus. Antworten Sie konkret."), ` +
                 `kühle Skepsis, bewusste Pausen, in denen du den Kandidaten still betrachtest, und die ` +
                 `Aufforderung, jede Behauptung zu untermauern. Du durchschaust Floskeln sofort und benennst sie ` +
                 `ruhig. Du erwartest gehobenes, präzises Deutsch. ` +
                 `Du UNTERBRICHST den Kandidaten NIEMALS — du lässt ihn ausreden, auch bei langem Zögern, und ` +
                 `setzt erst danach an; deine Pausen sind Teil der Einschüchterung, nicht das Wort-Abschneiden. ` +
                 `Sichtbare Verärgerung zeigst du NUR bei echter Unhöflichkeit oder totalem Versagen — und dann ` +
                 `eisig kontrolliert, niemals schreiend. Du sprichst ausschließlich Deutsch. Bleibe durchgehend in der Rolle.`,
    voice:       'cedar',   // newest, most natural OpenAI Realtime voice (was 'alloy')
    aggression:  0.95,
    patienceMs:  1800,
  },
};

const DEFAULT_BOSS = 'herr-tariq';

// ── Rescue move: the boss eases up when the candidate is clearly stuck ──────────
// Triggers: >RESCUE_SILENCE_MS of no speech after a boss turn, OR (from the gateway)
// two broken answers in a row. It only ever sends one extra gentle line via the SAME
// response.create path used for the opening line — the audio pipeline / VAD are untouched.
// Set RESCUE_ENABLED = false to disable instantly if it ever misbehaves.
const RESCUE_ENABLED    = true;
const RESCUE_SILENCE_MS = 6000;

// ── Phase 1/5: seeded per-session mood + a deliberate "thinking" pause ───────────────
// Mood is chosen ONCE per session from a seed derived from the sessionId, so a session is
// consistent and repeatable, and it NEVER flips mid-interview. It only shapes instruction
// text (delivery), never the audio/VAD/scoring. RESPONSE_DELAY_MS is an intentional pause
// before the boss's OPENING/rescue line (Phase 5b); per-turn pacing stays governed by the
// patient server_vad silence_duration_ms — that is NOT touched here.
const MOOD_POOL = ['sharp-monday', 'neutral', 'tired-friday'];
const RESPONSE_DELAY_MS = 450;
function _seedFrom(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _seededPick(arr, seed) { const x = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0; return arr[x % arr.length]; }

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export class RealtimeClient {
  /**
   * @param {{
   *   sessionId:         string,
   *   bossId?:           string,
   *   level?:            string,   // 'a2-b1' | 'b2'
   *   onAudioDelta:      (base64: string) => void,
   *   onTranscriptDelta: (text: string) => void,
   *   onTranscriptDone:  (data: {transcript:string, durationMs:number, wordCount:number}) => void,
   *   onBossSpeech:      (text: string) => void,
   *   onHpUpdate:        (hp: {bossHp:number, playerHp:number}) => void,
   *   onError:           (err: Error) => void,
   *   onClose:           () => void,
   * }} opts
   */
  constructor(opts) {
    this._sessionId  = opts.sessionId;
    const bossId     = opts.bossId ?? DEFAULT_BOSS;
    this._boss       = BOSS_CONFIGS[bossId] ?? BOSS_CONFIGS[DEFAULT_BOSS];
    this._cb         = opts;

    // Phase 1: seeded per-session mood (consistent + repeatable, never flips mid-session).
    // Clarification ("could you repeat that?") is LEVEL-SCALED: never for beginners (a2-b1),
    // occasional for advanced (b2). Delivery realism softens for beginners; judgement does not.
    this._mood = _seededPick(MOOD_POOL, _seedFrom(this._sessionId));
    const clarificationRate = opts.level === 'b2' ? 0.12 : 0;

    // Build the 3-part assessment funnel (intro → behavioral → CS roleplay), scaled
    // to the chosen CEFR level. Voice / aggression / interruption stay on this._boss.
    this._session = buildSessionScript({
      persona:     this._boss.persona,
      displayName: this._boss.displayName,
      greeting:    this._boss.greeting,
      levelId:     opts.level,
      dossier:     opts.dossier,   // recurring weak rule, so the boss can reference past struggles
      focusTitle:  opts.focusTitle, // Trainingslager: lesson title to weave into this fight
      mood:        this._mood,        // Phase 1: seeded delivery mood
      clarificationRate,              // Phase 5c: level-scaled repeat requests
    });

    // Public snapshot the gateway forwards to the browser (level + funnel + scenario).
    this.sessionInfo = {
      bossId,
      displayName: this._boss.displayName,
      level:       this._session.level.id,
      levelLabel:  this._session.level.label,
      behavioral:  this._session.behavioral,
      csScenario:  this._session.csScenario.id,
      stages:      this._session.stages,
    };

    this._ws              = null;
    this._connected       = false;
    this._closing         = false;
    this._speechStartedAt = null;
    this._transcriptBuf   = '';
    this._retries         = 0;
    this._maxRetries      = 3;
    this._activeResponseId = null;   // id of the in-flight OAI response, or null
    this._pendingResponse  = null;   // interrupt reply deferred until the cancel completes
    this._silenceTimer  = null;      // rescue: fires if the candidate stays silent after a boss turn
    this._rescueCooling = false;     // rescue: at most one rescue per stuck episode
    this._pendingRescue = null;      // rescue: reason, deferred until the current boss turn ends
  }

  // True while the boss is mid-turn (used to end a completed session without cutting audio).
  get isResponding() { return this._activeResponseId !== null; }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Connect to OAI Realtime API Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async connect() {
    await this._openWs();
  }
  _openWs() {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

      const url = `${OAI_URL}?model=${OAI_MODEL}`;

      const connectTimeout = setTimeout(() => {
        this._ws?.terminate();
        reject(new Error(`OAI connect timeout after 10s`));
      }, 10_000);

      this._ws = new WebSocket(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      this._ws.on('open', () => {
        clearTimeout(connectTimeout);
        this._connected = true;
        this._retries   = 0;
        console.log(`[realtimeClient] Connected to OAI  session=${this._sessionId}  model=${OAI_MODEL}`);
        resolve();
      });

      this._ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        this._connected = false;
        console.error(`[realtimeClient] WS error session=${this._sessionId}:`, err.message);
        reject(err);
        this._cb.onError(err);
      });

      this._ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        this._connected = false;
        const r = reason?.toString('utf8') ?? '';
        console.log(`[realtimeClient] WS closed  code=${code}  reason=${r}  session=${this._sessionId}`);

        if (!this._closing) {
          this._handleUnexpectedClose(code);
        } else {
          this._cb.onClose();
        }
      });

      this._ws.on('message', (data) => this._onMessage(data));
    });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Unexpected close: retry with back-off Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async _handleUnexpectedClose(code) {
    // Do NOT auto-reconnect during a fight. A reconnected OAI socket emits a fresh
    // session.created, which re-runs _onSessionCreated and replays the boss's opening
    // line — i.e. the interview "restarts itself" mid-session. End the session cleanly
    // and let the user restart deliberately instead.
    console.log(`[realtimeClient] OAI closed unexpectedly  code=${code}  session=${this._sessionId} — ending session (reconnect disabled)`);
    this._cb.onClose();
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ OAI event router Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onMessage(raw) {
    let event;
    try { event = JSON.parse(raw.toString('utf8')); }
    catch { return; }

    switch (event.type) {
      case OAI.SESSION_CREATED:        this._onSessionCreated(event); break;
      case OAI.SESSION_UPDATED:        break; // no-op Ã¢â‚¬â€ we log for debug
      case OAI.SPEECH_STARTED:         this._onSpeechStarted();       break;
      case OAI.SPEECH_STOPPED:         this._onSpeechStopped();       break;
      case OAI.TRANSCRIPT_DELTA:       this._onTranscriptDelta(event); break;
      case OAI.TRANSCRIPT_DONE:        this._onTranscriptDone(event);  break;
      case OAI.RESPONSE_AUDIO_DELTA:   this._onAudioDelta(event);      break;
      case OAI.RESPONSE_TEXT_DELTA:    this._onBossSpeechDelta(event); break;
      case OAI.RESPONSE_CREATED:       this._activeResponseId = event.response?.id ?? null; break;
      case OAI.RESPONSE_DONE:
        // Only clear if this is the response we think is active (ignore stale/cancelled dones)
        if (event.response?.id === this._activeResponseId) this._activeResponseId = null;
        // Boss finished (or was cut off) — let the client finalize the live subtitle line.
        this._cb.onBossSpeechDone?.();
        // A deferred interrupt reply was waiting for the cancelled response to finish.
        if (this._pendingResponse && this._activeResponseId === null) {
          const reply = this._pendingResponse;
          this._pendingResponse = null;
          this._sendEvent('response.create', reply);
        } else if (this._activeResponseId === null) {
          // Boss turn over and nothing else queued: a deferred "weak answers" rescue fires
          // now; otherwise wait for the candidate and arm the silence rescue.
          if (this._pendingRescue) { const why = this._pendingRescue; this._pendingRescue = null; this._fireRescue(why); }
          else this._armSilenceRescue();
        }
        break;
      case OAI.ERROR:                  this._onOaiError(event);        break;
      default: break;
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Session initialisation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onSessionCreated(event) {
    console.log(`[realtimeClient] Session created  oaiSessionId=${event.session?.id}  session=${this._sessionId}`);

    // Configure session: voice, VAD, transcription, boss personality
    // GA Realtime API schema: session.type is required, audio config is nested
    // under audio.input / audio.output, and output_modalities replaces modalities.
    this._sendEvent('session.update', {
      session: {
        type:              'realtime',
        instructions:      this._session.instructions,
        output_modalities: ['audio'],
        audio: {
          input: {
            format:        { type: 'audio/pcm', rate: 24000 },
            // Streaming STT: gpt-4o-mini-transcribe emits incremental
            // transcription.delta events so the user's words appear live as they
            // speak. (whisper-1 only returns one completed transcript at the end.)
            // language:'de' LOCKS the transcriber to German — without it, quiet/unclear
            // audio gets auto-detected as the wrong language and returns garbage (e.g.
            // Japanese „はい。" for a spoken „ja, hallo"). ISO-639-1 code.
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'de' },
            turn_detection: {
              type:                'server_vad',
              // The boss must WAIT through a real thinking pause before answering, so a
              // hesitant A2-B1 speaker can formulate a reply after a question.
              //   threshold (0.72): only clear, deliberate speech ends the turn —
              //     breathing, room noise and quiet mid-thought sounds are ignored.
              //   silence_duration_ms (2000): a full 2.0s of real silence is required
              //     after the user stops before the boss is allowed to respond, so a
              //     hesitant speaker can pause mid-thought without being cut off.
              // TUNE HERE: lower toward 1500 if the boss feels too slow, or raise toward
              //   2500 if it still jumps in; raise threshold toward 0.8 if background
              //   noise triggers it.
              threshold:           0.72,
              prefix_padding_ms:   300,
              silence_duration_ms: 2000,
              create_response:     true,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice:  this._boss.voice,
          },
        },
      },
    });

    // Trigger boss opening line — after a short, deliberate "thinking" pause (Phase 5b).
    // Per-turn pacing remains governed by the patient server_vad pause (unchanged).
    console.log(`[realtimeClient] mood=${this._mood}  openingDelayMs=${RESPONSE_DELAY_MS}  session=${this._sessionId}`);
    setTimeout(() => {
      if (this._closing) return;
      this._sendEvent('response.create', {
        response: {
          instructions:      `Beginne das Interview sofort mit genau diesem Satz: "${this._session.openingLine}"`,
          output_modalities: ['audio'],
        },
      });
    }, RESPONSE_DELAY_MS);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Speech VAD events Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onSpeechStarted() {
    this._speechStartedAt = Date.now();
    this._transcriptBuf   = '';
    // The candidate is answering: cancel any pending silence rescue and re-arm for next turn.
    this._clearSilenceTimer();
    this._rescueCooling = false;
    console.log(`[realtimeClient] Speech started  session=${this._sessionId}`);
  }

  _onSpeechStopped() {
    const elapsed = this._speechStartedAt ? Date.now() - this._speechStartedAt : 0;
    console.log(`[realtimeClient] Speech stopped  durationMs=${elapsed}  session=${this._sessionId}`);

    // Report this speech segment's length for accurate end-of-session WPM.
    this._cb.onSpeechSegment?.(elapsed);

    // Active "barking" interruption DISABLED.
    // This block used to cancel the candidate's turn and snap "Kommen Sie zum Punkt!"
    // on any answer shorter than patienceMs for high-aggression bosses. That cut off
    // hesitant A2-B1 speakers mid-thought and contradicts the new composed, never-
    // interrupting persona. Pressure now comes purely from the persona's pointed
    // follow-ups and pauses, and turn-taking is governed by server_vad
    // (silence_duration_ms: 1000). Kept commented for easy revert if ever wanted.
    //
    // if (this._boss.aggression >= 0.7 && elapsed < this._boss.patienceMs && elapsed > 500) {
    //   if (Math.random() < this._boss.aggression - 0.3) {
    //     this._sendEvent('input_audio_buffer.clear', {});
    //     ... response.cancel / sharp "Kommen Sie zum Punkt!" reply ...
    //   }
    // }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Transcript events Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onTranscriptDelta(event) {
    const delta = event.delta ?? '';
    this._transcriptBuf += delta;
    this._cb.onTranscriptDelta(delta);
  }

  _onTranscriptDone(event) {
    const transcript = event.transcript ?? this._transcriptBuf;
    const durationMs = this._speechStartedAt ? Date.now() - this._speechStartedAt : 0;
    const wordCount  = transcript.trim().split(/\s+/).filter(Boolean).length;

    console.log(`[realtimeClient] Transcript done  words=${wordCount}  ms=${durationMs}  session=${this._sessionId}`);

    this._cb.onTranscriptDone({ transcript, durationMs, wordCount });
    this._transcriptBuf   = '';
    this._speechStartedAt = null;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Audio events Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onAudioDelta(event) {
    const chunk = event.delta ?? '';
    if (chunk) this._cb.onAudioDelta(chunk);
  }

  _onBossSpeechDelta(event) {
    const text = event.delta ?? '';
    if (text) this._cb.onBossSpeech(text);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ OAI error Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  _onOaiError(event) {
    const msg  = event.error?.message ?? 'Unknown OAI error';
    const code = event.error?.code    ?? 'unknown';

    // Benign, self-recovering races from the interruption flow. The server's VAD
    // auto-response can collide with our interrupt response.create, or a cancel can
    // target an already-finished response. The boss is still replying via the active
    // response, so log these but DON'T surface them to the browser as realtime_error.
    const BENIGN = ['conversation_already_has_active_response', 'response_cancel_not_active'];
    if (BENIGN.includes(code)) {
      console.warn(`[realtimeClient] Ignoring benign OAI error  code=${code}  session=${this._sessionId}`);
      return;
    }

    console.error(`[realtimeClient] OAI error  code=${code}  message=${msg}  session=${this._sessionId}`);
    this._cb.onError(Object.assign(new Error(msg), { code }));

    // Fatal, non-recoverable errors: close the OpenAI socket NOW so we stop billing audio
    // (out of credit, key problem, rate-limited, or an OpenAI-side outage).
    if (['authentication_error', 'invalid_api_key', 'insufficient_quota',
         'rate_limit_exceeded', 'server_error'].includes(code)) {
      this._closing = true;
      this._ws?.close(1000);
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Public: send audio Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  sendAudio(base64Pcm16) {
    if (!this._connected || this._closing) return;
    this._sendEvent('input_audio_buffer.append', { audio: base64Pcm16 });
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Public: close Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  async close() {
    if (this._closing) return;
    this._closing = true;
    this._clearSilenceTimer();
    console.log(`[realtimeClient] Closing  session=${this._sessionId}`);

    if (this._ws && this._connected) {
      this._ws.close(1000, 'session_ended');
      await Promise.race([
        new Promise(r => this._ws.once('close', r)),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    }
    this._connected = false;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Event send helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  // ── Rescue move ────────────────────────────────────────────────────────────
  _clearSilenceTimer() { if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; } }

  _armSilenceRescue() {
    this._clearSilenceTimer();
    if (!RESCUE_ENABLED || this._closing || this._rescueCooling) return;
    this._silenceTimer = setTimeout(() => { this._silenceTimer = null; this._fireRescue('silence'); }, RESCUE_SILENCE_MS);
    this._silenceTimer.unref?.();
  }

  // Public: the gateway calls this after two broken answers. Fires now if the boss is idle,
  // otherwise defers until the current boss turn finishes (see RESPONSE_DONE).
  requestRescue(reason = 'weak') {
    if (!RESCUE_ENABLED) return;
    if (this._activeResponseId === null) this._fireRescue(reason);
    else this._pendingRescue = reason;
  }

  _fireRescue(reason) {
    if (!RESCUE_ENABLED || this._closing || this._rescueCooling || this._activeResponseId !== null) return;
    this._rescueCooling = true;   // one rescue per stuck episode; reset when the candidate speaks
    console.log(`[realtimeClient] Rescue (${reason})  session=${this._sessionId}`);
    const instr = reason === 'silence'
      ? `Der Kandidat schweigt und scheint blockiert. Bleib in deiner Rolle, aber HILF kurz: stelle deine letzte Frage EINFACHER und kürzer neu und ermutige in einem Satz ("Nehmen Sie sich ruhig Zeit…"). Höchstens zwei kurze Sätze.`
      : `Der Kandidat hat mehrfach Mühe. Bleib in deiner Rolle, aber LASS ETWAS NACH: vereinfache, gib einen kleinen Hinweis oder ein Anfangswort und ermutige knapp. Höchstens zwei kurze Sätze.`;
    this._sendEvent('response.create', { response: { instructions: instr, output_modalities: ['audio'] } });
  }

  _sendEvent(type, payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const event = { event_id: `${type}-${randomUUID().slice(0, 8)}`, type, ...payload };
    try {
      this._ws.send(JSON.stringify(event));
    } catch (err) {
      console.error(`[realtimeClient] Send failed  type=${type}  session=${this._sessionId}:`, err.message);
    }
  }
}

