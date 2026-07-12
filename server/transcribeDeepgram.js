/**
 * transcribeDeepgram.js — Deepgram STT adapter.
 *
 * Self-contained. Does NOT import panelscorer, assessment, the router, or any
 * side-effectful module. Calls Deepgram's prerecorded REST endpoint directly
 * via native fetch (Node >=18) — no @deepgram/sdk dependency, so it works
 * regardless of SDK version drift.
 *
 * Config is driven by env vars:
 *   DEEPGRAM_API_KEY  (required for real calls)
 *   DEEPGRAM_MODEL    (optional, default: 'nova-2')
 *   DEEPGRAM_LANGUAGE (optional, default: 'de')
 *
 * Usage:
 *   const { transcribeDeepgram } = await import('./transcribeDeepgram.js');
 *   const text = await transcribeDeepgram(buffer);                     // env defaults
 *   const text = await transcribeDeepgram(buffer, { model: 'nova-3' }); // per-call override
 *
 * Returns the transcript string. Throws on failure. Nothing downstream of the
 * returned transcript is touched by this module.
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

export async function transcribeDeepgram(audioBuffer, metadata = {}) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set');

  // contentType is a HEADER, not a query option — pull it out before building params
  // so the browser's real format (e.g. audio/webm;codecs=opus) is sent to Deepgram.
  const { contentType = 'audio/wav', ...query } = metadata;

  // Option precedence: built-in defaults < env vars < per-call metadata.
  const options = {
    model:        process.env.DEEPGRAM_MODEL    || 'nova-2',
    language:     process.env.DEEPGRAM_LANGUAGE || 'de',
    smart_format: true,
    punctuate:    true,
    diarize:      false,
    ...query,
  };

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }

  let res;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    res = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
      body: audioBuffer,
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Deepgram request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript?.trim();
  if (!text) throw new Error('Deepgram returned empty transcript');
  return text;
}
