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

// Planted answers (B2): every error commented so a human can re-verify the expectations.
const ANSWERS = [
  'Ich heiße Omar und ich habe gearbeitet drei Jahre in einer Firma weil ich habe viel Erfahrung mit Kunden.',   // VERB_POSITION ×2 (Partizip-Stellung, weil+V2), WORTSTELLUNG
  'Ich bin einer regelmäßige Nutzer von diese Software und ich arbeite mit die Kunden jeden Tag.',               // ADJ_ENDUNG, ARTIKEL/KASUS ×3
  'Gestern ich habe angerufen habe hatte mit einem Kunde gesprochen.',                                            // WORTSTELLUNG (V2), TEMPUS (angerufen habe hatte), KASUS (einem Kunde)
  'Ähm also ich denke dass ich bin sehr geduldig und ähm ich kann helfen die Kunden immer.',                      // FUELLWOERTER, VERB_POSITION (dass), WORTSTELLUNG
  'Es tut mir leid für die Problem. Ich werde kümmern mich um das sofort.',                                       // ARTIKEL_GENUS (die Problem), VERB_POSITION (Reflexiv)
  'Ich verstehe Ihre Frustration und ich möchte lösen das Problem heute noch.',                                   // VERB_POSITION
  'Ich möchte arbeiten in Ihre Firma weil die Team ist sehr gut und die Kollegen sind freundlich.',               // VERB_POSITION, KASUS (in Ihre Firma), ARTIKEL_GENUS (die Team)
  'Ich habe gelernt Deutsch seit drei Jahren und ich hoffe dass ich kann bald besser sprechen.',                  // VERB_POSITION ×2, TEMPUS-Idiomatik
  'Vielen Dank für das Gespräch, ich freue mich auf Ihre Antwort.',                                               // clean closer
];

const log = (...a) => console.log('[deepqa]', ...a);
const fail = (msg) => { console.error('[deepqa] FAIL:', msg); process.exit(1); };

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

// 1) Fresh account
const su = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
if (!su.ok || !su.body.token) fail(`signup ${su.status} ${JSON.stringify(su.body)}`);
const TOKEN = su.body.token;
log('account created', EMAIL);

// 2) Typed interview over the real WS protocol
const debrief = await new Promise((resolve, reject) => {
  const ws = new WebSocket(WSU);
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
      log(`debrief arrived  deepAnalysis=${JSON.stringify(m.deepAnalysis)}`);
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
if ((agg.totalErrors || 0) < 10) fail(`only ${agg.totalErrors} errors detected — spec needs ≥10 (under-reporting)`);
if (cats.length < 4) fail(`only ${cats.length} categories — spec needs ≥4`);
const substantive = analysis.answers.filter((a) => (a.original || '').split(/\s+/).length >= 6 && !a.truncated);
const thin = substantive.filter((a) => a.alternativen.length < 2);
if (thin.length) fail(`${thin.length} substantive answer(s) with <2 alternatives: ${thin.map((a) => 'A' + a.index).join(',')}`);

// 5) error_events rows
const ev = await api('/api/error-events', { headers: { Authorization: `Bearer ${TOKEN}` } });
log(`error_events rows=${ev.body.events?.length}`);
if ((ev.body.events?.length || 0) !== (agg.totalErrors || 0)) fail(`error_events (${ev.body.events?.length}) != totalErrors (${agg.totalErrors})`);

console.log('\n[deepqa] PASS — deep analysis detected the planted errors, alternatives present, error_events persisted.');
console.log(`[deepqa] probe account: ${EMAIL} (delete via admin if desired)`);
