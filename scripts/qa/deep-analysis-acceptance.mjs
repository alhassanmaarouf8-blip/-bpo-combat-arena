/**
 * deep-analysis-acceptance.mjs — acceptance test for the Deep Diagnostic Engine (v2 Phase 2).
 *
 * Runs a REAL typed interview against prod (or BASE) as a fresh throwaway account, with planted
 * B2 answers containing ≥12 errors across ≥6 taxonomy categories, then asserts the spec's
 * acceptance criteria on GET /api/analysis/:sessionId and /api/error-events:
 *   - ≥10 errors detected across ≥4 categories, each with correction + DE/AR explanation
 *   - ≥2 alternative phrasings per substantive answer
 *   - one error_events row per detected error
 *
 * Usage:  node scripts/qa/deep-analysis-acceptance.mjs            (prod)
 *         BASE=http://localhost:8787 node scripts/qa/deep-analysis-acceptance.mjs
 * Needs Node ≥22 (global WebSocket). Creates account alhassanmaarouf2+deepqa<ts>@gmail.com
 * (same probe-alias convention as the existing QA scripts).
 */

const BASE  = process.env.BASE || 'https://bpo-combat-arena.onrender.com';
const WSU   = BASE.replace(/^http/, 'ws');
const EMAIL = process.env.PROBE_EMAIL || `alhassanmaarouf2+deepqa${Date.now()}@gmail.com`;
const PASS  = process.env.PROBE_PASS  || `DeepQA-${Date.now()}!x`;

// Planted answers, DEFAULT variant (B2) — 13 planted errors across 7 classes, every error
// commented so a human can re-verify the expectations (E2E verification protocol item 1).
const ANSWERS_DEFAULT = [
  'Ich heiße Omar und ich habe gearbeitet drei Jahre in einer Firma weil ich habe viel Erfahrung mit Kunden.',   // E1 Partizip-Stellung (placement), E2 weil+V2 (placement)
  'Ich bin einer regelmäßige Nutzer von diese Software.',                                                         // E3 ADJ_ENDUNG/ARTIKEL, E4 KASUS (von diese)
  'Gestern ich habe angerufen habe hatte mit einem Kunde gesprochen.',                                            // E5 V2 nach Gestern, E6 TEMPUS (angerufen habe hatte), E7 KASUS (einem Kunde)
  'Ähm also ähm ich denke dass ich bin ähm sehr geduldig also ähm wirklich.',                                     // E8 FUELLWOERTER-Sturm, E9 dass+V2 (placement)
  'Es tut mir leid für die Problem. Ich werde kümmern mich sofort darum.',                                        // E10 ARTIKEL_GENUS (die Problem), E11 Reflexiv-Stellung (placement)
  'Danke, dass du mir diese Frage stellst — kannst du mir mehr über das Team erzählen?',                          // E12 REGISTER du/Sie (×2 Vorkommen)
  'Ich verstehe Ihre Frustration und ich möchte lösen das Problem heute noch.',                                   // E13 VERB_POSITION
  'Ich habe drei Jahre im Kundenservice gearbeitet und dabei viel über Geduld gelernt.',                          // clean
  'Vielen Dank für das Gespräch, ich freue mich auf Ihre Antwort.',                                               // clean closer
];
// ADJ/ARTIKEL-heavy variant (PROBE_VARIANT=adj) — main clauses only, correct V2, no subordinate
// clauses: the placement family cannot win, the selector must SWITCH (protocol item 3).
const ANSWERS_ADJ = [
  'Ich bin ein sehr motivierte Mitarbeiter und ein zuverlässige Kollege.',                                        // ADJ_ENDUNG ×2
  'Ich habe eine große Erfahrung mit schwierige Kunden im Callcenter.',                                           // ADJ_ENDUNG (schwierige→schwierigen)
  'Mein letzte Chef war sehr zufrieden mit meine Arbeit.',                                                        // ADJ_ENDUNG, KASUS (mit meine)
  'Ich suche eine neue Herausforderung in eine internationale Firma.',                                            // KASUS (in eine→einer)
  'Es tut mir leid, das ist ein große Problem für Sie.',                                                          // ADJ_ENDUNG/GENUS
  'Ich biete dem Kunde immer eine schnelle Lösung an.',                                                           // KASUS (dem Kunde→Kunden)
  'Ich bin ein geduldige Mensch und bleibe immer ruhig.',                                                         // ADJ_ENDUNG
  'Meine deutsche Sprachkenntnisse werden jeden Tag besser.',                                                     // ADJ_ENDUNG (deutsche→deutschen)
  'Vielen Dank für das Gespräch, ich freue mich auf Ihre Antwort.',                                               // clean closer
];
const ANSWERS = process.env.PROBE_VARIANT === 'adj' ? ANSWERS_ADJ : ANSWERS_DEFAULT;

const log = (...a) => console.log('[deepqa]', ...a);
const fail = (msg) => { console.error('[deepqa] FAIL:', msg); process.exit(1); };

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

// 1) Fresh account — or login when PROBE_EMAIL points at an existing (verified) probe account.
let TOKEN = null;
const su = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
if (su.ok && su.body.token) { TOKEN = su.body.token; log('account created', EMAIL); }
else {
  const li = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
  if (!li.ok || !li.body.token) fail(`signup ${su.status} ${JSON.stringify(su.body)} / login ${li.status} ${JSON.stringify(li.body)}`);
  TOKEN = li.body.token; log('logged into existing probe account', EMAIL);
}

// 2) Typed interview over the real WS protocol
const debrief = await new Promise((resolve, reject) => {
  // The server denies originless upgrades (websocketOriginAllowed) — present the prod client
  // origin like a browser would. Node's undici WebSocket accepts a non-standard headers option.
  const ORIGIN = process.env.PROBE_ORIGIN || 'https://bpo-combat-arena.vercel.app';
  const ws = new WebSocket(WSU, { headers: { Origin: ORIGIN } });
  let next = 0, started = false, answeredThisTurn = false;
  const die = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('interview timed out (10 min)')); }, 600_000);
  const sendAnswer = () => {
    if (next >= ANSWERS.length) next = ANSWERS.length - 1;   // repeat the closer if the boss keeps going
    const text = ANSWERS[next++];
    log(`A${next}: ${text.slice(0, 60)}…`);
    ws.send(JSON.stringify({ type: 'answer', text }));
    answeredThisTurn = true;
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'session_ready' && !started) {
      started = true;
      ws.send(JSON.stringify({ type: 'start_fight', token: TOKEN, level: 'b2', audioCapable: false }));
      log('fight started (typed, b2)');
    } else if (m.type === 'boss_speech_done') {
      answeredThisTurn = false;
      setTimeout(() => { if (!answeredThisTurn) sendAnswer(); }, 1200);
    } else if (m.type === 'debrief') {
      clearTimeout(die);
      log(`debrief arrived  generated=${m.generated}  deepAnalysis=${JSON.stringify(m.deepAnalysis)}`);
      try { ws.close(); } catch {}
      resolve(m);
    } else if (m.type === 'no_session') {
      clearTimeout(die); reject(new Error('server saw no real session'));
    } else if (m.type === 'error') {
      log('ws error message:', JSON.stringify(m).slice(0, 200));
    }
  };
  ws.onerror = (e) => { clearTimeout(die); reject(new Error(`ws error: ${e?.message || e}`)); };
});

const sessionId = debrief?.deepAnalysis?.sessionId;
if (!sessionId) fail('DEBRIEF carried no deepAnalysis.sessionId');

// 3) Poll the analysis
let analysis = null;
for (let i = 0; i < 60; i++) {
  const r = await api(`/api/analysis/${sessionId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.body.status === 'ready') { analysis = r.body; break; }
  if (r.body.status === 'failed') fail('analysis status=failed');
  await new Promise((s) => setTimeout(s, 5000));
}
if (!analysis) fail('analysis never became ready (5 min)');

// 4) Acceptance assertions
const agg = analysis.aggregates || {};
const cats = Object.keys(agg.byCategory || {});
log(`totalErrors=${agg.totalErrors}  categories=${cats.length} [${cats.join(', ')}]  fillers=${agg.fillerCount}  cefr=${agg.cefrEstimate?.geschaetzt}`);
for (const a of analysis.answers) {
  log(`  A${a.index}: errors=${a.errors.length}  alternatives=${a.alternativen.length}  strengths=${a.staerken.length}`);
  for (const e of a.errors) {
    if (!e.korrektur || !e.erklaerung_de) fail(`error without correction/explanation in A${a.index}: ${JSON.stringify(e).slice(0, 120)}`);
    if (!e.erklaerung_ar) log(`  ⚠ A${a.index} error missing AR explanation: ${e.code}`);
  }
}
const ADJ_VARIANT = process.env.PROBE_VARIANT === 'adj';
// The ADJ variant CONCENTRATES errors in 2-3 categories by design — the broad-coverage bars
// apply to the default 13-error/7-class transcript only.
if ((agg.totalErrors || 0) < (ADJ_VARIANT ? 8 : 10)) fail(`only ${agg.totalErrors} errors detected — under-reporting`);
if (!ADJ_VARIANT && cats.length < 4) fail(`only ${cats.length} categories — spec needs ≥4`);
if (ADJ_VARIANT && !['ADJ_ENDUNG', 'ARTIKEL_GENUS', 'KASUS'].some((c) => (agg.byCategory || {})[c] > 0))
  fail('adj variant: no adjective/article/case errors detected');
// Planted-class coverage (default variant, verification item 1): every REQUIRED class group
// must surface. Placement + adjective/article classes accept family siblings (LLM naming drift).
if (process.env.PROBE_VARIANT !== 'adj') {
  const has = (...names) => names.some((n) => (agg.byCategory || {})[n] > 0);
  const missing = [];
  if (!has('VERB_POSITION', 'WORTSTELLUNG', 'SATZBAU_NEBENSATZ')) missing.push('placement-family');
  if (!has('ADJ_ENDUNG', 'ARTIKEL_GENUS')) missing.push('adjektiv/artikel');
  if (!has('TEMPUS', 'VERB_KONJUGATION')) missing.push('tempus');
  if (!has('FUELLWOERTER', 'SELBSTKORREKTUR_SCHLEIFEN', 'FLUESSIGKEIT')) missing.push('füllwörter');
  if (!has('REGISTER_FORMALITAET')) missing.push('register (du/Sie)');
  if (missing.length) fail(`planted classes NOT detected: ${missing.join(', ')}`);
  log('planted-class coverage: placement ✓ adj/artikel ✓ tempus ✓ füllwörter ✓ register ✓');
}
const substantive = analysis.answers.filter((a) => (a.original || '').split(/\s+/).length >= 6 && !a.truncated);
const thin = substantive.filter((a) => a.alternativen.length < 2);
if (thin.length) fail(`${thin.length} substantive answer(s) with <2 alternatives: ${thin.map((a) => 'A' + a.index).join(',')}`);

// 5) error_events rows — the log accumulates across the account's WHOLE history by design
// (Phase-3 fuel), so the assertion filters to THIS interview's session.
const ev = await api('/api/error-events', { headers: { Authorization: `Bearer ${TOKEN}` } });
const sessionRows = (ev.body.events || []).filter((e) => e.sessionId === sessionId).length;
log(`error_events rows: total=${ev.body.events?.length}  this-session=${sessionRows}`);
if (sessionRows !== (agg.totalErrors || 0)) fail(`error_events for session (${sessionRows}) != totalErrors (${agg.totalErrors})`);

// 6) Phase 3 — exactly one bottleneck record for this interview, evidence-backed, with runner-ups.
const bn = analysis.bottleneck;
if (!bn) fail('analysis carries no bottleneck record');
log(`bottleneck: ${bn.code}  score=${bn.score}  repeat=${bn.repeat}  streak=${bn.dayStreak}  status=${bn.status}  lowConf=${bn.lowConfidence}  fallback=${bn.fallback}`);
log(`why: ${bn.why}`);
if (bn.sessionId !== sessionId) fail('bottleneck record is not for this session');
if (!bn.fallback && !(bn.evidenceQuotes || []).length) fail('bottleneck has no evidence quotes');
if (!bn.fallback && !(bn.runnerUps || []).length) fail('bottleneck has no runner-ups');
if (!bn.why || bn.why.length < 10) fail('bottleneck has no stored why');
const bns = await api('/api/bottlenecks', { headers: { Authorization: `Bearer ${TOKEN}` } });
const mine = (bns.body.records || []);
const thisIdx = mine.findIndex((r) => r.sessionId === sessionId);
if (thisIdx < 0 || mine.filter((r) => r.sessionId === sessionId).length !== 1) fail('expected exactly one daily_bottleneck row for this interview');
const FAMILY = new Set(['VERB_POSITION', 'WORTSTELLUNG', 'SATZBAU_NEBENSATZ']);
const sameFam = (a, b) => a === b || (FAMILY.has(a) && FAMILY.has(b));
const prevRec = thisIdx > 0 ? mine[thisIdx - 1] : null;
if (prevRec) {
  log(`previous record: ${prevRec.code}  status=${prevRec.status}  cleanStreak=${prevRec.cleanStreak ?? 0}`);
  if (sameFam(prevRec.category, bn.category) && prevRec.status !== 'closed' && !bn.repeat) fail('same problem family as previous record but repeat not flagged');
  if (bn.repeat) log('repeat-day behavior CONFIRMED (same wall re-selected, flagged)');
  // Verification item 3: a NEW dominant error must not close yesterday's file on one clean day.
  if (!sameFam(prevRec.category, bn.category) && prevRec.status === 'closed' && (prevRec.cleanStreak ?? 0) < 2
    && prevRec.status !== 'retested') fail(`selector switched but yesterday's file closed after ONE clean day (mastery by avoidance)`);
  if (!sameFam(prevRec.category, bn.category) && prevRec.status !== 'closed') log(`selector SWITCH confirmed — yesterday's file stays ${prevRec.status} (streak ${prevRec.cleanStreak ?? 0}/2)`);
}

// 7) Phase 4 — the personal step: generated set, brief data, stage-1 server validation, gating.
import('node:fs').then(async ({ promises: fs }) => {
  let ps = null;
  for (let i = 0; i < 30; i++) {
    const r = await api(`/api/personal-step?sessionId=${sessionId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.ok && (r.body.status === 'ready' || r.body.status === 'fallback')) { ps = r.body; break; }
    if (r.ok && r.body.status === 'failed') fail('personal step status=failed (fallback should have caught this)');
    await new Promise((s) => setTimeout(s, 4000));
  }
  if (!ps) fail('personal step never became ready (2 min)');
  const set = ps.set;
  log(`personal step: status=${ps.status}  title="${set.title_de}"  s1=${set.stage1.length} s2=${set.stage2.length} s3=${set.stage3.length}  reps=${set.totalReps}  ~${set.estMinutes}min`);
  if (!ps.bottleneck?.evidenceQuotes?.length && !set.fallback) fail('brief has no evidence quotes');
  if (ps.status === 'ready') {
    if (set.stage1.length < 3 || set.stage2.length < 2 || set.stage3.length < 1) fail('generated ladder incomplete');
    for (const i of set.stage1) if ((i.options || []).length !== 2) fail(`stage1 ${i.id} lacks 2 options`);
    for (const i of [...set.stage2, ...set.stage3]) if (!i.why_de) fail(`${i.id} has no why`);
    if (set.stage3[0].must_use_de) fail('stage3 leaked must_use before the attempt (covert test broken)');
  }
  if (ps.completed || ps.reinterviewUnlocked) fail('step claims completed before any work');

  // Stage 1 via API: try option A; if wrong, option B — only correct answers count server-side.
  for (const item of set.stage1) {
    let r = await api('/api/personal-step/answer', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ sessionId, itemId: item.id, choice: item.options[0] }) });
    if (r.ok && !r.body.correct) {
      r = await api('/api/personal-step/answer', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ sessionId, itemId: item.id, choice: item.options[1] }) });
    }
    if (!r.ok || !r.body.correct) fail(`stage1 ${item.id}: neither option accepted`);
    if (!r.body.why_de) fail(`stage1 ${item.id}: answer response has no why`);
  }
  const after = await api(`/api/personal-step?sessionId=${sessionId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const s1done = (after.body.set.stage1 || []).every((i) => i.repsDone >= i.reps);
  if (set.stage1.length && !s1done) fail('stage1 reps not recorded server-side');
  if (set.stage2.length && (after.body.completed || after.body.reinterviewUnlocked)) fail('re-interview unlocked before spoken stages (gate broken)');
  log(`stage1 completed via API (${set.stage1.length} items); re-interview correctly still locked (spoken stages pending)`);

  // Cross-run novelty (verification item 2): both runs generated + same problem family →
  // ZERO reused items across ALL stages, else the do-not-reuse contract is broken.
  const sigPath = new URL('./.deepqa-last-set.json', import.meta.url);
  const canonT = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const texts = [
    ...set.stage1.flatMap((i) => i.options || []),
    ...set.stage2.map((i) => i.target), ...set.stage2.map((i) => i.prompt),
    ...set.stage3.map((i) => i.frage),
  ].filter(Boolean).map(canonT);
  try {
    const prev = JSON.parse(await fs.readFile(sigPath, 'utf8'));
    const bothReady = prev.status === 'ready' && ps.status === 'ready';
    const famPrev = prev.family || '', famNow = ps.bottleneck?.category || '';
    const sameFamily = famPrev === famNow || (['VERB_POSITION', 'WORTSTELLUNG', 'SATZBAU_NEBENSATZ'].includes(famPrev)
      && ['VERB_POSITION', 'WORTSTELLUNG', 'SATZBAU_NEBENSATZ'].includes(famNow));
    const overlap = texts.filter((t) => prev.texts.includes(t));
    log(`novelty vs previous run: ${overlap.length}/${texts.length} reused items (bothReady=${bothReady} sameFamily=${sameFamily})`);
    if (bothReady && sameFamily && overlap.length > 0) fail(`repeat set reuses ${overlap.length} item(s): "${overlap[0]}"`);
  } catch { /* first run — nothing to compare */ }
  await fs.writeFile(sigPath, JSON.stringify({ at: Date.now(), status: ps.status, family: ps.bottleneck?.category || '', texts }));

  console.log('\n[deepqa] PASS — analysis + bottleneck + personal step verified end-to-end.');
  console.log('[deepqa] (spoken stages 2-3 + re-interview unlock = owner voice test on device)');
  console.log(`[deepqa] probe account: ${EMAIL} (delete via admin if desired)`);
});
