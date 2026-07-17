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
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace('if (a.reviewerId === b.reviewerId) throw new Error', 'if (false) throw new Error'),
    killed:(source) => !source.includes('if (a.reviewerId === b.reviewerId) throw new Error'),
    name:'expert gold accepts one reviewer twice',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace(".filter(([, item]) => !['owner_smoke', 'synthetic_smoke'].includes(item.split))", ''),
    killed:(source) => !source.includes("!['owner_smoke', 'synthetic_smoke'].includes(item.split)"),
    name:'expert gold counts owner and synthetic smoke as accuracy evidence',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace("exactKeys(verdict, ['acceptableDrillIds'", "void verdict; exactKeys({ acceptableDrillIds: verdict.acceptableDrillIds }, ['acceptableDrillIds'"),
    killed:(source) => !source.includes("exactKeys(verdict, ['acceptableDrillIds'"),
    name:'expert review permits hidden manual app verdicts',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace('masteryClaimed = validatedTransferProofs(finalProfile, asOf).some', 'masteryClaimed = !!finalProfile || validatedTransferProofs(finalProfile, asOf).some'),
    killed:(source) => !source.includes('masteryClaimed = validatedTransferProofs(finalProfile, asOf).some'),
    name:'drill or profile completion is treated as transfer mastery',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace('if (!isDeepStrictEqual(rebuilt.pack, suppliedPack) || !isDeepStrictEqual(rebuilt.key, suppliedKey))', 'if (false)'),
    killed:(source) => !source.includes('if (!isDeepStrictEqual(rebuilt.pack, suppliedPack) || !isDeepStrictEqual(rebuilt.key, suppliedKey))'),
    name:'modified expert evidence is accepted without re-derivation',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace('containsRawAudioOrTranscript: false, reviewerIdentityStored: false,', 'containsRawAudioOrTranscript: false, reviewerIdentityStored: false, accuracy: 1,'),
    killed:(source) => !source.includes('reviewerIdentityStored: false,') || source.includes('accuracy: 1,'),
    name:'incompatible expert metrics are collapsed into one accuracy number',
  },
  {
    file:'scripts/lib/expert-gold-harness.mjs',
    mutate:(source) => source.replace('items: rows.map(({ item, reviewId }) => ({ reviewId,', 'items: rows.map(({ item, reviewId }) => ({ reviewId, appDecision: item.appDecision,'),
    killed:(source) => source.includes('reviewId, appDecision: item.appDecision,'),
    name:'blinded pack reveals app labels to raters',
  },
  {
    file:'server/pronunciationRegistry.js',
    mutate:(source) => source.replace("release?.passed === true && release?.protocolVersion === PRONUNCIATION_PROTOCOL_VERSION",
      'item'),
    killed:(source) => !source.includes('release?.passed === true && release?.protocolVersion === PRONUNCIATION_PROTOCOL_VERSION'),
    name:'unvalidated pronunciation category reaches learner feedback',
  },
  {
    file:'server/pronunciationCore.js',
    mutate:(source) => source.replace("if (quality.status !== 'usable')", "if (quality.status === 'impossible')"),
    killed:(source) => !source.includes("if (quality.status !== 'usable')"),
    name:'noise or clipping is reclassified as a learner pronunciation defect',
  },
  {
    file:'server/pronunciationCore.js',
    mutate:(source) => source.replace('state.words.size >= 2 && state.evidence.size >= 2',
      'state.words.size >= 1 && state.evidence.size >= 1'),
    killed:(source) => !source.includes('state.words.size >= 2 && state.evidence.size >= 2'),
    name:'one ordinary pronunciation occurrence becomes a durable pattern',
  },
  {
    file:'server/pronunciationCore.js',
    mutate:(source) => source.replace('metrics.harmfulAcceptedVariantCorrections === 0',
      'metrics.harmfulAcceptedVariantCorrections >= 0'),
    killed:(source) => !source.includes('metrics.harmfulAcceptedVariantCorrections === 0'),
    name:'harmful correction of an accepted pronunciation variant passes release',
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
