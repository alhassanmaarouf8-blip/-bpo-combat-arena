import { readFile } from 'node:fs/promises';

const cases = [
  {
    file:'server/claimLedger.js',
    mutate:(source) => source.replace("const key = `${c.unit}:${c.axis || 'quantity'}`;", 'const key = c.unit;'),
    killed:(source) => !source.includes("const key = `${c.unit}:${c.axis || 'quantity'}`;"),
    name:'numeric claims collapse unrelated semantic axes',
  },
  {
    file:'server/scoring/roleplayTurnScoring.js',
    mutate:(source) => source.replace('rubric.negatives.some((pattern) => violatesNegativePattern(text, pattern))',
      'rubric.negatives.some((pattern) => pattern.test(text))'),
    killed:(source) => !source.includes('rubric.negatives.some((pattern) => violatesNegativePattern(text, pattern))'),
    name:'roleplay scoring loses negation scope',
  },
  {
    file:'client/public/sw.js',
    mutate:(source) => source.replace('k !== CACHE && k !== META_CACHE', 'k !== CACHE'),
    killed:(source) => !source.includes('k !== CACHE && k !== META_CACHE'),
    name:'service-worker activation deletes reminder metadata',
  },
  {
    file:'server/brain/adapter.js',
    mutate:(source) => source.replace('const progressionSessions = hasV2Evidence ? authoritativeSessions : sessions;',
      'const progressionSessions = sessions;'),
    killed:(source) => !source.includes('const progressionSessions = hasV2Evidence ? authoritativeSessions : sessions;'),
    name:'unreliable v2 sessions advance the learner model',
  },
];

let killed = 0;
for (const item of cases) {
  const source = await readFile(item.file, 'utf8');
  const mutant = item.mutate(source);
  if (mutant === source) throw new Error(`mutation_not_applied:${item.name}`);
  if (!item.killed(mutant)) throw new Error(`mutation_survived:${item.name}`);
  killed += 1;
  console.log(`killed: ${item.name}`);
}
console.log(`Reality Lab mutation score: ${killed}/${cases.length} (${Math.round(killed / cases.length * 100)}%)`);
