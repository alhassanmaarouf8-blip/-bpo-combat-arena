import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { speakingEvidenceQuality } from './scoring/turnQuality.js';
import { typedAnswerEvidence } from './spokenEvidence.js';

test('a long typed pseudo-C1 interview is never eligible for a spoken verdict', () => {
  const utterances = [0, 1, 2].flatMap((stage) => [0, 1].map((index) => ({
    stage,
    text: `Obwohl ich angeblich C1 bin, beantworte ich diese komplexe Frage nur schriftlich Nummer ${index}.`,
    words: 14,
    spokenEvidence: typedAnswerEvidence(),
  })));
  const quality = speakingEvidenceQuality(utterances, { observedUntrustedTurns: utterances.length });
  assert.equal(quality.prescriptionEligible, false);
  assert.equal(quality.trustedSpokenTurns, 0);
  assert.equal(quality.excludedUntrustedTurns, 6);
});

test('typed UI owns the turn and refreshes BrainGuide and Salma after debrief', async () => {
  const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(typeOpenRef\.current\) break;/u);
  assert.match(source, /if \(msg\.transcript && !typeOpenRef\.current\)/u);
  assert.match(source, /setBrainGuideRefresh\(\(value\) => value \+ 1\);/u);
  assert.match(source, /setSalmaResume\(\(value\) => value \+ 1\);/u);
  assert.match(source, /if \(!handsFreeRef\.current\) \{[\s\S]*typeOpenRef\.current = true;[\s\S]*start\(\);[\s\S]*return;/u);
  assert.match(source, /if \(!typeOpenRef\.current && handsFreeRef\.current\) await startGeminiMic\(\);/u);
  assert.match(source, /const levelRef\s*= useRef\(level\);/u);
  assert.doesNotMatch(source, /const levelRef\s*= useRef\('a2-b1'\)/u);
  assert.match(source, /audioCapable:\s*!typeOpenRef\.current\s*&&\s*handsFreeRef\.current/u);
  assert.match(source, /stopGeminiMode\(\);[\s\S]*typeOpenRef\.current = true;[\s\S]*REQUEST_TEXT_MODE/u,
    'switching to typing must hand the active Gemini session back to the text interviewer');
});

test('typed practice cannot award spoken progression or XP', async () => {
  const wsSource = await readFile(new URL('./websocketManager.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  // The counting gate must read the SAME v2 field the CEFR grade path enforces. The old
  // `evidenceQuality.eligible` was a v1 field the v2 object never computes — permanently false,
  // so NO interview counted (live-proven 07-20). Pin the field name AND that it actually exists
  // on the quality object, so a phantom-field regression can never ship silently again.
  assert.match(wsSource, /const meaningful\s*=\s*\(metrics\.answers[\s\S]*evidenceQuality\.prescriptionEligible\s*===\s*true/u);
  assert.doesNotMatch(wsSource, /evidenceQuality\.eligible\b/u, 'the phantom v1 field must stay dead');
  assert.ok(Object.hasOwn(speakingEvidenceQuality([]), 'prescriptionEligible'),
    'the gate field must exist on the v2 quality object');
  assert.match(wsSource, /session NOT counted \(insufficient trusted speech\)/u);
  assert.match(wsSource, /score >= 68 && isTrustedSpokenEvidence\(spokenEvidence\)/u);
  assert.match(appSource, /TIPPÜBUNG ABGESCHLOSSEN/u);
  assert.match(appSource, /Sprechen wurde nicht gemessen/u);
});

test('spoken headline calculation enforces Evidence Contract v2 before grading', async () => {
  const source = await readFile(new URL('./websocketManager.js', import.meta.url), 'utf8');
  const gate = source.indexOf('if (!spokenEvidence.prescriptionEligible)');
  const grade = source.indexOf('const graded = await gradeTranscript', gate);
  assert.ok(gate > 0 && grade > gate);
  assert.match(source, /rank, gradeUnavailable, verdict, gradeSource: 'panelscorer', spokenEvidence/u);
});

test('text-mode notices close and complete interviewer lines never concatenate', async () => {
  const wsSource = await readFile(new URL('./websocketManager.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(wsSource, /type:\s*S\.BOSS_SPEECH,\s*text:\s*noticeText[\s\S]*type:\s*S\.BOSS_SPEECH_DONE/u);
  assert.doesNotMatch(appSource, /setBossText\(t\s*=>\s*t\s*\+\s*msg\.text\)/u);
  assert.match(appSource, /bossLineRef\.current\s*=\s*msg\.text;[\s\S]*setBossText\(msg\.text\)/u);
});

test('beginner memory cannot be promoted into invented biography', async () => {
  const source = await readFile(new URL('./scenarios.js', import.meta.url), 'utf8');
  assert.match(source, /NIE als Beruf, Arbeitgeber, Erfahrung oder andere biografische Tatsache/u);
  assert.match(source, /Beim letzten Mal haben Sie über/u);
});

test('parent guidance refresh cannot erase an open drill result', async () => {
  for (const relative of [
    '../client/src/SatzbauSchmiede.jsx',
    '../client/src/FluencyDrill.jsx',
    '../client/src/Shadowing.jsx',
    '../client/src/SpokenReview.jsx',
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /pricingRef\.current\?\.\(\);\s*closeRef\.current\?\.\(\)/u, relative);
    assert.doesNotMatch(source, /const blocked\s*=\s*useCallback\([^\n]+\[onGoPricing,\s*onClose\]\)/u, relative);
  }
});

test('progress and review labels agree with the active learner configuration', async () => {
  const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /interviewLevel=\{level\}/u);
  assert.match(source, /const displayPlanName = ent\.trial\?\.active \? 'TESTPHASE' : planName/u);
  assert.match(source, /Eigene Fehler & Call-Center-Sätze/u);
  assert.doesNotMatch(source, /hint:'Deine Fehler laut korrigieren'/u);
});
