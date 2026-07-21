/**
 * callfloor/postCall.js — the DUAL DIAGNOSTIC HARVEST, once, on text, after the call.
 *
 * (a) LANGUAGE — the errors-only door (owner design 2026-07-21: calls feed EVIDENCE, interviews
 *     mint bottlenecks): the frozen deep-diagnosis pass runs on the transcript via its EXPORTED
 *     functions (generateDeepAnalysis → eventsFromAnalysis → appendErrorEvents), so every German
 *     error lands in error_events and informs the NEXT interview's bottleneck selection through
 *     history — but a call never triggers bottleneck selection or exercise generation itself.
 * (b) JOB COMPETENCY — competency.js, quote-gated, → call_results.
 *
 * Retries ride the per-minute-window doctrine (foot-gun #64): [0, 8s, 25s]. The transcript is
 * already durable in call_sessions before this runs — a total failure is honest ('failed'),
 * never silent, never lost.
 */

import { generateDeepAnalysis } from '../deepDiagnosis.js';
import { eventsFromAnalysis, appendErrorEvents } from '../analysisStore.js';
import { judgeCall, overallScore } from './competency.js';
import { saveCallResult, saveCallSession } from './resultsStore.js';

const RETRY_DELAYS = [0, 8_000, 25_000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shape a finished call transcript into the frozen analysis input contract. */
export function analysisInputFromCall(session, scenario) {
  const dialogue = session.transcript.map((t) => ({
    speaker: t.role === 'agent' ? 'candidate' : 'boss', text: t.text,
  }));
  const utterances = session.transcript
    .filter((t) => t.role === 'agent')
    .map((t, i) => ({
      text: t.text,
      words: t.text.split(/\s+/).filter(Boolean).length,
      durationMs: Math.max(0, Math.round(t.durationSec ? t.durationSec * 1000 : 0)),
      stage: 3, stageLabel: `Call Floor · ${scenario.title_de}`,
      lowConf: [],
    }));
  const words = utterances.reduce((s, u) => s + u.words, 0);
  return {
    dialogue, utterances,
    metrics: { words, source: 'callfloor' },
    level: 'b1',
    csScenarioId: `callfloor:${scenario.id}`,
  };
}

async function withRetries(tag, fn) {
  let lastErr = null;
  for (const delay of RETRY_DELAYS) {
    if (delay) await sleep(delay);
    try { return await fn(); }
    catch (err) { lastErr = err; console.error(`[callfloor/post] ${tag} attempt failed: ${err.message}`); }
  }
  throw lastErr;
}

/**
 * Fire-and-forget after a call ends. Language and competency run independently — one failing
 * never blocks the other. Returns the result record (or null) for the synchronous caller path.
 */
export async function runPostCall({ session, scenario }) {
  const userId = session.userId;

  // (a) LANGUAGE → error_events (evidence for the next interview's bottleneck choice).
  const language = withRetries('language', async () => {
    const input = analysisInputFromCall(session, scenario);
    if (!input.utterances.length) return { events: 0, skipped: 'no_agent_turns' };
    const { validated } = await generateDeepAnalysis({ ...input, sessionId: session.id });
    const events = eventsFromAnalysis({ userId, sessionId: session.id, validated });
    await appendErrorEvents(userId, events);
    return { events: events.length };
  }).then(async (r) => {
    session.analysisStatus = 'ready';
    await saveCallSession(session).catch(() => {});
    console.log(`[callfloor/post] language ready session=${session.id} events=${r.events ?? 0}`);
    return r;
  }).catch(async (err) => {
    session.analysisStatus = 'failed';
    await saveCallSession(session).catch(() => {});
    console.error(`[callfloor/post] language FAILED session=${session.id}: ${err.message}`);
    return null;
  });

  // (b) JOB COMPETENCY → call_results.
  const competency = withRetries('competency', () =>
    judgeCall({ scenario, transcript: session.transcript, userId }),
  ).then(async (judged) => {
    const result = {
      sessionId: session.id, userId, quadrant: session.quadrant, scenarioId: scenario.id,
      handleSeconds: Math.max(0, Math.round(((session.endedAt || Date.now()) - session.startedAt) / 1000)),
      satisfactionFinal: session.finalMood ?? null,
      resolved: judged.resolved,
      skills: judged.skills,
      meta: { summaryDe: judged.summaryDe, thin: judged.thin, overall: overallScore(judged.skills), unsolvable: !!scenario.unsolvable },
    };
    await saveCallResult(result);
    console.log(`[callfloor/post] result saved session=${session.id} overall=${result.meta.overall}`);
    return result;
  }).catch((err) => {
    console.error(`[callfloor/post] competency FAILED session=${session.id}: ${err.message}`);
    return null;
  });

  const [, result] = await Promise.all([language, competency]);
  return result;
}

export default { runPostCall, analysisInputFromCall };
