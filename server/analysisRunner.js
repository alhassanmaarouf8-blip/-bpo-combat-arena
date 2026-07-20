/**
 * analysisRunner.js — lifecycle of one deep analysis: pending → ready | queued → ready | failed.
 *
 * Fired-and-forgotten from the interview gateway AFTER the debrief is sent (never on its latency
 * path, and a failure here can never break the debrief). If the LLM call exhausts its in-process
 * retries, the record — which carries the full transcript input — is left 'queued'; the client's
 * poll (GET /api/analysis/:sessionId) lazily re-runs it with spacing until MAX_ATTEMPTS, then
 * 'failed'. No cron, no new infra: the retry rides on the poll the UI is doing anyway.
 */
import { generateDeepAnalysis } from './deepDiagnosis.js';
import { loadAnalysisRecord, saveAnalysisRecord, eventsFromAnalysis, appendErrorEvents } from './analysisStore.js';

export const MAX_ATTEMPTS   = 5;
export const RETRY_SPACING_MS = 60_000;

const inFlight = new Set();   // `${userId}:${sessionId}` — poll storms must not double-run

export async function runAnalysis(record) {
  const k = `${record.userId}:${record.sessionId}`;
  if (inFlight.has(k)) return record;
  inFlight.add(k);
  try {
    record.status = 'pending';
    record.attempts = (record.attempts || 0) + 1;
    await saveAnalysisRecord(record);
    const { validated, aggregates, usage } = await generateDeepAnalysis({ ...record.input, sessionId: record.sessionId });
    record.analysis   = validated;
    record.aggregates = aggregates;
    record.usage      = usage;
    record.status     = 'ready';
    await saveAnalysisRecord(record);
    const events = eventsFromAnalysis({ userId: record.userId, sessionId: record.sessionId, validated });
    await appendErrorEvents(record.userId, events);
    console.log(`[analysisRunner] ready  user=${record.userId}  session=${record.sessionId}  events=${events.length}`);
  } catch (err) {
    record.status = (record.attempts || 0) >= MAX_ATTEMPTS ? 'failed' : 'queued';
    console.error(`[analysisRunner] ${record.status}  user=${record.userId}  session=${record.sessionId}  attempt=${record.attempts}: ${err.message}`);
    await saveAnalysisRecord(record).catch(() => {});
  } finally {
    inFlight.delete(k);
  }
  return record;
}

// The debrief pipeline fires its own LLM calls on the same free-tier key seconds before this
// engine starts (live evidence: session 3a7a8e81 queued repeatedly right after the debrief).
// A short deliberate delay moves the analysis out of that rate window. 0 in tests.
export const INITIAL_DELAY_MS = Number(process.env.DEEP_ANALYSIS_DELAY_MS ?? 20_000);

/** Create the record (transcript input included → survives restarts) and run asynchronously. */
export async function startAnalysisForSession({ userId, sessionId, input }) {
  const record = {
    v: 1, userId, sessionId, status: 'pending', attempts: 0,
    createdAt: Date.now(), updatedAt: Date.now(), input,
  };
  await saveAnalysisRecord(record);
  setTimeout(() => {
    runAnalysis(record).catch((e) => console.error('[analysisRunner] detached run failed:', e.message));
  }, INITIAL_DELAY_MS);
  return record;
}

/** Poll-driven lazy retry: re-run a queued record when spacing has elapsed and attempts remain. */
export async function getOrRetryAnalysis(userId, sessionId) {
  const record = await loadAnalysisRecord(userId, sessionId);
  if (!record) return null;
  if (record.status === 'queued'
    && (record.attempts || 0) < MAX_ATTEMPTS
    && Date.now() - (record.updatedAt || 0) >= RETRY_SPACING_MS) {
    runAnalysis(record).catch((e) => console.error('[analysisRunner] lazy retry failed:', e.message));
    return { ...record, status: 'pending' };
  }
  return record;
}

export default { runAnalysis, startAnalysisForSession, getOrRetryAnalysis, MAX_ATTEMPTS };
