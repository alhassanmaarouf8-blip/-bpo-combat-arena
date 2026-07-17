export function shadowingRoundTruth(outcomes = [], total = 0) {
  const rows = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
  const expected = Math.max(0, Number(total) || 0);
  const passed = rows.filter((row) => Number(row?.match ?? row?.accuracy) >= 80 && row?.retry !== true).length;
  return {
    attempted: rows.length,
    passed,
    total: expected,
    complete: expected > 0 && rows.length >= expected && passed >= expected,
  };
}

export function flowRoundTruth(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const meaningful = (row) => {
    const metrics = row?.metrics || {};
    return Number(metrics.words) >= 15 && Number(metrics.voicedMs) >= 3000 && Number(metrics.wpm) > 0;
  };
  const final = rows[rows.length - 1];
  const finalMeaningful = meaningful(final);
  const normalizedTranscript = (row) => String(row?.transcript || '').toLocaleLowerCase('de-DE')
    .normalize('NFKC').replace(/[^a-z0-9äöüß\s]/giu, ' ').replace(/\s+/g, ' ').trim();
  const transcriptTokens = rows.map((row) => normalizedTranscript(row).split(' ').filter(Boolean));
  const nearDuplicate = (a, b) => {
    if (a.length < 10 || b.length < 10) return false;
    const left = new Set(a), right = new Set(b);
    let shared = 0;
    for (const token of left) if (right.has(token)) shared += 1;
    const union = new Set([...left, ...right]).size;
    return union > 0 && shared / union >= 0.9 && Math.abs(a.length - b.length) <= Math.max(3, Math.round(Math.max(a.length, b.length) * 0.1));
  };
  const duplicateRounds = rows.length === 3
    && nearDuplicate(transcriptTokens[0], transcriptTokens[1])
    && nearDuplicate(transcriptTokens[1], transcriptTokens[2]);
  return {
    roundsFinished: rows.length,
    allMeaningful: rows.length === 3 && rows.every(meaningful),
    finalMeaningful,
    relevancyMeasured: finalMeaningful && typeof final?.metrics?.relevancy === 'number',
    grammarMeasured: finalMeaningful,
    fillerPraiseAllowed: rows.length === 3 && meaningful(rows[0]) && finalMeaningful,
    duplicateRounds,
    improvementMeasurable: rows.length === 3 && rows.every(meaningful) && !duplicateRounds,
  };
}
