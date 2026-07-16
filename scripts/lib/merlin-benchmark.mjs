import crypto from 'node:crypto';

export const SYSTEMS = new Set(['languagetool', 'llm', 'merged']);
export const HOLDOUT_UNLOCK = 'I_UNDERSTAND_HOLDOUT_IS_ONE_TIME';
export const ADJUDICATION_VERDICTS = new Set(['valid', 'acceptable_alternative', 'harmful', 'unclear']);

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function merlinItemHash(version, authorId) {
  return sha256(`merlin:${version}:${authorId}`);
}

export function redactAdjudicationFragment(value, maxLength = 240) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/giu, '[URL]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[EMAIL]')
    .replace(/(?:\+?\d[\d\s()./-]{5,}\d)/gu, '[NUMBER]')
    .replace(/\b\d+(?:[.,]\d+)?\b/gu, '[NUMBER]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

export function deterministicSample(items, size, seed, priority = () => false) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Sample size must be a positive integer');
  const unique = new Map(items.map((item) => [item.itemHash, item]));
  const rank = (a, b) => sha256(`${seed}|${a.itemHash}`).localeCompare(sha256(`${seed}|${b.itemHash}`));
  const prioritized = [...unique.values()].filter(priority).sort(rank);
  const remainder = [...unique.values()].filter((item) => !priority(item)).sort(rank);
  return [...prioritized, ...remainder].slice(0, Math.min(size, unique.size));
}

export function grammarExamples(rule) {
  if (Array.isArray(rule?.allExamples)) return rule.allExamples;
  if (Array.isArray(rule?.summaryExamples)) return rule.summaryExamples;
  return Array.isArray(rule?.examples) ? rule.examples : [];
}

function blindCorrectionIndex(pack) {
  const index = new Map();
  for (const item of pack?.items || []) {
    for (const correction of item?.corrections || []) {
      if (!correction?.correctionId || index.has(correction.correctionId)) {
        throw new Error('Blinded pack contains a missing or duplicate correction ID');
      }
      if (typeof correction.before !== 'string' || typeof correction.after !== 'string'
        || correction.before.length > 240 || correction.after.length > 240
        || redactAdjudicationFragment(correction.before) !== correction.before
        || redactAdjudicationFragment(correction.after) !== correction.after) {
        throw new Error('Blinded pack contains an unsafe or unredacted correction fragment');
      }
      index.set(correction.correctionId, {
        reviewId: item.reviewId,
        before: correction.before,
        after: correction.after,
      });
    }
  }
  if (!index.size) throw new Error('Blinded pack contains no corrections');
  return index;
}

export function validateIndependentAdjudication(pack, review) {
  const allowedReviewKeys = ['independentReviewAttested', 'qualificationAttested', 'reviewerId', 'schemaVersion', 'verdicts'];
  if (Object.keys(review || {}).sort().join(',') !== allowedReviewKeys.sort().join(',')) {
    throw new Error('Human review contains missing or unknown fields');
  }
  if (review.schemaVersion !== 1) throw new Error('Unsupported human-review schema version');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(review.reviewerId || '')) {
    throw new Error('reviewerId must be an opaque 3-64 character identifier');
  }
  if (review.qualificationAttested !== true || review.independentReviewAttested !== true) {
    throw new Error('Qualified independent review must be explicitly attested');
  }
  if (!Array.isArray(review.verdicts)) throw new Error('Human review verdicts must be an array');
  const blindIndex = blindCorrectionIndex(pack);
  const verdicts = new Map();
  for (const entry of review.verdicts) {
    const keys = Object.keys(entry || {}).sort().join(',');
    if (keys !== 'correctionId,reviewerNote,verdict') throw new Error('Human verdict contains missing or unknown fields');
    if (!blindIndex.has(entry.correctionId)) throw new Error(`Unknown correction verdict: ${entry.correctionId}`);
    if (verdicts.has(entry.correctionId)) throw new Error(`Duplicate correction verdict: ${entry.correctionId}`);
    if (!ADJUDICATION_VERDICTS.has(entry.verdict)) throw new Error(`Invalid adjudication verdict: ${entry.verdict}`);
    if (typeof entry.reviewerNote !== 'string' || entry.reviewerNote.length > 500) {
      throw new Error('reviewerNote must be a string of at most 500 characters');
    }
    verdicts.set(entry.correctionId, entry.verdict);
  }
  if (verdicts.size !== blindIndex.size) {
    throw new Error(`Human review is incomplete: expected ${blindIndex.size}, received ${verdicts.size}`);
  }
  return { reviewerId: review.reviewerId, verdicts, blindIndex };
}

function nominalKappa(confusion, total) {
  if (!total) return null;
  const observed = [...ADJUDICATION_VERDICTS].reduce((sum, verdict) => sum + (confusion[verdict]?.[verdict] || 0), 0) / total;
  const expected = [...ADJUDICATION_VERDICTS].reduce((sum, verdict) => {
    const row = Object.values(confusion[verdict] || {}).reduce((a, b) => a + b, 0);
    const column = [...ADJUDICATION_VERDICTS].reduce((subtotal, left) => subtotal + (confusion[left]?.[verdict] || 0), 0);
    return sum + ((row / total) * (column / total));
  }, 0);
  return { observedAgreement: observed, expectedAgreement: expected, cohenKappa: expected === 1 ? null : (observed - expected) / (1 - expected) };
}

export function summarizeInterRaterAgreement(pack, reviewA, reviewB) {
  const a = validateIndependentAdjudication(pack, reviewA);
  const b = validateIndependentAdjudication(pack, reviewB);
  if (a.reviewerId === b.reviewerId) throw new Error('Two distinct independent reviewers are required');
  const confusion = Object.fromEntries([...ADJUDICATION_VERDICTS].map((verdict) => [
    verdict,
    Object.fromEntries([...ADJUDICATION_VERDICTS].map((other) => [other, 0])),
  ]));
  const disagreements = [];
  for (const correctionId of a.blindIndex.keys()) {
    const verdictA = a.verdicts.get(correctionId);
    const verdictB = b.verdicts.get(correctionId);
    confusion[verdictA][verdictB] += 1;
    if (verdictA !== verdictB) disagreements.push({ correctionId, verdictA, verdictB });
  }
  const agreement = nominalKappa(confusion, a.blindIndex.size);
  return {
    reviewed: a.blindIndex.size,
    agreements: a.blindIndex.size - disagreements.length,
    disagreements: disagreements.length,
    ...agreement,
    confusion,
    disagreementItems: disagreements,
  };
}

export function finalizeAdjudication(pack, key, reviewA, reviewB, resolution) {
  const agreement = summarizeInterRaterAgreement(pack, reviewA, reviewB);
  const a = validateIndependentAdjudication(pack, reviewA);
  const b = validateIndependentAdjudication(pack, reviewB);
  const allowedKeys = ['adjudicatorId', 'items', 'qualificationAttested', 'schemaVersion'];
  if (Object.keys(resolution || {}).sort().join(',') !== allowedKeys.sort().join(',')) {
    throw new Error('Final adjudication contains missing or unknown fields');
  }
  if (resolution.schemaVersion !== 1 || resolution.qualificationAttested !== true
    || !/^[A-Za-z0-9_-]{3,64}$/.test(resolution.adjudicatorId || '')) {
    throw new Error('Qualified final adjudicator must be explicitly attested with an opaque ID');
  }
  if (!Array.isArray(resolution.items)) throw new Error('Final adjudication items must be an array');
  const expected = new Set(agreement.disagreementItems.map((item) => item.correctionId));
  const resolved = new Map();
  for (const item of resolution.items) {
    const keys = Object.keys(item || {}).sort().join(',');
    if (keys !== 'after,before,correctionId,finalVerdict,rationale,verdictA,verdictB') {
      throw new Error('Final adjudication item contains missing or unknown fields');
    }
    if (!expected.has(item.correctionId)) throw new Error(`Unexpected final adjudication item: ${item.correctionId}`);
    if (resolved.has(item.correctionId)) throw new Error(`Duplicate final adjudication item: ${item.correctionId}`);
    if (!ADJUDICATION_VERDICTS.has(item.finalVerdict)) throw new Error(`Invalid final adjudication verdict: ${item.finalVerdict}`);
    if (typeof item.rationale !== 'string' || !item.rationale.trim() || item.rationale.length > 500) {
      throw new Error('Final adjudication rationale must contain 1-500 characters');
    }
    const fragment = a.blindIndex.get(item.correctionId);
    if (item.before !== fragment.before || item.after !== fragment.after
      || item.verdictA !== a.verdicts.get(item.correctionId) || item.verdictB !== b.verdicts.get(item.correctionId)) {
      throw new Error(`Final adjudication item does not match the frozen disagreement: ${item.correctionId}`);
    }
    resolved.set(item.correctionId, item.finalVerdict);
  }
  if (resolved.size !== expected.size) throw new Error(`Final adjudication is incomplete: expected ${expected.size}, received ${resolved.size}`);
  const verdicts = [...a.blindIndex.keys()].map((correctionId) => ({
    correctionId,
    verdict: a.verdicts.get(correctionId) === b.verdicts.get(correctionId)
      ? a.verdicts.get(correctionId)
      : resolved.get(correctionId),
  }));
  const final = summarizeAdjudication(key, { verdicts });
  if (final.reviewed !== a.blindIndex.size || final.availableCorrections !== a.blindIndex.size) {
    throw new Error('Hidden key does not exactly match the frozen blinded pack');
  }
  return { agreement, final };
}

export function summarizeAdjudication(key, review) {
  const correctionIndex = new Map();
  for (const item of key?.items || []) {
    for (const correction of item.corrections || []) {
      correctionIndex.set(correction.correctionId, {
        ruleId: correction.ltRuleId || 'unknown',
        fairCefr: item.fairCefr || 'unrated',
        l1: item.arabicL1 ? 'arabic-l1' : 'other-l1',
      });
    }
  }
  const seen = new Set();
  const counts = { valid: 0, acceptable_alternative: 0, harmful: 0, unclear: 0 };
  const byRule = {};
  for (const entry of review?.verdicts || []) {
    if (!correctionIndex.has(entry.correctionId)) throw new Error(`Unknown correction verdict: ${entry.correctionId}`);
    if (seen.has(entry.correctionId)) throw new Error(`Duplicate correction verdict: ${entry.correctionId}`);
    if (!ADJUDICATION_VERDICTS.has(entry.verdict)) throw new Error(`Invalid adjudication verdict: ${entry.verdict}`);
    seen.add(entry.correctionId);
    counts[entry.verdict] += 1;
    const ruleId = correctionIndex.get(entry.correctionId).ruleId;
    byRule[ruleId] ||= { reviewed: 0, valid: 0, acceptable_alternative: 0, harmful: 0, unclear: 0 };
    byRule[ruleId].reviewed += 1;
    byRule[ruleId][entry.verdict] += 1;
  }
  const reviewed = seen.size;
  return {
    reviewed,
    availableCorrections: correctionIndex.size,
    coverage: divide(reviewed, correctionIndex.size),
    counts,
    usableRate: divide(counts.valid + counts.acceptable_alternative, reviewed),
    harmfulRate: divide(counts.harmful, reviewed),
    unclearRate: divide(counts.unclear, reviewed),
    byRule: Object.fromEntries(Object.entries(byRule).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const header = rows[0];
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== header.length) {
      throw new Error(`Malformed CSV row ${rowIndex + 2}: expected ${header.length} fields, received ${values.length}`);
    }
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}

const splitStratum = (items, split) => {
  const calibrationEnd = Math.floor(items.length * split.calibration);
  const developmentEnd = calibrationEnd + Math.floor(items.length * split.development);
  return items.map((item, index) => ({
    ...item,
    split: index < calibrationEnd ? 'calibration' : index < developmentEnd ? 'development' : 'holdout',
  }));
};

export function buildIndex(rows, manifest) {
  const german = rows.filter((row) => row._test_language === 'German');
  const authorIds = new Set(german.map((row) => row._author_id));
  const arabicCount = german.filter((row) => row._author_L1 === 'Arabic').length;
  if (german.length !== manifest.expected.germanRows) throw new Error(`German row count mismatch: ${german.length}`);
  if (authorIds.size !== manifest.expected.uniqueGermanAuthors) throw new Error(`German author count mismatch: ${authorIds.size}`);
  if (arabicCount !== manifest.expected.arabicL1GermanRows) throw new Error(`Arabic-L1 count mismatch: ${arabicCount}`);
  if (authorIds.has('')) throw new Error('German metadata contains an empty author ID');

  const strata = new Map();
  for (const row of german) {
    const fairCefr = row._rating_fair_cefr || 'unrated';
    const arabicL1 = row._author_L1 === 'Arabic';
    const stratum = `${fairCefr}|${arabicL1 ? 'arabic-l1' : 'other-l1'}`;
    const item = {
      itemHash: merlinItemHash(manifest.version, row._author_id),
      fairCefr,
      arabicL1,
      hasGrammarError: Number(row.count_G || 0) > 0,
      sortKey: sha256(`${manifest.split.seed}|${row._author_id}`),
    };
    if (!strata.has(stratum)) strata.set(stratum, []);
    strata.get(stratum).push(item);
  }

  return [...strata.values()]
    .flatMap((items) => splitStratum(items.sort((a, b) => a.sortKey.localeCompare(b.sortKey)), manifest.split))
    .map(({ sortKey, ...item }) => item)
    .sort((a, b) => a.itemHash.localeCompare(b.itemHash));
}

export function publicIndex(items, manifestHash) {
  return {
    schemaVersion: 1,
    manifestHash,
    generatedAt: new Date().toISOString(),
    containsRawLearnerData: false,
    items: items.map(({ hasGrammarError, ...item }) => item),
    counts: items.reduce((acc, item) => {
      acc[item.split] = (acc[item.split] || 0) + 1;
      return acc;
    }, {}),
  };
}

export function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = successes / total;
  const denominator = 1 + (z ** 2 / total);
  const centre = (p + z ** 2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total)) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

const divide = (numerator, denominator) => denominator ? numerator / denominator : null;

const emptyConfusion = () => ({ tp: 0, fp: 0, tn: 0, fn: 0 });

function updateConfusion(counts, actual, predicted) {
  if (actual && predicted) counts.tp += 1;
  else if (!actual && predicted) counts.fp += 1;
  else if (!actual && !predicted) counts.tn += 1;
  else counts.fn += 1;
}

function metricsFrom(counts, eligible) {
  const total = counts.tp + counts.fp + counts.tn + counts.fn;
  const precision = divide(counts.tp, counts.tp + counts.fp);
  const recall = divide(counts.tp, counts.tp + counts.fn);
  const beta2 = 0.25;
  const f05 = precision == null || recall == null || (beta2 * precision + recall) === 0
    ? null
    : ((1 + beta2) * precision * recall) / (beta2 * precision + recall);
  return {
    n: total,
    eligible,
    coverage: divide(total, eligible),
    confusion: counts,
    accuracy: divide(counts.tp + counts.tn, total),
    precision,
    recall,
    specificity: divide(counts.tn, counts.tn + counts.fp),
    falsePositiveRate: divide(counts.fp, counts.fp + counts.tn),
    f05,
    accuracyWilson95: wilson(counts.tp + counts.tn, total),
  };
}

export function scorePredictions(items, predictions, split) {
  const selected = new Map(items.filter((item) => item.split === split).map((item) => [item.itemHash, item]));
  const seen = new Set();
  const systems = new Map();
  for (const prediction of predictions) {
    const keys = Object.keys(prediction).sort();
    if (keys.join(',') !== 'correctionCount,itemHash,system') throw new Error('Prediction contains missing or unknown fields');
    if (!SYSTEMS.has(prediction.system)) throw new Error(`Unknown system: ${prediction.system}`);
    if (!selected.has(prediction.itemHash)) throw new Error(`Prediction item is not in ${split}`);
    if (!Number.isInteger(prediction.correctionCount) || prediction.correctionCount < 0 || prediction.correctionCount > 100) {
      throw new Error('correctionCount must be an integer from 0 to 100');
    }
    const key = `${prediction.system}|${prediction.itemHash}`;
    if (seen.has(key)) throw new Error(`Duplicate prediction: ${key}`);
    seen.add(key);
    if (!systems.has(prediction.system)) {
      systems.set(prediction.system, { overall: emptyConfusion(), fairCefr: new Map(), l1: new Map() });
    }
    const accumulators = systems.get(prediction.system);
    const item = selected.get(prediction.itemHash);
    const actual = item.hasGrammarError;
    const predicted = prediction.correctionCount > 0;
    updateConfusion(accumulators.overall, actual, predicted);
    if (!accumulators.fairCefr.has(item.fairCefr)) accumulators.fairCefr.set(item.fairCefr, emptyConfusion());
    updateConfusion(accumulators.fairCefr.get(item.fairCefr), actual, predicted);
    const l1Key = item.arabicL1 ? 'arabic-l1' : 'other-l1';
    if (!accumulators.l1.has(l1Key)) accumulators.l1.set(l1Key, emptyConfusion());
    updateConfusion(accumulators.l1.get(l1Key), actual, predicted);
  }

  const result = {};
  for (const [system, accumulators] of systems) {
    const eligibleByCefr = [...selected.values()].reduce((counts, item) => {
      counts[item.fairCefr] = (counts[item.fairCefr] || 0) + 1;
      return counts;
    }, {});
    const eligibleByL1 = [...selected.values()].reduce((counts, item) => {
      const key = item.arabicL1 ? 'arabic-l1' : 'other-l1';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    result[system] = {
      ...metricsFrom(accumulators.overall, selected.size),
      slices: {
        fairCefr: Object.fromEntries([...accumulators.fairCefr].sort(([a], [b]) => a.localeCompare(b)).map(
          ([key, counts]) => [key, metricsFrom(counts, eligibleByCefr[key])],
        )),
        l1: Object.fromEntries([...accumulators.l1].sort(([a], [b]) => a.localeCompare(b)).map(
          ([key, counts]) => [key, metricsFrom(counts, eligibleByL1[key])],
        )),
      },
    };
  }
  return result;
}
