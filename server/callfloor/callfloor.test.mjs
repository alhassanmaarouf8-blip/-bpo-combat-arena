/**
 * callfloor.test.mjs — pins the Phase 2 Call Floor engine: scenario-bank hygiene (masri law,
 * no company names, valid voices, unsolvable coverage), persona turn parsing, the verbatim
 * quote guard + honest verdicts, the frozen-pipeline input adapter, the deterministic walls,
 * and the kill switch (flag off ⇒ the API is indistinguishable from not existing).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import express from 'express';

delete process.env.DATABASE_URL;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cf-test-'));
process.env.CALLFLOOR_DATA_DIR = tmp;                       // durable stores → temp dir
process.env.CALLFLOOR_USAGE_FILE = path.join(tmp, 'usage.jsonl');
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

const { SCENARIOS, QUADRANTS, RUBRICS, pickScenario } = await import('./scenarios.js');
const { parseTurn, speakableText, personaSystemPrompt, personaTurn } = await import('./callEngine.js');
const { quoteIsVerbatim, judgeCall, overallScore } = await import('./competency.js');
const { analysisInputFromCall } = await import('./postCall.js');
const cs = await import('./callSession.js');

// ── Scenario bank hygiene ─────────────────────────────────────────────────────────────────────
test('bank: every quadrant has ≥2 scenarios; every scenario is complete', () => {
  for (const q of Object.keys(QUADRANTS)) {
    const pool = SCENARIOS.filter((s) => s.quadrant === q);
    assert.ok(pool.length >= 2, `quadrant ${q} has ${pool.length} scenarios`);
    assert.ok(RUBRICS[q]?.length >= 3, `quadrant ${q} rubric too thin`);
  }
  for (const s of SCENARIOS) {
    for (const f of ['id', 'quadrant', 'title_de', 'brief_de', 'problem_de', 'goal_de', 'arc_de', 'voice']) {
      assert.ok(s[f], `${s.id} missing ${f}`);
    }
    assert.ok(s.customer?.name && s.customer?.style_de && s.customer?.mood0 >= 1 && s.customer?.mood0 <= 5, `${s.id} customer incomplete`);
  }
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length, 'duplicate scenario ids');
});

test('bank: masri law — every *_ar field is an empty OWNER-AR slot', () => {
  const walk = (o, where) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.endsWith('_ar')) assert.equal(v, '', `${where}.${k} must be an empty OWNER-AR slot`);
      else if (v && typeof v === 'object') walk(v, `${where}.${k}`);
    }
  };
  walk({ SCENARIOS, QUADRANTS }, 'bank');
});

test('bank: no employer/company names in any learner-facing German', () => {
  const forbidden = /\b(GmbH|AG|Telekom|Vodafone|O2|Amazon|Teleperformance|Concentrix|Majorel|Sitel|Sykes)\b/i;
  for (const s of SCENARIOS) {
    const text = [s.title_de, s.brief_de, s.problem_de, s.goal_de, s.arc_de, s.customer.style_de].join(' ');
    assert.ok(!forbidden.test(text), `${s.id} names a company`);
  }
});

test('bank: voices are valid Aura-2 German ids; ≥2 unsolvable scenarios exist', () => {
  const valid = new Set(['aura-2-julius-de', 'aura-2-fabian-de', 'aura-2-lara-de', 'aura-2-elara-de',
    'aura-2-aurelia-de', 'aura-2-kara-de', 'aura-2-viktoria-de']);
  for (const s of SCENARIOS) assert.ok(valid.has(s.voice), `${s.id} invalid voice ${s.voice}`);
  assert.ok(SCENARIOS.filter((s) => s.unsolvable).length >= 2, 'need ≥2 unsolvable scenarios (graceful-no skill)');
});

test('pickScenario: unseen-first, then least-recently-seen; unknown quadrant → null', () => {
  const pool = SCENARIOS.filter((s) => s.quadrant === 'inbound_cs').map((s) => s.id);
  assert.equal(pickScenario('inbound_cs', []).id, pool[0]);
  assert.equal(pickScenario('inbound_cs', [pool[0]]).id, pool[1]);
  const allSeen = [...pool, pool[0]];                      // pool[0] seen twice → pool[1] is oldest
  assert.equal(pickScenario('inbound_cs', allSeen).id, pool[1]);
  assert.equal(pickScenario('nope', []), null);
});

// ── Persona turn parsing ──────────────────────────────────────────────────────────────────────
test('parseTurn: mood + ENDE parsed, control tokens never reach TTS', () => {
  const t = parseTurn('Na endlich, das wurde auch Zeit. [STIMMUNG:4] [ENDE]');
  assert.equal(t.mood, 4);
  assert.equal(t.end, true);
  assert.equal(t.text, 'Na endlich, das wurde auch Zeit.');
  assert.equal(parseTurn('Hallo? [stimmung: 2]').mood, 2);                  // case/space tolerant
  assert.equal(parseTurn('Kein Marker hier.').mood, null);
  assert.ok(!/[\[\]]/.test(speakableText('Ja. [lacht] *seufz* [STIMMUNG:3]')));
});

test('personaTurn: mood falls back to previous when the model forgets the token', async () => {
  const scenario = SCENARIOS[0];
  const fake = async () => ({ content: 'Und was machen Sie jetzt konkret?', usage: null, provider: 'test:m' });
  const out = await personaTurn({ scenario, history: [], prevMood: 2, userId: 'u', _chat: fake });
  assert.equal(out.mood, 2);
  assert.equal(out.end, false);
});

test('personaSystemPrompt: carries the scenario truth + the mandatory mood contract', () => {
  const s = SCENARIOS[0];
  const p = personaSystemPrompt(s);
  for (const part of [s.problem_de, s.customer.style_de, '[STIMMUNG:1]', '[ENDE]']) {
    assert.ok(p.includes(part), `prompt missing: ${part.slice(0, 30)}`);
  }
});

// ── Competency honesty ────────────────────────────────────────────────────────────────────────
test('quoteIsVerbatim: accepts punctuation-variant quotes, rejects inventions and empties', () => {
  const agent = ['Es tut mir wirklich leid, ich prüfe das sofort für Sie.', 'Ich buche den Betrag zurück.'];
  assert.equal(quoteIsVerbatim('ich prüfe das sofort', agent), true);
  assert.equal(quoteIsVerbatim('Es tut mir wirklich leid ich prüfe das sofort', agent), true);
  assert.equal(quoteIsVerbatim('Ich schenke Ihnen einen Gutschein', agent), false);
  assert.equal(quoteIsVerbatim('', agent), false);
});

test('judgeCall: fabricated quotes dropped, invalid keys/scores rejected, fake resolved → null', async () => {
  const scenario = SCENARIOS.find((s) => s.quadrant === 'inbound_cs');
  const transcript = [
    { role: 'customer', text: 'Sie haben mir das Geld doppelt abgebucht!' },
    { role: 'agent', text: 'Das tut mir leid, ich prüfe die Buchung sofort.' },
  ];
  const fake = async () => ({ provider: 'test:m', usage: null, content: JSON.stringify({
    skills: [
      { key: 'deeskalation', score: 4, quote: 'ich prüfe die Buchung sofort', why_de: 'Konkret.' },
      { key: 'empathie', score: 5, quote: 'Ich fühle zutiefst mit Ihnen', why_de: 'erfunden' },       // fabricated
      { key: 'empathie', score: 3, quote: 'Das tut mir leid', why_de: 'dupe' },                       // duplicate key
      { key: 'hackerei', score: 5, quote: 'x', why_de: 'invalid key' },
      { key: 'struktur', score: 9, quote: 'Das tut mir leid', why_de: 'invalid score' },
    ],
    resolved: true, resolved_quote: 'Ich habe alles erstattet',                                       // fabricated
    summary_de: 'Ok.',
  }) });
  const out = await judgeCall({ scenario, transcript, userId: 'u', _chat: fake });
  assert.equal(out.skills.length, 2);
  assert.equal(out.skills.find((s) => s.key === 'deeskalation').quote, 'ich prüfe die Buchung sofort');
  assert.equal(out.skills.find((s) => s.key === 'empathie').quote, '');       // kept, quote stripped
  assert.equal(out.resolved, null);                                           // fake evidence → honest null
});

test('overallScore: only evidence-backed skills count; none → null (never a fabricated number)', () => {
  assert.equal(overallScore([{ key: 'a', score: 4, quote: 'x' }, { key: 'b', score: 2, quote: '' }]), 80);
  assert.equal(overallScore([{ key: 'b', score: 5, quote: '' }]), null);
});

// ── Frozen-pipeline adapter ───────────────────────────────────────────────────────────────────
test('analysisInputFromCall: exact input contract, agent-only utterances, callfloor-tagged', () => {
  const scenario = SCENARIOS[0];
  const session = { id: 'cf_x', transcript: [
    { role: 'customer', text: 'Wo bleibt mein Geld?' },
    { role: 'agent', text: 'Ich prüfe das sofort für Sie.', durationSec: 3.2 },
  ] };
  const input = analysisInputFromCall(session, scenario);
  assert.equal(input.dialogue.length, 2);
  assert.equal(input.dialogue[0].speaker, 'boss');
  assert.equal(input.utterances.length, 1);
  assert.equal(input.utterances[0].words, 6);
  assert.equal(input.utterances[0].durationMs, 3200);
  assert.deepEqual(input.utterances[0].lowConf, []);
  assert.equal(input.metrics.words, 6);
  assert.equal(input.csScenarioId, `callfloor:${scenario.id}`);
});

// ── Deterministic walls ───────────────────────────────────────────────────────────────────────
test('walls: turn cap and time cap end the call; daily limit parses from env', () => {
  const session = { startedAt: Date.now(), agentTurns: 0 };
  assert.equal(cs.wallReason(session), null);
  session.agentTurns = cs.MAX_AGENT_TURNS;
  assert.equal(cs.wallReason(session), 'turns');
  session.agentTurns = 0;
  session.startedAt = Date.now() - cs.MAX_CALL_MS - 1;
  assert.equal(cs.wallReason(session), 'time');
  const prev = process.env.CALLFLOOR_DAILY_MIN;
  process.env.CALLFLOOR_DAILY_MIN = '2';
  assert.equal(cs.dailyLimitSec(), 120);
  if (prev === undefined) delete process.env.CALLFLOOR_DAILY_MIN; else process.env.CALLFLOOR_DAILY_MIN = prev;
});

test('startCall: honest daily_limit refusal at the ceiling; call time is durable immediately', async () => {
  cs._resetForTest();
  const prev = process.env.CALLFLOOR_DAILY_MIN;
  process.env.CALLFLOOR_DAILY_MIN = '1';                    // 60s ceiling for the test
  try {
    const a = await cs.startCall({ userId: 'capuser', quadrant: 'inbound_cs' });
    assert.ok(a.session, 'first call starts');
    a.session.startedAt -= 120_000;                         // simulate 2 minutes of talk
    await cs.endCall(a.session);
    const b = await cs.startCall({ userId: 'capuser', quadrant: 'inbound_cs' });
    assert.equal(b.error, 'daily_limit');
    assert.ok(b.usedSec >= 60, `usedSec=${b.usedSec}`);
  } finally {
    if (prev === undefined) delete process.env.CALLFLOOR_DAILY_MIN; else process.env.CALLFLOOR_DAILY_MIN = prev;
  }
});

// ── The kill switch ───────────────────────────────────────────────────────────────────────────
test('kill switch: flag off ⇒ 404 on every callfloor route; flag on ⇒ auth is demanded', async () => {
  delete process.env.CALLFLOOR_ENABLED;
  const { callfloorRouter } = await import('./routes.js');
  const app = express();
  app.use('/api', callfloorRouter);
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const off = await fetch(`${base}/api/callfloor/state`);
    assert.equal(off.status, 404);
    assert.deepEqual(await off.json(), { error: 'not_found' });   // identical to the global catch-all

    process.env.CALLFLOOR_ENABLED = '1';
    const on = await fetch(`${base}/api/callfloor/state`);
    assert.equal(on.status, 401);                                  // now the wall is auth, not absence
  } finally {
    delete process.env.CALLFLOOR_ENABLED;
    server.close();
  }
});
