import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beginIndependentPlayback, claimTutorPlayback, consumeAutomaticTutorCue,
  createTutorDrillSession, stopTutorPlayback, stopTutorWhenDocumentHidden,
  tutorDrillSessionMatches } from '../client/src/salmaAudioSafety.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const token = (uid) => `${Buffer.from(JSON.stringify({ uid })).toString('base64url')}.signature`;

test('independent drill audio preempts tutor speech and blocks another tutor until release', () => {
  let stopped = 0;
  const tutor = claimTutorPlayback();
  tutor.attach(() => { stopped += 1; });
  const releaseDrill = beginIndependentPlayback();
  assert.equal(stopped, 1);
  assert.equal(claimTutorPlayback(), null);
  releaseDrill();
  const nextTutor = claimTutorPlayback();
  assert.ok(nextTutor);
  nextTutor.attach(() => { stopped += 1; });
  stopTutorPlayback();
  assert.equal(stopped, 2);
});

test('hidden documents stop active tutor audio and remove their listener cleanly', () => {
  let listener = null; let removed = false; let stopped = 0;
  const doc = {
    visibilityState: 'visible',
    addEventListener(type, fn) { assert.equal(type, 'visibilitychange'); listener = fn; },
    removeEventListener(type, fn) { assert.equal(type, 'visibilitychange'); removed = fn === listener; },
  };
  const tutor = claimTutorPlayback(); tutor.attach(() => { stopped += 1; });
  const cleanup = stopTutorWhenDocumentHidden(doc);
  listener(); assert.equal(stopped, 0);
  doc.visibilityState = 'hidden'; listener(); assert.equal(stopped, 1);
  cleanup(); assert.equal(removed, true);
});

test('automatic correction cap is isolated by account and durable drill-session object', () => {
  const a = createTutorDrillSession(token('account-a'), 'srs');
  const b = createTutorDrillSession(token('account-b'), 'srs');
  assert.equal(tutorDrillSessionMatches(a, token('account-a'), 'srs'), true);
  assert.equal(tutorDrillSessionMatches(a, token('account-b'), 'srs'), false);
  assert.equal(consumeAutomaticTutorCue(a, { id: 'cue-1' }, 2), true);
  assert.equal(consumeAutomaticTutorCue(a, { id: 'cue-1' }, 2), false);
  assert.equal(consumeAutomaticTutorCue(a, { id: 'cue-2' }, 2), true);
  assert.equal(consumeAutomaticTutorCue(a, { id: 'cue-3' }, 2), false);
  assert.equal(consumeAutomaticTutorCue(b, { id: 'cue-1' }, 2), true);

  const opaqueA = createTutorDrillSession('opaque-one', 'srs');
  const opaqueB = createTutorDrillSession('opaque-two', 'srs');
  assert.notEqual(opaqueA.accountScope, opaqueB.accountScope);
  assert.equal(opaqueA.accountScope.includes('opaque-one'), false);
});

test('all conditional drill panels receive a parent-owned durable intervention session', async () => {
  const drills = await Promise.all([
    read('client/src/Shadowing.jsx'), read('client/src/Listening.jsx'), read('client/src/PressureLadder.jsx'),
    read('client/src/SatzbauSchmiede.jsx'), read('client/src/SpokenReview.jsx'), read('client/src/FluencyDrill.jsx'),
  ]);
  for (const source of drills) {
    assert.match(source, /const tutorSession = useSalmaDrillSession\(token,/u);
    assert.match(source, /drillSession=\{tutorSession\}/u);
  }
});

test('takeover, fight start, capture, native and browser drill playback share stop safety', async () => {
  const [takeover, app, recorder, native, tutor] = await Promise.all([
    read('client/src/SalmaTakeover.jsx'), read('client/src/App.jsx'), read('client/src/clipRecorder.js'),
    read('client/src/nativeVoice.js'), read('client/src/SalmaTutorPanel.jsx'),
  ]);
  assert.match(takeover, /speechStopRef/u);
  assert.match(takeover, /return \(\) => \{ removeHiddenStop\(\); stopSpeech\(\); \}/u);
  assert.match(app, /const beginSession = useCallback\(async \(\) => \{\s*\/\/[^\n]*\s*stopTutorPlayback\(\);/u);
  assert.match(recorder, /async start\(\) \{\s*\/\/[^\n]*\s*stopTutorPlayback\(\);/u);
  assert.match(native, /u\.onstart = \(\) => \{ releaseIndependent = beginIndependentPlayback\(\)/u);
  assert.match(native, /if \(!salma && !releaseIndependent\) releaseIndependent = beginIndependentPlayback\(\)/u);
  assert.match(tutor, /stopTutorWhenDocumentHidden\(\)/u);
  assert.doesNotMatch(tutor, /const automaticCueCounts = new Map/u);
});
