import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStudyBrowserHandoffUrl, captureStudyCohortEntry, readStudyCohortEntry, stripStudyCohortParams,
  verifyStudyCohortEntry } from '../client/src/studyCohortEntry.js';

test('study entry parsing is exact and missing or malformed state stays generic', () => {
  assert.equal(readStudyCohortEntry('https://omni.test/?study=21d&invite=signed.token'), null,
    'bearer invites in a network-visible query must fail closed');
  assert.deepEqual(readStudyCohortEntry('https://omni.test/#study=21d&invite=signed.token'), {
    study:'21d', invite:'signed.token',
  });
  assert.equal(readStudyCohortEntry('https://omni.test/?study=21d'), null);
  assert.equal(readStudyCohortEntry('https://omni.test/?study=anything&invite=signed.token'), null);
  assert.equal(readStudyCohortEntry('not a url'), null);
});

test('browser handoff preserves only the cohort capability while history cleanup preserves unrelated state', () => {
  const location = 'https://omni.test/start?release=known&study=21d&invite=signed.token&src=facebook#proof';
  assert.equal(
    buildStudyBrowserHandoffUrl(location, 'signed.token'),
    'https://omni.test/start#study=21d&invite=signed.token',
  );
  assert.equal(stripStudyCohortParams(location), '/start?release=known&src=facebook#proof');

  let replaced = null;
  assert.deepEqual(captureStudyCohortEntry(
    'https://omni.test/start?release=known#study=21d&invite=signed.token',
    (path) => { replaced = path; },
  ), { study:'21d', invite:'signed.token' });
  assert.equal(replaced, '/start?release=known');
});

test('client accepts only the server-attested fixed 21-day study shape', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const responses = [
    { ok:true, json:async () => ({ valid:true, cohort:'21-day-study', days:21 }) },
    { ok:true, json:async () => ({ valid:true, cohort:'21-day-study', days:3 }) },
    { ok:true, json:async () => ({ valid:true, cohort:'other', days:21 }) },
  ];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.invite, 'private-token');
    return responses.shift();
  };
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:true, days:21 });
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:false });
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:false });
});

test('generic landing remains three days while valid study state alone selects a user-gesture diagnostic CTA', async () => {
  const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /danach 3 Tage Basic ab Interviewstart · keine Karte nötig/);
  assert.match(source, /Nach Anmeldung und E-Mail-Bestätigung: kostenlose Einstufung deines Niveaus/);
  assert.match(source, /const activeStudyStart = firstRun && auth\.account\?\.studyAccess\?\.active === true/);
  assert.match(source, /activeStudyStart \? '8-MIN-DIAGNOSE STARTEN' : 'Interview starten'/);
  assert.match(source, /onClick=\{beginSession\}/);
  assert.doesNotMatch(source, /studyStartPending\s*&&\s*auth\.account/);
  assert.match(source, /const STUDY_ENTRY_BOOT = typeof window !== 'undefined' \? captureStudyCohortEntry\(window\.location\) : null/);
  assert.ok(source.indexOf('const STUDY_ENTRY_BOOT') < source.indexOf("try { fetch(`${API_URL}/health`)"));
  assert.match(source, /useState\(\(\) => STUDY_ENTRY_BOOT\)/);
  assert.doesNotMatch(source, /aria-label="Studienlink"/);
  const handoffSource = source.slice(source.indexOf('function StudyBrowserHandoff'), source.indexOf('function VoiceReadinessCheck'));
  assert.doesNotMatch(handoffSource, />\{url\}<\/div>/);
  assert.doesNotMatch(handoffSource, /intent:\/\//);
  assert.match(handoffSource, /LINK KOPIEREN & IN CHROME\/SAFARI ÖFFNEN/);
});
