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
  return {
    roundsFinished: rows.length,
    allMeaningful: rows.length === 3 && rows.every(meaningful),
    finalMeaningful,
    relevancyMeasured: finalMeaningful && typeof final?.metrics?.relevancy === 'number',
    grammarMeasured: finalMeaningful,
    fillerPraiseAllowed: rows.length === 3 && meaningful(rows[0]) && finalMeaningful,
  };
}
