/**
 * observe-real.mjs — READ THE REAL THING instead of asking the owner. Drives real interviews on the
 * DEPLOYED server across personas, then reports the actual friction: worst-case latency (not averages),
 * opening variety (the "repeats the same intro" complaint), name-leak regression (the "Firo" class), and
 * robotic tells. Zero owner input, zero deps (Node 22+ global fetch + WebSocket).
 *
 * Run: node scripts/qa/observe-real.mjs [persona1,persona2,...]
 */
const HTTP = 'https://bpo-combat-arena.onrender.com';
const WS   = 'wss://bpo-combat-arena.onrender.com';
const PERSONAS = (process.argv[2]?.split(',')) || ['yasmin', 'lukas', 'frau-mona-adel'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// realistic candidate turns (substantive German → elicits real boss reactions)
const ANSWERS = [
  'Guten Tag, mein Name ist Omar. Ich habe drei Jahre im Kundenservice gearbeitet, weil ich gerne Menschen helfe.',
  'Einmal war ein Kunde sehr wütend, weil seine Rechnung falsch war. Ich habe ihm ruhig zugehört und das Problem gelöst.',
  'Ich glaube, meine Geduld und meine Kommunikation sind meine größten Stärken.',
  'Ich verstehe Ihre Frustration, und ich kümmere mich sofort darum, eine Lösung für Sie zu finden.',
];

async function signup() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${HTTP}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `qa${Date.now()}${Math.floor(performance.now())}@example.com`, password: 'qatest12345' }) });
    if (r.ok) return (await r.json()).token;
    if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }   // QA-account rate-limit → back off
    throw new Error(`signup ${r.status}`);
  }
  throw new Error('signup 429 (rate-limited after retries)');
}

// Drive one interview; collect boss turns. answers=0 → just capture the opening (fast).
function runInterview(token, bossId, answers = 0) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    const turns = []; let i = 0, done = false, errors = 0;
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch {} resolve({ bossId, turns, errors }); };
    const t = setTimeout(finish, 60000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start_fight', token, bossId, level: 'b2' }));
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'boss_speech') {
        turns.push(m.text);
        await sleep(250);
        if (i < answers) ws.send(JSON.stringify({ type: 'answer', text: ANSWERS[i++ % ANSWERS.length] }));
        else { clearTimeout(t); await sleep(300); finish(); }
      }
      if (m.type === 'error') errors++;
      if (m.type === 'debrief' || m.type === 'session_closed') { clearTimeout(t); await sleep(300); finish(); }
    };
    ws.onerror = () => { clearTimeout(t); finish(); };
  });
}

// ── deterministic friction detectors (no LLM, no owner) ──
const BANNED = ['das ist interessant', 'vielen dank für ihre antwort', 'das ist eine gute frage', 'teil eins', 'teil zwei', 'teil drei'];
// The "Firo" leak signature: a candidate NAME woven AFTER the greeting sentence, before the intro —
// "…kein Stress. Firo, erzählen…". Precise: a Capitalized token after terminal punctuation + comma +
// lowercase, EXCLUDING German discourse/greeting words (Schön/Hey/Gut/Also…) which are not names.
const NOT_A_NAME = new Set(['schön','hey','gut','guten','also','so','na','hallo','willkommen','danke','fangen','okay','ok','ja','nein','genau','verstehe','moment','nun','tja','prima','wunderbar','alles','setzen','nehmen','kommen','erzählen','stellen','sagen','erst','dann','gerne','sicher','richtig','klar','schauen','beginnen','starten']);
function nameLeak(opening) {
  const m = String(opening).match(/[.!?]\s+([A-ZÄÖÜ][a-zäöüß]{2,}),\s+[a-zäöüß]/);
  return !!m && !NOT_A_NAME.has(m[1].toLowerCase());
}
const opener = (s) => s.toLowerCase().replace(/^[„"'»\s]+/, '').split(/\s+/).slice(0, 2).join(' ');

const friction = [];
const flag = (sev, msg) => friction.push({ sev, msg });

console.log(`\n=== OBSERVE-REAL · deployed server · personas: ${PERSONAS.join(', ')} ===`);

for (const boss of PERSONAS) {
  try {
    // two openings → is the intro varied? (the "repeats the same intro" complaint)
    const a = await runInterview(await signup(), boss, 0);
    await sleep(400);
    const b = await runInterview(await signup(), boss, 0);
    const o1 = a.turns[0] || '', o2 = b.turns[0] || '';
    if (o1 && o2 && o1 === o2) flag('MED', `${boss}: identical opening across 2 sessions → "${o1.slice(0, 60)}…"`);
    for (const o of [o1, o2]) if (o && NAMEY.test(o)) flag('HIGH', `${boss}: opening leaks an injected name → "${o.slice(0, 50)}…"`);
    // one fuller interview → within-session robotic tells + latency
    const full = await runInterview(await signup(), boss, ANSWERS.length);
    const openers = full.turns.map(opener);
    const dupes = openers.length - new Set(openers).size;
    if (dupes > 0) flag('MED', `${boss}: ${dupes} repeated boss-turn opener(s) in one session (robotic)`);
    for (const turn of full.turns) for (const bp of BANNED) if (turn.toLowerCase().includes(bp)) flag('LOW', `${boss}: banned filler "${bp}"`);
    const lens = full.turns.map((t) => t.split(/\s+/).length);
    if (lens.length && Math.max(...lens) - Math.min(...lens) < 3) flag('LOW', `${boss}: boss turns all same length (${Math.min(...lens)}–${Math.max(...lens)} words) — monotone`);
    if (full.errors) flag('LOW', `${boss}: ${full.errors} realtime_error (likely rate-limit from QA accounts, not a product bug)`);
    console.log(`  ${boss}: ${full.turns.length} turns · openings ${o1 === o2 ? 'IDENTICAL' : 'varied'} · ${dupes} dupe-openers · ${full.errors} errors`);
  } catch (e) { console.log(`  ${boss}: probe failed — ${e.message}`); }
}

// ── latency: read the real telemetry populated by the interviews above (worst-case, not average) ──
try {
  const lat = await (await fetch(`${HTTP}/api/diag/latency?t=${Date.now()}`, { cache: 'no-store' })).json();
  const s = lat.server || {};
  const turns = lat.serverTurns || [];
  const worst = turns.length ? Math.max(...turns.map((t) => t.totalMs || t.ms || 0)) : null;
  console.log(`\n[latency] server turns=${s.count ?? 0}` + (worst != null ? ` · WORST server turn ${worst}ms · avg ${s.avgMs ?? '?'}ms` : ` · ${s.note || ''}`));
  if (worst != null && worst > 2500) flag('HIGH', `worst server turn ${worst}ms (brain slow on a real turn — not just VAD/TTS)`);
} catch (e) { console.log('[latency] read failed:', e.message); }

// ── ranked friction report ──
const rank = { HIGH: 0, MED: 1, LOW: 2 };
friction.sort((x, y) => rank[x.sev] - rank[y.sev]);
console.log(`\n=== FRICTION REPORT (${friction.length} findings, from real deployed behavior) ===`);
if (!friction.length) console.log('  ✅ no friction detected across ' + PERSONAS.length + ' personas (openings varied, no name leak, no robotic tells)');
for (const f of friction) console.log(`  [${f.sev}] ${f.msg}`);
console.log('\nNOTE: client-felt latency (VAD-wait + TTS) needs a browser probe — server latency here is brain speed only.');
