/**
 * hireReadinessAccuracy.test.mjs — SYNTHETIC BOUNDARY CORPUS + regression guard for the internal
 * simulation classifier. These cases are authored threshold probes, not real recruiter outcomes.
 *
 * The simulation diagnostic is visible on the home, so a false internal pass/fail is a trust-killer.
 * This locks authored simulation thresholds so the classifier cannot silently regress while real
 * outcome calibration remains explicitly absent.
 *
 * THE BOUNDARY RATCHET (invariants enforced here):
 *   1. ZERO-HARM — HARD FAIL, count MUST be 0:
 *        (a) FALSE INTERNAL PASS: a profile below a simulation gate never passes the classifier.
 *        (b) FALSE INTERNAL FAIL: a profile above every authored gate never fails the classifier.
 *      These guard the hire GATES (level ≥ B1, intelligibility ≥ 0.7, de-escalation ≥ 0.5,
 *      giveUp ≤ 0.3, wpm ≥ 90). Break a gate → this fails → it can never be committed.
 *   2. RATCHET — CEFR-level match and limiting-skill match are pinned to floors that only rise.
 *
 * Real consented outcomes belong in a separate outcome-evaluation dataset. They must never be mixed
 * into this source file or implied by these synthetic cases.
 * classify() is a locked internal boundary function; it is never evidence of hiring probability.
 *
 * Run: node --test server/scoring/hireReadinessAccuracy.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../hireReadiness.js';

// A "neutral-decent" baseline (same defaults featuresFromProfile uses); a case overrides only the
// salient signals so its intent is legible.
const BASE = { wpm: 100, fillerPer100: 6, errPer100: 6, subClauseRate: 0.3, vocabDiversity: 0.5,
  deescalation: 0.6, giveUpRate: 0.15, intelligibility: 0.8, latencyS: 3 };
const mk = (o) => ({ ...BASE, ...o });

// Authored synthetic cases. `hire` means pass/fail against the internal gates only.
const CORPUS = [
  // ── clearly HIREABLE (never fail them) ──
  { f: mk({ wpm: 130, errPer100: 3, subClauseRate: 0.5, vocabDiversity: 0.7, deescalation: 0.8, giveUpRate: 0.05, intelligibility: 0.9, fillerPer100: 4, latencyS: 2 }), hire: 'yes', level: 'B2' },
  { f: mk({ wpm: 125, errPer100: 4, subClauseRate: 0.5, vocabDiversity: 0.68, deescalation: 0.75, giveUpRate: 0.1, intelligibility: 0.88 }), hire: 'yes', level: 'B2' },
  { f: mk({ wpm: 140, errPer100: 2, subClauseRate: 0.6, vocabDiversity: 0.78, deescalation: 0.85, giveUpRate: 0.05, intelligibility: 0.92 }), hire: 'yes', level: 'C1' },
  { f: mk({ wpm: 100, errPer100: 7, subClauseRate: 0.3, vocabDiversity: 0.55, deescalation: 0.6, giveUpRate: 0.15, intelligibility: 0.8 }), hire: 'yes', level: 'B1' },

  // ── clearly NOT hireable — each fails ONE hire gate (never call them hireable) ──
  // strong German, but pronunciation doesn't come across (intelligibility gate) — the classic trap.
  { f: mk({ wpm: 120, errPer100: 4, subClauseRate: 0.5, vocabDiversity: 0.7, deescalation: 0.7, giveUpRate: 0.1, intelligibility: 0.5 }), hire: 'no', level: 'B2', limit: 'intelligibility' },
  { f: mk({ wpm: 110, errPer100: 5, subClauseRate: 0.4, vocabDiversity: 0.6, deescalation: 0.7, giveUpRate: 0.1, intelligibility: 0.4 }), hire: 'no', limit: 'intelligibility' },
  // can't calm an angry customer — the BPO-critical skill (de-escalation gate).
  { f: mk({ wpm: 115, errPer100: 5, subClauseRate: 0.45, vocabDiversity: 0.65, deescalation: 0.3, giveUpRate: 0.15, intelligibility: 0.85 }), hire: 'no', level: 'B2', limit: 'deescalation' },
  // freezes / gives up (giveUp gate).
  { f: mk({ wpm: 95, errPer100: 7, subClauseRate: 0.3, vocabDiversity: 0.6, deescalation: 0.55, giveUpRate: 0.5, intelligibility: 0.8, fillerPer100: 14, latencyS: 6 }), hire: 'no', limit: 'confidence' },
  // too slow to hold a live phone call (wpm gate).
  { f: mk({ wpm: 55, errPer100: 5, subClauseRate: 0.35, vocabDiversity: 0.6, deescalation: 0.65, giveUpRate: 0.15, intelligibility: 0.85 }), hire: 'no', limit: 'fluency' },
  // low level, many errors — nowhere near ready.
  { f: mk({ wpm: 70, errPer100: 16, subClauseRate: 0.1, vocabDiversity: 0.4, deescalation: 0.4, giveUpRate: 0.3, intelligibility: 0.6, fillerPer100: 12 }), hire: 'no', limit: 'grammar' },

  // ── EDGE (arguable hireability — excluded from zero-harm; used only for the limiting-skill ratchet) ──
  { f: mk({ wpm: 110, errPer100: 18, subClauseRate: 0.4, vocabDiversity: 0.6, deescalation: 0.65, giveUpRate: 0.1, intelligibility: 0.85 }), hire: 'edge', limit: 'grammar' },
  { f: mk({ wpm: 110, errPer100: 5, subClauseRate: 0.05, vocabDiversity: 0.3, deescalation: 0.65, giveUpRate: 0.1, intelligibility: 0.85 }), hire: 'edge', limit: 'complexity' },
  { f: mk({ wpm: 100, errPer100: 6, subClauseRate: 0.3, vocabDiversity: 0.55, deescalation: 0.6, giveUpRate: 0.15, intelligibility: 0.8, fillerPer100: 26, latencyS: 5 }), hire: 'edge', limit: 'confidence' },
];

const LEVEL_FLOOR = 0.80;   // ratchets UP as the corpus grows / the classifier improves. Never lower.
const LIMIT_FLOOR = 0.80;

test('synthetic boundary guard — no false internal pass or false internal fail', () => {
  const falseHireable = [], falseFail = [];
  for (const c of CORPUS) {
    const { hireReady } = classify(c.f);
    if (c.hire === 'no'  && hireReady === true)  falseHireable.push(JSON.stringify(c.f));
    if (c.hire === 'yes' && hireReady === false) falseFail.push(JSON.stringify(c.f));
  }
  assert.equal(falseHireable.length, 0, `FALSE INTERNAL PASS:\n  ${falseHireable.join('\n  ')}`);
  assert.equal(falseFail.length, 0,     `FALSE INTERNAL FAIL:\n  ${falseFail.join('\n  ')}`);
});

test('RATCHET — CEFR-level and limiting-skill match stay above their floors', () => {
  const lv = CORPUS.filter((c) => c.level);
  const lvHit = lv.filter((c) => classify(c.f).level === c.level).length;
  const lvRate = lv.length ? lvHit / lv.length : 1;

  const li = CORPUS.filter((c) => c.limit);
  const liHit = li.filter((c) => classify(c.f).limitingSkill === c.limit).length;
  const liRate = li.length ? liHit / li.length : 1;

  console.log(`\n[simulation-boundary-ratchet] level ${(lvRate * 100).toFixed(0)}% (${lvHit}/${lv.length}) · limiting-skill ${(liRate * 100).toFixed(0)}% (${liHit}/${li.length}) · synthetic corpus ${CORPUS.length} cases`);
  const lvMiss = lv.filter((c) => classify(c.f).level !== c.level).map((c) => `level→got ${classify(c.f).level} want ${c.level}`);
  const liMiss = li.filter((c) => classify(c.f).limitingSkill !== c.limit).map((c) => `limit→got ${classify(c.f).limitingSkill} want ${c.limit}`);
  if (lvMiss.length || liMiss.length) console.log('  gaps: ' + [...lvMiss, ...liMiss].join(' | '));

  assert.ok(lvRate >= LEVEL_FLOOR, `CEFR-level match ${(lvRate * 100).toFixed(0)}% fell below floor ${LEVEL_FLOOR * 100}%`);
  assert.ok(liRate >= LIMIT_FLOOR, `limiting-skill match ${(liRate * 100).toFixed(0)}% fell below floor ${LIMIT_FLOOR * 100}%`);
});
