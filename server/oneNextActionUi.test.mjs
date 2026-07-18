import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('BrainGuide keeps one visible action and an always-visible orientation contract', async () => {
  const source = await read('client/src/BrainGuide.jsx');
  assert.match(source, /DEIN NÄCHSTER SCHRITT/u);
  assert.match(source, /\{brief\.title\}/u);
  assert.match(source, /\{brief\.dose\}/u);
  assert.match(source, /01 · WARUM JETZT/u);
  assert.match(source, /02 · FERTIG, WENN/u);
  assert.match(source, /03 · DANACH/u);
  assert.match(source, /\{brief\.done\}/u);
  assert.match(source, /\{brief\.after\}/u);
  assert.match(source, /DAS GRÖSSERE ZIEL/u);
  assert.doesNotMatch(source, /<details className="brain-guide__why"/u);
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
