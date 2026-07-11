/**
 * verify-eleven.mjs — deterministic gate for the ElevenLabs integration (god-verification rung 1).
 * Zero-token: import-load (catches module-scope crashes) + logic units on the coherence-critical pieces
 * (scoreFactors = the per-turn HP scorer, elevenBudget = the daily quota). Every bug → a test here.
 */
const R = 'file:///C:/Users/lenovo/OneDrive/Desktop/bpo-combat-arena/server';
let ok = true;
const check = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  pass:', m); };

// ── 1. import-load (module-scope safety) ──
const { scoreFactors, scoreTurn } = await import(`${R}/scoreFactors.js`);
const { voiceGate, applyUsage, newUsage } = await import(`${R}/elevenBudget.js`);
console.log('import-load: OK (scoreFactors, elevenBudget)');

// ── 2. scoreFactors — coherence with the fight scorer ──
console.log('\nscoreFactors:');
// Strong German answer: connectors + C1 vocab + elaboration → high score, boss takes damage.
const strong = scoreTurn('Ich bin lösungsorientiert und arbeite konstruktiv, weil ich Verantwortung übernehme und transparent kommuniziere, sodass das Team mir vertraut.', 8000, { levelId: 'a2-b1' });
check(strong.scored && strong.score >= 65, `strong answer scores high (got ${strong.score})`);
check(strong.bossDmg > 0, `strong answer damages the boss (bossDmg ${strong.bossDmg})`);

// English → instant 0, max player damage ("kein Deutsch").
const eng = scoreTurn('I have three years of experience and I can work with the team very well here', 5000, { levelId: 'a2-b1' });
check(eng.scored && eng.score === 0, `English answer scores 0 (got ${eng.score})`);
check(eng.playerDmg === 12, `English answer costs max player HP (playerDmg ${eng.playerDmg})`);

// Too-short/blank → not scored (below MIN_SCORED_WORDS).
const short = scoreTurn('Ja.', 500, { levelId: 'a2-b1' });
check(!short.scored, 'one-word answer is NOT scored (fragment guard)');

// Weak-ish (short, no structure) → scored but player-side pressure.
const weak = scoreTurn('Ich weiß nicht so genau also.', 3000, { levelId: 'a2-b1' });
check(weak.scored, 'a real short answer is scored');
check(weak.bossDmg <= strong.bossDmg, 'weak answer damages boss no more than the strong one');

// Determinism: same input → same score.
const a = scoreTurn('Ich arbeite gerne im Team, weil ich zuverlässig bin.', 4000, { levelId: 'a2-b1' });
const b = scoreTurn('Ich arbeite gerne im Team, weil ich zuverlässig bin.', 4000, { levelId: 'a2-b1' });
check(a.score === b.score && a.bossDmg === b.bossDmg, 'scorer is deterministic (same in → same out)');

// HP caps respected.
check(strong.bossDmg <= 15 && strong.playerDmg <= 12, 'HP deltas within caps (boss≤15, player≤12)');

// ── ANTI-GAMING (death-mode finding 2026-07-11): buzzword/repetition spam must NOT farm points ──
const connSpam = scoreTurn('weil weil obwohl damit sodass dennoch trotzdem deshalb außerdem weil obwohl damit sodass', 5000, { levelId: 'a2-b1' });
check(connSpam.score <= 40 && connSpam.bossDmg === 0, `connector-spam capped, no boss dmg (score ${connSpam.score}, bossDmg ${connSpam.bossDmg})`);
const c1Spam = scoreTurn('professionell kompetenz transparent verbindlich lösungsorientiert konstruktiv nachvollziehbar zielführend', 5000, { levelId: 'a2-b1' });
check(c1Spam.score <= 40 && c1Spam.bossDmg === 0, `C1-word-spam capped, no boss dmg (score ${c1Spam.score}, bossDmg ${c1Spam.bossDmg})`);
const rep = scoreTurn(('lorem '.repeat(60)).trim(), 5000, { levelId: 'a2-b1' });
check(rep.score <= 40 && rep.bossDmg === 0, `repetition spam capped, no boss dmg (score ${rep.score}, bossDmg ${rep.bossDmg})`);
// CRITICAL: a REAL strong answer must be UNAFFECTED by the guard.
check(strong.score >= 65 && strong.bossDmg > 0, `real strong answer STILL rewarded after guard (score ${strong.score}, bossDmg ${strong.bossDmg})`);

// ── 3. elevenBudget — daily quota ──
console.log('\nelevenBudget:');
let u = newUsage();
check(voiceGate(u, 'taeglich', 'd1', 'm1').allowed, 'Täglich allowed fresh');
u = applyUsage(u, 'taeglich', 'd1', 'm1', 15 * 60);
check(!voiceGate(u, 'taeglich', 'd1', 'm1').allowed, 'Täglich daily quota spent');
check(voiceGate(u, 'taeglich', 'd2', 'm1').allowed, 'Täglich RESETS next day');

console.log(ok ? '\n✅ ALL PASS' : '\n❌ FAILURES ABOVE');
process.exit(ok ? 0 : 1);
