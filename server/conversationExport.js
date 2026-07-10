/**
 * conversationExport.js — builds the end-of-fight "conversation PDF" payload.
 *
 * WHY: on the Gemini native-audio path the on-the-fly transcript of the CANDIDATE mis-hears their
 * German as English ("Guten Tag" → "Hughen tag"), because Gemini's input transcription auto-detects
 * and biases to English. That is useless for a document whose whole promise is "exactly what you
 * said." So when — and ONLY when — the student asks for the PDF, we re-transcribe the verbatim audio
 * we captured during the fight through Deepgram pinned to GERMAN (nova-2, de), which is the accurate
 * ear. Boss lines are already accurate (Gemini output transcript) and are used as-is.
 *
 * PRONUNCIATION: Deepgram returns per-word confidence. Low-confidence words are the HONEST acoustic
 * signal that a word came out unclear / mispronounced (not a guess from text). Those words, in
 * context, go to a strong German model which — under a quote gate — returns the intended word and a
 * simple spoken-German hint. Everything here is fail-safe: any failure degrades to "transcript only",
 * never throws, never blocks the debrief.
 *
 * COST: one Deepgram pass per captured turn, run ON DEMAND only. A student who never taps "PDF"
 * costs $0 extra — the zero-spend law holds for the common case.
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const PRON_MODEL   = process.env.GROQ_GRAMMAR_MODEL ?? 'llama-3.3-70b-versatile';
const LOW_CONF     = 0.62;   // ≤ this word-confidence ⇒ flag as "unclear pronunciation"

const _canon = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?…"'»«„“”]+/gu, '').trim();

// Wrap raw PCM16 mono little-endian into a 44-byte WAV container. We send WAV (not raw + encoding
// query params) because it is Deepgram's default, self-describing format — no reliance on matching
// encoding/sample_rate params, and it round-trips through any decoder.
function pcm16ToWav(pcm, sampleRate = 16000) {
  const numChannels = 1, bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) >> 3;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

/**
 * Transcribe ONE raw-PCM16 (16 kHz mono LE) turn segment through Deepgram German.
 * @returns {Promise<{ text: string, lowConf: string[] }>} empty text on any failure (never throws).
 */
async function transcribeTurnGerman(pcmBuffer) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key || !pcmBuffer?.length) return { text: '', lowConf: [] };

  const params = new URLSearchParams({
    model:        process.env.DEEPGRAM_MODEL    || 'nova-2',
    language:     process.env.DEEPGRAM_LANGUAGE || 'de',
    smart_format: 'true',
    punctuate:    'true',
  });

  try {
    const res = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: pcm16ToWav(pcmBuffer),
    });
    if (!res.ok) { console.error(`[convExport] Deepgram HTTP ${res.status}`); return { text: '', lowConf: [] }; }
    const json = await res.json();
    const alt  = json?.results?.channels?.[0]?.alternatives?.[0];
    const text = (alt?.transcript || '').trim();
    const lowConf = (alt?.words || [])
      .filter((w) => typeof w.confidence === 'number' && w.confidence <= LOW_CONF)
      .map((w) => (w.word || '').trim())
      .filter(Boolean);
    return { text, lowConf: [...new Set(lowConf)] };
  } catch (e) {
    console.error('[convExport] Deepgram failed:', e.message);
    return { text: '', lowConf: [] };
  }
}

/**
 * Ask a strong German model to correct the pronunciation of the acoustically-unclear words.
 * Quote-gated: a note is kept ONLY if its `said` word actually appeared in the captured transcript,
 * so the model can never invent that the student said something they didn't.
 * @returns {Promise<Array<{said,correct,hint_de}>>} [] on any failure.
 */
async function pronunciationNotes(fullText, lowConfWords) {
  const key = process.env.GROQ_API_KEY;
  const uniq = [...new Set((lowConfWords || []).map((w) => w.trim()).filter(Boolean))];
  if (!key || !uniq.length || !fullText.trim()) return [];

  const SYSTEM = `Du bist Aussprache-Coach für arabische Muttersprachler, die ein deutsches Vorstellungsgespräch üben. Du bekommst (a) ein deutsches Transkript einer Sprachaufnahme und (b) eine Liste von Wörtern, die die Spracherkennung UNSICHER gehört hat (also wahrscheinlich undeutlich/falsch ausgesprochen).

Für JEDES unsichere Wort, bei dem du sicher bist, welches deutsche Wort GEMEINT war, gib zurück:
{ "said": "<das unsichere Wort, WÖRTLICH aus der Liste>", "correct": "<das richtige deutsche Wort/Form>", "hint_de": "<EIN kurzer, einfacher Aussprache-Tipp auf Deutsch, z.B. betonte Silbe oder Laut>" }

Regeln: NUR echte Aussprache-/Wortfehler. Wenn das Wort eigentlich korrekt sein könnte oder du unsicher bist, LASS ES WEG (Präzision vor Vollständigkeit). Keine Grammatik, kein Stil. Antworte NUR mit gültigem JSON: { "notes": [ ... ] }.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: PRON_MODEL,
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Transkript:\n${fullText}\n\nUnsichere Wörter: ${uniq.join(', ')}` },
        ],
      }),
    });
    if (!res.ok) { console.error(`[convExport] pronunciation API ${res.status}`); return []; }
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
    const textCanon = _canon(fullText);
    const out = [];
    const seen = new Set();
    for (const n of notes) {
      const said    = String(n?.said ?? '').trim();
      const correct = String(n?.correct ?? '').trim();
      const hint    = String(n?.hint_de ?? '').trim();
      if (!said || !correct) continue;
      if (!textCanon.includes(_canon(said))) continue;        // QUOTE GATE — not really said → drop
      if (_canon(said) === _canon(correct)) continue;         // no change → not an error
      const kdup = _canon(said) + '→' + _canon(correct);
      if (seen.has(kdup)) continue;
      seen.add(kdup);
      out.push({ said, correct, hint_de: hint });
    }
    return out;
  } catch (e) {
    console.error('[convExport] pronunciation failed:', e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-transcribe every captured student-turn segment through Deepgram GERMAN, in parallel.
 * Reused by the end-of-fight PDF AND by the live debrief (which must grade the candidate's REAL German,
 * not Gemini's English-biased live transcript). Each entry is { text, lowConf }; never throws.
 * @param {Array<{pcm:Buffer}>} turns
 * @returns {Promise<Array<{text:string, lowConf:string[]}>>}
 */
export async function transcribeStudentTurns(turns) {
  const arr = Array.isArray(turns) ? turns : [];
  return Promise.all(arr.map((t) => transcribeTurnGerman(t?.pcm)));
}

/**
 * Build the conversation-PDF payload from a live session context.
 * @param {object} ctx  the wsManager session context (uses ctx.dialogue + ctx.geminiUserTurns)
 * @returns {Promise<{ lines: Array<{speaker:'boss'|'you', text:string}>, pronunciation: Array, accurate: boolean }>}
 */
export async function buildConversationExport(ctx) {
  const dialogue = Array.isArray(ctx?.dialogue) ? ctx.dialogue : [];
  const turns    = Array.isArray(ctx?.geminiUserTurns) ? ctx.geminiUserTurns : [];

  // Re-transcribe each captured candidate turn through Deepgram German (parallel).
  const transcripts = await transcribeStudentTurns(turns);
  const anyAccurate = transcripts.some((r) => r.text);

  // Splice the accurate German into a copy of the ordered dialogue: the Nth 'candidate' entry gets
  // the Nth captured turn's Deepgram text (falls back to the original text if capture is missing).
  const lines = [];
  let candIdx = 0;
  for (const d of dialogue) {
    if (d.role === 'boss') {
      const text = (d.text || '').trim();
      if (text) lines.push({ speaker: 'boss', text });
    } else if (d.role === 'candidate') {
      const cap = transcripts[candIdx];
      candIdx += 1;
      const text = (cap?.text || d.text || '').trim();
      if (text) lines.push({ speaker: 'you', text });
    }
  }

  // Pronunciation pass over ALL captured candidate speech, keyed on acoustically-unclear words.
  const fullYou   = transcripts.map((r) => r.text).filter(Boolean).join('\n');
  const lowConf   = transcripts.flatMap((r) => r.lowConf);
  const pronunciation = fullYou ? await pronunciationNotes(fullYou, lowConf) : [];

  return { lines, pronunciation, accurate: anyAccurate };
}

export default { buildConversationExport };
