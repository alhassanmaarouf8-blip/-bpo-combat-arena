import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Salma is a personal tutor without recruiter or booking claims', async () => {
  const copy = await read('client/src/salmaCopy.js');
  assert.match(copy, /Persönliche Interviewtrainerin/u);
  assert.doesNotMatch(copy, /Recruiterin|ich buche|ich vermittle|buche dir|Arbeitgeberin/u);
});

test('portrait has no fake mouth layer and ordinary opens do not auto-greet', async () => {
  const [takeover, brain] = await Promise.all([
    read('client/src/SalmaTakeover.jsx'),
    read('client/src/BrainGuide.jsx'),
  ]);
  assert.doesNotMatch(takeover, /salma-talk\.jpg|face mouth|mouth-talk/u);
  assert.doesNotMatch(brain, /greetedThisSession|returning_welcome/u);
  assert.doesNotMatch(takeover, /autoNext|spokenRef|pre-synthesize her OPENING/u);
});

test('unreviewed Masri is fail-closed and Salma copy speaks German until a frozen pack exists', async () => {
  const [voice, copy, media] = await Promise.all([
    read('client/src/salmaVoice.js'),
    read('client/src/salmaCopy.js'),
    read('server/transcribeRouter.js'),
  ]);
  assert.doesNotMatch(voice, /voice: ar \?/u);
  assert.match(voice, /salmaLine\(it\.key, 'de'/u);
  assert.match(copy, /let s = entry\.de/u);
  assert.doesNotMatch(copy, /lang === 'ar'/u);
  assert.match(media, /masri_pack_unavailable/u);
});

test('tutor reuses the existing recorder, transcription and Salma voice', async () => {
  const panel = await read('client/src/SalmaTutorPanel.jsx');
  assert.match(panel, /ClipRecorder/u);
  assert.match(panel, /\/api\/transcribe/u);
  assert.match(panel, /X-Salma-Coach/u);
  assert.match(panel, /salmaModel/u);
  assert.doesNotMatch(panel, /getUserMedia|WebSocket/u);
});

test('drill corrections are visible between attempts and receive persisted result cues', async () => {
  const eventReportingDrills = await Promise.all([
    read('client/src/PressureLadder.jsx'),
    read('client/src/SatzbauSchmiede.jsx'),
    read('client/src/Listening.jsx'),
  ]);
  for (const source of eventReportingDrills) {
    assert.match(source, /SalmaTutorPanel/u);
    assert.match(source, /initialCue/u);
    assert.match(source, /reportDrillEvent/u);
  }
  const spoken = await read('client/src/SpokenReview.jsx');
  const spokenServer = await read('server/spokenReview.js');
  assert.match(spoken, /SalmaTutorPanel/u);
  assert.match(spoken, /initialCue/u);
  assert.match(spoken, /d\.coachCue/u);
  assert.match(spokenServer, /recordDrillOutcome/u);
  assert.match(spokenServer, /coachCueForDrill/u);
});

test('the live interview snapshots the completed prescription and closes only that same cycle', async () => {
  const websocket = await read('server/websocketManager.js');
  assert.match(websocket, /salmaRetestTarget\(prof\.salmaCoach, prof\)/u);
  assert.match(websocket, /targetImprovementSkillId/u);
  assert.match(websocket, /prior\.id === ctx\.targetImprovementPrescriptionId/u);
  assert.match(websocket, /recordMeaningfulRetest\(p\.salmaCoach, p/u);
});

test('the product measures the prescription → block → verified-retest funnel without identifiers', async () => {
  const panel = await read('client/src/SalmaTutorPanel.jsx');
  const beacon = await read('server/funnelBeacon.js');
  for (const event of ['salma_prescription_shown', 'salma_block_completed', 'salma_retest_improved', 'salma_retest_held', 'salma_retest_regressed']) {
    assert.match(panel + beacon, new RegExp(event, 'u'));
  }
  assert.match(panel, /JSON\.stringify\(\{ e: event \}\)/u);
});
