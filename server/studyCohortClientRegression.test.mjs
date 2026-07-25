import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStudyBrowserHandoffUrl, captureStudyCohortEntry, readStudyCohortEntry, stripStudyCohortParams,
  forgetStudyCohortEntry, readStoredStudyCohortEntry, verifyStudyCohortEntry } from '../client/src/studyCohortEntry.js';

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

test('a captured cohort invite survives refresh only inside the same browser session and can be cleared after reservation', () => {
  const values = new Map();
  const storage = { getItem:(key) => values.get(key) || null, setItem:(key, value) => values.set(key, value), removeItem:(key) => values.delete(key) };
  const originalStorage = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable:true, value:storage });
  try {
    assert.deepEqual(captureStudyCohortEntry('https://omni.test/#study=21d&invite=signed.token', () => {}), {
      study:'21d', invite:'signed.token',
    });
    assert.deepEqual(readStoredStudyCohortEntry(storage), { study:'21d', invite:'signed.token' });
    assert.deepEqual(captureStudyCohortEntry('https://omni.test/start', () => {}), { study:'21d', invite:'signed.token' });
    forgetStudyCohortEntry(storage);
    assert.equal(readStoredStudyCohortEntry(storage), null);
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable:true, value:originalStorage });
  }
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
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:true, days:21, state:'ready' });
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:false, state:'invalid' });
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:false, state:'invalid' });
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token'), { valid:false, state:'offline' });
});

test('cohort verification has a bounded offline fallback instead of hanging forever', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once:true });
  });
  const started = Date.now();
  assert.deepEqual(await verifyStudyCohortEntry('https://api.test', 'private-token', { timeoutMs:100 }),
    { valid:false, state:'offline' });
  assert.ok(Date.now() - started < 1000);
});

test('generic landing states the real offer (free-forever + true trial grant + price) while valid study state alone selects a user-gesture diagnostic CTA', async () => {
  const source = await readFile(new URL('../client/src/App.jsx', import.meta.url), 'utf8');
  // The generic landing must still state the trial — but as of 2026-07-24 it also states the PRICE
  // before signup (owner decision; the measured leak was that only 8 of ~120 openers ever saw one),
  // and every number is now server-driven from GET /api/billing/pricing → plans.config.js. No
  // hardcoded literal, so the page can never drift from what entitlement() actually grants.
  assert.match(source, /Kostenlos:/);
  // RATCHET (owner order 2026-07-25: "anyone that will use the app must pay to get access to the
  // interviews"): the landing may advertise the free Einstufung, never a free interview. If this
  // claim returns while freeFightAvailable() denies it, the page lies to every new visitor.
  assert.doesNotMatch(source, /Einstufung \+ dein erstes Interview/);
  assert.doesNotMatch(source, /Kostenlos starten: Einstufung \+ erstes Interview/);
  // Owner order 2026-07-25 settled the money model: drills and the first interview are FREE, the
  // measured AUSWERTUNG is what needs a plan. The landing must say exactly that, and must never
  // again promise a free verdict the server withholds.
  assert.match(source, /Die Auswertung — dein Niveau, dein Engpass,/);
  assert.doesNotMatch(source, /kostenlose Einstufung bleibt immer frei/);
  assert.match(source, /Deine \{pricing\.trial\.days\} Testtage \(ab dem ersten Interview\)/);
  assert.match(source, /\{pricing\.trial\.dailySessions\} Interviews\/Tag/);
  assert.match(source, /\{fmtEgp\(pl\.offerPriceEGP\)\} EGP\/Monat/);
  // RATCHET: the retired line promised "3 Tage Basic" while auth.js grants a trial user Elite-level
  // dailySessions (4 interviews/day, not Basic's 2), all drills and Ziel-Stelle — it under-sold the
  // trial by 2x AND named the wrong tier. A false claim about what the buyer gets must never return.
  assert.doesNotMatch(source, /3 Tage Basic/);
  // Honest-when-thin: price and trial detail render ONLY behind real server data. If this gate is
  // ever removed, a cold start would paint a fallback/undefined price — worse than showing none.
  assert.match(source, /\{pricing\?\.plans\?\.length > 0 && \(/);
  assert.match(source, /\{pricing\?\.trial\?\.dailySessions > 0 && \(/);
  assert.match(source, /Nach Anmeldung und E-Mail-Bestätigung startest du kostenlos: alle Übungen und dein erstes Interview/);
  assert.match(source, /const activeStudyStart = firstRun && auth\.account\?\.studyAccess\?\.active === true/);
  assert.match(source, /activeStudyStart \? '8-MIN-DIAGNOSE STARTEN' : 'Interview starten'/);
  assert.match(source, /onClick=\{beginSession\}/);
  assert.doesNotMatch(source, /studyStartPending\s*&&\s*auth\.account/);
  assert.match(source, /const STUDY_ENTRY_BOOT = typeof window !== 'undefined' \? captureStudyCohortEntry\(window\.location\) : null/);
  assert.ok(source.indexOf('const STUDY_ENTRY_BOOT') < source.indexOf("try { fetch(`${API_URL}/health`)"));
  assert.match(source, /useState\(\(\) => STUDY_ENTRY_BOOT\)/);
  assert.match(source, /const studyEntryRequestRef = useRef\(0\)/);
  assert.match(source, /requestId !== studyEntryRequestRef\.current/u);
  assert.doesNotMatch(source, /aria-label="Studienlink"/);
  const handoffSource = source.slice(source.indexOf('function StudyBrowserHandoff'), source.indexOf('function VoiceReadinessCheck'));
  assert.doesNotMatch(handoffSource, />\{url\}<\/div>/);
  assert.doesNotMatch(handoffSource, /intent:\/\//);
  assert.match(handoffSource, /LINK KOPIEREN & IN CHROME\/SAFARI ÖFFNEN/);
});
