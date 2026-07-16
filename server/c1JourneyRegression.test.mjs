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
});

test('typed practice cannot award spoken progression or XP', async () => {
  const wsSource = await readFile(new URL('./websocketManager.js', import.meta.url), 'utf8');
  assert.match(wsSource, /const meaningful\s*=\s*\(metrics\.answers[\s\S]*evidenceQuality\.eligible\s*===\s*true/u);
  assert.match(wsSource, /session NOT counted \(insufficient trusted speech\)/u);
});

test('spoken headline calculation enforces Evidence Contract v2 before grading', async () => {
  const source = await readFile(new URL('./websocketManager.js', import.meta.url), 'utf8');
  const gate = source.indexOf('if (!spokenEvidence.prescriptionEligible)');
  const grade = source.indexOf('const graded = await gradeTranscript', gate);
  assert.ok(gate > 0 && grade > gate);
  assert.match(source, /rank, gradeUnavailable, verdict, gradeSource: 'panelscorer', spokenEvidence/u);
});
