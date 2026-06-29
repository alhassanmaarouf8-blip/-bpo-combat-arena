/**
 * shadowing.js — "Shadowing" repeat-after-me practice (PAID feature; mic only, never streaming).
 *
 * Per item: the BROWSER speaks the model German sentence via its built-in speechSynthesis
 * (zero cost, no API), the learner records themselves repeating it, and the server transcribes
 * the clip and returns a DETERMINISTIC word-accuracy score + the exact target words that were
 * not recognised. There is NO model-written "pronunciation" note: the server cannot hear the
 * sound (the transcript erases accent), so it never claims to judge pronunciation. Honest by
 * construction. Adds no new paid API.
 *
 *   GET  /api/shadowing            → { sentences:[{id,de,en}] }  (3–5 per session, paid only)
 *   POST /api/shadowing/score      → raw audio + ?id=&ms= → { transcript, target, match, missed }
 *
 * Gated exactly like other paid features: requireAuth + active plan (planOf !== 'free',
 * which already reverts an expired plan to free). Sessions are unlimited.
 */
import express from 'express';
import { requireAuth, planOf, drillsUnlocked } from './auth.js';
import { BPO_PHRASES }                         from './scenarios.js';
import { transcribeAudio }                     from './planGuide.js';
import { loadUser, saveUser }                  from './store.js';
import { voicedDurationMs }                    from './audioGuard.js';

export const shadowingRouter = express.Router();

const PER_SESSION_MIN = 3;
const PER_SESSION_MAX = 5;

// ── NOVEL phrase generation (Groq chat — same pattern as realtimeClient.js) ───────
// SELF-CONSISTENT BY DESIGN: the learner repeats a phrase, and /score grades word-overlap
// against THAT SAME phrase. So generating fresh phrases is safe — we never grade against a
// phrase the learner wasn't given. Generated phrases get ids ABOVE the fixed indices and the
// EXACT served phrase is persisted per-user (u.shadowingPool), so /score can always resolve
// the target it was spoken — even after the brief generation cache expires or the server restarts.
// FAIL-SAFE: no key / bad JSON / too few items → fall back to the fixed BPO_PHRASES pool.
const GROQ_BASE   = 'https://api.groq.com/openai/v1';
const GEN_MODEL   = process.env.GROQ_INTERVIEW_MODEL || 'llama-3.3-70b-versatile';
const GEN_TTL_MS  = 10 * 60 * 1000;   // cache one generated batch briefly to bound cost
const GEN_ID_BASE = 1_000_000;        // generated-phrase ids live above the fixed BPO_PHRASES indices
const GEN_POOL_CAP = 120;             // bound the per-user persisted phrase map
let _phraseSeq    = GEN_ID_BASE;
let _phraseCache  = { at: 0, items: null };

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

async function generatePhrases() {
  const sys =
    'Du erstellst kurze, vorbildliche deutsche Kundenservice-/Callcenter-Sätze zum Nachsprechen ' +
    '("Shadowing") für angehende BPO-Mitarbeiter. Jeder Satz ist EIN natürlicher, idiomatischer, ' +
    'höflicher Satz in der Sie-Form (Empathie, Deeskalation, Rückfragen, Zusagen, Entschuldigungen, ' +
    'nächste Schritte) — sprechbar in 3-7 Sekunden, grammatisch einwandfrei, ohne Anführungszeichen ' +
    'oder Aufzählungszeichen. Liefere zu jedem Satz eine knappe englische Übersetzung. Variiere stark. ' +
    'Antworte AUSSCHLIESSLICH als JSON: {"phrases":[{"de":"...","en":"..."}, ...]}. KEIN weiterer Text.';
  const user = 'Erzeuge 14 NEUE, abwechslungsreiche Sätze. Keine Wiederholungen.';
  const content = await groqChatJSON([{ role: 'system', content: sys }, { role: 'user', content: user }]);
  const parsed = JSON.parse(content);
  const arr = Array.isArray(parsed) ? parsed : (parsed.phrases || parsed.items || parsed.saetze || []);
  return (Array.isArray(arr) ? arr : [])
    .filter((p) => p && typeof p.de === 'string' && p.de.trim().length > 8 && p.de.trim().length < 200)
    .map((p) => ({ id: _phraseSeq++, de: String(p.de).trim(), en: String(p.en || '').trim() }));
}

// Returns a fresh-ish generated pool (with stable ids), or null to signal "use the fixed pool".
async function getGeneratedPhrases() {
  if (!process.env.GROQ_API_KEY) return null;                       // FAIL-SAFE: no key → fixed pool
  if (_phraseCache.items && Date.now() - _phraseCache.at < GEN_TTL_MS) return _phraseCache.items;
  try {
    const items = await generatePhrases();
    if (items.length >= PER_SESSION_MAX) { _phraseCache = { at: Date.now(), items }; return items; }
    return _phraseCache.items;                                      // too few → keep last good (or null)
  } catch (e) {
    console.error('[shadowing] phrase generation failed:', e.message);
    return _phraseCache.items;                                      // FAIL-SAFE: stale batch or null → fixed
  }
}

// Fixed pool as {id,de,en} (ids = stable BPO_PHRASES indices) — the always-available fallback.
const fixedPool = () => BPO_PHRASES.map((p, i) => ({ id: i, de: p.de, en: p.en }));

// Active-paid gate (basic/elite/admin). planOf() already reverts an expired plan to 'free',
// so an expired subscriber is blocked here automatically. Sends 402 and returns false on block.
function paidOnly(req, res) {
  if (!drillsUnlocked(req.account)) {
    res.status(402).json({ error: 'plan_required', reason: 'shadowing_is_paid' });
    return false;
  }
  return true;
}

// Random subset of a {id,de,en} POOL → [{ id, de, en }]. Each phrase carries an explicit id
// (generated ids live above GEN_ID_BASE, fixed ids are stable BPO_PHRASES indices), so /score
// can resolve the target server-side (never trusts a client-sent sentence) and the seen-list
// stays valid across pools. No-repeat: serve UNSEEN first; reset only when fewer than a session remain.
function pickSentences(pool, n, seen) {
  const idx = pool.map((p) => p.id);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const seenSet = new Set(seen || []);
  let unseen = idx.filter((i) => !seenSet.has(i));
  let reset = false;
  if (unseen.length < n) { unseen = idx; reset = true; }
  const ids = unseen.slice(0, n);
  const byId = new Map(pool.map((p) => [p.id, p]));
  return { ids, reset, sentences: ids.map((i) => ({ id: i, de: byId.get(i).de, en: byId.get(i).en })) };
}

// DETERMINISTIC word accuracy (transcript vs target) — zero cost, no model, no audio analysis.
// HONEST BY CONSTRUCTION: this measures which TARGET WORDS came back in the transcript, i.e.
// WORD ACCURACY — NOT pronunciation/accent. The server never hears the sound, so it never
// claims to judge it. Returns the score plus the exact target words that were not recognised.
function wordAccuracy(transcript, target) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFC')
    .replace(/[^a-zäöüß0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
  const said = new Set(norm(transcript));
  const want = norm(target);
  if (!said.size || !want.length) return { match: 0, missed: [...new Set(want)] };
  const wantSet = [...new Set(want)];
  let hit = 0; const missed = [];
  for (const w of wantSet) { if (said.has(w)) hit++; else missed.push(w); }
  return { match: Math.round((hit / wantSet.size) * 100), missed };
}

// ── GET a fresh session of 3–5 sentences (paid only, unlimited sessions) ──
shadowingRouter.get('/shadowing', requireAuth, async (req, res) => {
  if (!paidOnly(req, res)) return;
  res.set('Cache-Control', 'no-store');
  // Prefer a freshly GENERATED pool (novel each open) + the fixed pool as backstop; fixed-only if no key/gen.
  const gen  = await getGeneratedPhrases().catch(() => null);
  const pool = (gen && gen.length) ? [...gen, ...fixedPool()] : fixedPool();
  const span = PER_SESSION_MAX - PER_SESSION_MIN + 1;
  const n    = Math.min(PER_SESSION_MIN + Math.floor(Math.random() * span), pool.length);
  try {
    const u = await loadUser(req.account.id);
    const seen = Array.isArray(u.shadowingSeen) ? u.shadowingSeen : [];
    const r = pickSentences(pool, n, seen);                 // UNSEEN phrases → never repeat until exhausted
    // Persist the EXACT served generated phrases so /score can grade against the same text later
    // (survives cache expiry + restarts). Fixed-pool phrases need no persistence (BPO_PHRASES has them).
    const map = (u.shadowingPool && typeof u.shadowingPool === 'object' && !Array.isArray(u.shadowingPool)) ? u.shadowingPool : {};
    for (const s of r.sentences) if (s.id >= GEN_ID_BASE) map[s.id] = { de: s.de };
    const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
    while (keys.length > GEN_POOL_CAP) delete map[keys.shift()];   // bound growth: drop oldest ids
    u.shadowingPool = map;
    u.shadowingSeen = r.reset ? r.ids.slice() : [...seen, ...r.ids];
    await saveUser(u);
    return res.json({ sentences: r.sentences });
  } catch {
    return res.json({ sentences: pickSentences(pool, n, []).sentences });
  }
});

// ── POST one recording → transcript + Arabic pronunciation note ──
shadowingRouter.post('/shadowing/score',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    if (!paidOnly(req, res)) return;
    try {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id) || id < 0) {
        return res.status(400).json({ error: 'bad_sentence' });
      }
      // Resolve the target server-side (never trust the client). Fixed ids → BPO_PHRASES;
      // generated ids → the per-user persisted pool (the SAME text the learner was given).
      let target;
      if (id < BPO_PHRASES.length) {
        target = BPO_PHRASES[id].de;
      } else {
        const u = await loadUser(req.account.id).catch(() => null);
        target = u?.shadowingPool?.[id]?.de;
      }
      if (!target) return res.status(400).json({ error: 'bad_sentence' });

      // Edge case: empty / failed recording.
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) {
        return res.status(400).json({ error: 'empty_audio' });
      }
      // HONEST GATE: no real voiced speech → retry, never score a Whisper hallucination of silence.
      if (voicedDurationMs(audio) < 600) return res.json({ transcript: '', target, retry: true, noSpeech: true });
      // 1) transcribe (cheap STT).
      const transcript = (await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' })).trim();

      // Edge case: transcription returned nothing → ask to retry.
      if (!transcript) return res.json({ transcript: '', target, retry: true, noSpeech: true });

      // DETERMINISTIC word accuracy only — NO model, NO pronunciation claim. We report which
      // target words were recognised and which were missed. We deliberately DROPPED the old
      // LLM "Aussprache" note: it judged a sound the server never heard (the transcript erases
      // accent), so any pronunciation verdict it produced was invented. Honest > impressive.
      const { match, missed } = wordAccuracy(transcript, target);

      console.log(`[shadowing] user=${req.account.id} id=${id} accuracy=${match}% missed=${missed.length}`);
      res.json({ transcript, target, match, missed });
    } catch (err) {
      console.error('[shadowing] score error:', err.message);
      const noKey = err.message === 'no_api_key';
      res.status(noKey ? 503 : 500).json({ error: noKey ? 'no_api_key' : 'shadowing_failed' });
    }
  });
