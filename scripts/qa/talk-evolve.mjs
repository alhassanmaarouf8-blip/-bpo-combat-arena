/**
 * talk-evolve — self-improving naturalness loop. Like training by playing many games: run a full
 * interview, JUDGE how human the interviewer is, let an optimizer rewrite the interviewer's tuning
 * addendum to fix the judged "tells", keep the best, repeat — until it is stably indistinguishable
 * from a real human (or the round cap). 100% FREE: same Groq key the boss uses, heavily PACED +
 * backed-off so it never trips the free-tier limit (slow, not costly). Reports ONLY at the end.
 *
 * Usage: node scripts/qa/talk-evolve.mjs [maxRounds] [turnsPerConvo]   (defaults 12, 5)
 * Requires GROQ_API_KEY in env.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dir, '../..');
try { for (const l of fs.readFileSync(path.join(ROOT,'server/.env'),'utf8').split(/\r?\n/)) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } } catch {}
const KEY = process.env.GROQ_API_KEY || process.env.INTERVIEW_API_KEY;
if (!KEY) { console.error('No GROQ_API_KEY'); process.exit(1); }

const MAX_ROUNDS = Number(process.argv[2]) || 12;
const TURNS      = Number(process.argv[3]) || 5;
const PACE_MS    = 21000;   // wait before EVERY Groq call → stay under the free per-minute token cap
const TARGET     = 90;      // humanScore needed (stable over 2 rounds) to call it indistinguishable
const PERSONAS   = ['hana', 'karim', 'yasmin', 'tarek'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

let _last = 0;
async function groq(messages, { json = false, temperature = 0.8, max_tokens = 400 } = {}, tries = 5) {
  for (let a = 0; a < tries; a++) {
    const wait = Math.max(0, PACE_MS - (Date.now() - _last));
    if (wait) await sleep(wait);
    _last = Date.now();
    let r;
    try {
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature, max_tokens, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      });
    } catch (e) { await sleep(15000); continue; }
    if (r.status === 429) { const ra = Number(r.headers.get('retry-after')) || 0; const back = Math.max(ra * 1000, 30000 * (a + 1)); log(`  …429, backoff ${Math.round(back/1000)}s`); await sleep(back); continue; }
    if (!r.ok) { await sleep(8000); continue; }
    return (await r.json()).choices?.[0]?.message?.content ?? '';
  }
  throw new Error('groq: exhausted retries (likely daily free cap)');
}

async function playCandidate(history) {
  const convo = history.map((t) => `${t.who === 'boss' ? 'Interviewer' : 'Du'}: ${t.text}`).join('\n');
  return (await groq([
    { role: 'system', content: `Du bist Omar, ägyptischer Bewerber (~B2 Deutsch) in einem echten BPO-Job-Interview. Antworte natürlich auf die letzte Aussage des Interviewers: 1–3 Sätze gesprochenes Deutsch, kleine glaubwürdige Fehler, ab und zu ein Füllwort, erfinde konkrete Details. NUR deine Antwort.` },
    { role: 'user', content: `Gespräch:\n${convo}\n\nDeine nächste Antwort:` },
  ], { temperature: 0.9, max_tokens: 160 })).trim();
}

async function judge(transcript) {
  const out = await groq([
    { role: 'system', content: `Du bist deutscher Muttersprachler. Beurteile NUR den INTERVIEWER im Transkript. Würde irgendein Mensch merken, dass er eine KI ist? JSON: {"humanScore":0-100,"moreHumanThanHuman":true/false,"verdict":"1 Satz","roboticTells":["konkret, max 4"]}` },
    { role: 'user', content: transcript },
  ], { json: true, temperature: 0.2, max_tokens: 600 });
  try { return JSON.parse(out); } catch { return { humanScore: 0, roboticTells: ['judge parse failed'], verdict: out.slice(0, 120) }; }
}

async function optimize(rules, tells) {
  const out = await groq([
    { role: 'system', content: `Du optimierst die ZUSATZREGELN für einen KI-Interviewer, damit er wie ein ECHTER Mensch klingt. Gib NUR die neuen Zusatzregeln zurück (Deutsch, knapp, KONKRETE Sprech-/Wortregeln, max 6 kurze Punkte). Behalte was wirkt, behebe gezielt die genannten Schwächen. NIEMALS die Disziplin „eine Frage pro Zug, dann Stille" aufheben. Keine Vorrede, nur die Regeln.` },
    { role: 'user', content: `Bisherige Zusatzregeln:\n${rules || '(noch keine)'}\n\nVom Richter gefundene Roboter-Schwächen:\n- ${(tells || []).join('\n- ')}\n\nNeue, verbesserte Zusatzregeln:` },
  ], { temperature: 0.7, max_tokens: 500 });
  return out.trim();
}

const { RealtimeClient } = await import(pathToFileURL(path.join(ROOT, 'server/realtimeClient.js')).href);

async function runConversation(extraRules, bossId) {
  const bossTurns = [];
  const client = new RealtimeClient({ sessionId: `evolve-${bossId}-${Date.now()%100000}`, bossId, level: 'b2', extraRules,
    onBossSpeech: (t) => bossTurns.push(t), onBossSpeechDone: () => {}, onError: () => {}, onClose: () => {} });
  await client.connect();
  await sleep(120);
  if (!bossTurns[0]) return null;
  const history = [{ who: 'boss', text: bossTurns[0] }];
  const candTurns = [];
  for (let i = 0; i < TURNS; i++) {
    const ans = await playCandidate(history);
    candTurns.push(ans); history.push({ who: 'cand', text: ans });
    const before = bossTurns.length;
    await sleep(PACE_MS);                       // pace the boss's own Groq call too
    _last = Date.now();
    await client.respond(ans).catch(() => {});
    if (bossTurns.length === before) return null;   // boss 429/error → invalid round
    history.push({ who: 'boss', text: bossTurns[before] });
  }
  return history.map((t) => `${t.who === 'boss' ? 'INTERVIEWER' : 'KANDIDAT'}: ${t.text}`).join('\n');
}

// ── Evolve ───────────────────────────────────────────────────────────────────────
let rules = '';
let best = { score: -1, rules: '', transcript: '', verdict: '' };
const hist = [];
let consecutiveHits = 0;
log(`\n=== TALK-EVOLVE  maxRounds=${MAX_ROUNDS} turns=${TURNS} target=${TARGET} (free, paced ${PACE_MS/1000}s) ===`);

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const bossId = PERSONAS[(round - 1) % PERSONAS.length];
  let transcript = null;
  for (let attempt = 0; attempt < 3 && !transcript; attempt++) {
    try { transcript = await runConversation(rules, bossId); } catch (e) { log(`  round ${round}: ${e.message}`); }
    if (!transcript) { log(`  round ${round} (${bossId}) invalid (rate-limit) → backoff`); await sleep(45000); }
  }
  if (!transcript) { log(`round ${round}: giving up this round`); continue; }

  let v;
  try { v = await judge(transcript); } catch (e) { log(`round ${round}: judge failed (${e.message})`); break; }
  const score = Number(v.humanScore) || 0;
  hist.push({ round, bossId, score, moreHuman: !!v.moreHumanThanHuman });
  log(`round ${round} [${bossId}] score=${score} moreHumanThanHuman=${v.moreHumanThanHuman} :: ${v.verdict || ''}`);

  if (score > best.score) best = { score, rules, transcript, verdict: v.verdict || '' };
  if (score >= TARGET && v.moreHumanThanHuman) { consecutiveHits++; if (consecutiveHits >= 2) { log(`\n✅ TARGET reached & stable at round ${round}.`); break; } }
  else consecutiveHits = 0;

  try { rules = await optimize(rules, v.roboticTells); } catch (e) { log(`optimize failed: ${e.message}`); break; }
}

// ── Final report ───────────────────────────────────────────────────────────────
log(`\n================ RESULT ================`);
log(`Best humanScore: ${best.score}/100`);
log(`Verdict: ${best.verdict}`);
log(`Score history: ${hist.map((h) => `${h.round}:${h.score}`).join('  ')}`);
log(`\n----- WINNING TUNING ADDENDUM (fold into TURN_RULE) -----\n${best.rules || '(base prompt already best — no addendum improved it)'}`);
log(`\n----- BEST TRANSCRIPT -----\n${best.transcript}`);
fs.writeFileSync(path.join(__dir, 'evolve-result.json'), JSON.stringify({ best, hist }, null, 2));
log(`\nSaved → scripts/qa/evolve-result.json\nDONE.`);
