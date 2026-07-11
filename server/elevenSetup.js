/**
 * elevenSetup.js — TEMPORARY one-time setup for the ElevenLabs voice path. Remove after use.
 * Creates ONE persistent agent with per-fight OVERRIDES enabled (prompt/first_message/language/voice)
 * and the required German TTS model, then verifies a signed URL mints. Token-gated; uses the Render key.
 */
import express from 'express';
export const elevenSetupRouter = express.Router();
const TOKEN = 'p0_elabs_9f3k2x7q_prove_2026';
const API = 'https://api.elevenlabs.io';
const KEY = () => process.env.ELEVENLABS_API_KEY;

elevenSetupRouter.get('/eleven-setup', async (req, res) => {
  if (req.query.token !== TOKEN) return res.status(403).json({ error: 'forbidden' });
  if (!KEY()) return res.status(500).json({ error: 'no_key' });
  const out = { steps: [] };
  try {
    const body = {
      name: 'omni-perform-interviewer',
      conversation_config: {
        agent: {
          prompt: { prompt: 'Du bist ein deutscher BPO-Interviewer. Antworte natürlich auf Deutsch.', llm: 'gemini-2.5-flash' },
          first_message: 'Guten Tag.',
          language: 'de',
        },
        tts: { model_id: 'eleven_flash_v2_5' },
      },
      // Allow the client to override these per fight (all 6 personas → one agent). ElevenLabs enables
      // overrides per-field under platform_settings.overrides.conversation_config_override.
      platform_settings: {
        overrides: {
          conversation_config_override: {
            agent: { prompt: { prompt: true }, first_message: true, language: true },
            tts: { voice_id: true },
          },
        },
      },
    };
    const cr = await fetch(`${API}/v1/convai/agents/create`, {
      method: 'POST', headers: { 'xi-api-key': KEY(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const crText = await cr.text();
    out.steps.push({ s: 'create', status: cr.status, body: crText.slice(0, 400) });
    if (!cr.ok) return res.json({ ok: false, ...out });
    const agentId = JSON.parse(crText).agent_id;

    // verify a signed url mints for it
    const su = await fetch(`${API}/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, { headers: { 'xi-api-key': KEY() } });
    const suj = await su.json();
    out.steps.push({ s: 'signed_url', ok: !!suj?.signed_url });

    return res.json({ ok: !!suj?.signed_url, agentId, ...out });
  } catch (e) { return res.json({ ok: false, error: e.message, ...out }); }
});

export default { elevenSetupRouter };
