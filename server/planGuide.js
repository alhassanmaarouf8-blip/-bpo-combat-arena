/**
 * planGuide.js — cheap text-model guidance for Zielplan steps 1–3.
 *
 * COST CONTROL: these are the daily-habit steps and run on a CHEAP text model
 * (gpt-4o-mini by default, env-overridable). They are near-zero cost. The expensive
 * voice interview (step type 'fight') is rationed and lives entirely elsewhere — this
 * module never touches it.
 *
 *   generateTask({ type, topic, level })            → a short task/prompt for the step
 *   giveFeedback({ type, topic, task, input, level })→ concise German feedback on the answer
 */
const PLAN_MODEL = process.env.OAI_PLAN_MODEL ?? 'gpt-4o-mini';
const OAI_CHAT   = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 25_000;

async function chat(system, user, maxTokens = 420) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no_api_key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OAI_CHAT, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:       PLAN_MODEL,
        temperature: 0.35,
        max_tokens:  maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`plan model ${res.status} ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

const levelLabel = (lvl) => (lvl === 'b2' ? 'B2 (natürliches Tempo, komplexe Strukturen)' : 'A2–B1 (einfach, geduldig)');

// ── Generate the task/prompt the learner works on ───────────────────────────────
export async function generateTask({ type, topic, level }) {
  const t = (topic || '').trim() || 'allgemeines BPO-Kundenservice-Deutsch';
  const lvl = levelLabel(level);

  if (type === 'research') {
    return chat(
      'Du bist ein knapper Deutsch-Lerncoach für ägyptische BPO-Bewerber. Antworte auf Deutsch.',
      `Nenne 3–4 konkrete Leitfragen, die der Lernende zum Thema "${t}" recherchieren sollte, ` +
      `um sich auf ein deutsches Call-Center-Bewerbungsgespräch vorzubereiten (Niveau ${lvl}). ` +
      `Nur die Leitfragen als kurze Liste, keine Antworten.`,
    );
  }
  if (type === 'speaking') {
    return chat(
      'Du bist ein Deutsch-Sprechtrainer für BPO-Bewerber. Antworte auf Deutsch.',
      `Gib GENAU EINE realistische Sprech-Aufgabe zum Thema "${t}" für Niveau ${lvl}: ` +
      `eine kurze Situation oder Frage, auf die der Lernende laut/schriftlich antworten soll (2–4 Sätze Ziel). ` +
      `Eine Aufgabe, kurz und klar.`,
    );
  }
  // written (default)
  return chat(
    'Du bist ein Deutsch-Übungsautor für BPO-Bewerber. Antworte auf Deutsch.',
    `Erstelle eine kurze schriftliche Übung (3–4 nummerierte Aufgaben) zum Thema "${t}" für Niveau ${lvl}: ` +
    `Mischung aus Lückensatz / Umformung / kurzem Satz bilden, passend zum Kundenservice-Kontext. ` +
    `Nur die Aufgaben, keine Lösungen.`,
  );
}

// ── Feedback on the learner's response (conservative, concrete, encouraging) ─────
export async function giveFeedback({ type, topic, task, input, level }) {
  const t   = (topic || '').trim() || 'das Thema';
  const lvl = levelLabel(level);
  const ans = (input || '').trim().slice(0, 2000);
  if (!ans) throw new Error('empty_input');

  const common =
    `Antworte auf Deutsch, ermutigend aber ehrlich, höchstens ~120 Wörter. ` +
    `Erfinde keine Fehler. Wenn etwas korrekt ist, sage es. Nenne 1–3 konkrete Verbesserungen ` +
    `und (falls nötig) je die korrigierte Fassung. Niveau ${lvl}.`;

  if (type === 'research') {
    return chat(
      `Du prüfst die Recherche eines Lernenden. ${common}`,
      `Thema: "${t}".\nRecherche-Ergebnisse des Lernenden:\n${ans}\n\n` +
      `Bewerte kurz: Was ist gut/relevant, was fehlt oder ist ungenau, und welche 1–2 Punkte sollte er ergänzen?`,
    );
  }
  if (type === 'speaking') {
    return chat(
      `Du gibst Feedback zu einer mündlichen Antwort (hier getippt). ${common}`,
      `Aufgabe: ${task || `Sprich zum Thema "${t}".`}\nAntwort des Lernenden:\n${ans}\n\n` +
      `Feedback zu Inhalt, Satzbau und Höflichkeit (Sie-Form, freundlich). Gib eine bessere Musterformulierung in 1 Satz.`,
    );
  }
  // written
  return chat(
    `Du korrigierst eine schriftliche Übung. ${common}`,
    `Aufgabe(n):\n${task || `Übung zum Thema "${t}".`}\nAntwort des Lernenden:\n${ans}\n\n` +
    `Korrigiere konkret Aufgabe für Aufgabe (richtig/falsch + korrigierte Fassung wo nötig).`,
  );
}

export const planModelName = PLAN_MODEL;
