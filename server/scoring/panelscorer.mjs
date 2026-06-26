import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

// ── New architecture: Groq + Deepgram, NO OpenAI ────────────────────────────
// Transcription: Groq whisper-large-v3 (default) or Deepgram nova-3 (TRANSCRIBER=deepgram).
// Judge: Groq llama-3.3-70b-versatile (OpenAI-compatible chat API via Groq base URL).
// All calls go over plain fetch to Groq's OpenAI-compatible endpoints — NO SDK.
const GROQ_BASE             = 'https://api.groq.com/openai/v1';
const TRANSCRIBER           = (process.env.TRANSCRIBER || 'groq').toLowerCase();
const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3';
const GROQ_JUDGE_MODEL      = 'llama-3.3-70b-versatile';
const DEEPGRAM_MODEL        = process.env.DEEPGRAM_MODEL || 'nova-3';

// Groq over plain fetch — no SDK, no 'openai' dependency (the server dropped it).
// A missing key surfaces on use, not at import time, so importing never crashes boot.
function groqKey() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  return apiKey;
}

// One Groq chat completion (OpenAI-compatible response shape) over fetch.
async function groqChat({ model, messages, response_format, temperature }) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, messages, response_format, temperature }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`groq_chat ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function makeNodeFileLike(buffer, mimeType = 'audio/wav') {
  const base64 = buffer.toString('base64url');
  return { buffer, name: `audio.${mimeType.split('/')[1] || 'wav'}`, contentType: mimeType, base64 };
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
      // Groq STT over fetch (native FormData/Blob, Node 20+) — no SDK. Filename ext
      // derived from the real mimeType so browser webm/opus is accepted, not just wav.
      const ext = (mimeType.split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
      const fd = new FormData();
      fd.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
      fd.append('model', GROQ_TRANSCRIBE_MODEL);
      fd.append('response_format', 'text');
      fd.append('language', 'de');
      const r = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${groqKey()}` },
        body:    fd,
      });
      if (!r.ok) throw new Error(`groq_stt ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      transcriptText = (await r.text()).trim();
    }
  } catch (error) {
    const message = error?.message || 'Unknown transcription error';
    console.error(`[panelScorer] Transcription failed user=${userId}: ${message}`);
    throw new Error(`transcription_failed: ${message}`);
  }

  // Judge from the transcript we just produced. Delegates to the transcript-only
  // path so the audio flow and the live turn-based interview (which already holds
  // transcripts) share ONE judge implementation.
  return gradeTranscript({ transcript: transcriptText, level, scenarioId, userId });
}

/**
 * Judge-only scoring from an already-produced transcript (no audio / no STT).
 * This is what the live turn-based interview calls for the end-screen grade and
 * the debrief — it already holds the candidate's transcripts. Same return shape
 * as scoreAnswer, plus cefrLevel. Groq only — never OpenAI.
 */
export async function gradeTranscript({ transcript = '', level = 'a2-b1', scenarioId = 'general', userId = 'anon' } = {}) {
  const text = String(transcript || '').trim();
  if (!text) {
    return {
      ok: true,
      verdict: 'no_speech',
      cefrLevel: null,
      transcript: '',
      metrics: { wordCount: 0, fluencyScore: 0, fillerCount: 0, wpm: 0, strengths: [], studyNext: [], grammar: [] },
    };
  }

  const prompt = buildScoringPrompt({ level, scenarioId, transcript: text });

  let completion;
  try {
    completion = await groqChat({
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

  const scored = parseScoredCompletion(completion, text);

  return {
    ok: scored.ok,
    verdict: scored.verdict,
    cefrLevel: scored.cefrLevel,
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
  "cefrLevel": "A1" | "A2" | "B1" | "B2" | "C1",
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
- "verdict" encodes real Cairo-BPO hireability, not effort or politeness, and MUST be derived from concrete evidence in the transcript:
    "pass" = would be SEATED on a live German customer line: C1-level control (fluent, precise, complex) AND it held up as the questions got harder — answers stayed coherent, complete and on-topic under pressure.
    "weak" = would clear the HR phone-screen but is NOT yet floor-ready: solid B2 (clear, controlled, complex sentences) with the spoken-pressure gap still open. B2 is a screen pass, not a seat.
    "fail" = below B2, OR collapsed under pressure — empty, one-word, or broken-off answers on the harder turns even if earlier German was strong. Freezing under pressure disqualifies regardless of vocabulary.
  Judge "collapse / freeze" ONLY from the transcript itself (answers that thin out, break off, or fall silent as the questions escalate). Never infer it from audio, timing, or anything not present in the text.
- "cefrLevel" is the candidate's CEFR level, judged ONLY from the German actually present (grammar control, vocabulary range, sentence complexity, coherence). Apply these anchors HONESTLY — do not deflate a genuinely strong answer to B1, and never inflate a weak one:
    A1/A2: simple words and memorized phrases; frequent basic errors (case, gender, word order); only very familiar topics.
    B1: connected speech on familiar topics; manages the interview but with noticeable, recurring errors and limited range.
    B2: clear, detailed answers; complex sentences (subordinate clauses, connectors); good grammatical control with only occasional errors; argues a point and uses professional vocabulary.
    C1: fluent, spontaneous, precise; broad/idiomatic vocabulary; complex structures used accurately; errors rare and minor.
  Broken or error-filled German must NOT reach B2/C1 — but accurate, complex, professional German MUST be graded B2 or C1. Do NOT default everything to B1.
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
    cefrLevel: ['A1', 'A2', 'B1', 'B2', 'C1'].includes(String(parsed.cefrLevel || '').toUpperCase())
      ? String(parsed.cefrLevel).toUpperCase()
      : null,
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
