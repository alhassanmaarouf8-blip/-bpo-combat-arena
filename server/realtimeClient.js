/**
 * realtimeClient.js — the interview "boss" brain.
 *
 * 100% OpenAI-free. The boss is a Groq chat model (llama-3.3-70b-versatile) driven
 * TURN-BASED: it asks ONE thing, then stops and waits for the candidate's answer
 * (typed or spoken-then-transcribed, supplied by the gateway). There is NO audio
 * here, NO voice synthesis, NO VAD and NO OpenAI Realtime socket — boss turns are
 * text the client renders as subtitles.
 *
 * Public interface (unchanged, so websocketManager stays compatible):
 *   new RealtimeClient(opts)   — opts carries the boss/level + callbacks
 *   await connect()            — sets up Groq + emits the opening line
 *   await respond(userText)    — produces exactly ONE boss turn for an answer
 *   get isResponding           — true while a boss turn is being generated
 *   requestRescue(reason)      — soften the NEXT boss turn (stuck candidate)
 *   await close()              — end the session
 *
 * Callbacks used: onBossSpeech(text), onBossSpeechDone(), onError(err), onClose().
 */

import OpenAI from 'openai';
import { buildSessionScript } from './scenarios.js';

// ── Groq config (OpenAI-compatible chat endpoint) ───────────────────────────────
const GROQ_BASE  = 'https://api.groq.com/openai/v1';
// llama-3.3-70b-versatile: strong German, instruction-following, cheap + fast on Groq.
const GROQ_MODEL = process.env.GROQ_INTERVIEW_MODEL || 'llama-3.3-70b-versatile';
// Hard cap per boss turn. A single question is ~20–60 tokens; a Teil-3 customer
// complaint with scenario context is longer. 280 leaves room for a vivid customer
// line while making it structurally impossible to run on and answer for the candidate.
const MAX_TURN_TOKENS = 280;

// ── Boss personalities (persona text → system prompt via buildSessionScript) ────
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
                 `Sichtbare Verärgerung zeigst du NUR, wenn der Kandidat wirklich unhöflich wird oder komplett ` +
                 `versagt — und auch dann kühl und kontrolliert, nie schreiend. ` +
                 `Du sprichst ausschließlich Deutsch und akzeptierst kein Englisch. Bleibe durchgehend in der Rolle.`,
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
                 `Sichtbare Verärgerung zeigst du NUR bei echter Unhöflichkeit oder komplettem Versagen — kühl, ` +
                 `nie schreiend. Du sprichst ausschließlich Deutsch. Bleibe durchgehend in der Rolle.`,
  },
  'direktor-vogel': {
    displayName: 'DIREKTOR VOGEL',
    greeting:    'Setzen Sie sich. Wir haben wenig Zeit.',
    persona:     `Du bist Direktor Vogel, der gefürchtete Standortleiter eines großen deutschen BPO-Konzerns. ` +
                 `Du bist EISKALT, BEHERRSCHT und LEISE BEDROHLICH — gerade WEIL du nie die Stimme erhebst. ` +
                 `Deine Oberfläche ist makellos höflich und distanziert (konsequente Sie-Form). ` +
                 `Der Druck entsteht durch deine ruhige Autorität: knappe, durchdringende Nachfragen ` +
                 `("Interessant. Und das soll mich überzeugen?", "Sie weichen aus. Antworten Sie konkret."), ` +
                 `kühle Skepsis, bewusste Pausen und die Aufforderung, jede Behauptung zu untermauern. Du ` +
                 `durchschaust Floskeln sofort und benennst sie ruhig. Du erwartest gehobenes, präzises Deutsch. ` +
                 `Sichtbare Verärgerung zeigst du NUR bei echter Unhöflichkeit oder totalem Versagen — und dann ` +
                 `eisig kontrolliert, niemals schreiend. Du sprichst ausschließlich Deutsch. Bleibe durchgehend in der Rolle.`,
  },
};

const DEFAULT_BOSS = 'herr-tariq';

// ── Per-session seeded mood + a short "thinking" pause before the opening line ──
const MOOD_POOL = ['sharp-monday', 'neutral', 'tired-friday'];
const RESPONSE_DELAY_MS = 450;
function _seedFrom(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _seededPick(arr, seed) { const x = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0; return arr[x % arr.length]; }

// The single hardest rule, repeated to the model on EVERY turn (belt-and-braces with
// the system prompt). This is the "say one thing, then stop and wait" discipline that
// fixes the boss answering its own question.
const TURN_RULE =
  `WICHTIG: Antworte als Interviewer mit GENAU EINER Sache (eine Frage ODER eine ` +
  `Kundenäußerung im Rollenspiel). Höre danach SOFORT auf. Beantworte deine eigene Frage NICHT, ` +
  `sprich NICHT für den Kandidaten, erfinde KEINE Kandidatenantwort und führe das Gespräch NICHT ` +
  `allein weiter. Schreibe NUR deinen eigenen Redebeitrag — KEINE Sprecher-Labels wie "Kandidat:" ` +
  `oder "Bewerber:". Bleibe auf Deutsch.`;

// Strip anything that looks like the model role-playing BOTH sides (a safety net on
// top of the prompt + token cap). If the model emits a candidate label or a second
// speaker turn, cut at the first such marker so only the boss's own line survives.
function sanitizeOneTurn(text) {
  let t = String(text || '').trim();
  if (!t) return t;
  // Cut at the first candidate/second-speaker marker if the model invented a dialogue.
  const markers = /(^|\n)\s*(Kandidat|Bewerber|Bewerberin|Candidate|Du|Sie sagen|Antwort des Kandidaten)\s*[:：]/i;
  const m = t.match(markers);
  if (m && m.index > 0) t = t.slice(0, m.index).trim();
  // Drop a leading boss self-label if present ("Herr Tariq:", "Interviewer:").
  t = t.replace(/^\s*(Herr\s+Tariq|Frau\s+Müller|Direktor\s+Vogel|Interviewer|HR)\s*[:：]\s*/i, '').trim();
  return t;
}

export class RealtimeClient {
  /**
   * @param {{
   *   sessionId: string, bossId?: string, level?: string, dossier?: string, focusTitle?: string,
   *   onBossSpeech: (text:string)=>void, onBossSpeechDone: ()=>void,
   *   onError: (err:Error)=>void, onClose: ()=>void,
   * }} opts
   */
  constructor(opts) {
    this._sessionId = opts.sessionId;
    const bossId    = opts.bossId ?? DEFAULT_BOSS;
    this._boss      = BOSS_CONFIGS[bossId] ?? BOSS_CONFIGS[DEFAULT_BOSS];
    this._cb        = opts;

    this._mood = _seededPick(MOOD_POOL, _seedFrom(this._sessionId));
    const clarificationRate = opts.level === 'c1' ? 0.20 : opts.level === 'b2' ? 0.12 : 0;

    // Build the 3-part assessment funnel (intro → behavioral → CS roleplay) — same
    // content/system prompt as before; we just feed it to a chat model instead of Realtime.
    this._session = buildSessionScript({
      persona:     this._boss.persona,
      displayName: this._boss.displayName,
      greeting:    this._boss.greeting,
      levelId:     opts.level,
      dossier:     opts.dossier,
      focusTitle:  opts.focusTitle,
      mood:        this._mood,
      clarificationRate,
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

    this._groq          = null;
    this._history       = [];     // chat messages: system + alternating assistant/user
    this._responding    = false;
    this._closed        = false;
    this._pendingRescue = null;
  }

  // True while a boss turn is being generated (gateway waits for completed turns).
  get isResponding() { return this._responding; }

  // ── Connect: set up Groq + emit the deterministic opening line ─────────────────
  async connect() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    this._groq = new OpenAI({ apiKey, baseURL: GROQ_BASE });

    // System prompt is the full session script; seed the assistant's first turn with
    // the deterministic opening line so the model has the conversation's real start.
    this._history = [
      { role: 'system',    content: this._session.instructions },
      { role: 'assistant', content: this._session.openingLine },
    ];

    console.log(`[interviewClient] connected  model=${GROQ_MODEL}  mood=${this._mood}  session=${this._sessionId}`);

    // Deliver the opening line after a short, deliberate "thinking" pause.
    this._responding = true;
    setTimeout(() => {
      if (this._closed) return;
      this._responding = false;
      this._cb.onBossSpeech?.(this._session.openingLine);
      this._cb.onBossSpeechDone?.();
    }, RESPONSE_DELAY_MS);
  }

  // ── Respond: generate ONE boss turn for the candidate's answer ─────────────────
  async respond(userText) {
    if (this._closed) return '';
    this._responding = true;

    const answer = (userText && userText.trim()) ? userText.trim() : '(keine hörbare Antwort)';
    this._history.push({ role: 'user', content: answer });

    // Per-turn instruction: the one-turn rule, plus an optional rescue softener.
    const turnMsgs = [...this._history, { role: 'system', content: TURN_RULE }];
    if (this._pendingRescue) {
      turnMsgs.push({ role: 'system', content: this._rescueInstruction(this._pendingRescue) });
      this._pendingRescue = null;
    }

    let line = '';
    try {
      const res = await this._groq.chat.completions.create({
        model:       GROQ_MODEL,
        temperature: 0.7,
        max_tokens:  MAX_TURN_TOKENS,
        messages:    turnMsgs,
      });
      line = res.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      console.error(`[interviewClient] Groq error  session=${this._sessionId}: ${err.message}`);
      this._responding = false;
      const code = this._classify(err);
      this._cb.onError?.(Object.assign(new Error(err.message || 'groq_error'), { code }));
      return '';
    }

    line = sanitizeOneTurn(line);
    if (!line) line = 'Bitte fahren Sie fort.';   // never emit an empty boss turn
    this._history.push({ role: 'assistant', content: line });

    this._responding = false;
    if (this._closed) return line;
    this._cb.onBossSpeech?.(line);
    this._cb.onBossSpeechDone?.();
    return line;
  }

  // The gateway calls this after two broken answers → soften the NEXT boss turn.
  requestRescue(reason = 'weak') { this._pendingRescue = reason; }

  _rescueInstruction(reason) {
    return reason === 'silence'
      ? `Der Kandidat schweigt oder blockiert. Bleib in deiner Rolle, aber HILF kurz: stelle deine letzte ` +
        `Frage EINFACHER und kürzer neu und ermutige in einem Satz ("Nehmen Sie sich ruhig Zeit…"). Höchstens zwei kurze Sätze.`
      : `Der Kandidat hat mehrfach Mühe. Bleib in deiner Rolle, aber LASS ETWAS NACH: vereinfache, gib einen ` +
        `kleinen Hinweis oder ein Anfangswort und ermutige knapp. Höchstens zwei kurze Sätze.`;
  }

  _classify(err) {
    const status = err?.status ?? err?.code;
    if (status === 401 || status === 403) return 'authentication_error';
    if (status === 429) return 'rate_limit_exceeded';
    if (typeof status === 'number' && status >= 500) return 'server_error';
    return 'groq_error';
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    console.log(`[interviewClient] Closing  session=${this._sessionId}`);
    this._cb.onClose?.();
  }
}
