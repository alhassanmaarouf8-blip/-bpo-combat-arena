import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('BrainGuide makes one action, dose, completion and consequence immediately legible', async () => {
  const source = await read('client/src/BrainGuide.jsx');
  assert.match(source, /DEIN NÄCHSTER SCHRITT/u);
  assert.match(source, />JETZT</u);
  assert.match(source, />FERTIG, WENN</u);
  assert.match(source, />DANACH</u);
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
  assert.match(source, /d\.confidence === 'low' \? 'ERSTE MESSUNG' : 'SERVER-GESTEUERT'/u);
});
