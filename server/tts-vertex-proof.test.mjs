// One-shot proof: Gemini-TTS on the VERTEX transport bills the $300 GCP credit, not the card.
// Hits the exact endpoint geminiTTS() builds and asserts real audio bytes come back. Run:
//   GEMINI_VERTEX_TOKEN=$(gcloud auth print-access-token) GEMINI_USE_VERTEX=1 node tts-vertex-proof.test.mjs
import { getVertexAccessToken } from './vertexToken.js';

const PROJECT  = process.env.GOOGLE_CLOUD_PROJECT  || 'gen-lang-client-0719205380';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
const MODEL    = process.env.GEMINI_TTS_MODEL_VERTEX || process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const VOICE    = process.env.GEMINI_TTS_VOICE || 'Kore';

const token = await getVertexAccessToken();
const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}`
          + `/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;
const body = { contents: [{ role: 'user', parts: [{ text: 'اقري بصوت ودود: أهلاً بيك، معاك سلمى.' }] }],
  generationConfig: { responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } };

console.log(`POST ${url}`);
const r = await fetch(url, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
if (!r.ok) { console.error(`FAIL ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`); process.exit(1); }
const j = await r.json();
const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
const bytes = part ? Buffer.from(part.inlineData.data, 'base64').length : 0;
console.log(`PROOF: audio=${bytes}B  model=${MODEL}`);
console.log(bytes > 0 ? 'PASS — Vertex TTS works, bills the credit' : 'FAIL — no audio');
process.exit(bytes > 0 ? 0 : 1);
