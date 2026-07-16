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
  const [takeover, brain, daily] = await Promise.all([
    read('client/src/SalmaTakeover.jsx'),
    read('client/src/BrainGuide.jsx'),
    read('client/src/DailyTraining.jsx'),
  ]);
  assert.doesNotMatch(takeover, /salma-talk\.jpg|face mouth|mouth-talk/u);
  assert.doesNotMatch(brain, /greetedThisSession|returning_welcome/u);
  assert.doesNotMatch(takeover, /autoNext|spokenRef|pre-synthesize her OPENING/u);
  assert.doesNotMatch(daily, /salmaSpeak|drill_handoff|drill_done/u,
    'opening or completing an ordinary drill must not trigger generic Salma speech');
  assert.doesNotMatch(daily, /Fehler geschlossen|DEINE FEHLER VON GESTERN/u,
    'daily completion and source labels must not overclaim mastery or mistake provenance');
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
  const recorder = await read('client/src/clipRecorder.js');
  assert.match(panel, /ClipRecorder/u);
  assert.match(panel, /\/api\/transcribe/u);
  assert.match(panel, /X-Salma-Coach/u);
  assert.match(panel, /salmaModel/u);
  assert.match(panel, /setQuestion\(body\.text\)/u,
    'a recognized spoken question must remain visible until Salma answers it');
  assert.match(panel, /Stimme erkannt/u);
  assert.doesNotMatch(panel, /question_limit_reached|Fragenlimit/u);
  assert.match(recorder, /onError:\s+onError \|\|/u,
    'mid-recording microphone failures must reach the tutor UI');
  assert.doesNotMatch(panel, /getUserMedia|WebSocket/u);
});

test('tutor separates observed patterns from unproven causes without adding another action', async () => {
  const [panel, core] = await Promise.all([
    read('client/src/SalmaTutorPanel.jsx'),
    read('server/salmaCoachCore.js'),
  ]);
  assert.match(core, /diagnosticTruth: flags\.enabled \? readiness\.diagnosticTruth : null/u);
  assert.match(panel, /WAS DIE MESSUNG WEISS — UND WAS NICHT/u);
  assert.match(panel, /Die Ursache ist damit nicht bewiesen/u);
  assert.match(panel, /Keine psychologische Diagnose/u);
  assert.match(panel, /TRUTH_DISCRIMINATOR_LABELS/u);
  assert.doesNotMatch(panel, /onClick=.*nextDiscriminatorId/u,
    'the discriminator is an explanation inside BrainGuide, never a competing CTA');
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

test('a corrected attempt clears stale tutor cues and every panel owns a unique question id', async () => {
  const [reporter, panel] = await Promise.all([
    read('client/src/salmaCoachClient.js'),
    read('client/src/SalmaTutorPanel.jsx'),
  ]);
  assert.match(reporter, /cue: body\.coachCue \|\| null/u);
  assert.match(panel, /Object\.hasOwn\(detail, 'cue'\)/u);
  assert.match(panel, /setCue\(detail\.cue\?\.text \? detail\.cue : null\)/u);
  assert.match(panel, /setCue\(initialCue\?\.text \? initialCue : null\)/u);
  assert.match(panel, /useId\(\)/u);
  assert.doesNotMatch(panel, /const questionId = `salma-question-\$\{String\(drillId \|\| screen\)/u);
});

test('targeted Spoken Review cannot finish from no-speech or unrelated-card progress', async () => {
  const [spoken, spokenServer] = await Promise.all([
    read('client/src/SpokenReview.jsx'),
    read('server/spokenReview.js'),
  ]);
  assert.match(spoken, /result\.prescriptionProgress\?\.targeted && !result\.prescriptionProgress\.completed/u);
  assert.match(spoken, /!result\.retry/u);
  assert.match(spoken, /prescription\?\.missingTarget/u);
  assert.match(spoken, /Damit der Satz im Interview sicher sitzt/u);
  assert.match(spoken, /useSalmaDrillSession\(token, 'sag-es-richtig'\)/u);
  assert.match(spoken, /drillId="sag-es-richtig"/u);
  assert.match(spokenServer, /canonicalSkillId === active\.skillId/u);
  assert.match(spokenServer, /targetedSpokenReviewQueue/u);
  assert.match(spokenServer, /lastCoachPrescriptionId/u);
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
  assert.match(websocket, /forcedBehavioralPromptId: retestContext\?\.forcedBehavioralPromptId/u);
  assert.match(websocket, /excludedBehavioralPromptIds: retestContext\?\.excludedBehavioralPromptIds/u);
  assert.match(websocket, /forcedScreeningPromptId: retestContext\?\.forcedScreeningPromptId/u);
  assert.match(websocket, /excludedScreeningPromptIds: retestContext\?\.excludedScreeningPromptIds/u);
  assert.match(websocket, /contentSeed: retestContext\?\.contentSeed/u);
  assert.match(websocket, /forcedMood: retestContext\?\.forcedMood/u);
  assert.match(websocket, /retestProbe/u);
  assert.match(websocket, /const revanche = !improvementRetest/u,
    'a client revenge session cannot authorize a prescribed retest');
  assert.match(websocket, /createSpeakingTaskContract/u);
  assert.match(websocket, /speakingTaskContract: ctx\.speakingTaskContract/u);
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

test('the home tutor keeps one dominant action and progressively discloses exact evidence', async () => {
  const [brain, panel] = await Promise.all([
    read('client/src/BrainGuide.jsx'),
    read('client/src/SalmaTutorPanel.jsx'),
  ]);

  for (const signal of [
    'wpm', 'grammar_errors_by_rule', 'intelligibility', 'service_recovery_steps',
    'response_continuity', 'latencyS', 'fillerPer100', 'subClauseRate', 'vocabDiversity',
  ]) {
    assert.match(brain, new RegExp(`${signal}:`, 'u'), `${signal} needs an exact learner-facing measurement label`);
  }
  assert.match(brain, /wpm: \{ label: 'Sprechtempo', unit: 'Wörter\/Min\.' \}/u);
  assert.doesNotMatch(brain, /Interviewerin kennt deine Akte/u);
  assert.doesNotMatch(brain, /salmaLine\('note_trial'/u,
    'trial marketing must not enter Salma playback or the next-action card');

  const actionIndex = brain.indexOf('<button style={cta}');
  const tutorIndex = brain.indexOf('<SalmaTutorPanel');
  assert.ok(actionIndex >= 0 && tutorIndex > actionIndex,
    'BrainGuide action must remain ahead of tutor details');
  assert.match(panel, />Warum genau das\?<\/summary>/u);
  assert.match(panel, />\s*Salma fragen\s*<\/summary>/u);
  assert.match(panel, /Fertig, wenn:/u);
  assert.match(panel, /Saubere Wiederholungen:/u);
  assert.match(panel, /Tutor-Einstellungen/u);
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

test('the debrief does not invent a fixed homework order beside BrainGuide', async () => {
  const app = await read('client/src/App.jsx');
  assert.doesNotMatch(app, /homework_order_top|unter 5 Grammatik-Fehler|15 Minuten heute und 15 Minuten morgen/u);
  assert.match(app, /<SalmaTutorPanel token=\{token\} apiUrl=\{apiUrl\} screen="debrief" \/>/u);
  assert.match(app, /onClick=\{onDone\}/u);
  assert.match(app, /PERSÖNLICHEN SCHRITT ÖFFNEN/u);
  assert.doesNotMatch(app, /debrief_followup_next|WOCHENFOKUS/u);
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

  assert.match(brain, /setData\(null\);\s*setLoadState\('loading'\);\s*onDirectiveState\?\.\(\{ status: 'loading', directive: null \}\)/u);
  assert.match(brain, /status: 'ready', directive: d\.directive/u);
  assert.match(brain, /status: 'error', directive: null/u);

  assert.match(panel, /coachRequestRef/u);
  assert.match(panel, /setCoach\(null\)/u);
  assert.match(panel, /requestId !== coachRequestRef\.current/u);
  assert.match(panel, /rawProof\?\.phase === 'transfer' && !masteryConfirmed \? null : rawProof/u);
});
