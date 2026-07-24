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

test('first diagnosis is selected by BrainGuide and cannot bypass it through Salma or the legacy CTA', async () => {
  const [app, takeover] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/src/SalmaTakeover.jsx'),
  ]);
  const firstMount = section(app, '// THE one first-mount decision point:', '}, []);');
  const welcome = section(takeover, "if (beat === 'welcome')", "} else if (beat === 'verdict')");

  assert.doesNotMatch(app, /localStorage\.setItem\(['"]bpo_pending_assessment['"]/u,
    'signup must not schedule the legacy text assessment');
  assert.doesNotMatch(firstMount, /setAssessmentOpen\(true\)/u,
    'first mount must not auto-open a second diagnostic');
  assert.match(firstMount, /live spoken diagnosis/u);
  assert.doesNotMatch(welcome, /onBookFight\(null\)/u,
    'the first-run tutor must not start a generic interview outside BrainGuide');
  assert.match(welcome, /onBrainAction\(brainDirective\)/u);
  assert.match(app, /const brainGuideAuthority = BRAIN_GUIDE_LIVE && canStart/u);
  assert.match(app, /missionContinuation: brainGuideAuthority/u);
  assert.match(app, /onAction=\{executeBrainDirective\}/u);
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

test('the landing has one truthful registration action and keeps the preview non-interactive', async () => {
  const app = await read('client/src/App.jsx');
  const preview = section(app, 'function ProductHomePreview(', 'function StudyBrowserHandoff(');
  const auth = section(app, 'function AuthScreen(', 'function PaywallScreen(');

  assert.match(preview, /function ProductHomePreview\(\)/u);
  assert.match(preview, /Beispiel: Antwort → Korrektur → Trainingsblock/u);
  assert.doesNotMatch(preview, /<button/u,
    'the preview must not masquerade as a second interview-start action');
  assert.match(auth, /const focusAuth = useCallback/u);
  assert.match(auth, /field\?\.focus\(\{ preventScroll:true \}\)/u,
    'the destination field must receive programmatic focus');
  assert.match(auth, /prefers-reduced-motion: reduce/u,
    'the transition must respect reduced-motion preferences');
  assert.match(auth, /<button onClick=\{\(\) => focusAuth\('signup'\)\}/u);
  assert.match(auth, /KOSTENLOSE DIAGNOSE FREISCHALTEN/u);
  assert.match(auth, /<ProductHomePreview \/>/u);
  assert.match(auth, /onLogin=\{\(\) => focusAuth\('login'\)\}/u);
  assert.doesNotMatch(preview, /onClick=\{\(\) => document\.getElementById\('signup-card'\)/u);
});

test('authentication mode switch exposes its selected state to assistive technology', async () => {
  const app = await read('client/src/App.jsx');
  const auth = section(app, 'function AuthScreen(', 'function PaywallScreen(');

  assert.match(auth, /aria-label="Anmeldung oder Registrierung"/u);
  assert.match(auth, /aria-pressed=\{mode === m\}/u);
});

test('public conversion fails visibly and recoverably instead of hanging or using native English errors', async () => {
  const [app, index] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/index.html'),
  ]);
  const voice = section(app, 'function VoiceReadinessCheck(', 'function AuthScreen(');
  const auth = section(app, 'function AuthScreen(', 'function PaywallScreen(');

  assert.match(voice, /microphone_permission_timeout/u);
  assert.match(voice, /8_000/u);
  assert.match(voice, /state === 'timeout'/u);
  assert.match(voice, /Mikrofon-Berechtigung/u);
  assert.match(auth, /<main className="auth-shell"/u);
  assert.match(auth, /overflowX:'hidden', overflowY:'visible'/u);
  assert.match(auth, /<form noValidate/u);
  assert.match(auth, /role="alert" aria-live="assertive"/u);
  assert.match(auth, /Passwort anzeigen/u);
  assert.match(auth, /type=\{showPw \? 'text' : 'password'\}/u);
  assert.match(auth, /<h1 dir="rtl" lang="ar-EG"/u);
  assert.match(index, /<link rel="canonical" href="https:\/\/omni-perform\.vercel\.app\/"/u);
});

test('production readiness logging never emits correlatable learner attributes', async () => {
  const progress = await read('server/progress.js');
  assert.doesNotMatch(progress, /\[hire-readiness\][^\n]*(?:user=|level=|gap=|ready=)/u);
});

test('BrainGuide explains the candidate-profile action in learner outcomes instead of product jargon', async () => {
  const [brain, mission] = await Promise.all([
    read('client/src/BrainGuide.jsx'),
    read('client/src/CandidateMissionControl.jsx'),
  ]);

  assert.match(brain, /passport: 'Dein Bewerbungsprofil erstellen'/u);
  assert.match(brain, /Zieljob, Erfahrung, Verfügbarkeit und bestätigte Stärken eintragen/u);
  assert.match(brain, /BEWERBUNGSPROFIL ERSTELLEN/u);
  assert.doesNotMatch(brain, /Kandidaten-Pass prüfen|passport:'PASS PRÜFEN'/u);
  assert.match(mission, /title="Dein privates Bewerbungsprofil"/u);
  assert.match(mission, /passende Stellen und Bewerbungshilfen/u);
  assert.match(mission, /PROFIL SPEICHERN/u);
});

test('the live home exposes one creative orientation contract and one primary action', async () => {
  const [app, brain, policy] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/src/BrainGuide.jsx'),
    read('client/src/brainActionPolicy.js'),
  ]);

  assert.match(app, /canStart && homePrimaryAction\.showGenericInterview/u);
  assert.match(app, /brainGuideAuthority \? 'Deine Mission' : 'Dein Interview'/u);
  assert.match(app, /Ein klarer Schritt auf dem Weg zum deutschen Jobinterview/u);
  assert.doesNotMatch(app, /<BrainGuide[^>]*externalInterviewCta/u);
  assert.match(policy, /showGenericInterview: false/u);
  // Orientation contract (premium pass 2026-07-24): the three facts — why now, what counts as
  // done, what comes next — plus the north-star goal must still render, and must still render
  // WITHOUT a discovery click. Only their chrome changed: they were three numbered, individually
  // labelled cards; nine uppercase micro-labels on one screen is what made this app read as
  // machine-made, so the same facts are now quiet prose under the action.
  assert.match(brain, /<div className="brain-guide__orient"/u);
  assert.match(brain, /<p>\{reason\}<\/p>/u);
  assert.match(brain, /\{brief\.done\}/u);
  assert.match(brain, /brief\.after/u);   // wrapped to strip a duplicated leading "Danach"
  assert.match(brain, /\{biggerGoal\(d\)\}/u);
  assert.match(brain, /DEIN WEG ZUM DEUTSCHEN JOBINTERVIEW/u);
  assert.doesNotMatch(brain, /<details className="brain-guide__why"/u,
    'the reason and completion contract must be visible without discovery clicks');
  assert.doesNotMatch(brain, /<details[^>]*brain-guide__orient/u,
    'orientation may be made quieter, never hidden behind a toggle');
});

test('BrainGuide renders useful loading and recoverable error states instead of disappearing', async () => {
  const brain = await read('client/src/BrainGuide.jsx');
  const fallback = section(brain, 'if (!data?.directive) return (', 'const d = data.directive;');

  assert.match(fallback, /role=\{loadState === 'loading' \? 'status' : 'alert'\}/u);
  assert.match(fallback, /Dein persönlicher Schritt wird berechnet/u);
  assert.match(fallback, /Dein persönlicher Schritt konnte noch nicht geladen werden/u);
  assert.match(fallback, /Deine Messdaten bleiben erhalten/u);
  assert.match(fallback, /setCoachRevision\(\(value\) => value \+ 1\)/u);
  assert.match(fallback, /ERNEUT LADEN/u);
  assert.doesNotMatch(fallback, /return null/u);
});

test('expired BrainGuide sessions recover through a real sign-in path instead of an endless retry loop', async () => {
  const [app, brain] = await Promise.all([
    read('client/src/App.jsx'),
    read('client/src/BrainGuide.jsx'),
  ]);

  assert.match(brain, /if \(r\.status === 401\)/u);
  assert.match(brain, /setLoadState\('auth'\)/u);
  assert.match(brain, /Deine Sitzung ist abgelaufen/u);
  assert.match(brain, /onClick=\{onSessionExpired\}/u);
  assert.match(brain, /ERNEUT ANMELDEN/u);
  assert.match(app, /onSessionExpired=\{onLogout\}/u,
    'the recovery action must clear stale authentication through the canonical logout path');
});

test('BrainGuide suppresses the legacy how-to card that can describe a different next action', async () => {
  const app = await read('client/src/App.jsx');

  assert.match(app, /\{canStart && showHowto && !brainGuideAuthority && \(/u);
  assert.match(app, /<BrainGuide[\s\S]*?onAction=\{executeBrainDirective\}/u);
});

test('debrief uses the canonical tutor and one personal next-step action; interview retries stay secondary', async () => {
  const app = await read('client/src/App.jsx');
  const debrief = section(app, 'function Debrief(', 'function Section(');

  assert.match(debrief, /<SalmaTutorPanel[^>]*screen="debrief"/u,
    'the measured prescription must come from the canonical coach endpoint');
  assert.doesNotMatch(debrief, /debrief_followup_(?:next|top)|WOCHENFOKUS/u,
    'generic follow-ups must not compete with the evidence-backed tutor prescription');
  // v2 Phase 4: the dominant route OPENS the personal step (bottleneck brief + generated
  // exercise block); plain route-home stays only as the fallback when no step handler exists.
  assert.equal((debrief.match(/onClick=\{onPersonalStep \|\| onDone\}/gu) || []).length, 1,
    'there must be exactly one dominant route to the personal training block');
  assert.equal((debrief.match(/onClick=\{onDone\}/gu) || []).length, 0,
    'no second plain route-home button may compete with the personal step');
  assert.match(debrief, /PERSÖNLICHEN (?:TRAININGSBLOCK|SCHRITT)/u);
  assert.doesNotMatch(debrief, /onClick=\{onDone \|\| onRestart\}/u);

  const primary = debrief.indexOf('onClick={onPersonalStep || onDone}');
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
