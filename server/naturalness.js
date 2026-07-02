/**
 * naturalness.js — Naturalness evaluator for student German
 * One focused Groq call that scores how natural the student's speech SOUNDS
 * in conversation — phrasing, turn-taking, register, discourse particles.
 * Returns structured JSON merged into the debrief.
 */
import { scrubStringsDeep } from './langGuard.js';

const COACH_MODEL   = process.env.GROQ_COACH_MODEL ?? 'llama-3.3-70b-versatile';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS    = 12_000;

const SYSTEM_PROMPT =
`Du bewertest, wie NATÜRLICH das Deutsch eines Kandidaten im Gespräch klingt.
NICHT Grammatik (das macht ein anderes Modul) — sondern ob es wie echtes gesprochenes Deutsch klingt.

Bewerte diese Dimensionen:
1. Diskurspartikel: Nutzt der Kandidat "halt", "mal", "doch", "eigentlich", "na ja", "tja", "also", "genau"? Oder klingt es zu steif?
2. Gesprächseinstiege: Steigt er/sie direkt mit "Ich denke, dass..." ein (übersetzt wirkend), oder mit natürlichen Einstiegen wie "Also,", "Ja,", "Gut,"?
3. Registerkonsistenz: Mischt der Kandidat C1-Formalsprache mit sehr informellen Wendungen (schlechtes Zeichen) oder ist das Register gleichmäßig?
4. Satzrhythmus: Nur lange, komplexe Sätze (= klingt abgelesen) ODER Mix aus kurzen und langen (= natürlich)?
5. Idiomatik: Calques (wörtliche Übersetzungen aus Arabisch/Englisch) oder echte deutsche Wendungen?
6. Gesprächskohärenz: Antwortet der Kandidat auf das, was gefragt wurde? Oder geht er am Thema vorbei?

Gib AUSSCHLIESSLICH gültiges JSON zurück:
{
  "naturalness": {
    "score": <0–100>,
    "label": "<sehr natürlich|natürlich|solide|klingt übersetzt|sehr formell>",
    "de": "<ein Satz Feedback auf Deutsch — konkret, stärken-zuerst>",
    "ar": "<dasselbe auf ägyptischem Umgangsarabisch — kurz, direkt, wie ein Trainer redet>",
    "tips": [
      { "de": "<konkreter Tipp auf Deutsch>", "ar": "<derselbe Tipp auf ägyptischem Arabisch>" }
    ]
  }
}

Label-Logik:
- 85–100: "sehr natürlich"
- 70–84:  "natürlich"
- 55–69:  "solide"
- 40–54:  "klingt übersetzt"
- 0–39:   "sehr formell"

HARTE REGELN:
- Maximal 3 Tips.
- "de" und "ar" je EIN Satz — kein Absatz.
- "ar" muss echtes ägyptisches Umgangsarabisch sein, KEIN Fusha.
- Wenn die Sitzung sehr kurz war (< 3 Äußerungen), setze score auf 50 und label auf "solide", da zu wenig Datenmaterial.
- Antworte AUSSCHLIESSLICH mit dem JSON-Objekt, OHNE Markdown-Codeblöcke.`;

export async function evaluateNaturalness({ utterances, level, csScenarioId }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !utterances || utterances.length === 0) return null;

  const lines = utterances
    .map((u, i) => `${i + 1}. ${u.text ?? ''}`)
    .join('\n');

  const userMsg =
    `Niveau: ${level ?? 'unbekannt'}\n` +
    `Szenario: ${csScenarioId ?? 'unbekannt'}\n` +
    `Äußerungen des Kandidaten (nur Kandidatenseite):\n${lines}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_CHAT_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:           COACH_MODEL,
        temperature:     0.3,
        max_tokens:      600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      console.error(`[naturalness] API error ${res.status}`);
      return null;
    }

    const data   = await res.json();
    const txt    = data.choices?.[0]?.message?.content ?? '{}';
    // Scrub script-drift glyphs (the "兄" class) from every string field before anything is shown.
    const parsed = scrubStringsDeep(JSON.parse(txt));

    if (!parsed?.naturalness?.score) return null;

    const n = parsed.naturalness;
    const LABELS = ['sehr natürlich', 'natürlich', 'solide', 'klingt übersetzt', 'sehr formell'];
    const score  = Math.max(0, Math.min(100, Math.round(Number(n.score) || 50)));
    const label  = LABELS.includes(n.label) ? n.label
      : score >= 85 ? 'sehr natürlich'
      : score >= 70 ? 'natürlich'
      : score >= 55 ? 'solide'
      : score >= 40 ? 'klingt übersetzt'
      : 'sehr formell';

    const tips = Array.isArray(n.tips)
      ? n.tips.slice(0, 3).map(t => ({ de: String(t?.de ?? ''), ar: String(t?.ar ?? '') })).filter(t => t.de)
      : [];

    return {
      naturalness: {
        score,
        label,
        de:   String(n.de ?? ''),
        ar:   String(n.ar ?? ''),
        tips,
      },
    };
  } catch (err) {
    console.error('[naturalness] evaluateNaturalness failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
