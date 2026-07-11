/**
 * scoreFactors.js — EXACT copy of websocketManager._scoreFactors + its HP-delta caps, for the
 * ElevenLabs per-turn HP path. COHERENCE (MUST #2): identical algorithm to the live fight scorer, so
 * HP moves the same way. Kept standalone so the live fight code is UNTOUCHED (zero regression risk).
 * ⚠ If the fight scorer (_scoreFactors) ever changes, mirror the change here.
 */
const FILLER_RE = /(?<!\p{L})(?:ähm+|äh+|ehm+|also|halt|irgendwie|quasi|sozusagen)(?!\p{L})/giu;
const countFillers = (text) => ((text || '').match(FILLER_RE) ?? []).length;
const MIN_SCORED_WORDS = 3;
const MAX_PLAYER_DMG   = 12;
const MAX_BOSS_DMG     = 15;

export function scoreFactors(transcript, durationMs, wordCount, opts = {}) {
  const factors = [];
  const add = (side, label, hp) => { const v = Math.round(hp); if (v > 0) factors.push({ side, label, hp: v }); };

  if (!transcript || wordCount < 1) {
    return { score: 0, factors: [{ side: 'player', label: 'keine Antwort', hp: 4 }] };
  }

  const lenient = opts.levelId === 'a2-b1';
  const strict  = opts.levelId === 'c1';
  const stage   = opts.stage ?? 0;
  const text    = ' ' + transcript.toLowerCase() + ' ';

  const englishWords = ['the','is','are','was','were','this','that','have','with','they','you','can'];
  const arabicChars  = /[؀-ۿ]/;
  const englishScore = englishWords.filter(w => text.includes(` ${w} `)).length;
  if (englishScore >= 3 || arabicChars.test(text)) {
    return { score: 0, factors: [{ side: 'player', label: 'kein Deutsch', hp: MAX_PLAYER_DMG }] };
  }
  if      (englishScore === 2) add('player', 'Englisch im Satz', 5);
  else if (englishScore === 1) add('player', 'englisches Wort',  3);

  let score = lenient ? 58 : 46;

  const fillers = countFillers(text);
  if (fillers > 0) {
    const pen = fillers * (lenient ? 2 : 4);
    score -= pen;
    if (fillers >= 2) add('player', 'Füllwörter', pen);
  }

  const wpm = durationMs > 0 ? Math.round((wordCount / durationMs) * 60_000) : 0;
  if (lenient) {
    if      (wpm >= 90 && wpm <= 170) { score += 8; add('boss', 'fließend', 6); }
    else if (wpm > 0 && wpm < 45)     { score -= 6; add('player', 'langes Zögern', 5); }
  } else {
    if      (wpm >= 130 && wpm <= 165) { score += 10; add('boss', 'fließend', 7); }
    else if (wpm < 90)                 { score -= 8;  add('player', 'langes Zögern', 6); }
    else if (wpm > 205)                { score -= 5;  add('player', 'zu hastig', 4); }
  }

  const [lenA, lenB] = lenient ? [12, 28] : [20, 45];
  let lenBonus = 0;
  if (wordCount >= lenA) lenBonus += 8;
  if (wordCount >= lenB) lenBonus += 8;
  if (lenBonus > 0) { score += lenBonus; add('boss', 'ausführlich', lenBonus * 0.4); }
  else if (wordCount < (lenient ? 6 : 10)) add('player', 'zu kurz', 3);

  const c1Words = ['lösungsorientiert','nachvollziehbar','transparent','verbindlich',
                   'zielführend','wertschätzend','eigenverantwortlich','konstruktiv',
                   'diesbezüglich','maßgeblich','professionell','kompetenz'];
  const c1Hits = c1Words.filter(w => text.includes(w)).length;
  if (c1Hits > 0) { score += c1Hits * 4; add('boss', 'Wortschatz', c1Hits * 3); }

  const connectors = ['weil','obwohl','damit','sodass','dennoch','trotzdem','deshalb',
                      'außerdem','während','sobald','falls','indem','zwar','jedoch'];
  const connHits = connectors.filter(w => text.includes(` ${w} `)).length;
  if (connHits > 0) { score += connHits * (lenient ? 3 : 5); add('boss', 'guter Satzbau', connHits * (lenient ? 2.5 : 3.5)); }
  if (!lenient && wordCount >= 25 && connHits === 0) { score -= 10; add('player', 'kein Satzbau', 6); }

  const konjunktiv = ['würde','würden','könnte','könnten','hätte','wäre','müsste','dürfte','sollte','möchte'];
  const konjHits = konjunktiv.filter(w => text.includes(` ${w} `)).length;
  if (konjHits > 0) { score += konjHits * (lenient ? 3 : 4); add('boss', 'Höflichkeit', konjHits * 2.5); }

  const selfCorr = ['ich meine','ich wollte sagen','ich meinte','beziehungsweise',
                    'genauer gesagt','besser gesagt','also ich meinte'];
  if (selfCorr.some(w => text.includes(w))) { score += 4; add('boss', 'Selbstkorrektur', 4); }

  if (stage === 2) {
    const empathy   = ['verstehe','tut mir leid','entschuldigung','entschuldige','nachvollziehen','verständlich','bedauere'];
    const ownership = ['ich kümmere','ich übernehme','ich sorge','ich kläre','ich prüfe','ich schaue','ich veranlasse'];
    const nextStep  = ['ich würde vorschlagen','ich schlage vor','als nächstes','ich werde','wir werden','umgehend'];
    if (empathy.some(w => text.includes(w)))   { score += 10; add('boss', 'Empathie', 6); }
    if (ownership.some(w => text.includes(w))) { score += 8;  add('boss', 'Verantwortung', 5); }
    if (nextStep.some(w => text.includes(w)))  { score += 8;  add('boss', 'klare Lösung', 5); }
    if (text.includes('könnten sie') || text.includes('würden sie') || text.includes('dürfte ich')) { score += 4; add('boss', 'höfliche Rückfrage', 3); }
    const c1Deesc = ['zusammenfassen','ihr anliegen','zuständige stelle','sachlich bleiben','umgehend darum','konkret für sie','nicht rückgängig machen'];
    if (c1Deesc.some(w => text.includes(w))) { score += 6; add('boss', 'C1-Deeskalation', 4); }
  }

  if (strict) {
    const fvg = ['eine entscheidung treffen','zur verfügung stellen','in anspruch nehmen','in betracht ziehen','einen schritt unternehmen','in frage stellen'];
    const passErsatz = ['lässt sich','ist zu klären','ist zu beachten','ist zu bearbeiten','ist zu lösen'];
    if (fvg.some(w => text.includes(w)))       { score += 8; add('boss', 'Nominalisierung', 5); }
    if (passErsatz.some(w => text.includes(w))) { score += 8; add('boss', 'Passiversatz',   5); }
    if (wordCount < 25 && wordCount >= MIN_SCORED_WORDS) { score -= 10; add('player', 'zu kurz für C1', 7); }
  }

  // ── Anti-gaming (2026-07-11): keyword/buzzword farming must not earn structure+vocab credit.
  // Mirror of websocketManager._scoreFactors — keep identical.
  {
    const gw = text.trim().split(/\s+/).filter(Boolean);
    const uniqR = gw.length ? new Set(gw).size / gw.length : 1;
    const bonusSet = new Set([...connectors, ...konjunktiv, ...c1Words]);
    const kwR = gw.length ? gw.filter((x) => bonusSet.has(x.replace(/[.,!?…„“”»«]/g, ''))).length / gw.length : 0;
    if (gw.length >= 4 && (uniqR < 0.5 || kwR > 0.35)) {
      for (let i = factors.length - 1; i >= 0; i--) if (factors[i].side === 'boss') factors.splice(i, 1);
      score = Math.min(score, 40);
      add('player', 'kein echter Satz', 6);
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), factors };
}

/** Score ONE answer and return the capped HP deltas exactly like the fight (bossDmg/playerDmg). */
export function scoreTurn(transcript, durationMs, opts = {}) {
  const wc = transcript ? transcript.trim().split(/\s+/).filter(Boolean).length : 0;
  if (!transcript || wc < MIN_SCORED_WORDS) return { scored: false, score: 0, bossDmg: 0, playerDmg: 0, reasons: null };
  const { score, factors } = scoreFactors(transcript, durationMs, wc, opts);
  const sumSide = (s) => factors.filter((f) => f.side === s).reduce((a, f) => a + f.hp, 0);
  const bossDmg   = Math.min(MAX_BOSS_DMG, sumSide('boss'));
  const playerDmg = Math.min(MAX_PLAYER_DMG, sumSide('player'));
  const topSide = (s) => factors.filter((f) => f.side === s).sort((a, b) => b.hp - a.hp)[0] ?? null;
  return {
    scored: true, score, bossDmg, playerDmg,
    reasons: {
      boss:   bossDmg   > 0 && topSide('boss')   ? { label: topSide('boss').label,   amount: bossDmg }   : null,
      player: playerDmg > 0 && topSide('player') ? { label: topSide('player').label, amount: playerDmg } : null,
    },
  };
}

export default { scoreFactors, scoreTurn };
