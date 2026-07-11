/**
 * elevenDebrief.js — build the FULL, coherent post-interview debrief from an ElevenLabs transcript.
 *
 * MUST #2 (owner 2026-07-11): the feedback after every interview must be absolutely accurate + relevant,
 * for all HRs, coherent with the app's core. So this REUSES the app's real feedback functions
 * (generateDebrief, gradeTranscript, topL1Pattern, debriefStructureWins) with the SAME metrics logic as
 * websocketManager._computeMetrics — fed ElevenLabs' ACCURATE German transcript (not Gemini gibberish).
 * It does NOT touch the live fight loop.
 *
 * Known gap vs the live fight: per-turn answer scores (avgScore/HP) come from the fight's live scoring,
 * which this transcript-only path doesn't have → fluency is computed from pace+lexical range only, and
 * avgScore is 0. The CORE feedback (grammar corrections, CEFR level+verdict, study advice, L1 pattern,
 * structure wins) is identical-function accurate. Live per-turn scoring is the next step (fight-loop wiring).
 */
import { generateDebrief } from './coach.js';
import { gradeTranscript } from './scoring/panelscorer.mjs';
import { topL1Pattern } from './scoring/l1Errors.js';
import { debriefStructureWins } from './scoring/structureWins.js';

const FILLER_RE = /\b(?:äh+|ähm+|öh+|hm+|halt|also|ja\s+genau|weißt\s+du|sozusagen|irgendwie|quasi)\b/gi;
const countFillers = (t) => ((t || '').match(FILLER_RE) ?? []).length;

// Mirrors websocketManager._computeMetrics exactly (same word lists) so numbers match the app.
function computeMetrics(utterances, level, speechMs) {
  const text = ' ' + utterances.map((u) => (u.text || '').toLowerCase()).join('  ') + ' ';
  const words = utterances.reduce((s, u) => s + (u.words || 0), 0);
  const totalSpeechMs = speechMs > 0 ? speechMs : Math.round((words / 2.3) * 1000);   // estimate if unmeasured (~2.3 w/s)
  const speechSec = Math.max(1, Math.round(totalSpeechMs / 1000));
  const wpm = totalSpeechMs > 0 ? Math.round(words / (speechSec / 60)) : 0;
  const countList = (list) => list.reduce((n, w) => n + (text.includes(` ${w} `) ? 1 : 0), 0);
  const fillers = countFillers(text);
  const connectors = ['weil', 'obwohl', 'damit', 'sodass', 'dennoch', 'trotzdem', 'deshalb', 'außerdem', 'während', 'sobald', 'falls', 'indem', 'zwar', 'jedoch'];
  const konjunktiv = ['würde', 'würden', 'könnte', 'könnten', 'hätte', 'wäre', 'müsste', 'dürfte', 'sollte', 'möchte'];
  const c1Words = ['lösungsorientiert', 'nachvollziehbar', 'transparent', 'verbindlich', 'zielführend', 'wertschätzend', 'eigenverantwortlich', 'konstruktiv', 'diesbezüglich', 'maßgeblich', 'professionell', 'kompetenz'];
  const polite = ['könnten sie', 'würden sie', 'dürfte ich', 'ich würde vorschlagen', 'es tut mir leid', 'entschuldigung', 'gerne'];
  const c1WordsUsed = c1Words.filter((w) => text.includes(w));
  const connectorHits = countList(connectors);
  const konjunktivHits = countList(konjunktiv);
  const c1Hits = c1WordsUsed.length;
  const wpmFit = (wpm >= 140 && wpm <= 160) ? 100 : (wpm >= 110 && wpm <= 180) ? 70 : (wpm > 0 ? 40 : 0);
  // No live per-turn avgScore on this path → fluency from pace + lexical range only.
  const fluency = Math.max(0, Math.min(100, Math.round(0.4 * wpmFit + 0.6 * Math.min(100, (c1Hits + connectorHits) * 12))));
  return {
    answers: utterances.length, words, speechSec, wpm, wpmTarget: [140, 160], fillers,
    connectorHits, konjunktivHits, c1Hits, c1WordsUsed,
    politenessHits: polite.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0),
    avgScore: 0, fluency, level,
  };
}

/**
 * @param {object} p { transcript:[{who:'user'|'ai', text}], level, userId, speechMs }
 * @returns {Promise<object>} the debrief payload (generateDebrief shape + rank/verdict/l1Pattern/structureWins/metrics)
 */
export async function buildElevenDebrief({ transcript = [], level = 'a2-b1', userId = 'anon', speechMs = 0 } = {}) {
  const utterances = [];
  const dialogue = [];
  for (const t of (Array.isArray(transcript) ? transcript : [])) {
    const txt = String(t?.text || '').trim();
    if (!txt) continue;
    if (t.who === 'user') {
      const words = txt.split(/\s+/).filter(Boolean).length;
      dialogue.push({ role: 'candidate', text: txt, words });
      if (words >= 2) utterances.push({ text: txt, words });
    } else {
      dialogue.push({ role: 'boss', text: txt });
    }
  }
  const metrics = computeMetrics(utterances, level, speechMs);
  const fullTranscript = utterances.map((u) => u.text).join('\n');

  let debrief;
  try { debrief = await generateDebrief({ utterances, dialogue, history: [], metrics, level, csScenarioId: 'general' }); }
  catch (e) { console.error('[elevenDebrief] generateDebrief failed:', e.message); debrief = { grammar: [], strengths: [], studyNext: [], metrics, generated: false }; }

  let rank = null, verdict = null;
  try { const g = await gradeTranscript({ transcript: fullTranscript, level, scenarioId: 'general', userId }); rank = g?.cefrLevel ?? null; verdict = g?.verdict ?? null; }
  catch (e) { console.error('[elevenDebrief] gradeTranscript failed:', e.message); }

  let l1Pattern = null, structureWins = [];
  try { l1Pattern = topL1Pattern(utterances); } catch (e) { /* optional */ }
  try { structureWins = debriefStructureWins(utterances); } catch (e) { /* optional */ }

  return { ...debrief, metrics, rank, verdict, l1Pattern, structureWins, answers: utterances.length };
}

export default { buildElevenDebrief };
