import OpenAI, { toFile } from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

// ── New architecture: Groq + Deepgram, NO OpenAI ────────────────────────────
// Transcription: Groq whisper-large-v3 (default) or Deepgram nova-3 (TRANSCRIBER=deepgram).
// Judge: Groq llama-3.3-70b-versatile (OpenAI-compatible chat API via Groq base URL).
// The OpenAI SDK is reused only as an OpenAI-compatible HTTP client pointed at Groq.
const GROQ_BASE             = 'https://api.groq.com/openai/v1';
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'groq').toLowerCase();
const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3';
const GROQ_JUDGE_MODEL      = 'llama-3.3-70b-versatile';
const DEEPGRAM_MODEL        = process.env.DEEPGRAM_MODEL || 'nova-3';

// Lazy init so importing this module never throws at load time (the router
// imports it; a missing key should surface on use, not crash module resolution).
let _groq = null;
function groqClient() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  _groq = new OpenAI({ apiKey, baseURL: GROQ_BASE });
  return _groq;
}

export function makeNodeFileLike(buffer, mimeType = 'audio/wav') {
  const base64 = buffer.toString('base64url');
  return { buffer, name: `audio.${mimeType.split('/')[1] || 'wav'}`, contentType: mimeType, base64 };
}

async function maybeAsync(obj) {
  return obj && typeof obj.then === 'function' ? obj : Promise.resolve(obj);
}

/**
 * Core scoring engine. Used by both the router and the CLI.
 */
export async function scoreAnswer(audioBuffer, opts = {}) {
  const {
    level = 'a2-b1',
    scenarioId = 'general',
    mimeType = 'audio/wav',
    userId = 'anon',
  } = opts;

  let transcriptText = '';
  try {
    if (TRANSCRIBER === 'deepgram') {
      const { transcribeDeepgram } = await import('../transcribeDeepgram.js');
      transcriptText = await transcribeDeepgram(audioBuffer, { model: DEEPGRAM_MODEL, language: 'de' });
    } else {
      // Filename extension derived from the real mimeType so browser webm/opus
      // ("audio/webm;codecs=opus") is accepted, not just clean wav.
      const ext = (mimeType.split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
      const audioFile = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType });
      const transcription = await groqClient().audio.transcriptions.create({
        model: GROQ_TRANSCRIBE_MODEL,
        file: audioFile,
        response_format: 'text',
        language: 'de',
      });
      transcriptText = typeof transcription === 'string' ? transcription : (transcription.text || '');
    }
  } catch (error) {
    const message = error?.message || 'Unknown transcription error';
    console.error(`[panelScorer] Transcription failed user=${userId}: ${message}`);
    throw new Error(`transcription_failed: ${message}`);
  }

  if (!transcriptText.trim()) {
    return {
      ok: true,
      verdict: 'no_speech',
      transcript: '',
      metrics: { wordCount: 0, fluencyScore: 0, fillerCount: 0, wpm: 0, strengths: [], studyNext: [], grammar: [] },
    };
  }

  const prompt = buildScoringPrompt({ level, scenarioId, transcript: transcriptText });

  let completion;
  try {
    completion = await groqClient().chat.completions.create({
      model: GROQ_JUDGE_MODEL,
      messages: prompt.messages,
      response_format: { type: 'json_object' },
      temperature: 0,
    });
  } catch (error) {
    const message = error?.message || 'Unknown scoring error';
    console.error(`[panelScorer] Scoring failed user=${userId}: ${message}`);
    throw new Error(`scoring_failed: ${message}`);
  }

  const scored = parseScoredCompletion(completion, transcriptText);

  return {
    ok: scored.ok,
    verdict: scored.verdict,
    transcript: scored.transcript,
    metrics: {
      wordCount: scored.wordCount,
      fluencyScore: scored.fluencyScore,
      fillerCount: scored.fillerCount,
      wpm: scored.wpm,
      strengths: scored.strengths,
      studyNext: scored.studyNext,
      grammar: scored.grammar,
      tokensIn: scored.tokensIn,
      tokensOut: scored.tokensOut,
    },
  };
}

function buildScoringPrompt({ level, scenarioId, transcript }) {
  return {
    messages: [
      {
        role: 'system',
        content: `You are a precise German interview scoring engine.
Input is a candidate's spoken transcript from a BPO interview simulation.
Judge ONLY what is actually present in the transcript — never invent grammar corrections, never invent utterances, never fabricate filler words that do not occur.

Return a compact JSON object with this exact shape:
{
  "ok": true,
  "verdict": "pass" | "weak" | "fail",
  "transcript": "the candidate transcript",
  "wordCount": 0,
  "fluencyScore": 0,
  "fillerCount": 0,
  "wpm": 0,
  "strengths": ["short factual phrases only"],
  "studyNext": ["concrete actionable item grounded in the transcript"],
  "grammar": [],
  "tokensIn": 0,
  "tokensOut": 0
}

Rules:
- "verdict" must be derived from concrete evidence in the transcript.
- fluencyScore is 0-100 integer.
- wpm is your best estimate from the word count.
- tokensIn/tokensOut are integers representing usage; if not measurable, set 0.`,
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
  };
}

function parseScoredCompletion(completion, echoTranscript) {
  const text = completion?.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  return {
    ok: true,
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict : 'weak',
    transcript: typeof parsed.transcript === 'string' ? parsed.transcript : echoTranscript,
    wordCount: Number(parsed.wordCount || 0),
    fluencyScore: Number(parsed.fluencyScore || 0),
    fillerCount: Number(parsed.fillerCount || 0),
    wpm: Number(parsed.wpm || 0),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
    studyNext: Array.isArray(parsed.studyNext) ? parsed.studyNext.slice(0, 3) : [],
    grammar: Array.isArray(parsed.grammar) ? parsed.grammar.slice(0, 5) : [],
    tokensIn: Number(parsed.tokensIn || (completion?.usage?.prompt_tokens || 0)),
    tokensOut: Number(parsed.tokensOut || (completion?.usage?.completion_tokens || 0)),
  };
}

// Preserved CLI harness — the existing discrimination test stays functional.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveAudioPath(inputPath) {
  // Handle both Windows literal paths ("C:\Users\...") and MSYS-translated
  // POSIX paths ("/c/Users/...") on this host, so the CLI and router consume
  // the bytes from the same canonical absolute path.
  try {
    return path.resolve(inputPath);
  } catch {
    // Fallback for MSYS-style paths that Node's path.resolve can choke on.
    if (/^\/[a-zA-Z]\//.test(inputPath)) {
      const drive = inputPath[1].toUpperCase();
      const tail = inputPath.slice(2).replace(/\//g, '\\');
      return `${drive}:\\${tail}`;
    }
    return inputPath;
  }
}

async function mainScore(inputPath) {
  const absolute = resolveAudioPath(inputPath);
  try {
    await fs.access(absolute);
  } catch {
    console.error(JSON.stringify({ error: 'file_not_found', path: absolute, cwd: process.cwd() }));
    process.exit(2);
  }
  const buffer = await fs.readFile(absolute);
  const result = await scoreAnswer(buffer, { mimeType: 'audio/wav', level: 'a2-b1', scenarioId: 'general' });
  console.log(JSON.stringify(result, null, 2));
}

const __cliArgv1 = pathToFileURL(process.argv[1]).href;
if (import.meta.url === __cliArgv1) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scoring/panelscorer.mjs <score.wav>');
    process.exit(2);
  }
  mainScore(target).catch((err) => {
    console.error(err && err.userMessage ? err.userMessage : err);
    process.exit(1);
  });
}
