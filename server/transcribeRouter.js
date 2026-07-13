/**
 * transcribeRouter.js — spoken-answer speech-to-text for the live interview.
 *
 * The interview is turn-based and text-driven: the candidate may TYPE an answer
 * (sent straight over the WebSocket) or SPEAK it. A spoken clip is POSTed here as
 * the raw audio body and converted to German text, which the client then sends as a
 * normal `answer` turn. Audio travels over HTTP — never the WebSocket (64 KB frames).
 *
 * 100% OpenAI-free and zero extra dependencies: no `openai` SDK, no `multer`. The raw
 * body is read with express.raw(); Groq Whisper is called over plain fetch. Default
 * engine is Groq Whisper (whisper-large-v3); set TRANSCRIBER=deepgram to use Deepgram.
 */

import express from 'express';
import { getAccountById, dailyMinutesFor, drillsUnlocked, requireAuth, rateLimit } from './auth.js';
import { activeFightUsers } from './liveFights.js';
import { voicedDurationMs } from './audioGuard.js';
import { expandForSpeechDE } from './speechExpandDE.js';
import { mintMediaTicket, consumeMediaTicket } from './mediaTickets.js';
import { vertexConfigured, getVertexAccessToken } from './vertexToken.js';

const router = express.Router();

const GROQ_BASE             = 'https://api.groq.com/openai/v1';
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'deepgram').toLowerCase();

// ── Boss voice: Deepgram Aura-2 German TTS (uses the existing DEEPGRAM_API_KEY) ──
// Neural, natural German; no OpenAI, no new key. The client falls back to the free
// browser voice if this is unavailable. Audio is returned as MP3 for easy playback.
const DG_SPEAK_URL  = 'https://api.deepgram.com/v1/speak';
const AURA_DE_VOICES = new Set([
  'aura-2-julius-de', 'aura-2-fabian-de',                       // masculine
  'aura-2-lara-de', 'aura-2-elara-de', 'aura-2-aurelia-de',     // feminine
  'aura-2-kara-de', 'aura-2-viktoria-de',
]);
const DEFAULT_VOICE = 'aura-2-julius-de';

// ── Salma's Egyptian voice: Gemini-TTS steered to Cairo masri ─────────────────────
// The recruiter speaks masri, not German — and the ENGINE decides "Egyptian" more than the text
// does: the owner's own ear ranked Gemini-TTS above Azure ar-EG and ElevenLabs on the Sara
// compare page (2026-07-07), and GEMINI_API_KEY already lives on this server. Whole-clip synth
// (no streaming) wrapped in a WAV header; her lines are short and fixed, so the shared TTS cache
// makes every replay instant and free. The dialect-steering prefix is copied VERBATIM from the
// owner-approved Sara implementation (never authored here, never rendered to a learner).
const SALMA_MASRI_VOICE = 'salma-masri';
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
// Vertex AI transport for TTS: when GEMINI_USE_VERTEX=1 + creds exist, the SAME generateContent
// call bills the $300 GCP credit (project) instead of the AI Studio key (owner's card). Vertex
// publisher-model ids can differ from AI Studio's — override with GEMINI_TTS_MODEL_VERTEX if the
// default 404s (mirrors the live model needing an explicit id, not the `-latest` alias).
const GEMINI_TTS_MODEL_VERTEX = process.env.GEMINI_TTS_MODEL_VERTEX || GEMINI_TTS_MODEL;
const VERTEX_PROJECT  = process.env.GOOGLE_CLOUD_PROJECT  || 'gen-lang-client-0719205380';
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const MASRI_STYLE = 'اقري الجملة دي بصوت دافي وودود بلهجة مصرية قاهرية أصيلة تماماً — زي موظفة استقبال مصرية بجد، ' +
  'الجيم تتنطق مصري زي «جنيه/جمب» (مش جيم فصحى) والقاف مهموزة: ';
// Salma's GERMAN lines (what she speaks until the owner fills a row's masri) run on the SAME Gemini
// engine + SAME Kore voice as her masri — steered warm/human in German — instead of Deepgram Aura-2.
// Owner ear 07-12: Aura-2 = "robotic, low, unhuman, predictable"; he chose Gemini on the compare
// page. One consistent Salma voice across both languages, normalized loud (pcmToLoudWav), cached→free.
const SALMA_DE_VOICE = 'salma-de';
// Owner 07-12: "she has to talk like a GENUINE human, not just read what's there / like Google read."
// So the style demands SPOKEN conversation, not narration — living intonation + small natural pauses.
const DE_WARM_STYLE = 'Sprich den folgenden Satz so, wie eine echte, herzliche Personalvermittlerin '
  + 'ihn frei im Gespräch sagen würde: warm, natürlich und ermutigend, mit lebendiger Betonung und '
  + 'kleinen natürlichen Pausen. Rede mit dem Kandidaten, lies nicht vor, klinge nie roboterhaft. '
  + 'Sprich ausschließlich den eigentlichen Satz, keinerlei Symbole oder Zeichen: ';

// ── ElevenLabs Turbo v2.5 — OPT-IN boss voice (native German; same price as Flash, more natural) ──
// Turbo v2.5 = 0.5 credits/char, identical to Flash, but higher German naturalness (ElevenLabs blog).
// Only used when USE_ELEVENLABS=1; default voice path is native-German Deepgram Aura-2.
const ELEVEN_BASE  = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVEN_MODEL = 'eleven_turbo_v2_5';
// Conversational, non-robotic settings. Baseline is livelier than before (lower stability = more
// intonation/emotional range). CONTEXT-AWARE: the interviewer's felt state this turn (decided by the
// backend — composed / impressed / skeptical / cornered) shapes HOW it sounds, so its inner awareness is
// HEARD, not just shown on its face. Lower stability → more expressive/dynamic; higher style → warmer/
// more coloured. Kept within a sane band so a structured interview never goes erratic.
const ELEVEN_VOICE_SETTINGS = { stability: 0.40, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true };
const ELEVEN_EMOTION_SETTINGS = {
  gefasst:     { stability: 0.42, similarity_boost: 0.75, style: 0.33, use_speaker_boost: true },  // composed, even
  beeindruckt: { stability: 0.30, similarity_boost: 0.78, style: 0.48, use_speaker_boost: true },  // impressed → warm, open
  skeptisch:   { stability: 0.55, similarity_boost: 0.72, style: 0.22, use_speaker_boost: true },  // skeptical → cooler, drier, controlled
  wuetend:     { stability: 0.26, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true },  // cornered → sharp, intense, dynamic
};
// Map the felt state → voice settings (falls back to the neutral baseline for anything unknown).
function voiceSettingsFor(emotion) {
  return ELEVEN_EMOTION_SETTINGS[String(emotion || '').toLowerCase()] || ELEVEN_VOICE_SETTINGS;
}
// NATIVE GERMAN shared-library voices (replaces the old English defaults that made German sound robotic).
// NOTE: these IDs are MEDIUM-confidence (shared library can change); if one is invalid the endpoint
// 502s and the client falls back to native-German Deepgram Aura-2 — so the voice is never robotic-English.
const ELEVEN_VOICES = new Set([
  'Ah5UjbC5d1A2iCl9Lbe7', 'oNs4CSS4LR7hEoEykuS5', 'VGPs8uAVxETgmG3lNnZD',  // female: Anna, Rebecca, Cornelia
  'gRJR8Fqocw86Vixo4cZV', 'hJAaR77ekN23CNyp0byH', 'vjMckQpQGHArc0Q8xmo6',  // male: Benjamin, Alexander, Florian
]);
const DEFAULT_ELEVEN_VOICE = 'Ah5UjbC5d1A2iCl9Lbe7';
const ELEVEN_VOICE_ACCOUNT_IDS = new Set(String(process.env.ELEVEN_VOICE_ACCOUNT_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean));
const elevenVoiceAllowed = (account) => process.env.USE_ELEVENLABS === '1'
  && !!process.env.ELEVENLABS_API_KEY && ELEVEN_VOICE_ACCOUNT_IDS.has(account?.id);

// ── Clean text for natural TTS (both engines) ────────────────────────────────────
// A voice must SPEAK the meaning, never READ characters aloud (owner 07-12: "she reads * / like
// Google read — she has to talk like a GENUINE human"). So we delete everything non-verbal BEFORE
// synthesis — deterministically, never trusting the TTS prompt (foot-gun #17): emoji/pictographs,
// "other symbols" (arrows, bullets, ✓, ™…), markdown, and stray formatting; and we turn typographic
// punctuation a robot verbalizes ("Sternchen", "Schrägstrich", "dot dot dot") into natural pauses.
// Non-ASCII targets are built from char codes / \p{} escapes on purpose — typing the literal glyphs
// or \u ranges here can emit raw bytes and NUL-corrupt this file (foot-gun #48/#49).
const _RE_PICTO = /[\p{Extended_Pictographic}\p{So}]/gu;                 // emoji, arrows, dingbats, misc symbols
const _RE_JOINERS = new RegExp('[' + String.fromCharCode(0x200D, 0x200C, 0xFE0F) + ']', 'g');  // ZWJ/ZWNJ/VS16
const _RE_PAUSE = new RegExp('[' + String.fromCharCode(0x2014, 0x2013, 0x2012, 0x2026) + ']', 'g'); // — – ‒ … → pause
const _RE_DROP  = new RegExp('[' + String.fromCharCode(0x00B7, 0x2022, 0x2027, 0x00AB, 0x00BB, 0x201C, 0x201D, 0x2018, 0x2019) + ']', 'g'); // · • ‧ « » " " ' '
function stripNonSpoken(s) {
  return String(s || '').trim()
    .replace(/\[[^\]]*\]/g, ' ')          // [seufzt]/[laughs]/[warmly] stage tags (v3-only; read aloud on turbo/flash)
    .replace(_RE_PICTO, ' ')
    .replace(_RE_JOINERS, '')
    .replace(/[*_#`>|~^]/g, '')            // markdown symbols
    .replace(_RE_PAUSE, ', ')              // em/en dash + ellipsis → a natural comma-pause, never "dash"/"dot dot dot"
    .replace(_RE_DROP, '')                 // bullets + typographic quotes → gone
    .replace(/\s*\/\s*/g, ' ')             // slash → space, never "Schrägstrich"
    .replace(/\s+([,.!?;:])/g, '$1')       // no space before punctuation our inserts created
    .replace(/,\s*(?=[,.!?])/g, '')        // collapse doubled pause punctuation
    .replace(/\s{2,}/g, ' ')
    .trim();
}
// Expands digits/€/times/abbreviations into spoken German (ROADMAP #20 — the engine must never
// decide how "19,99 €" sounds), then guarantees terminal punctuation for a natural final breath.
export function cleanForTTS(s) {
  let t = expandForSpeechDE(stripNonSpoken(s));
  t = t.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}
// Arabic twin for Salma's masri lines: same non-verbal scrub, but SKIPS expandForSpeechDE — running
// German number/abbreviation expansion inside Arabic prose would splice German words into her masri.
// Gemini-TTS reads digits in dialect context itself.
export function cleanForTTSAr(s) {
  return stripNonSpoken(s).replace(/[,\s]+$/, '').trim();
}
// In-memory MP3 cache keyed by voiceId+text. A character's OPENING line is identical
// every interview → generated once, then replayed instantly and for free. Dynamic
// follow-ups are unique → always live. Per server instance.
const _ttsCache = new Map();
const MAX_TTS_CACHE = 200;
const MAX_TTS_CACHE_BYTES = 32 * 1024 * 1024;
let _ttsCacheBytes = 0;
const ttsUsage = new Map();
const transcribeInFlight = new Set();

function ttsCacheGet(key) {
  const hit = _ttsCache.get(key);
  if (!hit) return null;
  _ttsCache.delete(key);
  _ttsCache.set(key, hit);
  return hit;
}

function ttsCachePut(key, value) {
  if (!Buffer.isBuffer(value) || value.length > MAX_TTS_CACHE_BYTES) return;
  const prior = _ttsCache.get(key);
  if (prior) _ttsCacheBytes -= prior.length;
  _ttsCache.delete(key);
  while (_ttsCache.size >= MAX_TTS_CACHE || _ttsCacheBytes + value.length > MAX_TTS_CACHE_BYTES) {
    const oldest = _ttsCache.keys().next().value;
    if (oldest === undefined) break;
    const removed = _ttsCache.get(oldest);
    _ttsCache.delete(oldest);
    _ttsCacheBytes -= removed?.length || 0;
  }
  _ttsCache.set(key, value);
  _ttsCacheBytes += value.length;
}

// Reserve provider characters before issuing a short-lived media ticket. Repeated
// unused tickets still consume quota, so account automation cannot mint around caps.
function reserveTts(userId, chars) {
  const day = new Date().toISOString().slice(0, 10);
  const userCap = Math.max(1000, parseInt(process.env.TTS_USER_DAILY_CHAR_CAP || '15000', 10));
  const globalCap = Math.max(userCap, parseInt(process.env.TTS_GLOBAL_DAILY_CHAR_CAP || '150000', 10));
  const globalKey = `global:${day}`, userKey = `${userId}:${day}`;
  const global = ttsUsage.get(globalKey) || 0, user = ttsUsage.get(userKey) || 0;
  if (global + chars > globalCap || user + chars > userCap) return false;
  ttsUsage.set(globalKey, global + chars); ttsUsage.set(userKey, user + chars);
  if (ttsUsage.size > 5000) for (const key of ttsUsage.keys()) if (!key.endsWith(day)) ttsUsage.delete(key);
  return true;
}

router.post('/media-ticket', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 600, tag: 'media-ticket-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 180, tag: 'media-ticket-account',
              keyExtra: (req) => req.account.id, accountOnly: true }), (req, res) => {
  const kind = req.body?.kind === 'eleven' ? 'eleven' : 'aura';
  const wantsMasri = kind === 'aura' && req.body?.voice === SALMA_MASRI_VOICE;
  const wantsSalmaDe = kind === 'aura' && req.body?.voice === SALMA_DE_VOICE;   // her German on Gemini
  const raw = String(req.body?.text || '').slice(0, 600);
  const text = wantsMasri ? cleanForTTSAr(raw) : cleanForTTS(raw);
  if (!text) return res.status(400).json({ error: 'missing_text' });
  const drill = req.body?.drill === true;
  // Salma is the AGENCY's own voice, not gated learner content — and the trial clock only starts
  // at the FIRST interview (consumeFreeFight), so a plan gate here silenced her cold-open for
  // every fresh account and her paywall pitch after trial expiry (probe-proven 402, 07-12).
  // Exempt exactly her two voices: short fixed lines, server-cached, still inside reserveTts and
  // the per-account ticket rate limits.
  const salmaTicket = req.body?.salma === true && kind === 'aura' && text.length <= 320
    && (wantsMasri || wantsSalmaDe || req.body?.voice === 'aura-2-kara-de');
  if (drill && !salmaTicket && !drillsUnlocked(req.account)) return res.status(402).json({ error: 'plan_required' });
  if (kind === 'eleven' && !elevenVoiceAllowed(req.account)) return res.status(403).json({ error: 'voice_not_enabled' });
  if (!drill && dailyMinutesFor(req.account) <= 0 && !activeFightUsers.has(req.account.id)) {
    return res.status(402).json({ error: 'daily_limit' });
  }
  if (!reserveTts(req.account.id, text.length)) return res.status(429).json({ error: 'voice_daily_limit' });
  const voice = kind === 'eleven'
    ? (ELEVEN_VOICES.has(req.body?.voice) ? req.body.voice : DEFAULT_ELEVEN_VOICE)
    : wantsMasri ? SALMA_MASRI_VOICE
      : wantsSalmaDe ? SALMA_DE_VOICE
      : (AURA_DE_VOICES.has(req.body?.voice) ? req.body.voice : DEFAULT_VOICE);
  const emotion = String(req.body?.emotion || '').slice(0, 24);
  const ticket = mintMediaTicket({ kind, userId: req.account.id, text, voice, emotion, drill });
  res.set('Cache-Control', 'no-store');
  res.json({ ticket, expiresIn: 60 });
});
const _cacheKey = (voice, text) => `${voice}\0${text}`;

async function groqTranscribe(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  // Native FormData/Blob (Node 20) → multipart, sent over fetch. No SDK needed.
  const ext = (mimeType.split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `answer.${ext}`);
  fd.append('model', GROQ_TRANSCRIBE_MODEL);
  fd.append('language', 'de');
  fd.append('response_format', 'text');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    fd,
    signal:  AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq STT ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.text()).trim();   // response_format 'text' → plain transcript
}

async function transcribe(buffer, mimeType) {
  // Default engine: Deepgram nova-3 (de) — markedly better on Arabic-accented German
  // than Whisper (which mangled "bereit"→"traurig" etc.). If Deepgram errors (outage/
  // key) or returns nothing, fall back to Groq Whisper so an answer is NEVER silently
  // lost. Override the default with TRANSCRIBER=groq.
  if (TRANSCRIBER !== 'groq') {
    try {
      const { transcribeDeepgram } = await import('./transcribeDeepgram.js');
      const text = await transcribeDeepgram(buffer, { language: 'de', model: 'nova-3', contentType: mimeType });
      if (text && text.trim()) return text.trim();
      throw new Error('deepgram returned empty transcript');
    } catch (err) {
      console.error(`[transcribeRouter] Deepgram nova-3 failed → Groq Whisper fallback: ${err.message}`);
      return groqTranscribe(buffer, mimeType);
    }
  }
  return groqTranscribe(buffer, mimeType);
}

// Raw audio body (no multer): the client POSTs the clip bytes with an audio/* type.
router.post('/transcribe',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 300, tag: 'transcribe-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, tag: 'transcribe-account',
              keyExtra: (req) => req.account.id, accountOnly: true }),
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '4mb' }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const account = req.account;
    if (dailyMinutesFor(account) <= 0 && !activeFightUsers.has(account.id)) return res.status(402).json({ error: 'daily_limit' });
    if (transcribeInFlight.has(account.id)) return res.status(409).json({ error: 'transcribe_in_progress' });

    const buffer = req.body;
    if (!buffer || !buffer.length) return res.status(400).json({ error: 'missing_audio' });
    const mimeType = (req.headers['content-type'] || 'audio/wav').toString();
    // HONEST GATE: no real voiced speech → empty text, so the interview never scores a Whisper
    // hallucination of silence as if the candidate answered. Detect WAV by the actual RIFF header
    // bytes, NOT the (spoofable / sometimes-octet-stream) content-type label — so a mislabeled silent
    // WAV can't bypass. The shipped client always sends WAV (clipRecorder), so this covers the real path.
    const looksWav = buffer.length > 44 && buffer.toString('latin1', 0, 4) === 'RIFF';
    if (looksWav && voicedDurationMs(buffer) < 600) return res.json({ text: '' });

    transcribeInFlight.add(account.id);
    try {
      const text = await transcribe(buffer, mimeType);
      console.log(`[cost] stt engine=${TRANSCRIBER} bytes=${buffer.length} transcriptChars=${(text || '').length}`);
      return res.json({ text: text || '' });
    } catch (err) {
      console.error(`[transcribeRouter] failed user=${account.id}: ${err.message}`);
      return res.status(502).json({ error: 'transcribe_failed' });
    } finally {
      transcribeInFlight.delete(account.id);
    }
  }
);

// Peak-normalize raw Int16LE mono PCM and wrap it in a 44-byte WAV header. This is the RELIABLE
// volume fix: Aura-2's raw output is quiet, so we scale every sample so the loudest peak sits at
// ~0.95 full-scale — as loud as possible with ZERO clipping/distortion (a gain cap stops near-silence
// from being blown up into noise). Done server-side so it works on every device, no client Web Audio.
function pcmToLoudWav(pcm, sampleRate = 24000) {
  const n = Math.floor(pcm.length / 2);
  // CLEAN peak-normalization ONLY — scale so the loudest sample sits at 0.97 full-scale. This is
  // mathematically distortion-FREE (a pure linear scale, never saturates), so it can NEVER sound
  // robotic. It makes the voice as loud as it can be WITHOUT changing its character. (Aura-2's
  // perceived loudness ceiling is then what it is — a free neural voice; louder-AND-natural needs a
  // different provider, which costs money. No DSP trick gets loud + clean + free.)
  if (n > 0) {
    let peak = 1;
    for (let i = 0; i < n; i++) { const s = Math.abs(pcm.readInt16LE(i * 2)); if (s > peak) peak = s; }
    const gain = Math.min((0.97 * 32767) / peak, 4);
    if (gain > 1.01) {
      for (let i = 0; i < n; i++) {
        let v = Math.round(pcm.readInt16LE(i * 2) * gain);
        v = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        pcm.writeInt16LE(v, i * 2);
      }
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ── Boss voice: POST /api/tts { text, voice? } → loud, normalized German WAV (Deepgram Aura-2) ─────
// Returns audio/wav on success. On any failure (no key, Deepgram error) returns a
// non-2xx JSON so the client cleanly falls back to the free browser voice.
router.post('/tts', requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 300, tag: 'legacy-tts-ip' }),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, tag: 'legacy-tts-account',
              keyExtra: (req) => req.account.id, accountOnly: true }),
  express.json({ limit: '16kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (process.env.ENABLE_LEGACY_TTS !== '1') return res.status(404).json({ error: 'not_found' });

  const account = req.account;
  if (dailyMinutesFor(account) <= 0 && !activeFightUsers.has(account.id)) return res.status(402).json({ error: 'daily_limit' });

  const text = cleanForTTS((req.body?.text ?? '').toString().slice(0, 1500));
  if (!text) return res.status(400).json({ error: 'missing_text' });
  const voice = AURA_DE_VOICES.has(req.body?.voice) ? req.body.voice : DEFAULT_VOICE;
  if (!reserveTts(account.id, text.length)) return res.status(429).json({ error: 'voice_daily_limit' });

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.status(503).json({ error: 'tts_unavailable' });   // client → browser voice

  try {
    // Raw PCM (not mp3) so we can peak-normalize the amplitude server-side, then wrap as WAV.
    const r = await fetch(`${DG_SPEAK_URL}?model=${voice}&encoding=linear16&sample_rate=24000`, {
      method:  'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  AbortSignal.timeout(25_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[tts] Deepgram ${r.status}: ${body.slice(0, 200)}`);
      return res.status(502).json({ error: 'tts_failed' });
    }
    const pcm = Buffer.from(await r.arrayBuffer());
    const wav = pcmToLoudWav(pcm, 24000);   // amplify to ~0.95 full-scale → as loud as possible, no clipping
    res.set('Content-Type', 'audio/wav');
    return res.send(wav);
  } catch (err) {
    console.error(`[tts] failed user=${account.id}: ${err.message}`);
    return res.status(502).json({ error: 'tts_failed' });
  }
});

// One Gemini-TTS call, steered by `style` (Cairo-masri for her Arabic, warm-German for her German) —
// SAME Kore voice either way, so Salma sounds like ONE person across both languages.
async function geminiTTS(text, style) {
  // role:'user' is REQUIRED by Vertex ("Please use a valid role") and accepted by AI Studio — so
  // one body works on both transports (probe-verified 2026-07-13, tts-vertex-proof.test.mjs).
  const body = { contents: [{ role: 'user', parts: [{ text: style + text }] }],
    generationConfig: { responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } } } };

  // Vertex first when configured (bills the $300 GCP credit, not the card); same generateContent
  // body, but the model is a publisher path and auth is a Bearer token, not a `?key=` query param.
  // Falls through to the AI Studio key path otherwise — identical contract, so callers don't change.
  let url, headers;
  if (vertexConfigured()) {
    const token = await getVertexAccessToken();
    url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}`
        + `/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_TTS_MODEL_VERTEX}:generateContent`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  } else {
    const key = process.env.GEMINI_API_KEY;
    url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${key}`;
    headers = { 'Content-Type': 'application/json' };
  }

  const r = await fetch(url, { method: 'POST', headers,
    body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`gemini tts ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const j = await r.json();
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('gemini tts: no audio in response');
  // Same peak-normalization as every boss voice — Gemini's raw PCM is quiet (owner ear-check
  // 07-12: "very low"); pcmToLoudWav scales to ~0.97 full-scale, distortion-free, and wraps WAV.
  return pcmToLoudWav(Buffer.from(part.inlineData.data, 'base64'));
}
const geminiMasriTTS = (text) => geminiTTS(text, MASRI_STYLE);
const geminiGermanTTS = (text) => geminiTTS(text, DE_WARM_STYLE);

// ── GET /api/tts-stream — Deepgram Aura-2 STREAMING boss voice (the DEFAULT, free) ─────────────────
// Measured: Aura emits its first audio bytes ~350ms after the request, but the whole clip takes up to
// ~6s to fully synthesize for a long line. The buffered POST /api/tts waits for the WHOLE clip before
// the user hears anything — that buffer wait WAS the dead air. This GET streams Deepgram's MP3 chunks
// straight to a progressive <audio> element (sound starts at ~350ms), exactly like /api/voice does for
// ElevenLabs. We drop the server-side peak-normalization because it was a no-op anyway: Aura-2 already
// outputs at ~100% full-scale (measured), so its gain computed to ~0.97x — i.e. it changed nothing.
// Fixed lines (openings) are teed into the same cache → instant + free replay.
router.get('/tts-stream', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const media = consumeMediaTicket(req.query.ticket, 'aura');
  if (!media) return res.status(401).json({ error: 'invalid_or_expired_ticket' });
  const account = await getAccountById(media.userId);
  if (!account) return res.status(401).json({ error: 'invalid_account' });
  // Drills are UNLIMITED and must not consume interview minutes — so drill audio (drill=1) skips the
  // daily-minute gate (still auth-gated). This lets Shadowing / Hör-Check / the Druck-Leiter model lines
  // use the native Aura-2 voice even when the learner's interview minutes are used up. Cached → $0.
  const isDrill = media.drill;
  if (!isDrill && dailyMinutesFor(account) <= 0 && !activeFightUsers.has(account.id)) return res.status(402).json({ error: 'daily_limit' });

  const text = media.text;
  const voice = media.voice;

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.status(503).json({ error: 'tts_unavailable' });   // client → buffered fallback

  // Cache hit (fixed lines like the opening) → instant + free, no API call. Keyed under a distinct
  // prefix so a streamed MP3 is never confused with the ElevenLabs MP3 cache for the same text.
  const ck = _cacheKey('aura-stream:' + voice, text);
  const hit = ttsCacheGet(ck);
  if (hit) {
    console.log(`[cost] tts-stream cache=HIT voice=${voice} chars=${text.length}`);
    res.set('Content-Type', (voice === SALMA_MASRI_VOICE || voice === SALMA_DE_VOICE) ? 'audio/wav' : 'audio/mpeg');
    return res.send(hit);
  }
  console.log(`[cost] tts-stream cache=MISS voice=${voice} chars=${text.length}`);

  // Salma's OWN voice (masri OR her warm German) → Gemini-TTS, whole clip. No streaming — her lines
  // are 1–3 short sentences and every repeat is a cache hit above. Missing key → 503 so the client
  // applies the native-or-silence law (never a robotic fallback voice), same contract as Deepgram below.
  if (voice === SALMA_MASRI_VOICE || voice === SALMA_DE_VOICE) {
    if (!process.env.GEMINI_API_KEY && !vertexConfigured()) return res.status(503).json({ error: 'tts_unavailable' });
    try {
      const wav = await (voice === SALMA_MASRI_VOICE ? geminiMasriTTS(text) : geminiGermanTTS(text));
      res.set('Content-Type', 'audio/wav');
      res.send(wav);
      ttsCachePut(ck, wav);
    } catch (err) {
      console.error(`[tts-stream] gemini masri failed user=${account.id}: ${err.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'tts_failed' });
    }
    return;
  }

  // 25s hard timeout: if Deepgram hangs mid-stream, abort so res.end() fires and the browser's
  // <audio> gets onerror instead of sitting in 'stalled' forever (same guard as /api/voice).
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(new Error('Deepgram stream timeout')), 25000);
  try {
    // MP3 (Deepgram's default container) so the browser <audio> can play it progressively. linear16
    // raw PCM can't be streamed to <audio> without a length-prefixed WAV header; MP3 streams natively.
    const r = await fetch(`${DG_SPEAK_URL}?model=${voice}`, {
      method:  'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
      signal:  ctrl.signal,
    });
    if (!r.ok || !r.body) {
      clearTimeout(abortTimer);
      const body = await (r.text?.().catch(() => '') ?? Promise.resolve(''));
      console.error(`[tts-stream] Deepgram ${r.status}: ${String(body).slice(0, 200)}`);
      return res.status(502).json({ error: 'tts_failed' });
    }
    res.set('Content-Type', 'audio/mpeg');
    const chunks = [];
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      chunks.push(buf);
      res.write(buf);
    }
    clearTimeout(abortTimer);
    res.end();
    ttsCachePut(ck, Buffer.concat(chunks));
  } catch (err) {
    clearTimeout(abortTimer);
    console.error(`[tts-stream] failed user=${account.id}: ${err.message}`);
    if (!res.headersSent) return res.status(502).json({ error: 'tts_failed' });
    try { res.end(); } catch {}
  }
});

// ── GET /api/voice — ElevenLabs Flash v2.5 streaming boss voice ────────────────
// GET so the browser <audio> element streams it progressively (sound starts before the
// full clip is ready). A one-use, 60-second scoped ticket is carried in the query. Streams ElevenLabs chunks
// straight to the client AND tees them into the cache so fixed lines (openings) replay
// instantly + free. On any failure the client falls back to the Deepgram neural voice.
router.get('/voice', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const media = consumeMediaTicket(req.query.ticket, 'eleven');
  if (!media) return res.status(401).json({ error: 'invalid_or_expired_ticket' });
  const account = await getAccountById(media.userId);
  if (!account) return res.status(401).json({ error: 'invalid_account' });
  if (!elevenVoiceAllowed(account)) return res.status(403).json({ error: 'voice_not_enabled' });
  if (dailyMinutesFor(account) <= 0 && !activeFightUsers.has(account.id)) return res.status(402).json({ error: 'daily_limit' });

  const text = media.text;
  const voice = media.voice;
  const emotion = media.emotion;

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ error: 'tts_unavailable' });   // client → Deepgram fallback

  // Cache hit (fixed lines like the opening) → instant + free, no API call. Keyed by emotion too, so
  // the same line spoken "impressed" vs "cornered" caches (and sounds) distinct.
  const ck = _cacheKey(voice + ':' + emotion, text);
  const hit = ttsCacheGet(ck);
  if (hit) {
    console.log(`[cost] tts cache=HIT voice=${voice} chars=${text.length}`);
    res.set('Content-Type', 'audio/mpeg');
    return res.send(hit);
  }
  console.log(`[cost] tts cache=MISS voice=${voice} chars=${text.length}`);   // billed ElevenLabs chars

  // 25s hard timeout: if ElevenLabs hangs mid-stream the response is never ended, the
  // browser <audio> element sits in 'stalled' and never fires onended → bossSpeak stuck.
  // Abort forces the fetch to throw, the catch calls res.end(), browser fires onerror.
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(new Error('ElevenLabs stream timeout')), 25000);
  try {
    const r = await fetch(`${ELEVEN_BASE}/${voice}/stream?output_format=mp3_44100_128`, {
      method:  'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: voiceSettingsFor(emotion) }),
      signal:  ctrl.signal,
    });
    if (!r.ok || !r.body) {
      clearTimeout(abortTimer);
      const body = await (r.text?.().catch(() => '') ?? Promise.resolve(''));
      console.error(`[voice] ElevenLabs ${r.status}: ${String(body).slice(0, 200)}`);
      return res.status(502).json({ error: 'tts_failed' });
    }
    res.set('Content-Type', 'audio/mpeg');
    const chunks = [];
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      chunks.push(buf);
      res.write(buf);
    }
    clearTimeout(abortTimer);
    res.end();
    ttsCachePut(ck, Buffer.concat(chunks));
  } catch (err) {
    clearTimeout(abortTimer);
    console.error(`[voice] failed user=${account.id}: ${err.message}`);
    if (!res.headersSent) return res.status(502).json({ error: 'tts_failed' });
    try { res.end(); } catch {}
  }
});

export { router as transcribeRouter };
