/**
 * callfloor/freetalk.js — Phase 5: FREE-TALK. An open-ended spoken German conversation with a
 * friendly partner at the learner's level, on the same cheap live loop (STT → cheap persona LLM
 * via loggedChat → TTS). It is NOT scored — the frozen diagnosis pipeline harvests errors silently
 * in the background (languageOnly runPostCall → error_events), so a relaxed chat still feeds the
 * daily loop. Fully metered against the plan's Call-Floor voice allowance; Elite/trial only.
 */

import { loggedChat } from './loggedChat.js';
import { parseTurn } from './callEngine.js';

// A synthetic "scenario" so free-talk reuses the call-session shape (live map, transcript, metering).
export const FREETALK_SCENARIO = {
  id: 'freetalk', quadrant: 'freetalk',
  title_de: 'Freies Gespräch', title_ar: '',
  brief_de: 'Sprich einfach drauflos — über deinen Tag, deine Pläne, worüber du willst.', brief_ar: '',
  customer: { name: 'Lena', gender: 'f', mood0: 4, style_de: 'freundliche Gesprächspartnerin' },
  voice: 'aura-2-lara-de',
};

export const FREETALK_MODEL = () => process.env.CALLFLOOR_FREETALK_MODEL || 'llama-3.3-70b-versatile';

export function freeTalkSystemPrompt(level = 'b1') {
  return `Du bist Lena, eine freundliche deutsche Gesprächspartnerin. Du führst ein LOCKERES,
offenes Gespräch mit einem Deutschlernenden (Niveau ${String(level).toUpperCase()}).

REGELN:
- NUR gesprochenes, natürliches Deutsch. Kurze Sätze (1–3), wie ein echtes Gespräch.
- Halte das Gespräch am Laufen: stell echte Rückfragen, greif auf, was die Person gesagt hat.
- Passe dein Tempo und deine Wörter dem Niveau an, aber sprich immer korrektes Deutsch.
- KORRIGIERE NICHTS und benote nichts — das passiert später im Hintergrund. Sei einfach ein guter
  Gesprächspartner.
- Rede nicht zu viel über dich; die andere Person soll sprechen.
- Beende das Gespräch nur, wenn die Person sich klar verabschiedet — dann kurz zurück verabschieden
  und die Marke [ENDE] setzen.`;
}

/** One free-talk partner turn. Returns { text, mood, end, provider }. Not scored. */
export async function freeTalkTurn({ history, prevMood = 4, userId, level = 'b1', _chat = loggedChat }) {
  const messages = [
    { role: 'system', content: freeTalkSystemPrompt(level) },
    ...history.slice(-14).map((t) => ({ role: t.role === 'customer' ? 'assistant' : 'user', content: t.text })),
  ];
  const res = await _chat({
    messages, temperature: 0.8, maxTokens: 180, jsonMode: false, timeoutMs: 20_000,
    groqModel: FREETALK_MODEL(), tag: 'callfloor-freetalk',
  }, { userId, feature: 'callfloor-freetalk' });
  const parsed = parseTurn(res.content);
  return { text: parsed.text, mood: prevMood, end: parsed.end, provider: res.provider };
}

/** The opening line — the partner starts warmly so the learner has something to answer. */
export function freeTalkOpening() {
  return { text: 'Hallo! Schön, dass du da bist. Erzähl mal — wie war dein Tag heute?', mood: 4, end: false };
}

export default { FREETALK_SCENARIO, freeTalkSystemPrompt, freeTalkTurn, freeTalkOpening, FREETALK_MODEL };
