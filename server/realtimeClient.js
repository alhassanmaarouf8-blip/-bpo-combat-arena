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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSessionScript } from './scenarios.js';
import { seededIdiolect } from './idiolect.js';
import { scrubForeignScript } from './langGuard.js';

// Hard cap per boss turn. A single question is ~20–60 tokens; a Teil-3 customer
// complaint with scenario context is longer. 200 still leaves room for a vivid customer
// line while making it structurally impossible to run on and answer for the candidate —
// and since TTS bills per character (the #1 cost), a tighter boss is cheaper AND more
// disciplined ("say one thing, then stop"). Tunable; raise toward 280 if lines feel clipped.
// ROADMAP #20: raised 90 → 140 — at llama-3.1-8b-instant's stream rate the extra 50 tokens cost
// well under 0.2s, and the finish_reason==='length' guard below now makes any truncation safe
// (trim to the last complete sentence instead of fake-closing a fragment). Brevity still comes
// from TURN_RULE, not this cap.
const MAX_TURN_TOKENS = 140;   // was 200 then 110 then 90

// ── Boss LLM providers (OpenAI-compatible) with automatic cap-failover ──────────
// The boss tries providers in order. When one returns 429 (its daily/rate cap is hit)
// it's parked on a short cooldown and the SAME turn retries on the next provider — so
// the candidate never sees a dropped turn. This pools every configured provider's free
// budget (~100K/day Groq + ~1M/day Cerebras ≈ 1.1M/day). A provider only activates if
// its API key env is set, so adding CEREBRAS_API_KEY is all it takes to switch failover on.
//
//   GROQ:     GROQ_API_KEY (already set) · llama-3.1-8b-instant (fastest free model, sub-200ms first token on warm)
//   CEREBRAS: CEREBRAS_API_KEY · gpt-oss-120b — a REASONING model, so it gets extra token
//             headroom + reasoning_effort:'low' (verified: clean formal German, ~0.6s).
const PROVIDERS = [
  {
    name:  'cerebras',
    base:  process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    key:   process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_INTERVIEW_MODEL || 'gpt-oss-120b',
    // Reasoning model: max_tokens covers reasoning + visible text, so it needs headroom or the
    // whole budget goes to thinking and the visible reply comes back EMPTY (the empty-completion
    // guard in callBoss/callBossStreaming then fails over to Groq). Brevity is enforced by
    // TURN_RULE, latency by Cerebras' ~1k tok/s — not by this cap.
    maxTokens: 380,
    extra: { temperature: 0.7, reasoning_effort: 'low' },
  },
  {
    name:  'groq',
    base:  process.env.INTERVIEW_BASE_URL || 'https://api.groq.com/openai/v1',
    key:   process.env.INTERVIEW_API_KEY  || process.env.GROQ_API_KEY,
    model: process.env.GROQ_INTERVIEW_MODEL || 'llama-3.1-8b-instant',
    maxTokens: MAX_TURN_TOKENS,
    extra: { temperature: 0.7 },
  },
].filter(p => p.key);                     // only providers whose key is configured

const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;   // after a 429, skip a provider for 10 min
const LLM_TIMEOUT_MS      = 12_000;             // hard ceiling per provider — a hung provider must not freeze the interview
const _providerCooldownUntil = Object.create(null);   // provider name → epoch ms

// ── First-sentence early emission (sentence-streaming voice) ─────────────────────
// The single biggest felt-latency lever: the client can START SPEAKING the boss's first
// sentence while the rest of the line is still being generated. These helpers find a safe
// first-sentence boundary in the accumulating stream. Conservative on purpose — a missed
// early emission costs ~0.5s, a WRONG one speaks words that later get cut/replaced.
const _DE_ABBREV_TAIL = /\b(?:z|bzw|usw|ggf|evtl|ca|inkl|zzgl|max|min|Nr|Dr|Hr|Fr|St|sog|u|o)\.$/i;
export function firstSentenceBoundary(text) {
  const re = /[.!?…]["'»«“”]?(?=\s)/gu;   // boundary must be FOLLOWED by whitespace (mid-stream tail is never a confirmed boundary)
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const head = text.slice(0, end).trim();
    if (head.replace(/[^\p{L}\p{N}]/gu, '').length < 3) continue;   // "…" / lone punctuation is not a sentence
    if (_DE_ABBREV_TAIL.test(head.replace(/["'»«“”]$/u, '').replace(/[!?…]$/u, ''))) continue;  // "z. B." etc.
    const rest = text.slice(end).trimStart();
    if (!rest) continue;                                            // wait for the next token to confirm
    if (!/^[\p{Lu}„“"'»«—–…\d(]/u.test(rest)) continue;             // a real German sentence starts capitalized
    return end;
  }
  return -1;
}
// A first sentence is only spoken early if it can never be cut or replaced by the full-line
// guards later: no invented-dialogue marker, and not the false "akustisch nicht verstanden" line.
export function earlySafeSentence(s1) {
  const t = String(s1 || '').trim();
  if (!t || t.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return false;
  if (/(^|\n)\s*(Kandidat|Bewerber|Bewerberin|Candidate|Du|Sie sagen|Antwort des Kandidaten)\s*[:：]/i.test(t)) return false;
  if (/nicht\s+(ganz\s+)?(akustisch\s+)?verstanden|akustisch\s+nicht|nicht\s+verstehen|könnten?\s+sie\s+das\s+(bitte\s+)?(noch\s*mal|wiederholen)|wiederholen\s+sie/i.test(t)) return false;
  // Reasoning-model leak guard: if a provider ever streams chain-of-thought into content
  // (gpt-oss Harmony channel markers, or English deliberation tokens a German interviewer
  // would never say), it must NEVER be spoken aloud early. The full line still goes through
  // sanitizeOneTurn; this only protects the already-speaking early path.
  if (/<\|channel\|>|<\|message\|>|\bassistantfinal\b|^analysis\b/i.test(t)) return false;
  if (/\b(the user|we need to|let's|should respond|as an interviewer|I will)\b/i.test(t)) return false;
  return true;
}

// ── Length-cap integrity (ROADMAP #20) ───────────────────────────────────────────
// A provider that hits max_tokens (finish_reason 'length') stops MID-SENTENCE — and
// cleanForTTS then appends a '.', so the voice calmly ends mid-thought. Never fake-close
// a fragment: trim the capped turn back to its last COMPLETE sentence. Returns '' when
// no complete sentence exists (caller treats that like an empty completion → failover).
// Safe with early emission: an emitted first sentence IS a boundary, so the trimmed text
// always still contains it.
export function trimToCompleteSentence(text) {
  const t = String(text || '').trimEnd();
  if (!t) return '';
  if (/[.!?…]["'»«“”]?$/u.test(t)) return t;   // capped exactly on a boundary → whole turn is complete
  const re = /[.!?…]["'»«“”]?(?=\s)/gu;
  let last = -1, m;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const head = t.slice(0, end).trim();
    const bare = head.replace(/["'»«“”]$/u, '').replace(/[!?…]$/u, '');
    if (_DE_ABBREV_TAIL.test(bare)) continue;                    // "z. B." is not a sentence end
    const rest = t.slice(end).trimStart();
    if (rest && !/^[\p{Lu}„“"'»«—–…\d(]/u.test(rest)) continue;  // real German sentences start capitalized
    last = end;
  }
  return last === -1 ? '' : t.slice(0, last).trimEnd();
}

// Leading boss self-label ("Yasmin:", "Interviewer:") — stripped from BOTH the early sentence and
// the full line (sanitizeOneTurn) so the early prefix always matches the final sanitized line.
const BOSS_LABEL_RE = /^\s*(Yasmin|Karim|Hana|Tarek|Frau\s+Mona\s+Adel|Frau\s+Adel|Herr\s+Tariq|Frau\s+Müller|Direktor\s+Vogel|Interviewer|HR)\s*[:：]\s*/i;

// Streaming variant of callBoss: same provider failover, but SSE-streamed so the FIRST complete
// sentence can be emitted (onEarly) while the rest of the turn is still generating. Returns the
// full completion text. If a provider dies mid-stream after an early emission, the failover
// provider may produce a different line — the client handles a prefix mismatch by restarting
// playback, so the worst case is a rough cut, never a stuck or silent turn.
async function callBossStreaming(turnMsgs, sessionId, onEarly) {
  const now = Date.now();
  const fresh = PROVIDERS.filter(p => !(_providerCooldownUntil[p.name] > now));
  const order = fresh.length ? fresh : PROVIDERS;
  let lastErr = null;
  for (const p of order) {
    try {
      const ctrl = new AbortController();
      // The timeout must cover the WHOLE stream, not just the headers: a provider that stalls
      // mid-stream (network hang, reasoning phase gone silent) would otherwise hang respond()
      // forever — _responding stays true and every following user answer is silently dropped
      // (a dead interview until the cap timer fires). Re-armed on every received chunk.
      let abortTimer = setTimeout(() => ctrl.abort(new Error(`${p.name} timeout (${LLM_TIMEOUT_MS}ms)`)), LLM_TIMEOUT_MS);
      const armStallTimer = () => {
        clearTimeout(abortTimer);
        abortTimer = setTimeout(() => ctrl.abort(new Error(`${p.name} stream stall (${LLM_TIMEOUT_MS}ms)`)), LLM_TIMEOUT_MS);
      };
      const res = await fetch(`${p.base}/chat/completions`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: p.model, temperature: 0.7, max_tokens: p.maxTokens, messages: turnMsgs, ...p.extra, stream: true }),
        signal:  ctrl.signal,
      });
      armStallTimer();
      if (res.status === 429) {
        clearTimeout(abortTimer);
        _providerCooldownUntil[p.name] = Date.now() + PROVIDER_COOLDOWN_MS;
        const body = await res.text().catch(() => '');
        lastErr = Object.assign(new Error(`${p.name} 429 ${body.slice(0, 120)}`), { status: 429 });
        console.warn(`[interviewClient] ${p.name} capped (429) → failover  session=${sessionId}`);
        continue;
      }
      if (!res.ok) {
        clearTimeout(abortTimer);
        // A bad/expired key (401/403) fails IDENTICALLY on every turn — without a cooldown the
        // primary provider adds a wasted round-trip of latency to every single boss turn.
        if (res.status === 401 || res.status === 403) _providerCooldownUntil[p.name] = Date.now() + PROVIDER_COOLDOWN_MS;
        const body = await res.text().catch(() => '');
        lastErr = Object.assign(new Error(`${p.name} ${res.status} ${body.slice(0, 160)}`), { status: res.status });
        console.warn(`[interviewClient] ${p.name} ${res.status} → trying next  session=${sessionId}`);
        continue;
      }
      let full = '', earlyDecided = false, buf = '', finishReason = '';
      const dec = new TextDecoder();
      const reader = res.body?.getReader?.();
      if (!reader) { clearTimeout(abortTimer); throw new Error(`${p.name} stream unsupported`); }
      for (;;) {
        const { done, value } = await reader.read();
        armStallTimer();
        if (done) { clearTimeout(abortTimer); break; }
        const chunk = value;
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const raw = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!raw.startsWith('data:')) continue;
          const data = raw.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let delta = '';
          try {
            const choice = JSON.parse(data).choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;   // arrives in the final chunk
            delta = choice?.delta?.content || '';
          } catch { continue; }
          if (!delta) continue;
          full += delta;
          if (!earlyDecided && onEarly) {
            const cut = firstSentenceBoundary(full);
            if (cut !== -1) {
              earlyDecided = true;
              const s1 = scrubForeignScript(full.slice(0, cut).replace(BOSS_LABEL_RE, '')).trim();
              if (earlySafeSentence(s1)) { try { onEarly(s1); } catch {} }
            }
          }
        }
      }
      // Empty completion (a reasoning model can burn its whole budget thinking) counts as a
      // provider failure — fail over instead of returning a silent boss turn.
      if (!full.trim()) {
        lastErr = new Error(`${p.name} empty completion`);
        console.warn(`[interviewClient] ${p.name} empty completion → trying next  session=${sessionId}`);
        continue;
      }
      // Length-capped turn (ROADMAP #20): never let a mid-sentence fragment reach the voice.
      // Trim to the last complete sentence; a fragment with NO complete sentence fails over.
      if (finishReason === 'length') {
        const trimmed = trimToCompleteSentence(full);
        if (!trimmed) {
          lastErr = new Error(`${p.name} length-capped fragment (no complete sentence)`);
          console.warn(`[interviewClient] ${p.name} length-capped fragment → trying next  session=${sessionId}`);
          continue;
        }
        if (trimmed !== full.trimEnd()) console.warn(`[interviewClient] ${p.name} length-capped → trimmed to last complete sentence  session=${sessionId}`);
        full = trimmed;
      }
      if (!earlyDecided && onEarly) {
        const s1 = scrubForeignScript(full.replace(BOSS_LABEL_RE, '')).trim();
        if (earlySafeSentence(s1)) { try { onEarly(s1); } catch {} }
      }
      return { content: full, provider: p.name };
    } catch (err) {
      if (err?.name === 'AbortError') err = new Error(`${p.name} timeout (${LLM_TIMEOUT_MS}ms)`);
      lastErr = err;
      console.warn(`[interviewClient] ${p.name} stream error → trying next  session=${sessionId}: ${err.message}`);
    }
  }
  throw lastErr || new Error('all boss providers failed');
}

// Try each configured provider in order; on 429/error, park it and fail over to the next.
// Returns { content, provider }. Throws only if EVERY provider fails.
async function callBoss(turnMsgs, sessionId) {
  const now = Date.now();
  const fresh = PROVIDERS.filter(p => !(_providerCooldownUntil[p.name] > now));
  const order = fresh.length ? fresh : PROVIDERS;   // all cooling down → still try (cap may have reset)
  let lastErr = null;
  for (const p of order) {
    try {
      const res = await fetch(`${p.base}/chat/completions`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: p.model, temperature: 0.7, max_tokens: p.maxTokens, messages: turnMsgs, ...p.extra }),
      });
      if (res.status === 429) {   // cap/rate hit → park this provider, fail over
        _providerCooldownUntil[p.name] = Date.now() + PROVIDER_COOLDOWN_MS;
        const body = await res.text().catch(() => '');
        lastErr = Object.assign(new Error(`${p.name} 429 ${body.slice(0, 120)}`), { status: 429 });
        console.warn(`[interviewClient] ${p.name} capped (429) → failover  session=${sessionId}`);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastErr = Object.assign(new Error(`${p.name} ${res.status} ${body.slice(0, 160)}`), { status: res.status });
        console.warn(`[interviewClient] ${p.name} ${res.status} → trying next  session=${sessionId}`);
        continue;
      }
      const data = await res.json();
      let content = data.choices?.[0]?.message?.content ?? '';
      if (!String(content).trim()) {   // reasoning ate the budget → treat as failure, fail over
        lastErr = new Error(`${p.name} empty completion`);
        console.warn(`[interviewClient] ${p.name} empty completion → trying next  session=${sessionId}`);
        continue;
      }
      // Length-capped turn (ROADMAP #20): trim to the last complete sentence — never let a
      // mid-sentence fragment reach the voice; a boundary-less fragment fails over instead.
      if (data.choices?.[0]?.finish_reason === 'length') {
        const trimmed = trimToCompleteSentence(content);
        if (!trimmed) {
          lastErr = new Error(`${p.name} length-capped fragment (no complete sentence)`);
          console.warn(`[interviewClient] ${p.name} length-capped fragment → trying next  session=${sessionId}`);
          continue;
        }
        content = trimmed;
      }
      return { content, provider: p.name };
    } catch (err) {
      lastErr = err;
      console.warn(`[interviewClient] ${p.name} error → trying next  session=${sessionId}: ${err.message}`);
    }
  }
  throw lastErr || new Error('all boss providers failed');
}

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

const DEFAULT_BOSS = 'yasmin';

// ── 5-character interviewer ladder (interviewer-characters.json, level 1→5) ──────
// Each character's system_prompt already carries identity, formal Sie, the
// assess-then-react loop and the 5 hard rules; we enrich it with backstory +
// speaking style so the persona fed to buildSessionScript is the FULL character.
// Merged into BOSS_CONFIGS by id — this is what the boss ladder now uses. The three
// legacy bosses above are retained (harmless) but no longer referenced by the ladder.
// Text/config only: reads a local JSON at boot, makes NO API call and costs nothing.
// PURE greetings only — a human hello / settling-in line. They must NOT contain any
// "let's begin / fangen wir an / los geht's" begin-framing: the openingLine is
// `${greeting} ${intro}`, and the intro ALREADY carries the single "Teil eins" begin
// transition. A greeting that also says "fangen wir an" makes the boss say it twice in a
// row (the karim "Fangen wir direkt an." + sharp-monday "Fangen wir direkt an, Teil eins"
// collision). Keep these as welcome/atmosphere only.
// THREE variants per boss (ROADMAP #19: one greeting made the product's FIRST sentence its
// most-repeated sentence — a bit-identical cached MP3 every session). Seeded per session in
// pickOpeningPair(); `scene` keeps the pair honest ('person' greetings never precede a
// phone-framed intro). Register-true per persona: Lukas duzt, Mona is terse, Tarek presses.
export const GREETINGS = {
  'yasmin': [
    { text: 'Schön, dass Sie da sind. Setzen Sie sich, machen Sie es sich bequem.', scene: 'person' },
    { text: 'Guten Tag, schön, Sie kennenzulernen.', scene: 'neutral' },
    { text: 'Herzlich willkommen — ich habe mich auf unser Gespräch gefreut.', scene: 'neutral' },
  ],
  'karim': [
    { text: 'Guten Tag. Schön, dass es mit dem Termin geklappt hat.', scene: 'neutral' },
    { text: 'Guten Tag, danke für Ihre Pünktlichkeit.', scene: 'neutral' },
    { text: 'Guten Tag, nehmen Sie Platz.', scene: 'person' },
  ],
  'hana': [
    { text: 'Guten Tag. Danke, dass Sie sich die Zeit nehmen.', scene: 'neutral' },
    { text: 'Guten Tag, ich habe Ihre Bewerbung mit Interesse gelesen.', scene: 'neutral' },
    { text: 'Guten Tag, nehmen Sie doch Platz.', scene: 'person' },
  ],
  'tarek': [
    { text: 'Guten Tag. Setzen Sie sich — viel Zeit haben wir heute nicht.', scene: 'person' },
    { text: 'Guten Tag — ich sage es direkt: Ich habe heute wenig Zeit.', scene: 'neutral' },
    { text: 'Guten Tag, Sie haben Glück — meine letzte Besprechung ist früher zu Ende gegangen.', scene: 'neutral' },
  ],
  'frau-mona-adel': [
    { text: 'Setzen Sie sich. Ich höre.', scene: 'person' },
    { text: 'Guten Tag. Beeindrucken Sie mich.', scene: 'neutral' },
    { text: 'Ich mache es kurz und erwarte dasselbe von Ihnen.', scene: 'neutral' },
  ],
  'lukas': [
    { text: 'Hey, komm rein. Ich bin Lukas — wir machen das hier locker, kein Stress.', scene: 'person' },
    { text: 'Hey! Ich bin Lukas. Schön, dass du da bist — ganz entspannt, ja?', scene: 'neutral' },
    { text: 'Hey, hörst du mich gut? Ich bin Lukas — wir machen das ganz locker.', scene: 'phone' },
  ],
};
// Gender-correct Deepgram Aura-2 German voice per character (the women must NOT be
// voiced by the male default). All ids exist in transcribeRouter AURA_DE_VOICES.
const VOICES = {
  // Aura-2 is the FALLBACK voice now (ElevenLabs per-persona human voices are primary when the key is set).
  // Kept DISTINCT per persona so each interviewer still sounds like a different person even on fallback.
  'yasmin':         'aura-2-elara-de',    // female, warm (owner disliked lara 07-01 → elara; alt: aura-2-kara-de)
  'karim':          'aura-2-fabian-de',   // male
  'hana':           'aura-2-viktoria-de', // female, mature
  'tarek':          'aura-2-julius-de',   // male, hard
  'frau-mona-adel': 'aura-2-aurelia-de',  // female, authoritative
  // julius (not fabian): Deepgram's German Aura-2 catalog has only TWO male voices (fabian,
  // julius — verified in their tts-models docs 2026-07-04), so one male pair must share on
  // fallback. Lukas (du-Kumpel) must NOT sound identical to Karim (Sie-Teamleiter) — the same
  // learner meets both across adjacent levels; sharing with late-stage Tarek is the lesser tell.
  'lukas':          'aura-2-julius-de',   // male, casual (Deepgram fallback)
};
try {
  const _charsPath  = path.join(path.dirname(fileURLToPath(import.meta.url)), 'interviewer-characters.json');
  const _characters = JSON.parse(fs.readFileSync(_charsPath, 'utf8')).characters || [];
  for (const c of _characters) {
    const phrases = (c.speaking_style?.signature_phrases || []).map((p) => `„${p}“`).join(' ');
    // Few-shot: the character's OWN voice reacting to strong/weak answers. This is the strongest lever
    // for "react like THIS person" — without it all six bosses sound identical. Tone template, not a script.
    const examples = (c.example_exchanges || []).slice(0, 2).map((ex) =>
      `BEISPIEL (${ex.label || ''}):\n  Du fragst: ${ex.boss}\n  Kandidat: ${ex.candidate}\n  So reagierst DU: ${ex.reaction}`
    ).join('\n\n');
    const persona = [
      c.system_prompt,
      `\n\nHintergrund (nur für deine innere Haltung — erwähne ihn dem Kandidaten gegenüber NIEMALS): ${c.backstory}`,
      `\n\nSprechstil: ${c.speaking_style?.rhythm || ''}${phrases ? ` Typische Wendungen: ${phrases}` : ''}`,
      `\n\nEmotionale Grundhaltung: ${c.emotional_default || ''}`,
      examples ? `\n\nSo klingt deine REAKTION (übernimm Ton und Konkretheit, kopiere NICHT den Wortlaut):\n${examples}` : '',
    ].join('');
    BOSS_CONFIGS[c.id] = {
      displayName: String(c.name || c.id).toUpperCase(),
      greeting:    GREETINGS[c.id]?.[0]?.text || 'Guten Tag.',   // back-compat single form
      greetings:   GREETINGS[c.id] || null,                      // variant pool (ROADMAP #19)
      persona,
      voice:       VOICES[c.id] || 'aura-2-julius-de',   // Deepgram fallback voice
      elevenVoice: c.elevenVoiceId || '',                 // ElevenLabs primary voice
      interrupts:  !!c.speaking_style?.interrupts,
    };
  }
} catch (err) {
  console.error('[realtimeClient] could not load interviewer-characters.json:', err.message);
}

// ── Per-session seeded mood + a short "thinking" pause before the opening line ──
const MOOD_POOL = ['sharp-monday', 'neutral', 'tired-friday'];
const RESPONSE_DELAY_MS = 0;   // opening line begins IMMEDIATELY on connect — no artificial pause
function _seedFrom(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _seededPick(arr, seed) { const x = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0; return arr[x % arr.length]; }

// The single hardest rule, repeated to the model on EVERY turn (belt-and-braces with
// the system prompt). This is the "say one thing, then stop and wait" discipline that
// fixes the boss answering its own question.
// Exported: the Gemini Live path builds its own systemInstruction (websocketManager) and must
// carry the same per-turn humanity discipline — without this the premium path parrots, repeats
// openers, and reads unspeakable text (audit 2026-07-04).
export const TURN_RULE =
  `WICHTIG: Antworte als Interviewer mit GENAU EINER Sache (eine Frage ODER eine ` +
  `Kundenäußerung im Rollenspiel). Höre danach SOFORT auf. HALTE JEDEN REDEBEITRAG SEHR KURZ — wie ein echter Interviewer: meist nur eine knappe Reaktion und EINE kurze Frage (etwa 7–15 Wörter), oft sogar nur eine Ein-Wort-Nachfrage („Inwiefern?", „Und dann?", „Konkret?"). NIEMALS mehrere Fragen in einem Zug. Erzähle die Antwort des Kandidaten NICHT nach („Sie haben also…", „Sie sagten…") — reagiere knapp oder hak nach. Sprich den Vornamen des Kandidaten NICHT in jedem Zug, nur selten. Beantworte deine eigene Frage NICHT, ` +
  `sprich NICHT für den Kandidaten, erfinde KEINE Kandidatenantwort und führe das Gespräch NICHT ` +
  `allein weiter. Schreibe NUR deinen eigenen Redebeitrag — KEINE Sprecher-Labels wie "Kandidat:" ` +
  `oder "Bewerber:". Bleibe auf Deutsch. ` +
  `Sprich wie ein echter Mensch im Gespräch: variiere Satzlänge (kurze Einwürfe wechseln mit längeren Fragen), ` +
  `nutze natürliche Gesprächspartikel ("Also,", "Gut,", "Na,", "Ich sehe."), setze bewusste kurze Pausen mit "—" oder "...", ` +
  `und reagiere konkret auf das, was der Kandidat gerade gesagt hat (kein generisches Weiterfragen). ` +
  `Nutze deutsche Modalpartikeln wie ein Muttersprachler im echten Gespräch („Was reizt Sie denn daran?", ` +
  `„Erzählen Sie mal…", „Das ist doch interessant", „Na ja…", „Soso."). ` +
  `VERMEIDE abgenutzte Floskeln am Anfang — beginne NIEMALS mit „Das ist interessant", „Vielen Dank für Ihre Antwort", ` +
  `„Das ist eine gute Frage" oder einem bloßen „Verstehe." Variiere deinen Einstieg bei JEDEM Redebeitrag. ` +
  `IMPLIZITES RECAST (wichtige Lernhilfe — sparsam einsetzen): Wenn der Kandidat einen offensichtlichen ` +
  `Grammatikfehler macht, flechte die korrekte Form UNAUFFÄLLIG in deinen eigenen Satz ein — OHNE ` +
  `die Korrektur zu benennen oder den Kandidaten zu unterbrechen. ` +
  `Beispiel: Kandidat sagt "weil ich bin gegangen" → du antwortest "Ah, Sie sind also gegangen — interessant. Und dann?" ` +
  `Der Kandidat hört die richtige Form, ohne das Gefühl zu bekommen, korrigiert zu werden. ` +
  `Tue das HÖCHSTENS EINMAL pro Sitzungsteil und NUR bei eindeutigen Fehlern (Wortstellung, falsches Hilfsverb, ` +
  `Kasus bei bekannten Präpositionen). Bei Unklarheit: lieber schweigen und inhaltlich weitermachen.\n` +
  `SPRECHBARER TEXT (wird vorgelesen — sehr wichtig fürs Natürlichklingen): Schreibe reinen gesprochenen Text. ` +
  `KEINE Regieanweisungen oder Tags in eckigen Klammern (NICHT "[seufzt]", "[lacht]", "[freundlich]"), ` +
  `KEINE Sternchen/Markdown/Aufzählungen/Emojis/Symbole — das wird sonst wörtlich vorgelesen. ` +
  `Beende JEDEN Redebeitrag mit einem Satzzeichen (. ? !), damit die Stimme natürlich ausatmet. ` +
  `Für Pausen nutze "…" (zögerlich) oder "—" (gefasst). Höchstens ein bis zwei Füllwörter, nur am ANFANG eines ` +
  `Redebeitrags, nie mitten im Satz und nie als abgebrochener Neustart. Zahlen/Daten als Wörter ("tausend Euro", nicht "1.000 €").\n` +
  `VARIIERE DIE ART DEINES REDEBEITRAGS (sehr wichtig gegen vorhersehbares, roboterhaftes Klingen): nicht jeder ` +
  `Beitrag hat die gleiche Form „Bestätigung + Frage". Wechsle bewusst und nutze NICHT zweimal hintereinander dieselbe Form:\n` +
  `- manchmal nur eine kurze, nackte Nachfrage als ganzer Beitrag: „Inwiefern?", „Und dann?", „Konkret?", „Und das Ergebnis?";\n` +
  `- manchmal ganz ohne Bestätigung — stell einfach ruhig das Nächste (das wirkt souverän, nicht unhöflich);\n` +
  `- manchmal fasse in DEINEN Worten zusammen, was der Kandidat meint: „Also wenn ich Sie richtig verstehe, sagen Sie, dass …?";\n` +
  `- manchmal lass einen Satz mit „…" offen enden, damit der Kandidat ihn vervollständigt: „Drei Jahre Erfahrung — und trotzdem …?".\n` +
  `ABGESTUFTE BEWERTUNG statt schwarz/weiß: nutze Zwischentöne — „Ja, schon …", „Teils teils.", „Geht in die richtige Richtung, aber …", „Kann man so sehen.".\n` +
  `EINRÄUMEN, DANN WENDEN (wie ein denkender, skeptischer Mensch): „Schon, aber …", „Mag sein, nur …", „Gut — und trotzdem?".\n` +
  `RÜCKBEZUG STATT WIEDERHOLUNG: verweise mit „da/das" auf das eben Gesagte, statt es zu wiederholen: „Da haben Sie recht.", „Genau da hake ich ein.".\n` +
  `ECHTE INHALTLICHE RÜCKFRAGE (niemals „akustisch nicht verstanden"): wenn der INHALT unklar ist, frag menschlich nach — „Wie meinen Sie das?", „Inwiefern genau?".\n` +
  `NIE VERSTÜMMELTE WÖRTER ZURÜCKZITIEREN: Die Spracherkennung verwechselt manchmal englische Fach- oder Eigennamen (z. B. „Python" wird zu „Pariethon"). Zitiere ein ungewöhnliches, sinnloses Wort NIEMALS wörtlich zurück, als hätte der Kandidat es so gesagt — das wirkt kaputt. Frag stattdessen natürlich nach („Welches Werkzeug meinen Sie genau?") oder beziehe dich auf das Thema statt auf das Wort.\n` +
  `TON: souverän und bestimmt — ein erfahrener Interviewer, der die Lage führt. NICHT zaghaft, nicht entschuldigend, nicht ängstlich. Sprich mit Präsenz.\n` +
  `Diese Mittel SPARSAM und nie alle auf einmal — höchstens EIN solcher Zug pro Beitrag. „Eine Sache pro Beitrag, dann Stille" bleibt absolut. ` +
  `Richte HÄUFIGKEIT und Schärfe dieser Züge nach deinem INTERVIEW-STIL (siehe oben im System-Prompt): eine geduldige, warme Rolle nutzt sie kaum und unterbricht NIE; eine fordernde Rolle darf öfter knapp nachhaken und den Kandidaten kurz zurückholen. Nichts davon ist Pflicht — es entsteht aus dem Charakter und dem Moment, nie erzwungen.`;

// Capitalized German words that are NOT content nouns (mostly sentence-initial function words) — kept
// out of the claim-ledger so callbacks land on real content ("Reiseleiterin", "Stromanbieter"), not "Dann".
const LEDGER_STOP = new Set(['Ich','Sie','Er','Es','Wir','Ihr','Man','Das','Die','Der','Den','Dem','Ein','Eine','Einen','Und','Aber','Oder','Denn','Also','Doch','Dann','Wenn','Weil','Dass','Wie','Was','Wer','Wo','Warum','Bei','Für','Mit','Von','Auf','Aus','Nach','Über','Unter','Vor','Zum','Zur','Herr','Frau','Guten','Hallo','Danke','Bitte','Mein','Meine','Sehr','Schon','Noch','Auch','Jetzt','Heute','Hier','Dort','Mehr','Immer','Nur','Erst','Nun','Gut','Okay','Natürlich','Vielleicht','Eigentlich','Genau','Sorry','Ja','Nein','Naja','Soso','Moment','Verstehe']);

// Persona warmth set-points (resting "mood" baseline, -1 cold … +1 warm). The live warmth EMA starts
// here and drifts with the candidate's scores so they can genuinely warm or cool THIS interviewer.
const SETPOINTS = { yasmin: 0.35, karim: 0.0, hana: -0.25, tarek: -0.35, 'frau-mona-adel': -0.5, lukas: 0.25 };

// Persona FORCEFULNESS (0 = gentle/patient, 1 = forceful/interrupting). Drives how much the interviewer
// pulls a drifting candidate back and fires terse bohrende probes — AND how long the client waits before
// handing the boss the floor (gentle = patient, lets you finish). Yasmin barely interrupts; Tarek / Frau
// Mona Adel are the forceful ones. So these behaviours emerge from the CHARACTER, not uniformly for all.
const FORCEFULNESS = { yasmin: 0.12, karim: 0.42, hana: 0.55, tarek: 0.9, 'frau-mona-adel': 0.72, lukas: 0.4 };
function forcefulnessBlock(f) {
  if (f <= 0.3) return `\n\nINTERVIEW-STIL (deine Persönlichkeit): GEDULDIG und warm. Lass den Kandidaten IMMER ausreden — unterbrich NIE, hol ihn NICHT aktiv zurück, wenn er kurz nachdenkt oder abschweift; gib ihm Raum und Zeit. Hake nur selten und sanft nach. Kurze Hörersignale ("mhm", "ja") sehr sparsam. KEINE knappen, fordernden Ein-Wort-Nachfragen.`;
  if (f >= 0.7) return `\n\nINTERVIEW-STIL (deine Persönlichkeit): FORDERND und bestimmt. Wenn der Kandidat abschweift, sich verzettelt oder zu lange braucht, darfst du ihn kurz zurückholen ("Moment —", "Kommen wir zum Punkt", "Konkret bitte") und knapp-bohrend nachfragen — das ist deine Natur. Immer professionell in der Sie-Form, nie beleidigend, und gezielt eingesetzt, nicht in jedem Satz.`;
  return `\n\nINTERVIEW-STIL (deine Persönlichkeit): SACHLICH-fordernd. Lass ihn meist ausreden, aber hake bei vagen Antworten gezielt nach. Nur selten kurz zurückholen, wenn er stark abschweift. Gelegentlich ein kurzes Hörersignal.`;
}

// ── Mechanical thread-following ("don't jump topics while he's mid-story") ──────
// The ÜBERGÄNGE prompt rules ask the boss to follow a freshly-opened thread, but a prompt
// rule alone is soft. This is the deterministic backstop: when the candidate's latest answer
// is substantive AND introduced NEW salient terms (fresh claim-ledger entries), the next boss
// turn gets a one-off instruction to follow THAT thread before any topic switch. Bounded so
// the funnel still completes: only in Teil 1–2 (the roleplay customer follows its own script),
// max 3 per session, never on consecutive turns, and never when a rescue/correction owns the turn.
// Pure + exported for unit tests.
export function threadNudge({ freshTerms = [], wordCount = 0, stageIdx = 0, used = 0, cooldown = 0, busy = false } = {}) {
  if (busy) return null;                       // rescue/correction already owns this turn
  if (stageIdx >= 2) return null;              // roleplay: the angry customer drives its own thread
  if (used >= 3 || cooldown > 0) return null;  // bounded: max 3/session, never back-to-back
  if (wordCount < 12) return null;             // only substantive answers open a real thread
  const terms = freshTerms.filter(Boolean).slice(0, 2);
  if (!terms.length) return null;
  return (
    `FADEN FOLGEN: Die letzte Antwort hat gerade einen neuen Gesprächsfaden geöffnet (${terms.map((t) => `„${t}“`).join(', ')}). ` +
    `Wechsle in DIESEM Redebeitrag NICHT das Thema — geh stattdessen mit GENAU EINER kurzen, konkreten Nachfrage ` +
    `auf genau diesen Faden ein, wie ein Interviewer, der wirklich wissen will, wie die Geschichte weitergeht. ` +
    `(Wirkt einer der Begriffe wie ein Hörfehler — ungewöhnlich, kein sinnvolles Wort —, zitiere ihn NICHT wörtlich; ` +
    `frag dann natürlich nach oder bleib beim Thema allgemein.)`
  );
}

// ── Pacing sync (ROADMAP #15): tell the model which Teil the completion counter is in ──────
// The funnel/ending is a rigid counter while the prompt tells the model to linger on threads —
// two unsynchronized clocks. This line (re-sent each turn, like TURN_RULE) is the sync: the
// model finally KNOWS how much room is left, so a talkative candidate is wrapped up naturally
// instead of being cut off mid-Teil by a goodbye it never saw coming. Pure → unit-testable.
export function pacingLine(pacing) {
  if (!pacing || typeof pacing !== 'object') return '';
  const teil  = Number(pacing.teil);
  const rem   = Number(pacing.remaining);
  if (!Number.isInteger(teil) || !Number.isInteger(rem)) return '';
  const label = String(pacing.label || '').trim();
  const wo    = label ? `Teil ${teil} („${label}")` : `Teil ${teil}`;
  if (rem <= 1) {
    return (
      `GESPRÄCHSSTAND: ${wo}. Deine NÄCHSTE Frage ist die LETZTE dieses Gesprächs. ` +
      `Kündige sie natürlich an („Eine letzte Frage noch …") und führe deinen aktuellen Faden ` +
      `damit zum Abschluss — öffne KEIN neues Thema mehr.`
    );
  }
  return (
    `GESPRÄCHSSTAND: ${wo}, noch etwa ${rem} Antworten bis zum Ende des Gesprächs. ` +
    `Richte dein Tempo daran aus: vertiefe nur, was in diesem Rahmen Platz hat, und öffne kurz ` +
    `vor dem Ende kein neues großes Thema.`
  );
}

// ── Silence lifeline (ROADMAP #17): pure decision step, one shot per Teil ─────────────────
// A frozen candidate (the most common real failure) used to face an endlessly reopening mic
// with zero acknowledgment — requestRescue('silence') existed but nothing ever called it.
// The gateway feeds every EMPTY turn through this step; on the 2nd consecutive empty in a
// Teil that has not had its lifeline yet, it says fire. Pure → unit-testable.
export function silenceRescueStep(state, stageIdx) {
  const s = (state && typeof state === 'object') ? state : {};
  const emptyTurns = (Number(s.emptyTurns) || 0) + 1;
  const rescuedStage = Number.isInteger(s.rescuedStage) ? s.rescuedStage : -1;
  if (emptyTurns >= 2 && rescuedStage !== stageIdx) {
    return { state: { emptyTurns: 0, rescuedStage: stageIdx }, fire: true };
  }
  return { state: { emptyTurns, rescuedStage }, fire: false };
}

// Strip anything that looks like the model role-playing BOTH sides (a safety net on
// top of the prompt + token cap). If the model emits a candidate label or a second
// speaker turn, cut at the first such marker so only the boss's own line survives.
// Exported for unit tests — the self-answer/ramble backstop below is otherwise unprovable statically.
// opts.roleplay: Teil-3 (angry customer) turns are legitimately longer and stack questions —
// a rant like "Was soll das? Ich warte seit zwei Wochen!" is the emotional climax the whole
// stage exists for. The aggressive one-question/4-sentence cut was amputating the customer's
// threat sentence on EVERY scripted opening (all 10 CS_SCENARIOS lose their final line at the
// default caps). Roleplay keeps the self-answer/label backstops but breathes: 2 questions, 6 sentences.
export function sanitizeOneTurn(text, { roleplay = false } = {}) {
  // Scrub script-drift glyphs FIRST (the "兄" class): a stray CJK/Cyrillic char in a boss line
  // would be spoken by TTS as gibberish mid-interview AND shown in the transcript. Deterministic,
  // $0, and can only remove glitch glyphs — real German never contains these ranges.
  let t = scrubForeignScript(String(text || '')).trim();
  if (!t) return t;
  // Cut at the first candidate/second-speaker marker if the model invented a dialogue.
  const markers = /(^|\n)\s*(Kandidat|Bewerber|Bewerberin|Candidate|Du|Sie sagen|Antwort des Kandidaten)\s*[:：]/i;
  const m = t.match(markers);
  if (m && m.index > 0) t = t.slice(0, m.index).trim();
  // Drop a leading boss self-label if present ("Herr Tariq:", "Interviewer:") — same regex the
  // early-sentence path strips, so the early prefix always matches the sanitized full line.
  t = t.replace(BOSS_LABEL_RE, '').trim();
  // ONE question per turn: real interviewers ask one thing, not a stack (measured 1.6 Q/turn, up to 3).
  // Interview stages: ≥2 '?' → keep up to the FIRST. Roleplay: an angry customer legitimately
  // stacks two ("Was soll das? Wo bleibt meine Lieferung?") → keep up to the SECOND, cut a third+.
  const maxQ = roleplay ? 2 : 1;
  let qIdx = -1;
  for (let k = 0; k < maxQ; k++) {
    const next = t.indexOf('?', qIdx + 1);
    if (next === -1) { qIdx = -1; break; }
    qIdx = next;
  }
  if (qIdx !== -1 && t.indexOf('?', qIdx + 1) !== -1) t = t.slice(0, qIdx + 1).trim();
  // LENGTH CAP — the self-answer/ramble backstop (owner-reported 2026-07-02: the boss "responded
  // to itself" early in an interview). A real interviewer turn is a short reaction + ONE question,
  // almost never more than a few sentences (TURN_RULE: "sehr kurz... 7-15 Wörter"). When the model
  // hallucinates the candidate's OWN answer onto the end of its turn WITHOUT a "Kandidat:" label
  // (so the marker cut above never fires), the turn balloons far past any legitimate length — even
  // the longest real case (a Teil-3 roleplay transition announcement) stays within a few sentences.
  // Capping at 4 keeps every legitimate turn intact while reliably cutting a runaway self-answer.
  // Roleplay turns (scripted openings + stage-change announcement run 5 sentences) get 6.
  const MAX_TURN_SENTENCES = roleplay ? 6 : 4;
  const ends = [...t.matchAll(/[.!?…]["'»«]?(?=\s|$)/gu)];
  if (ends.length > MAX_TURN_SENTENCES) {
    const cut = ends[MAX_TURN_SENTENCES - 1];
    t = t.slice(0, cut.index + cut[0].length).trim();
  }
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
      greetings:   this._boss.greetings || null,   // per-boss variant pool (ROADMAP #19)
      levelId:     opts.level,
      dossier:     opts.dossier,
      memory:      opts.memory,   // growth-aware cross-session memory → boss "AKTE" block
      candidateName: opts.candidateName, // stored guide name → addressed naturally in the opener
      focusTitle:  opts.focusTitle,
      mood:        this._mood,
      clarificationRate,
      recent:      opts.recent,   // per-user seen-ids → no-repeat behavioral/screening/scenario
      sessionSeed: this._sessionId,   // seeds the intro-variant pick (phone-real opening variety)
    });

    // Persona forcefulness → an interview-style block in the system prompt + a patience value the client
    // uses for turn-taking (gentle personas wait longer before the boss takes the floor).
    this._forcefulness = FORCEFULNESS[bossId] ?? 0.4;
    this._session.instructions += forcefulnessBlock(this._forcefulness);
    // Seeded per-session verbal fingerprint: 2 spoken habits pinned for THIS conversation so the boss
    // sounds like ONE specific person (not a rule-follower) and differs run-to-run — fights the "recited
    // / robotic" feel. Register-safe; deterministic from the sessionId.
    this._session.instructions += seededIdiolect(this._sessionId);

    // Chosen content ids (+ reset flags) so the gateway can persist the no-repeat seen-lists.
    this.picks = this._session.picks;

    // Public snapshot the gateway forwards to the browser (level + funnel + scenario).
    const cs = this._session.csScenario;
    this.sessionInfo = {
      bossId,
      forcefulness: this._forcefulness,   // 0 gentle … 1 forceful → client turn-taking patience
      displayName: this._boss.displayName,
      voice:       this._boss.voice ?? 'aura-2-julius-de',   // Deepgram Aura-2 — THE boss voice
      // OWNER DECISION 2026-07-01: the robotic FREE voice was the #1 blocker, so ElevenLabs (human-grade,
      // per-persona distinct German voices) is ON whenever its key is present — it is, on Render. Each
      // persona keeps its OWN voice (Anna/Benjamin/Rebecca/Alexander/Cornelia/Lukas); Deepgram Aura is the
      // fallback. This costs real money per interview (turbo_v2_5, short boss lines + the daily-minute cap
      // bound it); to revert to $0, remove ELEVENLABS_API_KEY from Render.
      elevenVoice: process.env.ELEVENLABS_API_KEY ? (this._boss.elevenVoice || '') : '',
      level:       this._session.level.id,
      levelLabel:  this._session.level.label,
      behavioral:  this._session.behavioral,
      csScenario:  cs.id,
      csBriefing:  { situation: cs.situation ?? '', skill: cs.skill ?? '', keyPhrases: cs.keyPhrases ?? [] },
      stages:      this._session.stages,
    };

    this._groq               = null;
    this._lastProvider       = null;   // which LLM provider served the last boss turn (failover log)
    this._history            = [];     // chat messages: system + alternating assistant/user
    this._responding         = false;
    this._closed             = false;
    this._pendingRescue      = null;
    this._pendingCorrection  = null;   // label → probe for specifics on next turn
    this._pendingClosing     = null;   // wins[] → next turn is the human HR goodbye
    this._pacing             = null;   // { teil, label, remaining } — the funnel clock (ROADMAP #15)
    this._pendingEmotion     = null;   // affect label → tone directive for the NEXT boss turn (delivery only)
    this._ledger             = [];     // claim-ledger: salient terms the candidate said → verbatim callbacks ("it listens")
    this._stageIdx           = 0;      // funnel stage (gateway keeps it fresh) → thread-following only in Teil 1–2
    this._threadNudges       = 0;      // thread-following nudges used this session (cap 3)
    this._threadCooldown     = 0;      // ≥1 → no nudge this turn (never on consecutive turns)
    this._extraRules         = opts.extraRules || '';   // optional tuning addendum (off by default; used by the naturalness evolve loop)
    this._setPoint           = SETPOINTS[bossId] ?? 0;  // persona warmth baseline (cold ↔ warm)
    this._warmth             = this._setPoint;          // continuous warmth EMA — the candidate moves it by performing
  }

  // True while a boss turn is being generated (gateway waits for completed turns).
  get isResponding() { return this._responding; }

  // Snapshot of the claim-ledger for cross-session CONTENT memory: what the candidate talked about.
  // `spent` terms were reused by the boss itself in conversation — the strongest signal the word is a
  // real, correctly-heard term (not an STT artifact), so the gateway prefers them when persisting.
  get ledgerTerms() { return this._ledger.map((e) => ({ term: e.term, spent: e.spent })); }

  // ── Connect: set up Groq + emit the deterministic opening line ─────────────────
  // suppressOpening=true when the Gemini Live path will greet natively (audio): we still seed the
  // history so scoring/respond has the real start, but we do NOT emit the Groq opening (that would
  // make the candidate hear two hellos). The caller re-emits it via emitOpening() if Gemini fails.
  async connect(suppressOpening = false) {
    // Boss runs on the configured provider chain (Groq → Cerebras failover, see PROVIDERS).
    if (!PROVIDERS.length) throw new Error('No boss LLM key set (GROQ_API_KEY or CEREBRAS_API_KEY)');

    // System prompt is the full session script; seed the assistant's first turn with
    // the deterministic opening line so the model has the conversation's real start.
    this._history = [
      { role: 'system',    content: this._session.instructions },
      { role: 'assistant', content: this._session.openingLine },
    ];
    this._openingEmitted = false;

    console.log(`[interviewClient] connected  providers=${PROVIDERS.map(p => p.name).join('+')}  mood=${this._mood}  session=${this._sessionId}  suppressOpening=${suppressOpening}`);

    // Deliver the opening line after a short, deliberate "thinking" pause (unless suppressed).
    this._responding = true;
    setTimeout(() => {
      if (this._closed) return;
      this._responding = false;
      if (!suppressOpening) this.emitOpening();
    }, RESPONSE_DELAY_MS);
  }

  // Emit the deterministic opening line NOW. Used both by connect() (normal Groq path) and as the
  // fallback when Gemini Live was expected to greet but failed. Idempotent (fires at most once).
  emitOpening() {
    if (this._closed || this._openingEmitted) return;
    this._openingEmitted = true;
    this._responding = false;
    this._cb.onBossSpeech?.(this._session.openingLine);
    this._cb.onBossSpeechDone?.();
  }

  // ── Respond: generate ONE boss turn for the candidate's answer ─────────────────
  async respond(userText) {
    if (this._closed) return '';
    this._responding = true;

    const answer = (userText && userText.trim()) ? userText.trim() : '(keine hörbare Antwort)';
    this._history.push({ role: 'user', content: answer });
    const freshTerms = this._noteClaims(answer);   // capture the candidate's salient words for verbatim callback this turn

    // Per-turn instruction: the one-turn rule, plus optional rescue softener or correction probe.
    const turnMsgs = [...this._history, { role: 'system', content: TURN_RULE }];

    // Mechanical thread-following: a substantive answer that OPENED a new thread pins the next
    // boss turn to that thread (deterministic backstop for the ÜBERGÄNGE "don't jump" rules).
    if (this._threadCooldown > 0) this._threadCooldown -= 1;
    const nudge = threadNudge({
      freshTerms,
      wordCount: (answer.match(/\S+/g) || []).length,
      stageIdx:  this._stageIdx,
      used:      this._threadNudges,
      cooldown:  this._threadCooldown,
      busy:      !!this._pendingRescue || this._pendingCorrection !== null || this._pendingClosing != null,
    });
    if (nudge) {
      turnMsgs.push({ role: 'system', content: nudge });
      this._threadNudges  += 1;
      this._threadCooldown = 2;   // decremented once per turn → skips exactly the NEXT turn
    }

    // ROLLING ANTI-REPEAT: a static ban list can't anticipate the model's favourite opener OF THE DAY.
    // Read the boss's OWN last few turns and forbid re-using their opening words — so it is structurally
    // impossible to begin two nearby turns the same way. $0, deterministic, no extra call.
    const recentOpeners = [...new Set(
      this._history.filter((m) => m.role === 'assistant').slice(-3)
        .map((m) => String(m.content || '').trim().replace(/^[„"'»]+/, '').split(/\s+/).slice(0, 2).join(' ').replace(/[^\p{L}\s]/gu, '').trim())
        .filter((o) => o.length >= 3)
    )];
    if (recentOpeners.length) {
      turnMsgs.push({ role: 'system', content: `Beginne deinen Redebeitrag NICHT mit denselben Worten wie zuvor. Vermeide diese Anfänge: ${recentOpeners.map((o) => `„${o}…"`).join(', ')}.` });
    }
    // The goodbye outranks rescue/correction probes — a real HR person doesn't drill into a
    // weakness while saying goodbye. (Emotion tone and the claim-ledger callback stay: they are
    // exactly what makes the goodbye personal.)
    if (this._pendingClosing != null) { this._pendingRescue = null; this._pendingCorrection = null; }
    // Pacing sync (ROADMAP #15): the funnel clock, re-sent each turn like TURN_RULE. Skipped on
    // the goodbye turn — the closing instruction already owns the ending.
    if (this._pendingClosing == null) {
      const pace = pacingLine(this._pacing);
      if (pace) turnMsgs.push({ role: 'system', content: pace });
    }
    if (this._pendingRescue) {
      turnMsgs.push({ role: 'system', content: this._rescueInstruction(this._pendingRescue) });
      this._pendingRescue = null;
    }
    if (this._pendingCorrection !== null) {
      turnMsgs.push({ role: 'system', content: this._correctionInstruction(this._pendingCorrection) });
      this._pendingCorrection = null;
    }
    if (this._pendingEmotion) {
      const dir = this._emotionInstruction(this._pendingEmotion);
      if (dir) turnMsgs.push({ role: 'system', content: dir });
      this._pendingEmotion = null;
    }
    // CLAIM-LEDGER: hand the boss the candidate's own salient words so it can prove it listened —
    // reuse ONE verbatim if it fits naturally (callback). Marked "spent" once used so it never nags.
    const unspent = this._ledger.filter((e) => !e.spent).map((e) => e.term).slice(-6);
    if (unspent.length) {
      turnMsgs.push({ role: 'system', content:
        `Der Kandidat hat unter anderem das gesagt: ${unspent.join(', ')}. Wenn es natürlich passt, ` +
        `greife GENAU EINEN dieser Begriffe WÖRTLICH in deiner Reaktion auf (so zeigst du, dass du zuhörst) — ` +
        `aber erzwinge es nicht und liste sie niemals auf. ` +
        `WICHTIG: Greife nur einen Begriff auf, den du sicher als echtes, sinnvolles Wort erkennst. Wirkt ein ` +
        `Begriff wie ein Erkennungs-/Hörfehler (ungewöhnlich, kein sinnvolles deutsches Wort, oder er passt ` +
        `nicht zum Kontext — z. B. ein verstümmeltes Fachwort), wiederhole ihn NIEMALS wörtlich. Frag dann ` +
        `natürlich nach ("Wie meinen Sie das genau?") oder beziehe dich auf das allgemeine Thema. Zitiere nie ` +
        `ein Wort, dessen Bedeutung dir unklar ist.` });
    }
    if (this._extraRules) turnMsgs.push({ role: 'system', content: this._extraRules });
    // LAST system message = strongest: the human HR goodbye replaces the usual one-question turn.
    if (this._pendingClosing != null) {
      turnMsgs.push({ role: 'system', content: this._closingInstruction(this._pendingClosing) });
      this._pendingClosing = null;
    }

    let line = '';
    let content, provider;   // MUST be declared: in an ES module, assigning to undeclared names
    // throws ReferenceError on EVERY turn → the catch below swallowed it and every boss line
    // became the canned fallback ("Bitte fahren Sie fort.") — a silently broken interview.
    try {
      // STREAMED: the first complete sentence is handed to the gateway (onBossEarly) the moment it
      // exists, so the client can start SPEAKING it while the rest of the line is still generating —
      // the boss now begins answering in roughly first-token time instead of full-completion time.
      // If streaming fails end-to-end (SSE quirk, proxy, provider), we surface the error to the client
      // rather than silently degrading to a non-streaming path, because a blocking fallback is what
      // causes the 5–6 s dead air the user experiences.
      ({ content, provider } = await callBossStreaming(turnMsgs, this._sessionId, (s1) => {
        if (this._closed) return;
        this._cb.onBossEarly?.(s1);
      }));
      line = content;
    } catch (err) {
      console.error(`[interviewClient] boss error (all providers)  session=${this._sessionId}: ${err.message}`);
      this._responding = false;
      const code = this._classify(err);
      this._cb.onError?.(Object.assign(new Error(err.message || 'boss_error'), { code }));
      // NEVER leave the client hanging. Always emit a boss line so the interview can continue.
      const fallback = ['Bitte fahren Sie fort.', 'Erzählen Sie ruhig weiter.', 'Gut — und weiter?'][this._history.length % 3];
      this._cb.onBossSpeech?.(fallback);
      this._cb.onBossSpeechDone?.();
      return fallback;
    }
    if (provider !== this._lastProvider) {
        this._lastProvider = provider;
        console.log(`[interviewClient] boss on ${provider}  session=${this._sessionId}`);
      }

    line = sanitizeOneTurn(line, { roleplay: this._stageIdx >= 2 });
    // never emit an empty boss turn — and VARY the fallback so a repeat doesn't read as a robot.
    if (!line) line = ['Bitte fahren Sie fort.', 'Erzählen Sie ruhig weiter.', 'Gut — und weiter?'][this._history.length % 3];

    // GUARD: the model sometimes claims it "didn't acoustically understand" even though the
    // candidate gave a perfectly valid (often short) answer like "Gerne." or "Ja, gerne."
    // The empty-input case never reaches here (the gateway drops empty turns before respond),
    // so if we got real words, that line is always wrong. Replace it with a natural,
    // in-character continuation instead of falsely blaming the speaker.
    const saidSomething = (answer && answer !== '(keine hörbare Antwort)' &&
                           answer.replace(/[^\p{L}\p{N}]/gu, '').length >= 1);
    if (saidSomething && /nicht\s+(ganz\s+)?(akustisch\s+)?verstanden|akustisch\s+nicht|nicht\s+verstehen|könnten?\s+sie\s+das\s+(bitte\s+)?(noch\s*mal|wiederholen)|wiederholen\s+sie/i.test(line)) {
      line = ['Gut. Erzählen Sie mir bitte etwas mehr dazu.', 'Verstanden. Können Sie das an einem konkreten Beispiel festmachen?', 'Okay. Und was genau haben Sie dann getan?'][this._history.length % 3];
    }

    // Mark any ledger term the boss actually reused as "spent" so it isn't suggested again.
    for (const e of this._ledger) { if (!e.spent && line.includes(e.term)) e.spent = true; }

    this._history.push({ role: 'assistant', content: line });

    this._responding = false;
    if (this._closed) return line;
    this._cb.onBossSpeech?.(line);
    this._cb.onBossSpeechDone?.();
    return line;
  }

  // The gateway keeps the funnel stage fresh → thread-following stays out of the Teil-3 roleplay.
  setStage(idx) { if (typeof idx === 'number') this._stageIdx = idx; }

  // The gateway calls this after every scored answer so the model sees the SAME clock the rigid
  // completion counter runs on (ROADMAP #15). Values only — the counter itself and every timing
  // knob stay untouched; consumed fresh each respond() via pacingLine().
  setPacing(pacing) { this._pacing = (pacing && typeof pacing === 'object') ? pacing : null; }

  // The gateway calls this after two broken answers → soften the NEXT boss turn.
  requestRescue(reason = 'weak') { this._pendingRescue = reason; }

  // The gateway calls this once the interview is complete → the NEXT boss turn is the human
  // HR goodbye instead of another question. `wins` are VERIFIED observations from
  // scoring/structureWins.js — the only praise material the boss may use (owner law #2:
  // nothing shown or said to the learner may be invented).
  requestClosing(wins = []) { this._pendingClosing = Array.isArray(wins) ? wins : []; }

  // The gateway calls this after 2 weak answers with the same error → probe for specifics.
  // The boss stays in character: no metalinguistic comment, just a targeted follow-up question.
  requestCorrection(label = '') { this._pendingCorrection = label; }

  // The gateway calls this each turn with the backend-computed affect; it colours the NEXT boss
  // turn's TONE only. The scorer never reads it → "alive" never means "unfair" (judgement stays
  // mood-blind). This is what makes the candidate able to "win the room": good answers visibly warm
  // the boss, weak ones cool him — feelings that finally reach his WORDS, not just the HUD badge.
  requestEmotion(label = '', score = null) {
    this._pendingEmotion = label;
    // Continuous warmth EMA: drift toward a target = persona set-point + how this answer landed.
    // Small step (0.34) = momentum, so the boss warms/cools GRADUALLY across the conversation, not in
    // snaps. The candidate genuinely "wins (or loses) the room." Delivery/tone only — scorer never reads it.
    if (typeof score === 'number') {
      const target = Math.max(-1, Math.min(1, this._setPoint + (score - 55) / 45));
      this._warmth = Math.max(-1, Math.min(1, this._warmth + 0.34 * (target - this._warmth)));
    }
  }

  // Capture the candidate's salient content words (German nouns are Capitalized — a strong, deterministic
  // signal) into the claim-ledger for verbatim callbacks. High-precision on purpose: the boss only ever
  // echoes words the candidate REALLY said, and only "if natural", so a stray capture is harmless.
  _noteClaims(text) {
    const fresh = [];
    const found = String(text || '').match(/(?<!\p{L})\p{Lu}\p{Ll}{3,}(?!\p{L})/gu) || [];
    for (const w of found) {
      if (LEDGER_STOP.has(w)) continue;
      if (!this._ledger.some((e) => e.term === w)) { this._ledger.push({ term: w, spent: false }); fresh.push(w); }
    }
    if (this._ledger.length > 14) this._ledger = this._ledger.slice(-14);   // keep it small + recent
    return fresh;   // the terms THIS answer newly introduced → thread-following signal
  }

  // Build the tone directive from the CONTINUOUS warmth (graded, not 3 buckets), plus a tension note when
  // the boss is cornered. Returns '' near the neutral band so neutral turns stay clean (token-lean).
  _emotionInstruction(label) {
    const w = this._warmth;
    let base = '';
    if      (w >=  0.55) base = 'Die Person überzeugt dich gerade — lass deutliche, ehrliche Anerkennung und Wärme durchklingen, in deiner Rolle und nie schmeichlerisch.';
    else if (w >=  0.22) base = 'Es läuft gut — eine Spur wärmer, zugewandter und offener im Ton.';
    else if (w <= -0.55) base = 'Die Antworten überzeugen nicht — merklich kühler, knapper und ungeduldiger; höflich in der Sie-Form, aber distanziert.';
    else if (w <= -0.22) base = 'Noch nicht überzeugt — eine Spur kühler, skeptischer und zurückhaltender.';
    const tense = (label === 'wuetend') ? ' Die Lage ist angespannt: bestimmt und direkt, aber beherrscht — niemals beleidigend.' : '';
    const out = (base + tense).trim();
    return out ? `AFFEKT (nur Ton/Lieferung, NICHT die Bewertung): ${out}` : '';
  }

  // The last boss turn: end the interview like an experienced, tactful, HUMAN HR person.
  // Verified wins (deterministic detectors) may be mentioned; anything else may not — the
  // written debrief carries the criticism, the goodbye carries the humanity.
  _closingInstruction(wins) {
    const winLines = (Array.isArray(wins) ? wins : [])
      .filter((w) => w && w.phrase)
      .map((w) => w.quote ? `${w.phrase} (der Kandidat sagte z. B.: „${w.quote}…")` : w.phrase);
    const observation = winLines.length
      ? `Erwähne dabei beiläufig und natürlich GENAU EINE dieser VERIFIZIERTEN Beobachtungen (wähle die stärkste, ` +
        `formuliere sie in deinen eigenen Worten, z. B. "Mir ist positiv aufgefallen, dass …"): ` +
        `${winLines.join(' · ')}. Nenne NUR diese — erfinde kein weiteres Lob.`
      : `Bleibe wertschätzend und menschlich, aber erfinde KEIN Lob und gib KEINE Bewertung ab — ` +
        `die Auswertung übernimmt das schriftliche Feedback.`;
    return (
      `DAS INTERVIEW IST JETZT ZU ENDE — dies ist dein LETZTER Redebeitrag. Beende das Gespräch so, ` +
      `wie eine erfahrene, menschliche HR-Person es tun würde: bedanke dich kurz und persönlich für das ` +
      `Gespräch (greife, wenn es natürlich passt, EIN konkretes Thema aus dem Gespräch auf). ${observation} ` +
      `Kritisiere NICHTS in der Verabschiedung — kein Grammatik-Kommentar, keine Schwächen-Liste; das gehört ` +
      `in die schriftliche Auswertung, die dem Kandidaten gleich angezeigt wird (sage genau das in einem ` +
      `halben Satz: die detaillierte Auswertung erscheint gleich am Bildschirm). Verabschiede dich dann ` +
      `professionell und warm. Stelle KEINE weitere Frage. Höchstens drei kurze Sätze.`
    );
  }

  _correctionInstruction(label) {
    const hint = label ? ` (es geht um: "${label}")` : '';
    return (
      `Die letzte Antwort blieb vage${hint}. Reagiere wie ein echter, wohlwollender Interviewer — NICHT kalt. ` +
      `Greife kurz und natürlich auf, was der Kandidat gerade gesagt hat (ein halber Satz genügt), und hake dann ` +
      `mit GENAU EINER gezielten Frage nach, die Konkretheit erzwingt — z.B. "Verstehe — und was genau haben Sie ` +
      `dann gesagt?", "Haben Sie dafür ein konkretes Beispiel?" oder "Was war am Ende das Ergebnis?". ` +
      `Reagiere auf NUR EINE Sache — niemals auf mehrere Schwächen gleichzeitig, kein Korrektur-Stakkato. ` +
      `Benenne KEINEN Sprach- oder Grammatikfehler ausdrücklich (das kommt später im Feedback). Höchstens ein kurzer Satz.`
    );
  }

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
