/**
 * talk-test — run a FULL real interview conversation and judge: is the interviewer more human than a
 * human? Drives the REAL boss engine (server/realtimeClient.js) against a Groq-played Egyptian B2
 * candidate, then scores naturalness with deterministic metrics + an LLM judge. 100% free (the same
 * Groq key the boss already uses — no new service, no cost beyond normal interview usage).
 *
 * Usage:  node scripts/qa/talk-test.mjs [bossId] [level] [turns]
 *   bossId: yasmin|karim|hana|tarek|frau-mona-adel|lukas   (default: hana)
 *   level:  a2-b1|b2|c1                                    (default: b2)
 *   turns:  number of candidate answers                    (default: 6)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dir, '../..');

// Load server/.env into process.env BEFORE importing the boss (its providers read env at module load).
try {
  for (const line of fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env may already be set */ }

const GROQ_KEY = process.env.GROQ_API_KEY || process.env.INTERVIEW_API_KEY;
if (!GROQ_KEY) { console.error('No GROQ_API_KEY found (server/.env).'); process.exit(1); }

const bossId = process.argv[2] || 'hana';
const level  = process.argv[3] || 'b2';
const TURNS  = Number(process.argv[4]) || 6;

// ── A free Groq chat helper (candidate player + judge) ───────────────────────────
async function groq(messages, { json = false, temperature = 0.8, max_tokens = 400 } = {}) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile', temperature, max_tokens, messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices?.[0]?.message?.content ?? '';
}

// The candidate: a realistic Egyptian B2 German learner — natural, imperfect, NOT a perfect bot.
async function playCandidate(history) {
  const sys = `Du bist Omar, ein ägyptischer Bewerber (Deutsch ca. B2) in einem echten Job-Interview für ein ` +
    `deutsches BPO-Unternehmen (Kundenservice). Antworte NATÜRLICH und realistisch auf die letzte Frage/Aussage ` +
    `des Interviewers: 1–3 Sätze, gesprochenes Deutsch, mit kleinen, glaubwürdigen Fehlern und ab und zu einem ` +
    `Füllwort. Erfinde konkrete Details (frühere Jobs, Zahlen, Situationen). Gib NUR deine Antwort zurück, ohne Label.`;
  const convo = history.map((t) => `${t.who === 'boss' ? 'Interviewer' : 'Du'}: ${t.text}`).join('\n');
  return (await groq([
    { role: 'system', content: sys },
    { role: 'user', content: `Bisheriges Gespräch:\n${convo}\n\nDeine nächste Antwort (nur der Text):` },
  ], { temperature: 0.9, max_tokens: 160 })).trim();
}

function fakeEmotion(ans) {
  const w = ans.split(/\s+/).length;
  const rich = /(weil|obwohl|damit|sodass|konkret|zum beispiel|ergebnis)/i.test(ans);
  if (w >= 28 && rich) return 'beeindruckt';
  if (w <= 8) return 'skeptisch';
  return 'gefasst';
}

// ── Deterministic naturalness metrics over the boss's turns ──────────────────────
const BANNED = ['das ist interessant', 'vielen dank für ihre antwort', 'das ist eine gute frage', 'teil eins', 'teil zwei', 'teil drei'];
const PARTICLES = /\b(denn|doch|mal|eben|halt|na ja|naja|soso|also|tja|nun ja)\b/i;
function metrics(bossTurns, candTurns) {
  const openers = bossTurns.map((t) => t.toLowerCase().replace(/^[„"'»\s]+/, '').split(/\s+/).slice(0, 2).join(' '));
  const dupes = openers.length - new Set(openers).size;
  const banned = bossTurns.flatMap((t) => BANNED.filter((b) => t.toLowerCase().includes(b)));
  const withParticle = bossTurns.filter((t) => PARTICLES.test(t)).length;
  // callback rate: boss turn N reuses a Capitalized content word the candidate said in turn N-1
  let callbacks = 0;
  for (let i = 0; i < candTurns.length && i + 1 < bossTurns.length; i++) {
    const candNouns = (candTurns[i].match(/\b[A-ZÄÖÜ][a-zäöüß]{3,}\b/g) || []);
    if (candNouns.some((n) => bossTurns[i + 1].includes(n))) callbacks++;
  }
  const lens = bossTurns.map((t) => t.split(/\s+/).length);
  return {
    bossTurns: bossTurns.length,
    repeatedOpeners: dupes,
    bannedPhrases: banned,
    particleTurns: `${withParticle}/${bossTurns.length}`,
    callbackRate: candTurns.length ? `${callbacks}/${Math.min(candTurns.length, bossTurns.length - 1)}` : 'n/a',
    lineLenMinMax: `${Math.min(...lens)}–${Math.max(...lens)} words`,
  };
}

async function judge(transcript) {
  const sys = `Du bist ein deutscher Muttersprachler und Experte für gesprochene Sprache. Unten ist das Transkript ` +
    `eines Job-Interviews. Beurteile NUR den INTERVIEWER. Würde ein Muttersprachler merken, dass der Interviewer ` +
    `eine KI ist? Klingt er wie ein echter, lebendiger Mensch — oder wie vorgefertigte Zeilen? Antworte als JSON: ` +
    `{"humanScore":0-100,"moreHumanThanHuman":true/false,"verdict":"1 Satz","roboticTells":["..."],"fixes":["..."]}`;
  const out = await groq([
    { role: 'system', content: sys },
    { role: 'user', content: transcript },
  ], { json: true, temperature: 0.2, max_tokens: 700 });
  try { return JSON.parse(out); } catch { return { raw: out }; }
}

// ── Run the real conversation ────────────────────────────────────────────────────
const { RealtimeClient } = await import(pathToFileURL(path.join(ROOT, 'server/realtimeClient.js')).href);

const bossTurns = [];
const client = new RealtimeClient({
  sessionId: `talktest-${bossId}-${level}`, bossId, level,
  onBossSpeech: (t) => bossTurns.push(t),
  onBossSpeechDone: () => {}, onError: (e) => console.error('[boss error]', e.message), onClose: () => {},
});
await client.connect();
await new Promise((r) => setTimeout(r, 80));   // let the opening line fire

const history = [{ who: 'boss', text: bossTurns[0] || '(no opening)' }];
const candTurns = [];
console.log(`\n=== TALK-TEST  boss=${bossId} level=${level} turns=${TURNS} ===\n`);
console.log(`B: ${bossTurns[0]}\n`);
for (let i = 0; i < TURNS; i++) {
  const ans = await playCandidate(history);
  candTurns.push(ans); history.push({ who: 'cand', text: ans });
  console.log(`K: ${ans}`);
  client.requestEmotion(fakeEmotion(ans));
  const before = bossTurns.length;
  await client.respond(ans);
  const line = bossTurns[before] || '(no reply)';
  history.push({ who: 'boss', text: line });
  console.log(`B: ${line}\n`);
}

const transcript = history.map((t) => `${t.who === 'boss' ? 'INTERVIEWER' : 'KANDIDAT'}: ${t.text}`).join('\n');
console.log('=== DETERMINISTIC METRICS ===');
console.log(JSON.stringify(metrics(bossTurns, candTurns), null, 2));
console.log('\n=== LLM JUDGE ===');
try { console.log(JSON.stringify(await judge(transcript), null, 2)); }
catch (e) { console.error('judge failed:', e.message); }
console.log('\nDONE.');
