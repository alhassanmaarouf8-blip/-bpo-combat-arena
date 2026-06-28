/**
 * pressureLadder.js — DRUCK-LEITER server seam (never-repeat + survival tracking + HR-style grading).
 *
 *   GET  /api/pressure/survived  → { survived: string[] }
 *   POST /api/pressure/survive   → { ok: true }   body: { line: string }
 *   POST /api/pressure/grade    → { survived: boolean, reason: string, transcript: string, detail?: string }
 *                                 body: raw audio bytes, query: line=<boss prompt>
 *
 * Client-side rules:
 *  - Survived lines are permanently retired from the learner's rotation.
 *  - Frozen / unsent lines are NEVER marked survived, so they remain retryable.
 *  - Rung auto-advance is handled client-side once all lines for that rung are retired.
 *
 * Grading doctrine (no half-pass, no fake pass):
 *  1) Honest voice gate: reject silence / noise / <3s real voiced speech.
 *  2) STT via Groq Whisper (German).
 *  3) LLM judge via Groq: judge whether the transcript is genuinely good spoken German for BPO context.
 *     The judge is STRICT: copying the prompt, broken grammar, irrelevant content, or English-heavy
 *     answers are REJECTED. Only clear, coherent, BPO-appropriate German passes.
 *  4) If LLM grading fails for any reason, FAIL-CLOSED (reject) — never fake a pass.
 */
import express from 'express';
import { requireAuth } from './auth.js';
import { loadUser, saveUser } from './store.js';
import { voicedDurationMs } from './audioGuard.js';

export const pressureRouter = express.Router();

pressureRouter.get('/pressure/survived', requireAuth, async (req, res) => {
  try {
    const u = await loadUser(req.account.id);
    const survived = Array.isArray(u.pressureSurvived) ? u.pressureSurvived : [];
    res.json({ survived });
  } catch (e) {
    console.error('[pressure] survived fetch error:', e.message);
    res.json({ survived: [] });
  }
});

pressureRouter.post('/pressure/survive', requireAuth, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const line = String(req.body?.line ?? '').trim();
    if (!line) return res.status(400).json({ error: 'missing_line' });
    const u = await loadUser(req.account.id);
    u.pressureSurvived = Array.isArray(u.pressureSurvived) ? u.pressureSurvived : [];
    if (!u.pressureSurvived.includes(line)) u.pressureSurvived.push(line);
    await saveUser(u);
    res.json({ ok: true, survived: u.pressureSurvived });
  } catch (e) {
    console.error('[pressure] survive write error:', e.message);
    res.status(500).json({ error: 'pressure_save_failed' });
  }
});

// ── Grade a spoken attempt: strict HR-style gate (not "did you make sound?" but "did you answer WELL?") ──
pressureRouter.post('/pressure/grade',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
  requireAuth,
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length < 1000) return res.json({ survived: false, reason: 'empty_audio', transcript: '', detail: '' });

      // Fast local gate: no real voiced speech → reject immediately (no LLM, no STT cost)
      const voiced = voicedDurationMs(buffer);
      if (voiced < 3000) return res.json({ survived: false, reason: 'too_short', transcript: '', detail: 'Keine echte Sprache erkannt (unter 3s).' });
      if (voiced < 5000) return res.json({ survived: false, reason: 'too_short', transcript: '', detail: 'Zu kurz für eine vollständige Antwort.' });

      const transcript = await groqTranscribe(buffer, req.headers['content-type'] || 'audio/wav');
      if (!transcript || !transcript.trim()) return res.json({ survived: false, reason: 'no_speech', transcript: '', detail: 'Keine Sprache erkannt.' });

      const bossLine = String(req.query.line || '').trim();
      const verdict = await gradeWithLLM(transcript.trim(), bossLine);
      return res.json({ ...verdict, transcript });
    } catch (e) {
      console.error('[pressure] grade error:', e.message);
      // FAIL-CLOSED: if grading blows up, REJECT. Never fake a pass.
      return res.json({ survived: false, reason: 'grading_error', transcript: '', detail: 'Bewertung fehlgeschlagen — bitte erneut versuchen.' });
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function groqTranscribe(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  const ext = (String(mimeType).split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.isBuffer(buffer) ? new Uint8Array(buffer) : buffer], { type: mimeType }), `pressure.${ext}`);
  fd.append('model', 'whisper-large-v3');
  fd.append('language', 'de');
  fd.append('response_format', 'text');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`Groq STT ${r.status}`);
  return (await r.text()).trim();
}

/**
 * Genuine quality gate: use an LLM to judge whether the spoken answer is acceptable.
 * STRICT criteria:
 *  - Must be German (not English-heavy, not copying the prompt verbatim)
 *  - Must be coherent and relevant to the boss prompt
 *  - Must be at least 4 real words
 *  - Must sound like a real candidate answering, not a parrot
 *  - Must be free of filler-only / broken grammar that makes it meaningless
 */
async function gradeWithLLM(transcript, bossLine) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { survived: false, reason: 'no_api_key', detail: 'Bewertungssystem nicht verfügbar.' };

  const prompt = `Du bist ein strenger BPO-Interview-Richter. Bewerte die folgende Kandidaten-Antwort auf Deutsch.

BOSS-FRAGE / PROMPT:
"${bossLine || '(Allgemeine Druckübung — Kandidat sollte frei auf Deutsch sprechen)'}"

KANDIDATEN-ANTWORT (transkribiert):
"${transcript}"

REGELN (streng, keine halben Sachen):
1. Die Antwort muss auf DEUTSCH sein. Gemischtes Englisch/Dschunglisch ist sofort DURCHGEFALLEN.
2. Maximale Wörtliche Abschreibung der Boss-Frage ist DURCHGEFALLEN (max. 70% Wortidentität erlaubt).
3. Die Antwort muss mindestens 4 echte Inhaltswörter haben (keine "äh", "hm", "also" allein). Besteht sie fast nur aus Fülllauten, ist sie DURCHGEFALLEN.
4. Die Antwort muss einen vollständigen, sinnvollen Gedanken ausdrücken — keine halben Sätze, keine Filler-Ketten.
5. Die Grammatik muss so sauber sein, dass ein deutscher Kunde/Kollege es ohne Anstrengung versteht.
6. Der Inhalt muss zur Frage passen — thematisch relevante Antwort, nicht "Ich weiß nicht" oder Thema wechseln.
7. Druck-Halluzination: Wenn die Antwort inhaltlich leer ist, nur aus "Ja", "Nein", Stimmlosigkeit oder wiederholten Füllern besteht → DURCHGEFALLEN.
8. Nur echte, eigenständige Leistung zählt. Vortäuschung von Rede durch monotone Fülllautketten wird sofort erkannt und abgelehnt.

ANTWORT-FORMAT (streng):
ANTWORT: BESTANDEN | DURCHGEFALLEN
GRUND: [maximal 1 Satz, warum]`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Du bist ein strenger, aber fairer BPO-Interview-Richter. Du gibst niemals unechte Bestehen. Du bist kritisch, aber präzise.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 120,
        temperature: 0,
      }),
    });
    if (!r.ok) throw new Error(`Groq judge ${r.status}`);
    const text = (await r.text()).trim();
    const passed = /BESTANDEN/i.test(text) && !/DURCHGEFALLEN/i.test(text);
    return {
      survived: passed,
      reason: passed ? 'genuine_german' : 'quality_failed',
      detail: text.split('\n').find((l) => l.startsWith('GRUND:'))?.replace(/^GRUND:\s*/i, '').trim() || '',
    };
  } catch (e) {
    console.error('[pressure] LLM judge failed:', e.message);
    // FAIL-CLOSED on any grading error
    return { survived: false, reason: 'judge_error', detail: 'Bewertung fehlgeschlagen.' };
  }
}
