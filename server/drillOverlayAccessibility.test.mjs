import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../client/src/${file}`, import.meta.url), 'utf8');

test('every full-screen core drill uses the shared modal isolation contract', () => {
  for (const file of ['DailyTraining.jsx', 'FluencyDrill.jsx', 'Listening.jsx', 'Shadowing.jsx', 'SpokenReview.jsx', 'SatzbauSchmiede.jsx']) {
    const source = read(file);
    assert.match(source, /useAccessibleOverlay/, `${file} must use the shared overlay contract`);
    assert.match(source, /<div \{\.\.\.overlayProps\}/, `${file} must apply the modal props to its full-screen root`);
  }
});

test('the progress dashboard uses the same modal isolation contract', () => {
  const source = read('App.jsx');
  assert.match(source, /function Dashboard[\s\S]*useAccessibleOverlay\(onClose, 'Fortschritt'\)/);
  assert.match(source, /<div \{\.\.\.overlayProps\} style=\{\{ position:'absolute'/);
});

test('the pricing takeover uses the same modal isolation contract', () => {
  const source = read('App.jsx');
  assert.match(source, /function PaywallScreen[\s\S]*useAccessibleOverlay\(onClose, 'Plan wählen'\)/);
  assert.match(source, /<div \{\.\.\.overlayProps\} style=\{\{ position:'absolute', inset:0, zIndex:220/);
});

test('the private dossier is modal and does not claim external verification or certainty', () => {
  const source = read('App.jsx');
  assert.match(source, /DossierSheet[\s\S]*useAccessibleOverlay\(onClose, 'Bewerbungs-Dossier'\)/);
  assert.doesNotMatch(source, /nichts ist\s*geschätzt, nichts wird versprochen\. Verifizierbar/);
  assert.match(source, /Das Deutsch-Niveau ist eine interne[\s\S]*Schätzung/);
  assert.match(source, /kein Zertifikat[\s\S]*keine Jobgarantie/);
  assert.match(source, /=== 1 \? 'Tag' : 'Tage'/);
});

test('feedback is a labelled modal with named, large rating controls', () => {
  const source = read('Feedback.jsx');
  assert.match(source, /useAccessibleOverlay\(close, 'Feedback', open\)/);
  assert.match(source, /aria-label=\{`\$\{n\}/);
  assert.match(source, /aria-pressed=\{rating === n\}/);
  assert.match(source, /minWidth: 44, minHeight: 44/);
  assert.match(source, />★<\/button>/);
});

test('home settings and debrief controls keep a 44px touch target', () => {
  const source = read('App.jsx');
  assert.match(source, /setShowOpts[\s\S]{0,220}minHeight:44/);
  for (const label of ['Interviewer auswählen', 'Zielbranche auswählen']) {
    const start = source.indexOf(`aria-label="${label}"`);
    assert.ok(start >= 0, `${label} must exist`);
    assert.match(source.slice(start, start + 1200), /minHeight:44/);
  }
  assert.match(source, /chooseFeedbackLang\(id\)[\s\S]{0,140}minHeight:44/);
  assert.match(source, /dismissLastDebrief[\s\S]{0,160}minHeight:44/);
});

test('the shared overlay contract isolates background, traps focus, supports Escape, and restores focus', () => {
  const source = read('useAccessibleOverlay.js');
  assert.match(source, /role: 'dialog'/);
  assert.match(source, /'aria-modal': 'true'/);
  assert.match(source, /node\.inert = true/);
  assert.match(source, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /previousFocus\.focus/);
});

test('audio graph cleanup is idempotent and consumes async close rejection', () => {
  const gemini = read('geminiVoice.js');
  const native = read('nativeVoice.js');
  assert.match(gemini, /ctx\.state !== 'closed'/);
  assert.match(gemini, /ctx\.close\(\)\?\.catch\?\./);
  assert.match(native, /new Set\(\[levelWire\?\.ctx, phoneCtx\]/);
  assert.match(native, /ctx\.state === 'closed'/);
  assert.match(native, /ctx\.close\(\)\?\.catch\?\./);
});
