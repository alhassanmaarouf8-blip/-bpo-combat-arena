/**
 * grammarCheck.js
 * Authoritative German grammar checking via LanguageTool — the SOURCE OF TRUTH for the
 * end-of-session correction feedback. We do NOT let the language model invent corrections;
 * every shown correction comes from LanguageTool's deterministic rule engine.
 *
 * Transport: the LanguageTool HTTP API (language=de-DE). No extra npm dependency — uses
 * Node's global fetch. Defaults to the public endpoint; point LANGUAGETOOL_URL at a
 * self-hosted server (https://dev.languagetool.org/http-server) for volume / privacy.
 *
 * Returns corrections already in the debrief's grammar shape so coach.js can drop them in:
 *   { rule, count, explanation, explanation_ar, summaryExamples:[{wrong,right}], allExamples:[...] }
 */

const LT_URL     = process.env.LANGUAGETOOL_URL ?? 'https://api.languagetool.org/v2/check';
const LT_TIMEOUT = 12_000;

// LanguageTool categories that are noise on a SPEECH transcript (the punctuation and
// casing come from the speech-to-text layer, not the learner) — never blame the user for
// those. We keep genuine grammar, agreement, word-order and spelling errors.
const SKIP_CATEGORIES = new Set([
  'TYPOGRAPHY', 'WHITESPACE', 'PUNCTUATION', 'CASING',
  'STYLE', 'REDUNDANCY', 'COLLOQUIALISMS', 'PLAIN_ENGLISH',
]);

// LanguageTool tags each match with an issueType. We drop the purely stylistic / cosmetic
// types — they are the usual source of "corrections" that are wrong or pointless on a
// speech transcript. The rule is: better to show FEWER corrections than a wrong one.
// NOTE: 'uncategorized' is deliberately NOT skipped. LanguageTool tags many GENUINE German
// fixes (e.g. preposition+article like "zum" → "zur", der/die/das agreement) as
// 'uncategorized'; skipping them silently dropped real corrections and made the coach look
// like it couldn't teach. The SKIP_CATEGORIES filter (casing/typography/style) plus the
// identical-correction guards below still protect against noise.
const SKIP_ISSUE_TYPES = new Set([
  'style', 'register', 'typographical', 'whitespace', 'characters',
  'non-conformance', 'locale-violation',
]);

// Canonicalize for the identical-correction guard: collapse whitespace + drop a trailing
// sentence mark. Case is preserved (a real capitalization fix still counts).
function canon(s) {
  return String(s ?? '').replace(/\s+/g, ' ').replace(/[.!?…]+\s*$/u, '').trim();
}

async function callLanguageTool(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LT_TIMEOUT);
  try {
    const res = await fetch(LT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      signal:  controller.signal,
      body:    new URLSearchParams({ text, language: 'de-DE', enabledOnly: 'false' }).toString(),
    });
    if (!res.ok) throw new Error(`LanguageTool ${res.status} ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the candidate's utterances through LanguageTool and return grammar corrections.
 * One HTTP call per session (all utterances joined), then each match is mapped back to
 * the sentence it belongs to. Returns [] if nothing is flagged; THROWS if LT is
 * unreachable (so the caller can decide on a backstop).
 */
export async function buildGrammar(utterances) {
  // Join real utterances into one document, remembering each one's character span so we
  // can map a match's offset back to the exact sentence (and correct only that sentence).
  const segments = [];
  let combined = '';
  for (const u of (utterances || [])) {
    const t = (u?.text || '').trim();
    if (!t || (u.words ?? t.split(/\s+/).length) < 2) continue;
    const start = combined.length;
    combined += t;
    segments.push({ start, end: combined.length, text: t });
    combined += '\n';
  }
  if (!combined.trim()) return [];

  const matches = await callLanguageTool(combined);

  // Group corrections by rule so the UI can say "this rule, N times".
  const byRule = new Map();
  for (const mt of matches) {
    const repl = mt.replacements?.[0]?.value;
    if (repl == null) continue;                                   // no concrete fix → skip
    const catId = mt.rule?.category?.id;
    if (catId && SKIP_CATEGORIES.has(catId)) continue;            // STT/style noise → skip
    const issueType = mt.rule?.issueType;
    if (issueType && SKIP_ISSUE_TYPES.has(issueType)) continue;   // low-confidence type → skip

    const seg = segments.find((s) => mt.offset >= s.start && (mt.offset + mt.length) <= s.end);
    if (!seg) continue;                                           // spans a boundary → skip

    const local   = mt.offset - seg.start;
    const matched = seg.text.slice(local, local + mt.length);     // exact text LT wants to replace
    if (canon(matched) === canon(repl)) continue;                 // replacement == original span → no real change
    const wrong   = seg.text;
    const right   = seg.text.slice(0, local) + repl + seg.text.slice(local + mt.length);
    if (canon(wrong) === canon(right)) continue;                  // identical sentence → NOT an error

    const ruleName = (mt.shortMessage || mt.rule?.description || mt.rule?.category?.name || 'Grammatik').trim();
    const key = mt.rule?.id || ruleName;
    if (!byRule.has(key)) {
      byRule.set(key, {
        rule:           ruleName,
        explanation:    (mt.message || mt.rule?.description || '').trim(),
        explanation_ar: '',                                       // LT messages are German; client falls back to German
        ltRuleId:       mt.rule?.id || '',                        // stable LanguageTool ids (for Trainingslager tagging)
        ltCategoryId:   catId || '',
        examples:       [],
      });
    }
    byRule.get(key).examples.push({ wrong, right });
  }

  // Shape into the debrief grammar contract; cap to keep the screen scannable.
  return [...byRule.values()].slice(0, 6).map((g) => {
    // de-dupe identical wrong/right pairs within a rule
    const seen = new Set();
    const examples = g.examples.filter((e) => {
      const k = canon(e.wrong) + '→' + canon(e.right);
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    return {
      rule:            g.rule,
      count:           examples.length,
      explanation:     g.explanation,
      explanation_ar:  g.explanation_ar,
      ltRuleId:        g.ltRuleId,
      ltCategoryId:    g.ltCategoryId,
      summaryExamples: examples.slice(0, 2),
      allExamples:     examples,
    };
  }).filter((g) => g.summaryExamples.length > 0);
}
