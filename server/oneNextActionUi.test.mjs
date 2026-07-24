import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('BrainGuide keeps one visible action and an always-visible orientation contract', async () => {
  const source = await read('client/src/BrainGuide.jsx');
  // CONTRACT UNCHANGED, PRESENTATION CHANGED (owner order 2026-07-24: "extremely simple to
  // navigate", "extremely premium"). What this test has always protected is that the learner can
  // see, WITHOUT tapping anything, why this step / what counts as done / what comes next. That is
  // still enforced below. What it used to ALSO pin was the specific chrome — the uppercase kicker
  // "DEIN NÄCHSTER SCHRITT" and three numbered, individually-labelled cards. Nine uppercase
  // micro-labels on one screen is what made the app read as machine-made, so the labels are gone
  // and the same three facts are now quiet prose. The anti-collapse guard below is deliberately
  // KEPT: hiding orientation behind a disclosure is still forbidden.
  assert.match(source, /\{primaryTitle\}/u);
  assert.match(source, /\{primaryDose\}/u);
  // Resume-aware primary (owner 2026-07-23): an UNFINISHED interview exercise set supersedes the drill
  // as the next step — but when NOT resuming, title/dose still come from the server brief, never fabricated.
  assert.match(source, /primaryTitle\s*=\s*resuming\s*\?[^;]*:\s*brief\.title/u);
  assert.match(source, /primaryDose\s*=\s*resuming\s*\?[^;]*:\s*brief\.dose/u);
  // The three orientation facts must still be RENDERED, and rendered unconditionally — no state,
  // no toggle, no `showX &&` in front of them.
  assert.match(source, /<div className="brain-guide__orient"/u);
  assert.match(source, /<p>\{reason\}<\/p>/u);
  assert.match(source, /\{brief\.done\}/u);
  assert.match(source, /\{brief\.after\}/u);
  assert.match(source, /\{biggerGoal\(d\)\}/u);
  assert.match(source, /Interne Simulation · keine Arbeitgeberentscheidung/u);
  // ANTI-COLLAPSE, KEPT FROM THE ORIGINAL CONTRACT: orientation may be made quieter, never hidden.
  // A previous session tried collapsing it behind a disclosure and it was rejected; that verdict
  // stands, and restyling is not a licence to revisit it.
  assert.doesNotMatch(source, /<details className="brain-guide__why"/u);
  assert.doesNotMatch(source, /<details[^>]*brain-guide__orient/u);
  // And the label cull must not quietly reverse: these were the machine-made tell.
  for (const label of ['01 · WARUM JETZT', '02 · FERTIG, WENN', '03 · DANACH', 'DAS GRÖSSERE ZIEL']) {
    assert.equal(source.includes(label), false,
      `uppercase micro-label "${label}" is back — nine of these on one screen is what made the UI read as AI-made`);
  }
  assert.match(source, /className="brain-guide__cta"/u);
  assert.equal((source.match(/className="brain-guide__cta"/gu) || []).length, 1,
    'the guide must render exactly one primary action implementation');
  assert.match(source, /active\.successGate/u,
    'personalized completion copy must come from the bounded server prescription');
  assert.match(source, /active\.repetitions/u,
    'personalized dose must come from the bounded server prescription');
  assert.match(source, /api\/salma\/coach/u);
  assert.match(source, /response\.ok \? response\.json\(\) : null/u,
    'optional tutor dose must fail closed without hiding the canonical BrainGuide action');
  assert.match(source, /Interne Simulation · keine Arbeitgeberentscheidung/u);
});

test('the mission UI stays energetic without sacrificing mobile, focus or motion safety', async () => {
  const css = await read('client/src/BrainGuide.css');
  assert.match(css, /\.brain-guide__mission/u);
  assert.match(css, /\.brain-guide__cta/u);
  assert.match(css, /min-height:\s*54px/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(max-width:\s*680px\)/u);
  assert.match(css, /grid-template-columns:\s*1fr/u);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(css, /animation:\s*none/u);
});

test('confidence copy cannot call an unmeasured gate repeatedly measured', async () => {
  const source = await read('client/src/BrainGuide.jsx');
  assert.match(source, /d\.confidence === 'high' && d\.state === 'POST_FIGHT' \? 'WIEDERHOLT GEMESSEN'/u);
  assert.match(source, /d\.confidence === 'low' \? 'ERSTE MESSUNG' : 'DEIN PLAN'/u);
});

test('career journey reflects verified evidence without becoming another planner', async () => {
  const source = await read('client/src/BrainGuide.jsx');
  assert.match(source, /const JOURNEY_PHASES = Object\.freeze/u);
  assert.match(source, /function activeJourneyPhase\(directive\)/u);
  assert.match(source, /action === 'drill' \|\| action === 'wait'/u);
  assert.match(source, /\['READY', 'RETEST_READY'\]\.includes\(directive\?\.state\)/u);
  assert.match(source, /j\.entryDone \?\? 0/u,
    'visible progress must remain sourced from the server journey');
  assert.match(source, /F.higkeiten best.tigt/u);
  assert.match(source, /Fortschritt z.hlt erst, wenn du es in einer neuen Situation zeigst/u);
  assert.match(source, /aria-current=\{current \? 'step' : undefined\}/u);
  assert.equal((source.match(/className="brain-guide__cta"/gu) || []).length, 1,
    'the presentation layer must not add a competing primary action');
});

test('career journey remains readable from narrow phones through desktop', async () => {
  const css = await read('client/src/BrainGuide.css');
  assert.match(css, /\.brain-guide__phases\s*\{[^}]*grid-template-columns:\s*repeat\(4,/su);
  assert.match(css, /@media \(max-width:\s*680px\)[\s\S]*?\.brain-guide__phases\s*\{[^}]*repeat\(2,/u);
  assert.match(css, /@media \(max-width:\s*390px\)[\s\S]*?\.brain-guide__phases\s*\{[^}]*grid-template-columns:\s*1fr/u);
  assert.match(css, /\.brain-guide__phase\.is-current/u);
});
