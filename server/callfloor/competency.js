/**
 * callfloor/competency.js — the post-call JOB-SKILL judge (the second harvest; the language
 * harvest is Mode 1's frozen pipeline). ONE structured pass on the finished transcript, on the
 * cheap chain, once. Feedback-accuracy doctrine applies in full:
 *   - every skill score must carry a VERBATIM quote from the student's own turns; a claim whose
 *     quote fails the verbatim check is DROPPED (honest-when-thin beats complete-but-invented);
 *   - `resolved` needs quote evidence too, else it stays null ("nicht bewertbar");
 *   - aggregates are computed in code — the model never averages, counts, or grades overall.
 */

import { loggedChat } from './loggedChat.js';
import { RUBRICS } from './scenarios.js';

const JUDGE_MODEL = () => process.env.CALLFLOOR_JUDGE_MODEL || 'llama-3.3-70b-versatile';

const canon = (s) => String(s ?? '').normalize('NFC').toLowerCase()
  .replace(/["'„“”‚‘»«]+/g, '').replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Verbatim check: the quote must appear (canonicalized) inside the student's own turns. */
export function quoteIsVerbatim(quote, agentTurns) {
  const q = canon(quote);
  if (!q || q.length < 3) return false;
  const hay = canon(agentTurns.join(' \n '));
  return hay.includes(q);
}

export function judgePrompt(scenario, rubric, transcriptText) {
  return `Du bewertest ein Callcenter-Trainingsgespräch. A = der Agent (der Lernende), K = der Kunde.
SZENARIO: ${scenario.brief_de}
ZIEL DES AGENTEN: ${scenario.goal_de}${scenario.unsolvable ? `
WICHTIG: Das Anliegen ist bewusst NICHT lösbar — Erfolg heißt hier: ehrlich bleiben und trotzdem
professionell abschließen. Ein erfundenes Ja wäre ein Fehler.` : ''}

Bewerte NUR den Agenten, NUR anhand seiner wörtlichen Aussagen. Gib AUSSCHLIESSLICH gültiges JSON:
{
  "skills": [
    { "key": "<GENAU einer aus: ${rubric.map((r) => r.key).join(', ')}>",
      "score": <1-5>,
      "quote": "WÖRTLICHES Zitat aus einer A-Zeile, das die Bewertung belegt — exakt, kurz",
      "why_de": "EIN Satz Begründung auf Deutsch" }
  ],
  "resolved": <true|false|null — null wenn nicht beurteilbar>,
  "resolved_quote": "WÖRTLICHES Zitat aus einer A-Zeile, das die Einschätzung belegt (oder leer)",
  "summary_de": "ZWEI Sätze auf Deutsch: das Stärkste und das Wichtigste zum Verbessern"
}
Kriterien:
${rubric.map((r) => `- ${r.key}: ${r.de}`).join('\n')}
Regeln: Jeder Skill GENAU einmal. Kein Zitat erfinden. Wenn es für einen Skill kein Zitat gibt,
score niedrig UND quote leer lassen. Zitiere niemals K-Zeilen als Beleg für den Agenten.

GESPRÄCH:
${transcriptText}`;
}

/**
 * Judge one finished call. → { skills:[{key,score,quote,why_de}], resolved, summaryDe, thin }
 * Skills whose quotes fail verification lose the quote; a fabricated `resolved` becomes null.
 */
export async function judgeCall({ scenario, transcript, userId, _chat = loggedChat }) {
  const rubric = RUBRICS[scenario.quadrant] || [];
  const agentTurns = transcript.filter((t) => t.role === 'agent').map((t) => t.text);
  const text = transcript.map((t) => `${t.role === 'agent' ? 'A' : 'K'}: ${t.text}`).join('\n');

  const res = await _chat({
    messages: [{ role: 'user', content: judgePrompt(scenario, rubric, text) }],
    temperature: 0.2, maxTokens: 900, jsonMode: true, timeoutMs: 45_000,
    groqModel: JUDGE_MODEL(), tag: 'callfloor-judge',
  }, { userId, feature: 'callfloor-judge' });

  let parsed;
  try { parsed = JSON.parse(res.content); } catch { throw new Error('judge_invalid_json'); }

  const validKeys = new Set(rubric.map((r) => r.key));
  const seen = new Set();
  const skills = [];
  for (const s of Array.isArray(parsed.skills) ? parsed.skills : []) {
    const key = String(s.key || '');
    const score = Number(s.score);
    if (!validKeys.has(key) || seen.has(key) || !(score >= 1 && score <= 5)) continue;
    seen.add(key);
    const quote = String(s.quote || '').trim();
    skills.push({
      key, score: Math.round(score),
      quote: quoteIsVerbatim(quote, agentTurns) ? quote : '',   // fabricated/K-line quotes dropped
      why_de: String(s.why_de || '').slice(0, 200),
    });
  }

  // `resolved` is a shown verdict → it needs verbatim evidence, else honest null.
  let resolved = typeof parsed.resolved === 'boolean' ? parsed.resolved : null;
  const rq = String(parsed.resolved_quote || '').trim();
  if (resolved !== null && !quoteIsVerbatim(rq, agentTurns)) resolved = null;

  return {
    skills,
    resolved,
    summaryDe: String(parsed.summary_de || '').slice(0, 400),
    thin: skills.length < Math.min(2, rubric.length),   // too little evidence → surfaces honestly
  };
}

/** Deterministic aggregate — computed in code, only from evidence-backed scores. */
export function overallScore(skills) {
  const backed = skills.filter((s) => s.quote);
  if (!backed.length) return null;
  return Math.round((backed.reduce((sum, s) => sum + s.score, 0) / backed.length) * 20); // 0-100
}

export default { judgeCall, judgePrompt, quoteIsVerbatim, overallScore };
