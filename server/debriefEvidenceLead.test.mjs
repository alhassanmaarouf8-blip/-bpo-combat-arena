/**
 * debriefEvidenceLead.test.mjs — the debrief must LEAD with the learner's own evidence.
 *
 * Before this shipped, the most valuable thing the product makes — ~14-16 verbatim findings, the
 * ONE named bottleneck and its measured `why` — sat behind the collapsed "ALLE DETAILS & ANALYSE
 * ANZEIGEN" toggle. A first-timer left with a rank and one sentence, then met a generic upsell
 * ("Bleib dran bis zur nächsten Bewerbung") that referenced nothing they had just lived through.
 *
 * What is locked here is mostly HONESTY, because this surface is the sales argument and the
 * temptation to overstate it is exactly what anti-slop exists to stop:
 *   - never render a lead that is not ready, not graded, or not spoken
 *   - never print a precise finding count on a thin sample
 *   - never paraphrase the selector's measured `why` into marketing prose
 *   - never let the upsell imply findings the screen did not actually show
 *   - and the two claims it makes about the product must stay true in the server code
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
const client = await readFile(new URL('../client/src/deepAnalysisClient.js', import.meta.url), 'utf8');

test('exactly ONE poll of /api/analysis — the lead and the details share a request', () => {
  const appFetches = source.match(/fetch\(`\$\{apiUrl\}\/api\/analysis\//g) || [];
  assert.equal(appFetches.length, 0,
    'App.jsx must not poll /api/analysis itself — the shared hook in deepAnalysisClient.js owns it');
  const hookFetches = client.match(/fetch\(`\$\{apiUrl\}\/api\/analysis\//g) || [];
  assert.equal(hookFetches.length, 1, 'the shared hook must issue exactly one polling call');
  assert.match(source, /const deep = useDeepAnalysis\(token, apiUrl, data\?\.deepAnalysis\?\.sessionId\)/);
  assert.match(source, /<DeepAnalysisSection state=\{deep\}/, 'the details section consumes the shared state');
  // The lifted poll must keep the original ceiling — an unbounded retry would hammer a rate-limited
  // endpoint (120 req / 10 min per account) now that it starts on debrief open instead of on tap.
  assert.match(client, /\+\+tries < 36/);
  assert.match(client, /setTimeout\(tick, 5000\)/);
});

test('the evidence lead obeys the honesty ladder', () => {
  // Suppressed entirely unless ready AND graded AND actually spoken.
  assert.match(source, /if \(deep\?\.status !== 'ready' \|\| gradeUnavailable \|\| typedPractice\) return null;/,
    'never show evidence for an ungraded session or a typed-practice turn');
  assert.match(source, /const bn = deep\.bottleneck;\s*\n\s*if \(!bn\) return null;/,
    'no fabricated lead when the selector named no lever');
  // A precise count is dropped on a thin sample — the card still renders with its own marker.
  assert.match(source, /!bn\.lowConfidence\) \? total : null/,
    'lowConfidence must suppress the count, not the card');
  assert.match(source, /\{evidence\.count && \(/,
    'the count line must be conditional, never rendered as 0 or undefined');
});

test('the selector\'s measured `why` is rendered verbatim, never paraphrased', () => {
  // buildWhy() composes a sentence from real frequencies, severities and the beaten runner-up.
  // Rewriting it in the client is how a measured statement becomes a marketing one.
  assert.match(source, /\{bn\.why\}/, 'the bottleneck card must print the server-authored why as-is');
  assert.match(source, /<BottleneckCard bn=\{evidence\.bn\} compact \/>/,
    'the lead must reuse the same card as the full analysis, not a second styling of it');
  assert.match(source, /\{!hideBottleneck && <BottleneckCard bn=\{bn\} \/>\}/,
    'the full analysis must suppress its card when the lead already showed it (no duplicate)');
  assert.match(source, /hideBottleneck=\{!!evidence\}/);
});

test('the details toggle is untouched — progressive disclosure still works', () => {
  assert.match(source, /ALLE DETAILS & ANALYSE ANZEIGEN ▾/,
    'the toggle label must stay byte-identical; the lead is added ABOVE it, nothing is replaced');
  assert.match(source, /WENIGER ANZEIGEN ▴/);
});

test('the upsell cites the file, and falls back cleanly when there is no evidence', () => {
  assert.match(source, /ein benannter Engpass: \{DEEP_CAT_DE\[evidence\.bn\.category\]/);
  assert.match(source, /Deine Akte schließt erst, wenn du es in zwei sauberen Interviews zeigst\./);
  // Without evidence the original copy must survive — the offer may never imply findings the
  // screen did not show.
  assert.match(source, /: 'Bleib dran bis zur nächsten Bewerbung\.'/,
    'the pre-existing line must remain as the no-evidence fallback');
  assert.match(source, /\{onSeePlans && ent && \(ent\.plan \|\| 'free'\) === 'free'/,
    'the upsell must still be shown only to non-paying accounts');
});

test('both product claims the debrief makes are still TRUE in the server code', async () => {
  // Claim 1: "Deine Akte schließt erst, wenn du es in zwei sauberen Interviews zeigst."
  const selector = await readFile(new URL('./bottleneckSelector.js', import.meta.url), 'utf8');
  assert.match(selector, /rec\.cleanStreak >= 2 \|\| \(loopRan && rec\.cleanStreak >= 1\)/,
    'closure no longer requires two clean interviews — the debrief copy is now false');
  // Claim 2: "Dein persönlicher Schritt trainiert genau diesen Engpass."
  const runner = await readFile(new URL('./analysisRunner.js', import.meta.url), 'utf8');
  assert.match(runner, /startExerciseGeneration/,
    'the personal step is no longer generated off the analysis — the debrief copy is now false');
  const generator = await readFile(new URL('./exerciseGenerator.js', import.meta.url), 'utf8');
  assert.match(generator, /export async function generateExerciseSet\(\{ bottleneck/,
    'the generator no longer takes the selected bottleneck as its input');
});
