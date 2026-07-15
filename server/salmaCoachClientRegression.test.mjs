import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { primaryActionPolicy } from '../client/src/brainActionPolicy.js';

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

test('verified drill evidence refreshes both guides and APPLY opens Mission Control', async () => {
  const [reporter, brain, panel, app] = await Promise.all([
    read('client/src/salmaCoachClient.js'),
    read('client/src/BrainGuide.jsx'),
    read('client/src/SalmaTutorPanel.jsx'),
    read('client/src/App.jsx'),
  ]);
  assert.match(reporter, /omni:coach-state-changed/u);
  assert.match(brain, /addEventListener\('omni:coach-state-changed'/u);
  assert.match(panel, /addEventListener\('omni:coach-state-changed'/u);
  assert.match(app, /p\.action === 'apply'\) setMissionOpenRequest/u);
  assert.doesNotMatch(app, /p\.action === 'apply'\) beginSession/u);
  assert.match(brain, /d\.prescription\?\.action !== 'wait'/u);
});

test('coaching progress accepts one-use server evidence instead of client-claimed outcomes', async () => {
  const [reporter, progress, satzbau, listening, fluency, pressure, shadowing] = await Promise.all([
    read('client/src/salmaCoachClient.js'),
    read('server/progress.js'),
    read('server/satzbauSchmiede.js'),
    read('server/listening.js'),
    read('server/fluencyDrill.js'),
    read('server/druckLeiter.js'),
    read('server/shadowing.js'),
  ]);
  assert.match(reporter, /evidenceReceipt/u);
  assert.doesNotMatch(reporter, /JSON\.stringify\(event\)/u);
  assert.match(progress, /redeemDrillEvidenceReceipt/u);
  assert.match(progress, /verified_drill_evidence_required/u);
  assert.match(progress, /drill_evidence_mismatch/u);
  for (const grader of [satzbau, listening, fluency, pressure, shadowing]) {
    assert.match(grader, /issueDrillEvidenceReceipt/u);
  }
});

test('the live interview snapshots the completed prescription and closes only that same cycle', async () => {
  const websocket = await read('server/websocketManager.js');
  assert.match(websocket, /salmaRetestTarget\(prof\.salmaCoach, prof\)/u);
  assert.match(websocket, /targetImprovementSkillId/u);
  assert.match(websocket, /prior\.id === ctx\.targetImprovementPrescriptionId/u);
  assert.match(websocket, /recordMeaningfulRetest\(p\.salmaCoach, p/u);
  assert.match(websocket, /forcedScenarioId: retestContext\?\.forcedScenarioId/u);
  assert.match(websocket, /excludedScenarioIds: retestContext\?\.excludedScenarioIds/u);
  assert.match(websocket, /!improvementRetest && msg\.bossId/u);
});

test('the live evaluator snapshots and forwards the exact scenario id instead of an object', async () => {
  const websocket = await read('server/websocketManager.js');
  assert.match(websocket, /ctx\.csScenarioId = picks\?\.cs\?\.id \|\| null/u);
  assert.match(websocket, /csScenarioId: ctx\.csScenarioId \|\| 'general'/u);
  assert.match(websocket, /scenarioId: ctx\.csScenarioId \|\| 'general'/u);
  assert.doesNotMatch(websocket, /csScenarioId: ctx\.csScenario(?:\s|,|\})/u);
  assert.doesNotMatch(websocket, /scenarioId: ctx\.csScenario(?:\s|,|\})/u);
});

test('the product measures the prescription → block → verified-retest funnel without identifiers', async () => {
  const panel = await read('client/src/SalmaTutorPanel.jsx');
  const beacon = await read('server/funnelBeacon.js');
  for (const event of ['salma_prescription_shown', 'salma_block_completed', 'salma_retest_improved', 'salma_retest_held', 'salma_retest_regressed']) {
    assert.match(panel + beacon, new RegExp(event, 'u'));
  }
  assert.match(panel, /JSON\.stringify\(\{ e: event \}\)/u);
});

test('the tutor labels observed risk honestly and exposes delayed listening retest timing without another CTA', async () => {
  const panel = await read('client/src/SalmaTutorPanel.jsx');
  const app = await read('client/src/App.jsx');
  const brain = await read('client/src/BrainGuide.jsx');
  assert.match(panel, /GRÖSSTES RISIKO IM AKTUELLEN ZIELINTERVIEW/u);
  assert.match(panel, /BEOBACHTETES RISIKO IN DIESER SIMULATION/u);
  assert.match(panel, /alte oder entfernte Stellenziele/u);
  assert.match(panel, /keine Vorhersage einer Arbeitgeberentscheidung/u);
  assert.match(panel, /interne Referenz/u);
  assert.match(panel, /Hörnachweis/u);
  assert.match(panel, /gilt aber nicht als Retest/u);
  assert.doesNotMatch(app, /JETZT GEZIELT TRAINIEREN/u);
  assert.doesNotMatch(app, /INTERVIEW-BEREITSCHAFT/u);
  assert.doesNotMatch(panel, /90%|Einstellung garantiert|wirst eingestellt/u);
  assert.doesNotMatch(brain, /blockiert.*Einstellung|جاهز تشتغل/u);
  assert.match(brain, /internen Einstiegskriterien der Simulation/u);
});

test('improvement copy is metric-correct transfer evidence without causal or hiring overclaim', async () => {
  const [brain, alhassan] = await Promise.all([
    read('client/src/BrainGuide.jsx'),
    read('server/alhassan.js'),
  ]);
  assert.match(brain, /VERIFIZIERTER TRANSFER/u);
  assert.match(brain, /verzögerten Transfer-Retest mit neuer Situation bestätigt/u);
  assert.match(brain, /fluency_score: \{ label: 'Sprechfluss', unit: 'Punkte' \}/u);
  assert.doesNotMatch(brain, /nicht Zufall|von \$\{d\.aha\.before\} Fehlern auf/u);
  assert.doesNotMatch(alhassan, /CONFIRMED, REAL WIN|living proof their work pays off/u);
  assert.match(alhassan, /do not claim the drill alone caused it/u);
  assert.match(alhassan, /do not call them hired or hireable/u);
});

test('BrainGuide is the only returning-user primary action authority', () => {
  const ready = (action) => primaryActionPolicy({
    brainGuideEnabled: true,
    missionContinuation: true,
    status: 'ready',
    directive: { prescription: { action } },
  });

  assert.equal(primaryActionPolicy().showGenericInterview, true);
  assert.equal(primaryActionPolicy({ brainGuideEnabled: true, missionContinuation: false }).showGenericInterview, true);
  assert.equal(ready('interview').showGenericInterview, true);
  assert.equal(ready('measure').showGenericInterview, true);
  for (const action of ['assessment', 'drill', 'wait', 'vacancy', 'mission', 'apply', 'unknown']) {
    assert.equal(ready(action).showGenericInterview, false, `${action} must not compete with a generic interview CTA`);
  }
  for (const status of ['idle', 'loading', 'error']) {
    const result = primaryActionPolicy({
      brainGuideEnabled: true,
      missionContinuation: true,
      status,
      directive: { prescription: { action: 'interview' } },
    });
    assert.equal(result.showGenericInterview, false, `${status} must fail closed`);
  }
  assert.equal(primaryActionPolicy({
    brainGuideEnabled: true,
    missionContinuation: true,
    status: 'ready',
    directive: null,
  }).showGenericInterview, false);
});

test('home clears stale guidance and cannot display unsupported readiness or transfer claims', async () => {
  const [app, brain, panel] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/src/BrainGuide.jsx'),
    read('client/src/SalmaTutorPanel.jsx'),
  ]);

  assert.match(app, /primaryActionPolicy/u);
  assert.match(app, /onDirectiveState=\{setBrainDecision\}/u);
  assert.match(app, /homePrimaryAction\.showGenericInterview/u);
  assert.doesNotMatch(app, /\{rank && <RankLadder/u);

  assert.match(brain, /setData\(null\);\s*onDirectiveState\?\.\(\{ status: 'loading', directive: null \}\)/u);
  assert.match(brain, /status: 'ready', directive: d\.directive/u);
  assert.match(brain, /status: 'error', directive: null/u);

  assert.match(panel, /coachRequestRef/u);
  assert.match(panel, /setCoach\(null\)/u);
  assert.match(panel, /requestId !== coachRequestRef\.current/u);
  assert.match(panel, /rawProof\?\.phase === 'transfer' && !masteryConfirmed \? null : rawProof/u);
});
