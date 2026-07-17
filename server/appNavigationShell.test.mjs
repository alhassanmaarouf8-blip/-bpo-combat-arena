import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../client/src/AppShell.css', import.meta.url), 'utf8');

test('returning-user navigation exposes only today, practice, and progress', () => {
  assert.match(app, /canStart && !firstRun && \(\s*<nav className="app-navigation"/);
  assert.match(app, /aria-label="Heute: dein nächster Schritt"/);
  assert.match(app, /aria-label="Übungen öffnen"/);
  assert.match(app, /aria-label="Fortschritt öffnen"/);
  assert.doesNotMatch(app, /app-navigation__item[^>]+(?:Vacancy|Salma|Preise|Streak)/);
});

test('navigation points to the existing BrainGuide mission and practice library', () => {
  assert.match(app, /selectHomeView\('today'\)/);
  assert.match(app, /id="today-mission"[^>]+className="home-section-anchor"/);
  assert.match(app, /selectHomeView\('practice'\)/);
  assert.match(app, /id="practice-library"[^>]+className="home-section-anchor"/);
  assert.match(app, /onClick=\{openDashboard\}/);
});

test('shell is a desktop rail and mobile bottom navigation with accessible targets', () => {
  assert.match(css, /@media \(min-width: 900px\)/);
  assert.match(css, /@media \(max-width: 899px\)/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('Today and Practice are true exclusive workspaces, not competing page sections', () => {
  assert.match(app, /const \[homeView, setHomeView\] = useState\('today'\)/);
  assert.match(app, /hidden=\{homeView !== 'today'\}/);
  assert.match(app, /homeView === 'practice' && canStart && !firstRun/);
  assert.match(app, /aria-current=\{homeView === 'today' \? 'page'/);
  assert.match(app, /aria-current=\{homeView === 'practice' \? 'page'/);
});

test('Practice highlights only a server-selected BrainGuide drill', () => {
  assert.match(app, /brainDecision\.directive\?\.prescription\?\.action === 'drill'/);
  assert.match(app, /brainDecision\.directive\.prescription\.drill/);
  assert.match(app, /data-prescribed=\{t\.id === prescribedDrill \? 'true'/);
  assert.match(app, /Number\(b\.id === prescribedDrill\) - Number\(a\.id === prescribedDrill\)/);
  assert.match(css, /\.practice-tile--prescribed/);
});
