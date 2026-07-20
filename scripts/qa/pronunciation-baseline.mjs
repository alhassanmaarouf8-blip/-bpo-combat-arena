/**
 * pronunciation-baseline.mjs — Phase-3 baseline matrix runner for the pronunciation
 * validation program. Drives the LOCAL production-parity rig (server on :3001 at a
 * pinned commit, vite client on :5173, fixture server on :8787) through the real
 * browser microphone path via the localhost voiceLab exact-input adapter, which also
 * plays every fixture audibly.
 *
 * It never touches production accounts and asserts nothing — it OBSERVES and records:
 * per cell: fixture, surface, API verdict, visible UI result, and a ruling slot
 * filled in later against the cell's expectation.
 *
 * Usage: node scripts/qa/pronunciation-baseline.mjs <baselineLabel> <cellSet>
 *   baselineLabel: e.g. server-6baa378 | server-0c6f8fa
 *   cellSet:       ser1 | ser2 | ser3 | shadowing | flow
 */
import { chromium } from 'playwright';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateVoiceFixture } from './voice-reality-lab.mjs';

const CLIENT = 'http://127.0.0.1:5173/?voiceLab=1';
const FIXTURE_HTTP = 'http://127.0.0.1:8787/voice-fixtures';
const FIXTURES_DIR = process.env.FIXTURES_DIR
  || 'C:\\Users\\lenovo\\Documents\\OMNI-PERFORM Audio Validation\\validation-program\\fixtures';
const RESULTS_DIR = 'C:\\Users\\lenovo\\Documents\\OMNI-PERFORM Audio Validation\\validation-program\\baseline-results';
const AUTH_FILE = 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\claude\\C--Users-lenovo\\2ee813aa-5e83-4c0f-a492-dff109d16505\\scratchpad\\baseline-auth.json';

const [baselineLabel = 'unlabeled', cellSet = 'ser1'] = process.argv.slice(2);
const results = [];
const apiLog = [];

function record(cell) {
  results.push(cell);
  console.log(`[cell] ${cell.id}: ${cell.outcome} — ${String(cell.detail).slice(0, 140)}`);
}

async function saveResults() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${baselineLabel}.${cellSet}.jsonl`);
  for (const row of results) await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
  console.log(`saved ${results.length} cells → ${file}`);
}

async function armFixture(page, wavName) {
  const input = page.getByLabel('Local fixture URL');
  await input.fill(`${FIXTURE_HTTP}/${wavName}`);
  await page.getByRole('button', { name: 'Load local WAV' }).click();
  await page.getByText(`Armed: ${wavName}`).waitFor({ timeout: 8000 });
}

function watchApi(page) {
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    let body = null;
    try { body = await response.json(); } catch { /* non-json */ }
    apiLog.push({ t: Date.now(), url: url.replace(/^https?:\/\/[^/]+/u, ''), status: response.status(), body });
  });
}

function lastApi(pattern) {
  return [...apiLog].reverse().find((row) => row.url.includes(pattern));
}

async function waitForApi(pattern, sinceIndex, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = apiLog.slice(sinceIndex).find((row) => row.url.includes(pattern));
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

async function openApp(page) {
  const auth = JSON.parse((await readFile(AUTH_FILE, 'utf8')).replace(/^﻿/u, ''));
  await page.addInitScript((session) => {
    localStorage.setItem('bpo_token', session.token);
    localStorage.setItem('bpo_account', JSON.stringify(session.account));
    localStorage.setItem('bpo_howto_seen', '1');
    localStorage.setItem('omni_salma_seen', '1');
  }, auth);
  await page.goto(CLIENT, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
}

async function clickFirst(page, labels, { timeout = 6000 } = {}) {
  for (const label of labels) {
    const target = page.getByText(label, { exact: false }).first();
    if (await target.click({ timeout }).then(() => true).catch(() => false)) return label;
  }
  return null;
}

async function visibleText(page, max = 900) {
  return (await page.evaluate(() => document.body.innerText)).replace(/\s+/gu, ' ').slice(0, max);
}

async function openDrill(page, names) {
  await clickFirst(page, ['Übungen', 'التمارين']);
  await page.waitForTimeout(800);
  const opened = await clickFirst(page, names);
  await page.waitForTimeout(1200);
  return opened;
}

/** One SER item turn: arm fixture, record, wait for grade response. */
async function serTurn(page, wavName, cellId, expectation) {
  await armFixture(page, wavName);
  const mark = apiLog.length;
  const clicked = await clickFirst(page, ['Korrekt sagen', 'aufnehmen', 'سجّل']);
  if (!clicked) { record({ id: cellId, outcome: 'DRIVER_FAIL', detail: `no record button; page: ${await visibleText(page, 300)}` }); return; }
  const graded = await waitForApi('/api/spoken-review/grade', mark, 40_000);
  await page.waitForTimeout(1500);
  record({ id: cellId, baseline: baselineLabel, surface: 'sag-es-richtig', fixture: wavName, expectation,
    outcome: graded ? (graded.body?.correct === true ? 'ACCEPTED' : graded.body?.retry ? 'RETRY' : 'REJECTED') : 'NO_GRADE',
    detail: JSON.stringify(graded?.body || {}).slice(0, 400), ui: await visibleText(page, 260) });
  const next = await clickFirst(page, ['Weiter', 'Nächste', 'التالي'], { timeout: 3000 });
  await page.waitForTimeout(800);
  return next;
}

const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
const page = await context.newPage();
watchApi(page);
page.on('pageerror', (error) => apiLog.push({ pageError: error.message.slice(0, 200) }));

try {
  await openApp(page);

  if (cellSet === 'assess') {
    // Spoken assessment with REAL Arabic-L1 learner read speech (LeaP). Observed questions:
    // does the level verdict come with any phoneme/pronunciation claim, and does the flow
    // treat recording quality separately from language ability?
    const learnerClip = 'dk_ara_ger_m_read_c1-e1e9eae5.clean.wav';
    await clickFirst(page, ['Einstufung machen', 'EINSTUFUNG', 'Einstufung']);
    await page.waitForTimeout(2000);
    await armFixture(page, learnerClip);
    await clickFirst(page, ['Los geht’s', "Los geht's", 'Los geht']);
    await page.waitForTimeout(3000);
    for (let step = 1; step <= 7; step++) {
      const text = await visibleText(page, 500);
      const mark = apiLog.length;
      await armFixture(page, learnerClip).catch(() => {});
      await clickFirst(page, ['aufnehmen', 'Aufnahme', 'Antworten', 'sprechen', 'Mikro', '●'], { timeout: 5000 });
      await page.waitForTimeout(24_000);
      await clickFirst(page, ['Stopp', 'Fertig', 'senden', 'beenden'], { timeout: 4000 });
      await page.waitForTimeout(7000);
      void text;
      const responses = apiLog.slice(mark).filter((row) => row.url && row.status);
      record({ id: `ASSESS-step${step}`, baseline: baselineLabel, surface: 'assessment', fixture: learnerClip,
        expectation: 'level estimate only; no phoneme claims; recording quality separated',
        outcome: 'OBSERVED', detail: JSON.stringify(responses.map((r) => ({ u: r.url, s: r.status, b: r.body }))).slice(0, 600),
        ui: await visibleText(page, 400) });
      if (/ERGEBNIS|Niveau|abgeschlossen|DIAGNOSE/iu.test(await visibleText(page, 600))) break;
    }
    record({ id: 'ASSESS-final', baseline: baselineLabel, surface: 'assessment', fixture: learnerClip,
      expectation: 'final verdict without pronunciation fabrication',
      outcome: 'OBSERVED', detail: '', ui: await visibleText(page, 900) });
  }

  if (cellSet === 'ser1') {
    const opened = await openDrill(page, ['Sag es richtig', 'SAG ES RICHTIG']);
    if (!opened) throw new Error(`SER tile not found; page: ${await visibleText(page, 400)}`);
    await page.waitForTimeout(1500);
    await serTurn(page, 'ser-sorry-contaminated.wav', 'SER-A1-contamination', 'reject (target embedded in English chatter)');
    await serTurn(page, 'ser-jahr-wrong.wav', 'SER-A2-wrong-token-1edit', 'reject (original error Jahr vs Jahre)');
    await serTurn(page, 'ser-weil-wrong.wav', 'SER-A3-word-order-wrong', 'reject (verb-second in weil clause = the original error)');
    await serTurn(page, 'ser-bestellnummer-clean.wav', 'SER-A4-clean-control', 'accept (exact correct sentence)');
    await serTurn(page, 'ser-hoelle-swapped.wav', 'SER-A5-minimal-pair-swap', 'reject only if STT hears Hölle; observe');
    await serTurn(page, 'ser-mitte-swapped.wav', 'SER-A6-minimal-pair-swap', 'reject only if STT hears Mitte; observe');
  }

  if (cellSet === 'ser2') {
    const opened = await openDrill(page, ['Sag es richtig', 'SAG ES RICHTIG']);
    if (!opened) throw new Error(`SER tile not found; page: ${await visibleText(page, 400)}`);
    await page.waitForTimeout(1500);
    await serTurn(page, 'ser-sorry-reversed.wav', 'SER-B1-meaning-reversal', 'reject (nicht reverses meaning)');
    await serTurn(page, 'ser-jahre-clean.wav', 'SER-B2-clean-control', 'accept');
    await serTurn(page, 'ser-weil-correct.wav', 'SER-B3-clean-control', 'accept');
    await serTurn(page, 'ser-bestellnummer-quiet.wav', 'SER-B4-quiet-variant', 'retry/noSpeech (quality gate)');
    await serTurn(page, 'ser-hoehle-clean.wav', 'SER-B5-clean-control', 'accept');
    await serTurn(page, 'ser-miete-clean.wav', 'SER-B6-clean-control', 'accept');
  }

  if (cellSet === 'ser3') {
    const opened = await openDrill(page, ['Sag es richtig', 'SAG ES RICHTIG']);
    if (!opened) throw new Error(`SER tile not found; page: ${await visibleText(page, 400)}`);
    await page.waitForTimeout(1500);
    await serTurn(page, 'ser-sorry-clean-katja.wav', 'SER-C1-second-speaker', 'accept (same content, different speaker)');
  }

  if (cellSet === 'shadowing') {
    const opened = await openDrill(page, ['Shadowing', 'SHADOWING']);
    if (!opened) throw new Error(`Shadowing tile not found; page: ${await visibleText(page, 400)}`);
    await page.waitForTimeout(1800);
    const session = lastApi('/api/shadowing');
    const sentences = session?.body?.sentences?.map((s) => s.de || s.text || s) || [];
    console.log('shadowing sentences:', JSON.stringify(sentences).slice(0, 300));

    // Cell 1: exact clean TTS of the displayed sentence → control accept
    if (sentences[0]) {
      const gen = await generateVoiceFixture({ text: sentences[0], profile: 'clean', outDir: FIXTURES_DIR });
      const wavName = path.basename(gen.wav);
      await armFixture(page, wavName);
      const mark = apiLog.length;
      await clickFirst(page, ['aufnehmen', 'Aufnahme starten', '●']);
      const scored = await waitForApi('/api/shadowing/score', mark, 45_000)
        || (await clickFirst(page, ['Stopp'], { timeout: 4000 }), await waitForApi('/api/shadowing/score', mark, 30_000));
      record({ id: 'SHA-1-exact-clean', baseline: baselineLabel, surface: 'shadowing', fixture: wavName,
        expectation: 'high word match, zero phoneme claims',
        outcome: scored ? 'SCORED' : 'NO_SCORE', detail: JSON.stringify(scored?.body || {}).slice(0, 400),
        ui: await visibleText(page, 260) });
      await clickFirst(page, ['Weiter', 'Nächster Satz'], { timeout: 3000 });
      await page.waitForTimeout(1000);
    }

    // Cell 2: quiet variant of sentence 2 → recording-quality handling
    if (sentences[1]) {
      const gen = await generateVoiceFixture({ text: sentences[1], profile: 'quiet', outDir: FIXTURES_DIR });
      const wavName = path.basename(gen.wav);
      await armFixture(page, wavName);
      const mark = apiLog.length;
      await clickFirst(page, ['aufnehmen', '●']);
      const scored = await waitForApi('/api/shadowing/score', mark, 45_000)
        || (await clickFirst(page, ['Stopp'], { timeout: 4000 }), await waitForApi('/api/shadowing/score', mark, 30_000));
      record({ id: 'SHA-2-quiet', baseline: baselineLabel, surface: 'shadowing', fixture: wavName,
        expectation: 'noSpeech/retry or honest low-quality handling, never a language verdict',
        outcome: scored ? 'SCORED' : 'NO_SCORE', detail: JSON.stringify(scored?.body || {}).slice(0, 400),
        ui: await visibleText(page, 260) });
      await clickFirst(page, ['Weiter', 'Nächster Satz'], { timeout: 3000 });
      await page.waitForTimeout(1000);
    }

    // Cell 3: mismatched HUMAN native read speech → word accuracy must be low; no phoneme claim
    const humanClip = 'co_ger_ger_m_read_na-133f1d33.clean.wav';
    await armFixture(page, humanClip);
    const mark = apiLog.length;
    await clickFirst(page, ['aufnehmen', '●']);
    const scored = await waitForApi('/api/shadowing/score', mark, 60_000)
      || (await clickFirst(page, ['Stopp'], { timeout: 5000 }), await waitForApi('/api/shadowing/score', mark, 40_000));
    record({ id: 'SHA-3-mismatch-human-native', baseline: baselineLabel, surface: 'shadowing', fixture: humanClip,
      expectation: 'low word match; system must not claim pronunciation quality either way',
      outcome: scored ? 'SCORED' : 'NO_SCORE', detail: JSON.stringify(scored?.body || {}).slice(0, 400),
      ui: await visibleText(page, 260) });
  }

  if (cellSet === 'flow') {
    const opened = await openDrill(page, ['Flow', 'FLOW', 'Fluency', '4-3-2']);
    if (!opened) throw new Error(`Flow tile not found; page: ${await visibleText(page, 400)}`);
    await page.waitForTimeout(1800);
    const humanClip = 'co_ger_ger_m_read_na-133f1d33.clean.wav';
    for (let round = 1; round <= 3; round++) {
      await armFixture(page, humanClip);
      const mark = apiLog.length;
      const clicked = await clickFirst(page, [`Runde ${round} aufnehmen`, 'aufnehmen', '●'], { timeout: 8000 });
      if (!clicked) { record({ id: `FLOW-r${round}`, outcome: 'DRIVER_FAIL', detail: await visibleText(page, 300) }); break; }
      // round may auto-stop on its timer; try an early stop control once the fixture is done (~16s)
      await page.waitForTimeout(17_000);
      await clickFirst(page, ['Fertig', 'Stopp', 'beenden'], { timeout: 4000 });
      const scored = await waitForApi('/api/fluency/score', mark, 120_000);
      record({ id: `FLOW-identical-r${round}`, baseline: baselineLabel, surface: 'flow', fixture: humanClip,
        expectation: 'identical audio must never yield an improvement claim',
        outcome: scored ? 'SCORED' : 'NO_SCORE', detail: JSON.stringify(scored?.body || {}).slice(0, 500),
        ui: await visibleText(page, 300) });
      await page.waitForTimeout(1500);
      await clickFirst(page, ['Weiter', `Runde ${round + 1}`], { timeout: 4000 });
    }
    await page.waitForTimeout(2500);
    record({ id: 'FLOW-final-verdict', baseline: baselineLabel, surface: 'flow', fixture: humanClip,
      expectation: 'debrief refuses improvement claim from identical takes',
      outcome: 'OBSERVED', detail: '', ui: await visibleText(page, 900) });
  }
} catch (error) {
  record({ id: `${cellSet}-fatal`, outcome: 'FATAL', detail: error.message.slice(0, 300) });
} finally {
  await saveResults();
  await browser.close();
}
