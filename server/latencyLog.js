/**
 * latencyLog.js — in-memory ring buffer of recent voice-turn latency breakdowns (server-side
 * segments only). Diagnostic instrumentation for the ONE product metric: user-stops → boss-starts.
 *
 * Segments captured per spoken turn (ms):
 *   flush       AUDIO_END received → _commitTurn fires (Deepgram flush wait, ~160ms timer + final)
 *   prep        _commitTurn → respond() called (scoring/setup; overlaps generation already)
 *   llm         respond() called → first boss text ready (Groq/Cerebras generation = usual culprit)
 *   serverTotal AUDIO_END → first boss text ready (everything the SERVER controls)
 * Client TTS + audio playback happen AFTER this and are measured client-side separately.
 */
const BUF = [];
const MAX = 80;

export function recordTurn(rec) { BUF.push(rec); if (BUF.length > MAX) BUF.shift(); }
export function recentTurns(n = 40) { return BUF.slice(-n); }

// CLIENT-side timings POSTed from the browser (the half the server clock can't see):
//   vadWaitMs  = silence the VAD waited after you stopped, before sending the turn
//   ttsMs      = boss text received → first audio actually played (TTS synth+download+decode)
//   fullMs     = you stopped speaking → first boss audio (the number you FEEL)
//   build      = which client build reported it (catches stale-cache)
const CLIENT = [];
export function recordClient(rec) { CLIENT.push(rec); if (CLIENT.length > MAX) CLIENT.shift(); }
export function recentClient(n = 40) { return CLIENT.slice(-n); }
export function clientSummary() {
  if (!CLIENT.length) return { count: 0, note: 'no client timings yet — run an interview on the new build' };
  const avg = (k) => Math.round(CLIENT.reduce((a, r) => a + (r[k] || 0), 0) / CLIENT.length);
  const builds = [...new Set(CLIENT.map((r) => r.build).filter(Boolean))];
  return { count: CLIENT.length, avgVadWaitMs: avg('vadWaitMs'), avgTtsMs: avg('ttsMs'), avgFullMs: avg('fullMs'), builds };
}

export function summary() {
  if (!BUF.length) return { count: 0, note: 'no spoken turns recorded yet — run an interview' };
  const avg = (k) => Math.round(BUF.reduce((a, r) => a + (r[k] || 0), 0) / BUF.length);
  const p95 = (k) => { const s = BUF.map((r) => r[k] || 0).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
  const byProv = {};
  for (const r of BUF) { const p = r.provider || '?'; (byProv[p] = byProv[p] || []).push(r.llmMs || 0); }
  const llmByProvider = Object.fromEntries(Object.entries(byProv).map(([p, a]) => [p, { avgMs: Math.round(a.reduce((x, y) => x + y, 0) / a.length), turns: a.length }]));
  return {
    count: BUF.length,
    avgFlushMs: avg('flushMs'), avgPrepMs: avg('prepMs'), avgLlmMs: avg('llmMs'),
    avgServerTotalMs: avg('serverTotalMs'), p95ServerTotalMs: p95('serverTotalMs'),
    llmByProvider,
    biggestGap: (() => { const segs = { flush: avg('flushMs'), prep: avg('prepMs'), llm: avg('llmMs') }; return Object.entries(segs).sort((a, b) => b[1] - a[1])[0]; })(),
  };
}

export default { recordTurn, recentTurns, summary };
