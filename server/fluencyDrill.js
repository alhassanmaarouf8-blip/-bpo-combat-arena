/**
 * fluencyDrill.js — the 4-3-2 spoken-fluency drill (PAID; mic + cheap STT, NEVER a Realtime session).
 *
 * METHOD (Nation 1989; Arevart & Nation 1991): the learner answers the SAME prompt three times
 * in SHRINKING time windows (here 90 → 60 → 45 s, adapted to interview-length answers). Forcing
 * the same content into less time pushes speech rate up and hesitation down WITHIN the session.
 *
 * HONESTY / EVIDENCE LIMITS (deliberately encoded, not marketing):
 *   - The replicated effect is the WITHIN-SESSION speed-up. Durable transfer to NEW topics is
 *     NOT established (Thai & Boers 2016), and 4-3-2 improves fluency but NOT grammar/accuracy.
 *     So this drill trains DELIVERY only; grammar is shown separately and never sold as the win.
 *
 * ACCURACY GUARANTEE (this is the whole point of the design):
 *   - ALL fluency feedback is DETERMINISTIC and computed from the learner's OWN transcribed
 *     speech: words, duration, words-per-minute, and clearly-recognised hesitation sounds.
 *     There is NO language-model opinion anywhere in this file — nothing generic, nothing
 *     invented. The client renders the learner's real round-1 vs round-3 numbers.
 *   - Any GRAMMAR shown comes ONLY from LanguageTool (grammarCheck.js, the same authoritative
 *     engine the debrief uses). If LanguageTool is unreachable, NO grammar is shown — we would
 *     rather show nothing than a correction we cannot stand behind.
 *   - Whisper tends to CLEAN UP "äh/ähm", so transcript-based filler counts undercount. The
 *     client therefore HEADLINES words-per-minute (robust) and labels fillers as a best-effort,
 *     transcript-detected secondary — never overclaimed.
 *
 *   GET  /api/fluency                 → { prompt:{id,de,ar}, rounds:[90,60,45] }  (paid only)
 *   POST /api/fluency/score           → raw audio + ?id=&round=&ms=&level=&grammar=0|1
 *                                       → { transcript, metrics:{words,wpm,fillers,fillerHits,
 *                                            uniqueWords,durationMs}, grammar? }
 *
 * OpenAI-free: transcription runs on Groq Whisper over plain fetch (no openai SDK, no multer).
 * Gated exactly like shadowing: requireAuth + active plan (planOf !== 'free').
 */
import express from 'express';
import { requireAuth, planOf, drillsUnlocked } from './auth.js';
import { buildGrammar, isSpeakableRule } from './grammarCheck.js';
import { loadUser, saveUser }  from './store.js';
import { voicedDurationMs }    from './audioGuard.js';
import { isCleanGermanText, isCleanArabicOrGermanText } from './langGuard.js';

export const fluencyRouter = express.Router();

// 4-3-2 time compression, adapted to interview-length answers (seconds per round).
const ROUND_SECONDS = [90, 60, 45];

// Groq Whisper — same OpenAI-free STT the live interview uses. No SDK, native FormData/fetch.
const GROQ_BASE  = 'https://api.groq.com/openai/v1';
const STT_MODEL  = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';

// Curated BPO-interview speaking prompts. The SAME prompt is used for all three rounds.
// level: 'a2-b1' (simpler) or 'b2' (demands a structured Situation→Handlung→Ergebnis answer).
const PROMPTS = [
  { de: 'Stellen Sie sich kurz vor: Wer sind Sie, und warum möchten Sie im Kundenservice arbeiten?',
    ar: 'عرّف بنفسك باختصار: مين انت، وليه عايز تشتغل في خدمة العملاء؟', level: 'a2-b1' },
  { de: 'Beschreiben Sie Ihren letzten Arbeitstag oder Studientag — was haben Sie konkret gemacht?',
    ar: 'وصف آخر يوم شغل أو مذاكرة — عملت إيه بالظبط؟', level: 'a2-b1' },
  { de: 'Ein Kunde ruft an und ist verärgert, weil seine Lieferung zu spät ist. Wie reagieren Sie?',
    ar: 'عميل بيتصل وهو متضايق علشان الشحنة اتأخرت. هتتصرف إزاي؟', level: 'a2-b1' },
  { de: 'Warum sollten wir genau Sie einstellen? Nennen Sie drei konkrete Stärken mit Beispiel.',
    ar: 'ليه نعيّنك انت بالذات؟ اذكر تلات نقاط قوة بمثال لكل واحدة.', level: 'b2' },
  { de: 'Erzählen Sie von einer Situation, in der Sie einen verärgerten Kunden beruhigt haben — Situation, Handlung, Ergebnis.',
    ar: 'احكِ عن موقف هدّيت فيه عميل غضبان — الموقف، اللي عملته، والنتيجة.', level: 'b2' },
  { de: 'Ein Kollege macht einen Fehler, der einen Kunden betrifft. Wie gehen Sie professionell damit um?',
    ar: 'زميل عمل غلط أثّر على عميل. هتتعامل مع الموقف باحتراف إزاي؟', level: 'b2' },
  { de: 'Wo sehen Sie sich beruflich in zwei Jahren, und was tun Sie heute dafür?',
    ar: 'بتشوف نفسك فين مهنياً بعد سنتين، وبتعمل إيه دلوقتي علشان توصل؟', level: 'b2' },
  { de: 'Erklären Sie einem Kunden höflich, dass sein Wunsch leider nicht möglich ist, ohne ihn zu verärgern.',
    ar: 'اشرح لعميل بأدب إن طلبه مش ممكن للأسف، من غير ما تضايقه.', level: 'b2' },
  { de: 'Erzählen Sie von einem Tag, an dem alles schiefging — und wie Sie ruhig geblieben sind.',
    ar: 'احكِ عن يوم كله غلط — وإزاي فضلت هادي.', level: 'a2-b1' },
  { de: 'Was machen Sie, wenn Sie die Antwort auf die Frage eines Kunden nicht kennen?',
    ar: 'بتعمل إيه لو معرفتش إجابة سؤال العميل؟', level: 'a2-b1' },
  { de: 'Ein Kunde besteht zu Unrecht auf einer Erstattung. Bleiben Sie höflich, aber bestimmt — was sagen Sie?',
    ar: 'عميل مصمم على استرداد فلوس من غير حق. خليك مؤدب بس حازم — هتقول إيه؟', level: 'b2' },
  { de: 'Überzeugen Sie mich in 60 Sekunden, dass Sie unter Druck ruhig bleiben.',
    ar: 'اقنعني في 60 ثانية إنك بتفضل هادي تحت الضغط.', level: 'b2' },
];

// ── NOVEL prompt generation (Groq chat — same pattern as realtimeClient.js) ───────
// Fluency is measured DETERMINISTICALLY from the learner's own audio (WpM/LanguageTool);
// the prompt is never graded against an answer, so GENERATING speaking topics is fully
// safe — there is no "correct answer" to get wrong. We generate a fresh batch of German
// BPO-interview speaking prompts (both levels, Arabic gloss) so reopening gives NEW topics.
// FAIL-SAFE: no key / bad JSON / too few items → fall back to the fixed PROMPTS pool above.
const GEN_MODEL  = process.env.GROQ_INTERVIEW_MODEL || 'llama-3.3-70b-versatile';
const GEN_TTL_MS = 10 * 60 * 1000;   // cache one generated batch briefly to bound cost
const GEN_ID_BASE = 1_000_000;        // generated-prompt ids live above the fixed indices
let _promptSeq   = GEN_ID_BASE;
let _promptCache = { at: 0, items: null };

async function groqChatJSON(messages, { maxTokens = 1400, temperature = 1.0 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('no_api_key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: GEN_MODEL, temperature, max_tokens: maxTokens,
                                response_format: { type: 'json_object' }, messages }),
      signal:  controller.signal,
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(timer); }
}

async function generatePrompts() {
  const sys =
    'Du erstellst Sprech-Aufgaben (NUR Themen/Impulse, KEINE Musterantworten) für ein 4-3-2-Flüssigkeits-' +
    'training angehender deutscher Callcenter-/Kundenservice-Mitarbeiter. Jede Aufgabe ist eine einzige, ' +
    'sprechbare Aufforderung auf natürlichem, idiomatischem Deutsch (Sie-Form), die 60-90 Sekunden freies ' +
    'Sprechen anregt — Selbstvorstellung, Verhaltensfragen (STAR/Situation-Handlung-Ergebnis), ' +
    'Kundenservice-Szenarien, Deeskalation, Motivation. Variiere die Themen stark. Liefere zu jeder Aufgabe ' +
    'eine knappe ägyptisch-arabische Übersetzung als Lernhilfe. "level": "a2-b1" für einfache, "b2" für ' +
    'anspruchsvollere Aufgaben. Antworte AUSSCHLIESSLICH als JSON: ' +
    '{"prompts":[{"de":"...","ar":"...","level":"a2-b1"|"b2"}, ...]}. KEIN weiterer Text.';
  const user = 'Erzeuge 10 NEUE, abwechslungsreiche Sprech-Aufgaben (etwa zur Hälfte a2-b1, zur Hälfte b2). Keine Wiederholungen, keine Musterantworten.';
  const content = await groqChatJSON([{ role: 'system', content: sys }, { role: 'user', content: user }]);
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed) ? parsed : (parsed.prompts || parsed.items || parsed.aufgaben || []);
  // SCRIPT SANITY (langGuard.js): the learner speaks for 90-60-45s FROM this prompt — a foreign-
  // script glitch here would derail the whole round, so reject it before it's ever served.
  return (Array.isArray(arr) ? arr : [])
    .filter((p) => p && typeof p.de === 'string' && p.de.trim().length > 12 && isCleanGermanText(p.de) && (!p.ar || isCleanArabicOrGermanText(p.ar)))
    .map((p) => ({ de: String(p.de).trim(), ar: String(p.ar || '').trim(),
                   level: p.level === 'b2' ? 'b2' : 'a2-b1', id: _promptSeq++ }));
}

// Returns a fresh-ish generated pool (with stable ids), or null to signal "use the fixed pool".
async function getGeneratedPrompts() {
  if (!process.env.GROQ_API_KEY) return null;                       // FAIL-SAFE: no key → fixed pool
  if (_promptCache.items && Date.now() - _promptCache.at < GEN_TTL_MS) return _promptCache.items;
  try {
    const items = await generatePrompts();
    if (items.length >= 4) { _promptCache = { at: Date.now(), items }; return items; }
    return _promptCache.items;                                      // too few → keep last good (or null)
  } catch (e) {
    console.error('[fluency] prompt generation failed:', e.message);
    return _promptCache.items;                                      // FAIL-SAFE: stale batch or null → fixed
  }
}

// Active-paid gate (basic/elite/admin). planOf() already reverts an expired plan to 'free'.
function paidOnly(req, res) {
  if (!drillsUnlocked(req.account)) {
    res.status(402).json({ error: 'plan_required', reason: 'fluency_is_paid' });
    return false;
  }
  return true;
}

// Pick a prompt the student has NOT seen (no repeats until the level's pool is exhausted, then cycle).
// `pool` carries explicit ids (generated ids live above GEN_ID_BASE, fixed ids are 0..n-1), so the
// per-level seen-list stays valid no matter which pool is active.
function pickPrompt(pool, level, seen) {
  const matched = pool.filter((p) => p.level === level);
  const from = matched.length ? matched : pool;
  const seenSet = new Set(seen || []);
  let unseen = from.filter((p) => !seenSet.has(p.id));
  let reset = false;
  if (!unseen.length) { unseen = from; reset = true; }
  return { chosen: unseen[Math.floor(Math.random() * unseen.length)], reset };
}
const fixedPool = () => PROMPTS.map((p, i) => ({ ...p, id: i }));

// ── DETERMINISTIC measurement — the accuracy core. No model, no opinion. ──────────
// Only UNAMBIGUOUS hesitation sounds are counted as fillers. Discourse words that are
// often legitimate (also, ja, halt, eigentlich) are intentionally EXCLUDED so we never
// mislabel correct speech as a filler — being wrong here would break the user's trust.
const FILLER_SET = new Set(['äh', 'ähm', 'ähh', 'ähhm', 'ähem', 'ehm', 'öh', 'öhm', 'hm', 'hmm', 'mhm', 'mh']);

function measure(transcript, durationMs, voicedMs) {
  const tokens = String(transcript || '').toLowerCase().normalize('NFC')
    .replace(/[^a-zäöüß0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
  const words = tokens.length;
  // Speech rate from VOICED time (silence removed), NOT mic-on wall-clock. This kills the
  // artifact where leaving the recorder running (or just stopping it sooner in round 3) faked
  // a "got faster" headline. Fall back to wall-clock only if voiced detection is unreliable.
  const baseMs = (voicedMs && voicedMs >= 800) ? voicedMs : durationMs;
  const minutes = baseMs > 0 ? baseMs / 60000 : 0;
  const wpm = minutes > 0 ? Math.round(words / minutes) : 0;
  let fillers = 0;
  for (const t of tokens) if (FILLER_SET.has(t)) fillers++;
  const uniqueWords = new Set(tokens.filter((t) => !FILLER_SET.has(t))).size;
  return { words, wpm, fillers, uniqueWords, durationMs, voicedMs: voicedMs || 0 };
}

// voicedDurationMs now lives in audioGuard.js (shared by every audio-scored feature).

async function transcribeGroq(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('no_api_key');
  const ext = (String(mimeType).split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `round.${ext}`);
  fd.append('model', STT_MODEL);
  fd.append('language', 'de');
  fd.append('response_format', 'text');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Groq STT ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.text()).trim();
  } finally { clearTimeout(timer); }
}

// ── GET a fresh drill: one prompt + the three shrinking round windows (paid only) ──
fluencyRouter.get('/fluency', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');   // fresh prompt + focus every open (never a cached repeat)
  const level = req.query.level === 'b2' ? 'b2' : 'a2-b1';
  // Prefer a freshly GENERATED pool (novel each open); fall back to the fixed PROMPTS pool.
  const gen  = await getGeneratedPrompts().catch(() => null);
  const pool = (gen && gen.length) ? gen : fixedPool();
  let chosen, focus = null;
  try {
    const u = await loadUser(req.account.id);
    // No-repeat, KEYED BY LEVEL: a2-b1 and b2 keep separate seen-lists, so exhausting/resetting one
    // level can't wipe or contaminate the other's no-repeat history. (Migrates the old flat array.)
    const store = (u.fluencySeen && !Array.isArray(u.fluencySeen)) ? u.fluencySeen : {};
    const seen  = Array.isArray(store[level]) ? store[level] : [];
    const r = pickPrompt(pool, level, seen);
    chosen = r.chosen;
    store[level]  = r.reset ? [chosen.id] : [...seen, chosen.id];
    u.fluencySeen = store;
    // Weakness FOCUS: prime the learner on their #1 weak (speakable) rule; LanguageTool then measures it.
    const weak = (u.srs || []).filter((i) => i.type === 'grammar' && !i.mastered && i.content && isSpeakableRule(i.content))
                              .sort((a, b) => (b.lapses || 0) - (a.lapses || 0))[0];
    if (weak) focus = weak.content;
    await saveUser(u);
  } catch {
    chosen = pickPrompt(pool, level, []).chosen;   // best-effort: still serve a prompt
  }
  res.json({ prompt: { id: chosen.id, de: chosen.de, ar: chosen.ar }, rounds: ROUND_SECONDS, focus });
});

// ── POST one round's recording → measured metrics (+ authoritative grammar on request) ──
fluencyRouter.post('/fluency/score',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    if (!paidOnly(req, res)) return;
    res.set('Cache-Control', 'no-store');
    try {
      const round = Math.min(3, Math.max(1, parseInt(req.query.round, 10) || 1));
      const durationMs = Math.max(0, parseInt(req.query.ms, 10) || 0);

      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) {
        return res.status(400).json({ error: 'empty_audio' });
      }

      // HONEST GATE: no real voiced speech → DON'T transcribe or score. Whisper invents German from
      // silence, which became fake metrics + a fake "correction". Tell the client to retry instead.
      const voicedMs = voicedDurationMs(audio);
      if (voicedMs < 600) return res.json({ transcript: '', retry: true, noSpeech: true });

      const transcript = (await transcribeGroq(audio, req.headers['content-type'] || 'audio/wav')).trim();
      if (!transcript) return res.json({ transcript: '', retry: true, noSpeech: true });

      const metrics = measure(transcript, durationMs, voicedMs);

      // Authoritative grammar (LanguageTool only) — requested on the final round so we don't
      // interrupt the fluency push mid-drill. Never model-invented; [] if LT is unreachable.
      let grammar;
      if (req.query.grammar === '1' && metrics.words >= 3) {
        try {
          grammar = await buildGrammar([{ text: transcript, words: metrics.words }]);
        } catch (e) {
          console.error('[fluency] LanguageTool unavailable:', e.message);
          grammar = [];   // show nothing rather than an unverified correction
        }
      }

      console.log(`[fluency] user=${req.account.id} round=${round} wpm=${metrics.wpm} words=${metrics.words} fillers=${metrics.fillers}`);
      res.json({ transcript, metrics, ...(grammar !== undefined ? { grammar } : {}) });
    } catch (err) {
      console.error('[fluency] score error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'fluency_failed' });
    }
  });
