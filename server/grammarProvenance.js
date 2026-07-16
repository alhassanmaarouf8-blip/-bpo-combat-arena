const correctionKey = (example) =>
  `${example?.wrong ?? ''}→${example?.right ?? ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const tagRules = (rules, source) => (rules || []).map((rule) => ({
  ...rule,
  correctionSource: source,
  examples: (rule.examples || []).map((example) => ({ ...example, correctionSource: source })),
}));

/**
 * Preserve the existing LLM-first merge while exposing exactly which checker produced each
 * correction. `null` means the provider did not return a usable result; `[]` means it ran and
 * found no correction. The function is pure so provenance can be regression-tested independently
 * from network providers.
 */
export function mergeGrammarSources({ languageTool = null, llm = null } = {}) {
  const languageToolAvailable = Array.isArray(languageTool);
  const llmAvailable = Array.isArray(llm);
  const taggedLanguageTool = tagRules(languageToolAvailable ? languageTool : [], 'languagetool');
  const taggedLlm = tagRules(llmAvailable ? llm : [], 'llm');

  const seen = new Set(taggedLanguageTool.flatMap((rule) => (rule.examples || []).map(correctionKey)));
  const freshLlm = taggedLlm
    .map((rule) => ({
      ...rule,
      examples: (rule.examples || []).filter((example) => !seen.has(correctionKey(example))),
    }))
    .filter((rule) => rule.examples.length > 0);

  const grammar = [...freshLlm, ...taggedLanguageTool];
  const correctionSources = [
    ...(freshLlm.length ? ['llm'] : []),
    ...(taggedLanguageTool.length ? ['languagetool'] : []),
  ];
  const grammarSource = correctionSources.length === 2
    ? 'merged'
    : correctionSources[0] ?? 'none';

  return {
    grammar,
    grammarSource,
    grammarUnavailable: !languageToolAvailable && !llmAvailable,
    grammarProvenance: {
      version: 1,
      strategy: 'llm-first-deduplicated-merge',
      correctionSources,
      providers: {
        languagetool: {
          status: languageToolAvailable ? 'available' : 'unavailable',
          correctionRules: taggedLanguageTool.length,
        },
        llm: {
          status: llmAvailable ? 'available' : 'unavailable',
          correctionRules: freshLlm.length,
        },
      },
    },
  };
}

export function attachGrammarProvenance(target, result) {
  target.grammarSource = result.grammarSource;
  target.grammarUnavailable = result.grammarUnavailable;
  target.grammarProvenance = result.grammarProvenance;
  return target;
}
