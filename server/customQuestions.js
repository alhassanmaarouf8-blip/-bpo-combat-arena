/**
 * customQuestions.js — "Meine eigenen Fragen": the candidate uploads photos/screenshots of the
 * exact questions they expect at their target employer, a vision model extracts them AS German
 * interview questions, the candidate confirms/edits the list, and the normal voice interview then
 * asks THOSE questions (persona, scoring, debrief all unchanged — only the question source changes).
 *
 *   POST /api/custom-questions/extract   images[] (base64) → { questions:[], note }  (rate-limited)
 *   POST /api/custom-questions           { questions[] }   → save the confirmed set to the profile
 *   GET  /api/custom-questions           → the active set (or null)
 *   DELETE /api/custom-questions         → clear it
 *
 * HONESTY (anti-slop): the extractor NEVER fabricates a question. No questions found → questions:[]
 * + a plain note; the UI must tell the user to type them or upload a clearer image, and no interview
 * ever starts on unconfirmed OCR. The confirm/edit step (client) is mandatory. Raw images are used
 * transiently for extraction and never persisted — only the confirmed text is stored.
 *
 * $0: Gemini vision via the SAME generateContent transport as the TTS path (Vertex $300 credit when
 * configured, else the AI-Studio GEMINI_API_KEY). OFF by default — CUSTOM_QUESTIONS_ENABLED=1 to arm.
 */
import express from 'express';
import { requireAuth, rateLimit, entitlement } from './auth.js';
import { loadUser, mutateUser } from './store.js';
import { vertexConfigured, getVertexAccessToken } from './vertexToken.js';

const ENABLED = process.env.CUSTOM_QUESTIONS_ENABLED === '1';
const VISION_MODEL        = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const VISION_MODEL_VERTEX = process.env.GEMINI_VISION_MODEL_VERTEX || 'gemini-2.5-flash';
const VERTEX_PROJECT  = process.env.GOOGLE_CLOUD_PROJECT  || 'gen-lang-client-0719205380';
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

export const MAX_IMAGES    = 5;
export const MAX_QUESTIONS  = 15;
export const MAX_Q_LEN      = 240;   // one interview question; longer = OCR ran two together / junk
const MAX_IMAGE_BYTES       = 1_600_000;   // ~1.6MB decoded per image (client compresses to ~1MB first)

const VISION_PROMPT =
  'Du bekommst Fotos oder Screenshots, die ein Bewerber gesammelt hat — mögliche Fragen für ein ' +
  'echtes Vorstellungsgespräch (auf Deutsch, Englisch oder Arabisch, als Notiz, Stellenanzeige oder ' +
  'Screenshot). Extrahiere JEDE Interviewfrage aus den Bildern und gib sie als klare, natürliche ' +
  'DEUTSCHE Interviewfrage zurück, so wie ein Personaler sie stellen würde (übersetze Nicht-Deutsches ' +
  'ins Deutsche). Ignoriere alles, was keine Interviewfrage ist (Überschriften, Namen, URLs, Deko). ' +
  'Erfinde NICHTS: Findest du keine Frage, gib eine leere Liste zurück. ' +
  'Antworte AUSSCHLIESSLICH als JSON: {"questions": ["...", "..."], "note": ""}. ' +
  'Höchstens ' + MAX_QUESTIONS + ' Fragen, keine Dubletten.';

// ── Honest parsing/cleaning (the unit-tested core) ──────────────────────────────────────────────
const normWhitespace = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Loose key for near-duplicate detection: lowercased, letters/digits only. */
const dupeKey = (q) => normWhitespace(q).toLowerCase().normalize('NFC').replace(/[^a-zäöüß0-9]/gi, '');

/** Clean, trim, cap-length, drop empties, de-duplicate (near-dupes) and cap the count of a list. */
export function sanitizeQuestions(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    let q = normWhitespace(raw);
    if (!q) continue;
    if (q.length > MAX_Q_LEN) q = q.slice(0, MAX_Q_LEN).trim();
    // A real question has at least a few word-characters; kill single-token OCR noise.
    if ((q.match(/[a-zäöüß]/gi) || []).length < 3) continue;
    const k = dupeKey(q);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/**
 * Turn the vision model's raw response text into a clean, honest result. Tolerant of ```json fences
 * and of a model that answered with a bare array or plain lines. NEVER invents a question.
 * @returns {{ questions: string[], note: string }}
 */
export function parseVisionQuestions(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) return { questions: [], note: '' };

  let questions = null;
  let note = '';
  // 1) Preferred: JSON object/array (strip a ```json … ``` fence if present).
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const j = JSON.parse(unfenced);
    if (Array.isArray(j)) questions = j;
    else if (j && typeof j === 'object') {
      if (Array.isArray(j.questions)) questions = j.questions;
      if (typeof j.note === 'string') note = normWhitespace(j.note);
    }
  } catch { /* fall through to line parsing */ }

  // 2) Fallback: the model returned plain/numbered lines instead of JSON.
  if (questions == null) {
    questions = unfenced.split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
  }

  const cleaned = sanitizeQuestions(questions);
  return { questions: cleaned, note: cleaned.length ? note : note };
}

// ── Vision call ($0; same generateContent transport as the TTS path) ────────────────────────────
function decodeImage(entry) {
  // Accept either a bare base64 string or a data: URL; return { mimeType, data(base64) } or null.
  const s = String(entry ?? '');
  let mimeType = 'image/jpeg';
  let data = s;
  const m = s.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (m) { mimeType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase(); data = m[2]; }
  data = data.trim();
  if (!data) return null;
  // Size guard (base64 length ≈ bytes × 4/3).
  if (data.length > MAX_IMAGE_BYTES * 1.4) return null;
  return { mimeType, data };
}

export async function extractQuestionsFromImages(images) {
  const parts = [{ text: VISION_PROMPT }];
  let usable = 0;
  for (const img of (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES)) {
    const d = decodeImage(img);
    if (!d) continue;
    parts.push({ inlineData: { mimeType: d.mimeType, data: d.data } });
    usable++;
  }
  if (!usable) return { questions: [], note: 'no_image' };

  // No responseMimeType JSON constraint: schema-mode adds latency and can stall vision requests
  // (30s-timeout observed on Vertex). We ask for JSON in the prompt and parse fences/plain lines
  // ourselves (parseVisionQuestions), which is both faster and more robust.
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  };

  let url, headers, via;
  if (vertexConfigured()) {
    const token = await getVertexAccessToken();
    url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}`
        + `/locations/${VERTEX_LOCATION}/publishers/google/models/${VISION_MODEL_VERTEX}:generateContent`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    via = `vertex/${VISION_MODEL_VERTEX}`;
  } else {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('no_vision_credentials');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${key}`;
    headers = { 'Content-Type': 'application/json' };
    via = `aistudio/${VISION_MODEL}`;
  }

  const t0 = Date.now();
  console.log(`[customQuestions] vision call via ${via}  images=${usable}`);
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(75_000) });
  if (!r.ok) throw new Error(`vision ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const j = await r.json();
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const out = parseVisionQuestions(raw);
  console.log(`[customQuestions] vision ok via ${via}  ${Date.now() - t0}ms  questions=${out.questions.length}`);
  return out;
}

// ── Router ───────────────────────────────────────────────────────────────────────────────────────
export const customQuestionsRouter = express.Router();

// Trial-included AND paid, never expired-trial-free (spec §1): entitlement().drillsUnlocked is
// exactly planOf!=='free' || trialActive. Single enforcement point for the whole feature.
function gate(req, res, next) {
  if (!ENABLED) return res.status(503).json({ error: 'feature_disabled' });
  if (!entitlement(req.account).drillsUnlocked) return res.status(402).json({ error: 'upgrade_required' });
  next();
}

customQuestionsRouter.post('/custom-questions/extract',
  requireAuth, gate,
  express.json({ limit: '12mb' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, tag: 'cq-extract', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const images = Array.isArray(req.body?.images) ? req.body.images : [];
      if (!images.length) return res.status(400).json({ error: 'no_images' });
      const result = await extractQuestionsFromImages(images);
      // Honest: the raw images are NOT stored; only the extracted text goes back to the client to confirm.
      return res.json({ questions: result.questions, note: result.note || '' });
    } catch (err) {
      console.error('[customQuestions] extract failed:', err.message);
      const code = err.message === 'no_vision_credentials' ? 503 : 502;
      return res.status(code).json({ error: 'extract_failed' });
    }
  });

customQuestionsRouter.post('/custom-questions',
  requireAuth, gate, express.json({ limit: '256kb' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, tag: 'cq-save', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const questions = sanitizeQuestions(req.body?.questions);
      if (!questions.length) return res.status(400).json({ error: 'no_questions' });
      const set = { questions, createdAt: Date.now() };
      await mutateUser(req.account.id, (profile) => ({ value: { ...profile, customQuestionSet: set } }));
      console.log(`[customQuestions] set saved  user=${req.account.id}  n=${questions.length}`);
      return res.json({ ok: true, count: questions.length, createdAt: set.createdAt });
    } catch (err) {
      console.error('[customQuestions] save failed:', err.message);
      return res.status(500).json({ error: 'save_failed' });
    }
  });

customQuestionsRouter.get('/custom-questions',
  requireAuth, gate,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120, tag: 'cq-get', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const profile = await loadUser(req.account.id);
      const set = profile?.customQuestionSet || null;
      return res.json({ set: set && Array.isArray(set.questions) && set.questions.length ? set : null });
    } catch (err) {
      console.error('[customQuestions] get failed:', err.message);
      return res.status(500).json({ error: 'get_failed' });
    }
  });

customQuestionsRouter.delete('/custom-questions',
  requireAuth, gate,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 60, tag: 'cq-del', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await mutateUser(req.account.id, (profile) => ({ value: { ...profile, customQuestionSet: null } }));
      return res.json({ ok: true });
    } catch (err) {
      console.error('[customQuestions] delete failed:', err.message);
      return res.status(500).json({ error: 'delete_failed' });
    }
  });

export default { customQuestionsRouter, parseVisionQuestions, sanitizeQuestions, extractQuestionsFromImages,
  MAX_IMAGES, MAX_QUESTIONS, ENABLED };
