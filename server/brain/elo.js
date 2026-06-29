/**
 * elo.js — Elo rating of learner ABILITY vs skill/item DIFFICULTY on one shared scale.
 * Online, deterministic, zero-cost (Pelánek 2016, "Elo in adaptive educational systems"). This is the
 * free, training-free equivalent of Duolingo's IRT-based "Birdbrain". Same inputs → same outputs.
 */

// P(learner succeeds) given ability θ and difficulty b (logistic; θ=b → 0.5).
export function expectedScore(ability, difficulty) {
  return 1 / (1 + Math.pow(10, (difficulty - ability) / 400));
}

// Adaptive K: large early (fast convergence), shrinks with experience (stability). No RNG.
export function adaptiveK(n, a = 32, b = 0.05) {
  return a / (1 + b * Math.max(0, n || 0));
}

// One update from a single graded outcome (1 = success, 0 = fail; fractional allowed).
// Counts (abilityN / difficultyN) drive the adaptive K independently for learner and item.
export function eloUpdate({ ability = 1200, difficulty = 1200, abilityN = 0, difficultyN = 0, outcome }) {
  const e = expectedScore(ability, difficulty);
  const dA = adaptiveK(abilityN) * (outcome - e);
  const dD = adaptiveK(difficultyN) * (outcome - e);
  return {
    ability:     ability + dA,
    difficulty:  difficulty - dD,
    abilityN:    abilityN + 1,
    difficultyN: difficultyN + 1,
    expected:    e,
  };
}
