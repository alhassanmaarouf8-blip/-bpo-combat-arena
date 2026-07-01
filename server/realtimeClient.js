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

// Hard cap per boss turn. A single question is ~20–60 tokens; a Teil-3 customer
// complaint with scenario context is longer. 200 still leaves room for a vivid customer
// line while making it structurally impossible to run on and answer for the candidate —
// and since TTS bills per character (the #1 cost), a tighter boss is cheaper AND more
// disciplined ("say one thing, then stop"). Tunable; raise toward 280 if lines feel clipped.
const MAX_TURN_TOKENS = 110;   // was 200 — measured boss turns averaged 58 words (4-8× a real interviewer's ~7-15); shorter cap + the prompt + the one-question clamp pull it toward human length

// ── Boss LLM providers (OpenAI-compatible) with automatic cap-failover ──────────
// The boss tries providers in order. When one returns 429 (its daily/rate cap is hit)
// it's parked on a short cooldown and the SAME turn retries on the next provider — so
// the candidate never sees a dropped turn. This pools every configured provider's free
// budget (~100K/day Groq + ~1M/day Cerebras ≈ 1.1M/day). A provider only activates if
// its API key env is set, so adding CEREBRAS_API_KEY is all it takes to switch failover on.
//
//   GROQ:     GROQ_API_KEY (already set) · llama-3.3-70b-versatile (non-reasoning, fast)
//   CEREBRAS: CEREBRAS_API_KEY · gpt-oss-120b — a REASONING model, so it gets extra token
//             headroom + reasoning_effort:'low' (verified: clean formal German, ~0.6s).
const PROVIDERS = [
  {
    name:  'groq',
    base:  process.env.INTERVIEW_BASE_URL || 'https://api.groq.com/openai/v1',
    key:   process.env.INTERVIEW_API_KEY  || process.env.GROQ_API_KEY,
    model: process.env.GROQ_INTERVIEW_MODEL || 'llama-3.3-70b-versatile',
    maxTokens: MAX_TURN_TOKENS,
    // Naturalness: llama-3.3-70b at temp 0.7 with no penalties collapses toward one safe written
    // register and recycles the same openers ("Das ist interessant…"). presence/frequency penalties
    // + a small temp bump break that mechanically. Set per-provider (NOT on the Cerebras reasoning
    // model, which handles these params differently) and spread AFTER the body's temperature so it wins.
    extra: { temperature: 0.85, presence_penalty: 0.6, frequency_penalty: 0.4 },
  },
  {
    name:  'cerebras',
    base:  process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    key:   process.env.CEREBRAS_API_KEY,
    model: process.env.CEREBRAS_INTERVIEW_MODEL || 'gpt-oss-120b',
    maxTokens: 400,                       // reasoning tokens eat into this → give headroom
    extra: { reasoning_effort: 'low' },   // minimal thinking → short, clean question, fast
  },
].filter(p => p.key);                     // only providers whose key is configured

const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;   // after a 429, skip a provider for 10 min
const _providerCooldownUntil = Object.create(null);   // provider name → epoch ms

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
      return { content: data.choices?.[0]?.message?.content ?? '', provider: p.name };
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
const GREETINGS = {
  'yasmin':         "Schön, dass Sie da sind. Setzen Sie sich, machen Sie es sich bequem.",
  'karim':          "Guten Tag. Schön, dass es mit dem Termin geklappt hat.",
  'hana':           "Guten Tag. Danke, dass Sie sich die Zeit nehmen.",
  'tarek':          "Guten Tag. Setzen Sie sich — viel Zeit haben wir heute nicht.",
  'frau-mona-adel': "Setzen Sie sich. Ich höre.",
  'lukas':          "Hey, komm rein. Ich bin Lukas — wir machen das hier locker, kein Stress.",
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
  'lukas':          'aura-2-fabian-de',   // male, casual (Deepgram fallback)
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
      greeting:    GREETINGS[c.id] || 'Guten Tag.',
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
const TURN_RULE =
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
  t = t.replace(/^\s*(Yasmin|Karim|Hana|Tarek|Frau\s+Mona\s+Adel|Frau\s+Adel|Herr\s+Tariq|Frau\s+Müller|Direktor\s+Vogel|Interviewer|HR)\s*[:：]\s*/i, '').trim();
  // ONE question per turn: real interviewers ask one thing, not a stack (measured 1.6 Q/turn, up to 3).
  // If the line has ≥2 question marks, keep everything up to and including the FIRST '?' and drop the rest.
  const q1 = t.indexOf('?');
  if (q1 !== -1 && t.indexOf('?', q1 + 1) !== -1) t = t.slice(0, q1 + 1).trim();
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
      memory:      opts.memory,   // growth-aware cross-session memory → boss "AKTE" block
      candidateName: opts.candidateName, // stored guide name → addressed naturally in the opener
      focusTitle:  opts.focusTitle,
      mood:        this._mood,
      clarificationRate,
      recent:      opts.recent,   // per-user seen-ids → no-repeat behavioral/screening/scenario
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
    this._pendingEmotion     = null;   // affect label → tone directive for the NEXT boss turn (delivery only)
    this._ledger             = [];     // claim-ledger: salient terms the candidate said → verbatim callbacks ("it listens")
    this._extraRules         = opts.extraRules || '';   // optional tuning addendum (off by default; used by the naturalness evolve loop)
    this._setPoint           = SETPOINTS[bossId] ?? 0;  // persona warmth baseline (cold ↔ warm)
    this._warmth             = this._setPoint;          // continuous warmth EMA — the candidate moves it by performing
  }

  // True while a boss turn is being generated (gateway waits for completed turns).
  get isResponding() { return this._responding; }

  // ── Connect: set up Groq + emit the deterministic opening line ─────────────────
  async connect() {
    // Boss runs on the configured provider chain (Groq → Cerebras failover, see PROVIDERS).
    if (!PROVIDERS.length) throw new Error('No boss LLM key set (GROQ_API_KEY or CEREBRAS_API_KEY)');

    // System prompt is the full session script; seed the assistant's first turn with
    // the deterministic opening line so the model has the conversation's real start.
    this._history = [
      { role: 'system',    content: this._session.instructions },
      { role: 'assistant', content: this._session.openingLine },
    ];

    console.log(`[interviewClient] connected  providers=${PROVIDERS.map(p => p.name).join('+')}  mood=${this._mood}  session=${this._sessionId}`);

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
    this._noteClaims(answer);   // capture the candidate's salient words for verbatim callback this turn

    // Per-turn instruction: the one-turn rule, plus optional rescue softener or correction probe.
    const turnMsgs = [...this._history, { role: 'system', content: TURN_RULE }];

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

    let line = '';
    try {
      const { content, provider } = await callBoss(turnMsgs, this._sessionId);
      line = content;
      if (provider !== this._lastProvider) {
        this._lastProvider = provider;
        console.log(`[interviewClient] boss on ${provider}  session=${this._sessionId}`);
      }
    } catch (err) {
      console.error(`[interviewClient] boss error (all providers)  session=${this._sessionId}: ${err.message}`);
      this._responding = false;
      const code = this._classify(err);
      this._cb.onError?.(Object.assign(new Error(err.message || 'boss_error'), { code }));
      return '';
    }

    line = sanitizeOneTurn(line);
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

  // The gateway calls this after two broken answers → soften the NEXT boss turn.
  requestRescue(reason = 'weak') { this._pendingRescue = reason; }

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
    const found = String(text || '').match(/(?<!\p{L})\p{Lu}\p{Ll}{3,}(?!\p{L})/gu) || [];
    for (const w of found) {
      if (LEDGER_STOP.has(w)) continue;
      if (!this._ledger.some((e) => e.term === w)) this._ledger.push({ term: w, spent: false });
    }
    if (this._ledger.length > 14) this._ledger = this._ledger.slice(-14);   // keep it small + recent
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
