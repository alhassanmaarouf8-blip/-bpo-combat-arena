import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('App keeps Salma speech user-initiated and never autoplays generic result copy', async () => {
  const app = await read('client/src/App.jsx');
  const speechLines = app.split(/\r?\n/u).filter((line) => line.includes('salmaSpeak('));

  assert.ok(speechLines.length > 0, 'manual Salma listening controls should remain available');
  for (const line of speechLines) {
    assert.match(line, /onClick=\{\(\) => salmaSpeak\(/u,
      'every App-level Salma playback must require a direct click');
  }
  assert.doesNotMatch(app, /import\s+\{?\s*salmaModel\b/u);
  assert.doesNotMatch(app, /rankCeremony[^\n]*salmaSpeak|debrief[^\n]*auto[^\n]*salma/iu);
});

test('first diagnosis is the universal live interview, not the legacy assessment fallback', async () => {
  const [app, takeover] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/src/SalmaTakeover.jsx'),
  ]);
  const firstMount = section(app, '// THE one first-mount decision point:', '}, []);');

  assert.doesNotMatch(app, /localStorage\.setItem\(['"]bpo_pending_assessment['"]/u,
    'signup must not schedule the legacy text assessment');
  assert.doesNotMatch(firstMount, /setAssessmentOpen\(true\)/u,
    'first mount must not auto-open a second diagnostic');
  assert.match(firstMount, /live spoken diagnosis/u);
  assert.match(takeover, /onBookFight\(null\)/u,
    'the first-run tutor must start the same live diagnostic used by the product');
  assert.doesNotMatch(takeover, /onStartScreening/u);
});

test('study invite verification preserves the landing page and gates submit without a full-screen block', async () => {
  const app = await read('client/src/App.jsx');
  const auth = section(app, 'function AuthScreen(', 'function PaywallScreen(');

  assert.match(auth, /const studyInviteLanding = studyEntryChecking \|\| validStudyEntry/u);
  assert.match(auth, /role="status" aria-live="polite"/u);
  assert.match(auth, /disabled=\{busy \|\| studyEntryChecking\}/u);
  assert.match(auth, /studyEntryChecking \? 'ZUGANG WIRD GEPRÜFT/u);
  assert.doesNotMatch(auth, /if\s*\(studyEntryChecking\)\s*return/u);
  assert.doesNotMatch(auth, /studyEntryChecking\s*&&\s*<LazyFallback|studyEntryChecking\s*&&\s*<Loading/u);
});

test('BrainGuide renders useful loading and recoverable error states instead of disappearing', async () => {
  const brain = await read('client/src/BrainGuide.jsx');
  const fallback = section(brain, 'if (!data?.directive) return (', 'const d = data.directive;');

  assert.match(fallback, /role=\{loadState === 'error' \? 'alert' : 'status'\}/u);
  assert.match(fallback, /Dein persönlicher Schritt wird berechnet/u);
  assert.match(fallback, /Dein persönlicher Schritt konnte noch nicht geladen werden/u);
  assert.match(fallback, /Deine Messdaten bleiben erhalten/u);
  assert.match(fallback, /setCoachRevision\(\(value\) => value \+ 1\)/u);
  assert.match(fallback, /ERNEUT LADEN/u);
  assert.doesNotMatch(fallback, /return null/u);
});

test('debrief uses the canonical tutor and one personal next-step action; interview retries stay secondary', async () => {
  const app = await read('client/src/App.jsx');
  const debrief = section(app, 'function Debrief(', 'function Section(');

  assert.match(debrief, /<SalmaTutorPanel[^>]*screen="debrief"/u,
    'the measured prescription must come from the canonical coach endpoint');
  assert.doesNotMatch(debrief, /debrief_followup_(?:next|top)|WOCHENFOKUS/u,
    'generic follow-ups must not compete with the evidence-backed tutor prescription');
  assert.equal((debrief.match(/onClick=\{onDone\}/gu) || []).length, 1,
    'there must be exactly one dominant route to the personal training block');
  assert.match(debrief, /PERSÖNLICHEN (?:TRAININGSBLOCK|SCHRITT)/u);
  assert.doesNotMatch(debrief, /onClick=\{onDone \|\| onRestart\}/u);

  const primary = debrief.indexOf('onClick={onDone}');
  const retry = debrief.indexOf('onClick={onRestart}', primary + 1);
  assert.ok(primary >= 0 && retry > primary,
    'another interview may remain only after the personal training route as a secondary action');
});

test('Salma distinguishes tentative risk from a repeatedly observed high-confidence bottleneck', async () => {
  const panel = await read('client/src/SalmaTutorPanel.jsx');

  assert.doesNotMatch(panel, /'DEIN ENGPASS'/u,
    'a single or medium-confidence observation must not be labeled as a settled bottleneck');
  assert.match(panel, /MEHRFACH BEOBACHTETER ENGPASS/u,
    'high-confidence repeated evidence needs an explicit repeated-observation heading');
  assert.match(panel, /BEOBACHTETES RISIKO[^'\n]*(?:NOCH|WEITER)[^'\n]*BESTÄTIG/u,
    'lower-confidence evidence must say that confirmation is still required');
  assert.match(panel, /forecast\?\.confidence === 'high'/u,
    'the stronger heading must be gated by server confidence');
});

test('client briefing fails closed: only explicit practice may reveal coaching phrases or scrutiny', async () => {
  const app = await read('client/src/App.jsx');
  const handler = section(app, 'case S.SCENARIO_INFO:', 'case S.BOSS_SPEECH_EARLY:');

  assert.match(handler, /const practice = msg\.briefingMode === 'practice'/u);
  assert.match(handler, /keyPhrases: practice && Array\.isArray\(msg\.csBriefing\.keyPhrases\)/u);
  assert.match(handler, /scrutiny: practice \? \(msg\.scrutiny \|\| null\) : null/u);
  assert.doesNotMatch(handler, /briefingMode\s*!==\s*'assessment'|briefingMode\s*\?\?\s*'practice'/u);
});

test('server briefing keeps diagnostic and improvement retests uncontaminated', async () => {
  const websocket = await read('server/websocketManager.js');

  assert.match(websocket, /const revanche = !improvementRetest && \[0, 1, 2\]\.includes\(revancheStage\)/u,
    'a forged revanche must never override a matched or transfer retest');
  assert.match(websocket, /const briefingMode = revanche \? 'practice' : 'assessment'/u,
    'missing, diagnostic, matched and transfer sessions must all default to assessment');
  assert.match(websocket, /keyPhrases: briefingMode === 'practice' && Array\.isArray\(rawBriefing\.keyPhrases\)[\s\S]*?: \[\]/u);
  assert.match(websocket, /scrutiny: briefingMode === 'practice' \? \(ctx\.targetWeakRule \|\| null\) : null/u);
  assert.match(websocket, /briefingMode,/u);
});
