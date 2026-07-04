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

import { looksTruncatedDE, looksLikeTrustworthyCorrection } from './scoring/turnQuality.js';

const LT_URL     = process.env.LANGUAGETOOL_URL ?? 'https://api.languagetool.org/v2/check';
const LT_TIMEOUT = 12_000;

// LanguageTool categories that are noise on a SPEECH transcript. Punctuation, casing AND
// SPELLING (TYPOS) come from the speech-to-text layer, not the learner — the candidate spoke,
// they never typed, so orthography is the STT's choice, not theirs. TYPOS is the German
// spell-checker (GERMAN_SPELLER_RULE); on an STT transcript it "corrects" mis-heard non-words
// (e.g. splitting "überbeantragt" → "über beantragt"), which is wrong and pointless. We keep
// genuine GRAMMAR (agreement, case, word-order, verb forms).
const SKIP_CATEGORIES = new Set([
  'TYPOGRAPHY', 'WHITESPACE', 'PUNCTUATION', 'CASING', 'TYPOS',
  'STYLE', 'REDUNDANCY', 'COLLOQUIALISMS', 'PLAIN_ENGLISH',
]);

// LanguageTool tags each match with an issueType. We drop the purely stylistic / cosmetic
// types, plus 'misspelling' (orthography — see TYPOS above; the learner spoke, didn't spell).
// The rule is: better to show FEWER corrections than a wrong one.
// NOTE: 'uncategorized' is deliberately NOT skipped. LanguageTool tags many GENUINE German
// fixes (e.g. "drei Jahre" → "drei Jahren", "zum" → "zur") as 'uncategorized'; skipping them
// silently dropped real corrections and made the coach look like it couldn't teach.
const SKIP_ISSUE_TYPES = new Set([
  'style', 'register', 'typographical', 'whitespace', 'characters',
  'non-conformance', 'locale-violation', 'misspelling',
]);

// Canonicalize for the identical-correction guard: collapse whitespace + drop a trailing
// sentence mark. Case is preserved (a real capitalization fix still counts).
function canon(s) {
  return String(s ?? '').replace(/\s+/g, ' ').replace(/[.!?…]+\s*$/u, '').trim();
}

// Same letters, only spacing/case differs → an orthography artifact of the speech-to-text
// (compound splits/joins like "überbeantragt" ⇄ "über beantragt"), NOT a grammar error.
function spacingOrCaseOnly(a, b) {
  const strip = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
  return strip(a) === strip(b);
}

// Same LETTERS/digits — only punctuation/comma/spacing/case differs. A SPEAKER cannot produce a
// comma, a capital letter, or a hyphen by voice, so this is a written artifact of the transcript,
// NEVER a spoken error. THIS is the filter that was missing → "Komma vor 'sondern'" leaked through.
function punctSpacingCaseOnly(a, b) {
  const strip = (s) => String(s ?? '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
  return strip(a) === strip(b);
}

// Is this grammar rule meaningful for a SPOKEN trainer? Punctuation/casing/spelling rules are not —
// you cannot hear a comma. Used to scrub already-stored SRS items from the weakness/drills too.
export function isSpeakableRule(content) {
  const s = String(content || '').toLowerCase();
  if (!s) return true;
  return !/komma|zeichensetzung|interpunktion|anführung|bindestrich|apostroph|schreibung|getrennt.{0,8}zusammen|leerzeichen|typograf/i.test(s);
}

// Build a SHORT context fragment centred on the change (≈4 words each side) so the UI can
// show what actually changed instead of re-printing a whole ~40-word sentence twice.
function makeFragment(sentence, local, length, repl) {
  const WORDS = 4;
  const before = sentence.slice(0, local);
  const after  = sentence.slice(local + length);
  const matched = sentence.slice(local, local + length);
  const preAll  = before.split(/\s+/).filter(Boolean);
  const postAll = after.split(/\s+/).filter(Boolean);
  const pre  = preAll.slice(-WORDS).join(' ');
  const post = postAll.slice(0, WORDS).join(' ');
  const lead = preAll.length  > WORDS ? '… ' : '';
  const tail = postAll.length > WORDS ? ' …' : '';
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  return {
    wrongWord:     matched.trim(),
    rightWord:     String(repl).trim(),
    wrongFragment: clean(`${lead}${pre} ${matched} ${post}${tail}`),
    rightFragment: clean(`${lead}${pre} ${repl} ${post}${tail}`),
  };
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
    // Skip empty/one-word turns AND cut-off fragments: a turn the interviewer interrupted
    // ("…Wir haben") isn't a grammar mistake — checking it would flag the learner's INCOMPLETE
    // (not wrong) German as an error, the exact false correction the accuracy doctrine forbids.
    if (!t || (u.words ?? t.split(/\s+/).length) < 2 || looksTruncatedDE(t)) continue;
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
    if (spacingOrCaseOnly(matched, repl)) continue;               // STT orthography artifact → skip
    if (punctSpacingCaseOnly(matched, repl)) continue;            // comma/punctuation/casing-only → NOT a spoken error

    // STT-mishearing guard: on short turns, a single-token “inflection” replacement is usually
    // LanguageTool fixing a non-word the STT invented (e.g. "abpassen" → "abpasse"). Longer
    // sentences get the benefit of the doubt; very short turns don’t.
    const segLen = (seg.text || '').split(/\s+/).filter(Boolean).length;
    if (segLen <= 4 && String(matched).split(/\s+/).filter(Boolean).length === 1 && String(repl).split(/\s+/).filter(Boolean).length === 1) continue;
    const wrong   = seg.text;
    const right   = seg.text.slice(0, local) + repl + seg.text.slice(local + mt.length);
    if (canon(wrong) === canon(right)) continue;                  // identical sentence → NOT an error
    // TRUST GATE (owner-reported 2026-07-02): `right` only patches the ONE span LanguageTool
    // flagged — any OTHER defect already in this utterance (a stutter, a trailing-off clause)
    // rides along unfixed into what gets shown/stored as "the correct answer to learn" (debrief
    // "Richtig:" + the Sag-es-richtig SRS drill target). looksTruncatedDE alone doesn't catch every
    // way a sentence can trail off, so this is a stricter, separate check specifically for content
    // being PROMOTED as a model answer. Skip the whole match rather than teach broken German as right.
    if (!looksLikeTrustworthyCorrection(right)) continue;

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
    // Keep the full sentence (wrong/right) for SRS drills; add the focused fragment for display.
    byRule.get(key).examples.push({ wrong, right, ...makeFragment(seg.text, local, mt.length, repl) });
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
  })
  // FINAL SPOKEN GUARD at the source: even if a punctuation/casing/spelling rule slipped past the
  // category/issue-type/letter-diff filters above, its RULE NAME is screened here — so the debrief
  // grammar card and the "Sag es richtig" drill can never show "Komma vor 'sondern'" to a speaker.
  .filter((g) => g.summaryExamples.length > 0 && isSpeakableRule(g.rule));
}
