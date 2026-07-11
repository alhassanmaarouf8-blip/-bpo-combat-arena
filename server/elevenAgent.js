/**
 * elevenAgent.js — server-side glue for the ElevenLabs Conversational AI (ElevenAgents) voice path.
 *
 * ⚠ Phase 1 (behind USE_ELEVEN_VOICE). Keeps the API key server-side: the browser gets only a
 * short-lived signed URL. One persistent agent (ELEVEN_AGENT_ID) is OVERRIDDEN per fight so all 6
 * personas + the interview brief run through it.
 *
 * Proven live 2026-07-11 (see memory voice-api-provider-comparison-0711):
 *   - reply latency ~1.58s (text-in), native German, robust server-side turn-taking.
 *   - GOTCHA: German (non-English) agents MUST set tts.model_id = 'eleven_flash_v2_5' or create/override 400s.
 *   - GOTCHA: per-session overrides (prompt/first_message/language/voice_id) must be ENABLED in the
 *     agent's Security settings, else startSession throws.
 */
const API = 'https://api.elevenlabs.io';
const KEY = () => process.env.ELEVENLABS_API_KEY;
export const ELEVEN_TTS_MODEL = 'eleven_flash_v2_5';   // required for German
// The persistent agent created 2026-07-11 (overrides enabled for prompt/first_message/language/voice_id;
// German flash_v2_5). Not a secret — hardcoded so no Render env var is needed. Override via env if recreated.
export const AGENT_ID = process.env.ELEVEN_AGENT_ID || 'agent_0201kx8arpnwf1dvraym4x1v3cmn';

/** Is the Eleven voice infra available on this instance? (Rollout is gated per-account at fight start.) */
export function elevenReady() {
  return !!(KEY() && AGENT_ID);
}

/**
 * Mint a short-lived signed URL (valid ~15 min to INITIATE) so the browser can open the ElevenLabs
 * conversation WebSocket without ever seeing the API key.
 * @returns {Promise<string|null>} signed_url or null on failure.
 */
export async function getSignedUrl(agentId = AGENT_ID) {
  if (!KEY() || !agentId) return null;
  try {
    const r = await fetch(`${API}/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': KEY() } });
    if (!r.ok) { console.error(`[elevenAgent] signed_url ${r.status}: ${(await r.text()).slice(0, 200)}`); return null; }
    const j = await r.json();
    return j?.signed_url || null;
  } catch (e) { console.error('[elevenAgent] signed_url failed:', e.message); return null; }
}

/**
 * Build the per-fight override payload the CLIENT passes to conversation.startSession({ overrides }).
 * camelCase (the @elevenlabs/react SDK shape). The server hands this to the client alongside the URL.
 * @param {object} p  { systemPrompt, firstMessage, voiceId }
 */
export function buildOverrides({ systemPrompt, firstMessage, voiceId }) {
  const agent = { language: 'de' };
  if (systemPrompt)  agent.prompt = { prompt: systemPrompt };
  if (firstMessage)  agent.firstMessage = firstMessage;
  const tts = { modelId: ELEVEN_TTS_MODEL };
  if (voiceId) tts.voiceId = voiceId;
  return { agent, tts };
}

export default { elevenReady, getSignedUrl, buildOverrides, ELEVEN_TTS_MODEL };
