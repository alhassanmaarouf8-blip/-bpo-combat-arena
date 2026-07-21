/**
 * callfloor/callEngine.js — the customer AI. CHEAP MODEL, ALWAYS (Rule: the live call runs on the
 * cheap chat chain via loggedChat; the expensive analysis runs once, post-call, on text).
 *
 * The persona plays ONE German customer per scenario, short spoken turns, an emotional arc, and a
 * self-reported mood token per turn ([STIMMUNG:n] — the CHARACTER's own state, which honestly
 * drives the client's satisfaction face; it is never presented as a measurement of the student).
 * Control tokens are stripped before TTS. Deterministic caps (turns/duration) live in
 * callSession.js — the model never decides billing-relevant limits.
 */

import { loggedChat } from './loggedChat.js';

// Default = the proven free-tier workhorse. A customer speaking BROKEN German would teach broken
// German — pedagogy caps how cheap the persona may go. Overridable to a smaller model via env.
export const PERSONA_MODEL = () => process.env.CALLFLOOR_PERSONA_MODEL || 'llama-3.3-70b-versatile';

export const MOOD_RE = /\[\s*STIMMUNG\s*:\s*([1-5])\s*\]/i;
export const END_RE  = /\[\s*ENDE\s*\]/i;

/** Strip control tokens + non-spoken junk so TTS never reads brackets aloud. */
export function speakableText(raw) {
  return String(raw || '')
    .replace(MOOD_RE, ' ')
    .replace(END_RE, ' ')
    .replace(/\[[^\]]{0,40}\]/g, ' ')     // any other bracketed stage direction
    .replace(/[*_#`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTurn(raw) {
  const mood = MOOD_RE.exec(raw || '');
  return {
    text: speakableText(raw),
    mood: mood ? Number(mood[1]) : null,
    end:  END_RE.test(raw || ''),
  };
}

export function personaSystemPrompt(scenario) {
  const c = scenario.customer;
  return `Du bist ${c.name}, ein deutscher Kunde / eine deutsche Kundin am TELEFON. Du sprichst mit
einem Callcenter-Agenten (dem Lernenden). Du bist NIEMALS der Agent, du hilfst nicht, du bewertest
nicht, du bleibst zu 100% in deiner Rolle.

DEINE SITUATION: ${scenario.problem_de}
DEIN CHARAKTER: ${c.style_de}
DEIN EMOTIONALER BOGEN: ${scenario.arc_de}

REGELN:
- NUR gesprochenes Deutsch. Kurze, natürliche Sätze (1–3 pro Antwort), wie ein echter Mensch am
  Telefon. Keine Listen, keine Anführungszeichen, keine Erzählstimme.
- Reagiere auf das, was der Agent WIRKLICH gesagt hat — greife seine Worte auf.
- Wenn der Agent unklar spricht oder ausweicht, frag nach oder werde ungeduldiger — je nach Bogen.
- Erfinde keine neuen Fakten, die deiner Situation widersprechen.
- Beende JEDE Antwort mit deiner aktuellen Stimmung als Marke: [STIMMUNG:1] (sehr verärgert) bis
  [STIMMUNG:5] (sehr zufrieden). Die Marke ist Pflicht.
- Wenn dein Anliegen erledigt ist (oder endgültig gescheitert) und der Agent das Gespräch
  abschließt, verabschiede dich kurz und setze zusätzlich die Marke [ENDE].`;
}

/**
 * One persona turn. history = [{role:'agent'|'customer', text}]. Returns
 * { text, mood, end, provider } — mood falls back to the previous mood when the model forgets
 * the token (never invented upward).
 */
export async function personaTurn({ scenario, history, prevMood, userId, _chat = loggedChat }) {
  const messages = [
    { role: 'system', content: personaSystemPrompt(scenario) },
    ...history.slice(-14).map((t) => ({
      role: t.role === 'customer' ? 'assistant' : 'user',
      content: t.text,
    })),
  ];
  const res = await _chat({
    messages, temperature: 0.7, maxTokens: 180, jsonMode: false,
    timeoutMs: 20_000, groqModel: PERSONA_MODEL(), tag: 'callfloor-persona',
  }, { userId, feature: 'callfloor-persona' });
  const parsed = parseTurn(res.content);
  return {
    text: parsed.text,
    mood: parsed.mood ?? prevMood ?? scenario.customer.mood0,
    end:  parsed.end,
    provider: res.provider,
  };
}

/** The customer's opening line is scripted per quadrant direction — instant, free, deterministic. */
export function openingTurn(scenario) {
  const inbound = scenario.quadrant.startsWith('inbound');
  if (inbound) {
    // Customer called us → the customer opens with the problem in character (first persona turn
    // is generated live so it varies); this scripted line is the ring-answer beat before it.
    return null;
  }
  // Outbound → the STUDENT opens; the customer just picks up.
  const c = scenario.customer;
  return { text: `${c.name}. Hallo?`, mood: c.mood0, end: false };
}

export default { PERSONA_MODEL, personaSystemPrompt, personaTurn, openingTurn, parseTurn, speakableText, MOOD_RE, END_RE };
