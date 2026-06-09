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
const PLAN_MODEL       = process.env.OAI_PLAN_MODEL ?? 'gpt-4o-mini';
const TRANSCRIBE_MODEL = process.env.OAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';
const OAI_CHAT         = 'https://api.openai.com/v1/chat/completions';
const OAI_TRANSCRIBE   = 'https://api.openai.com/v1/audio/transcriptions';
const TIMEOUT_MS       = 25_000;

async function chat(system, user, maxTokens = 420, { json = false, purpose = 'plan-guidance' } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no_api_key');
  console.log(`[ai] ${PLAN_MODEL} · ${purpose}`);   // cost audit: one line per AI call

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OAI_CHAT, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:           PLAN_MODEL,
        temperature:     0.35,
        max_tokens:      maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
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

// ── Speech → text via the CHEAP transcription model (never a Realtime session) ──
export async function transcribeAudio(buffer, { mime = 'audio/wav', filename = 'clip.wav' } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no_api_key');
  if (!buffer || !buffer.length) throw new Error('empty_audio');
  console.log(`[ai] ${TRANSCRIBE_MODEL} · speaking-step transcription (${buffer.length} bytes)`);

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'de');
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(OAI_TRANSCRIBE, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: controller.signal });
    if (!res.ok) throw new Error(`transcribe ${res.status} ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return (data.text || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

// ── Feedback on a SPOKEN answer's transcript (German + Arabic), cheap text model ──
export async function speakingFeedback({ transcript, wpm, fillers, topic, level }) {
  const lvl = level === 'b2' ? 'B2 (natürliches Tempo)' : 'A2–B1 (einfach, geduldig)';
  const sys =
    `Du bist ein knapper, ehrlicher Deutsch-Sprechtrainer für ein BPO-Bewerbungstraining. ` +
    `Gib AUSSCHLIESSLICH gültiges JSON zurück: {"de":"…","ar":"…"}. ` +
    `"de": 2–3 KONKRETE Hinweise zur Transkription, JEDER mit benannter Regel/Struktur ` +
    `(z.B. Verbstellung im Nebensatz, Konjunktiv II, Artikel/Genus, Wortstellung) — Stärke ODER Korrektur. ` +
    `KEINE generische Lob-Floskel ("gut gemacht", "weiter so"). Bei Fehlern die korrigierte Form nennen. ` +
    `"ar": exakt dieselbe Rückmeldung auf klarem Hocharabisch. Je höchstens ~90 Wörter. Niveau ${lvl}.`;
  const usr =
    `Thema: ${topic || 'BPO-Sprechübung'}\n` +
    `Gemessene Werte (NICHT neu erfinden, nur ggf. einordnen): ${wpm} WpM (Zielzone 140–160), ${fillers} Füllwörter.\n` +
    `Transkription der gesprochenen Antwort:\n${(transcript || '').slice(0, 1500)}`;
  const raw = await chat(sys, usr, 500, { json: true, purpose: 'speaking-step feedback' });
  try {
    const o = JSON.parse(raw);
    return { de: String(o.de ?? '').trim(), ar: String(o.ar ?? '').trim() };
  } catch {
    return { de: raw, ar: '' };
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

// ── Feedback on the learner's response — bilingual {de, ar} so the Arabic toggle works.
export async function giveFeedback({ type, topic, task, input, level }) {
  const t   = (topic || '').trim() || 'das Thema';
  const lvl = levelLabel(level);
  const ans = (input || '').trim().slice(0, 2000);
  if (!ans) throw new Error('empty_input');

  const common =
    `Gib AUSSCHLIESSLICH gültiges JSON zurück: {"de":"…","ar":"…"}. ` +
    `"de": ehrliche, konkrete Rückmeldung auf DEUTSCH (max ~120 Wörter) — erfinde keine Fehler, ` +
    `sage was korrekt ist, nenne 1–3 konkrete Verbesserungen mit korrigierter Fassung. ` +
    `"ar": exakt dieselbe Rückmeldung auf klarem Hocharabisch (deutsche Beispiel-/Korrektur-Wörter bleiben Deutsch). Niveau ${lvl}.`;

  let sys, usr;
  if (type === 'research') {
    sys = `Du prüfst die Recherche eines Lernenden für ein deutsches BPO-Interview. ${common}`;
    usr = `Thema: "${t}".\nRecherche-Ergebnisse:\n${ans}\n\nWas ist gut/relevant, was fehlt oder ist ungenau, welche 1–2 Punkte ergänzen?`;
  } else {
    sys = `Du korrigierst eine schriftliche Übung. ${common}`;
    usr = `Aufgabe(n):\n${task || `Übung zum Thema "${t}".`}\nAntwort des Lernenden:\n${ans}\n\nKorrigiere konkret Aufgabe für Aufgabe (richtig/falsch + korrigierte Fassung wo nötig).`;
  }
  const raw = await chat(sys, usr, 520, { json: true, purpose: `${type}-step feedback` });
  try { const o = JSON.parse(raw); return { de: String(o.de ?? '').trim(), ar: String(o.ar ?? '').trim() }; }
  catch { return { de: raw, ar: '' }; }
}

export const planModelName = PLAN_MODEL;
