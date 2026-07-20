/**
 * pipelineFailure.test.mjs — E2E verification item 5: kill the LLM calls (no provider keys) and
 * prove the failure paths: analysis → honest queued→failed (retry ladder intact, transcript input
 * preserved for later re-runs), generation → deterministic Stage-2 fallback (never an empty
 * personal step). Runs fully offline; keys are scrubbed IN-PROCESS so CI environments with
 * secrets still test the keyless behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

delete process.env.GROQ_API_KEY;
delete process.env.CEREBRAS_API_KEY;
process.env.DEEP_ANALYSIS_DELAY_MS = '0';

const { startAnalysisForSession, getOrRetryAnalysis, runAnalysis, MAX_ATTEMPTS } = await import('./analysisRunner.js');
const { loadAnalysisRecord } = await import('./analysisStore.js');
const { startExerciseGeneration, loadStep } = await import('./personalStep.js');

const BASE = path.dirname(fileURLToPath(import.meta.url));
const UID = 'testPipelineFailureUser';
const cleanup = async () => {
  for (const p of [
    ['data', 'analyses', `${UID}__failsess.json`],
    ['data', 'personalstep', `${UID}__failsess.json`],
    ['data', 'bottlenecks', `${UID}.json`],
    ['data', 'errorlog', `${UID}.json`],
  ]) await rm(path.join(BASE, ...p), { force: true });
};

const INPUT = {
  dialogue: [{ role: 'boss', text: 'Erzählen Sie.' }, { role: 'candidate', text: 'weil ich habe viel Erfahrung mit Kunden' }],
  utterances: [{ text: 'weil ich habe viel Erfahrung mit Kunden', words: 7, durationMs: 3000, lowConf: [] }],
  metrics: { words: 7 }, level: 'b2', csScenarioId: 'general',
};
const BN = {
  code: 'VERB_POSITION/verb_am_ende_nach_weil', category: 'VERB_POSITION',
  subcode: 'verb_am_ende_nach_weil', why: 'Test', sessionId: 'failsess', cairoDay: 'd',
  evidenceQuotes: [{ quote: 'weil ich habe viel Erfahrung', corrected: 'weil ich viel Erfahrung habe' }],
  exerciseHistory: [],
};

const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('keyless analysis: queued honestly, input preserved, retry ladder ends in failed — never a fake result', async (t) => {
  t.after(cleanup);
  await startAnalysisForSession({ userId: UID, sessionId: 'failsess', input: INPUT });
  const rec = await waitFor(async () => {
    const r = await loadAnalysisRecord(UID, 'failsess');
    return r && r.status !== 'pending' ? r : null;
  });
  assert.equal(rec.status, 'queued');                                   // not 'ready', not silent
  assert.equal(rec.attempts, 1);
  assert.equal(rec.input.dialogue[1].text, INPUT.dialogue[1].text);     // transcript survives for later re-runs
  // Spacing gate: an immediate poll must NOT burn an attempt.
  const polled = await getOrRetryAnalysis(UID, 'failsess');
  assert.equal(polled.status, 'queued');
  assert.equal((await loadAnalysisRecord(UID, 'failsess')).attempts, 1);
  // Exhaust the ladder (spacing bypassed by direct runs) → terminal 'failed', still honest.
  let r = await loadAnalysisRecord(UID, 'failsess');
  while (r.attempts < MAX_ATTEMPTS) r = await runAnalysis(r);
  assert.equal(r.status, 'failed');
  assert.ok(!r.analysis);                                               // no fabricated analysis anywhere
});

test('keyless generation: deterministic Stage-2 fallback from stored corrections — never empty', async (t) => {
  t.after(cleanup);
  const step = await startExerciseGeneration({ userId: UID, sessionId: 'failsess', bottleneck: BN, level: 'b2', cairoDay: 'd' });
  assert.equal(step.status, 'fallback');
  assert.equal(step.set.fallback, true);
  assert.equal(step.set.stage2.length, 1);
  assert.equal(step.set.stage2[0].target, BN.evidenceQuotes[0].corrected);
  assert.ok(step.set.totalReps > 0);
  const persisted = await loadStep(UID, 'failsess');
  assert.equal(persisted.status, 'fallback');                           // survives reload → GET serves it
});

test('keyless generation with NO stored corrections: status failed (client shows honest empty-state line)', async (t) => {
  t.after(cleanup);
  const step = await startExerciseGeneration({ userId: UID, sessionId: 'failsess',
    bottleneck: { ...BN, evidenceQuotes: [] }, level: 'b2', cairoDay: 'd' });
  assert.equal(step.status, 'failed');
});
