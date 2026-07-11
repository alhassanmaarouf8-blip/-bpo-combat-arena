/**
 * phase0Eleven.js — TEMPORARY Phase-0 proof endpoint for the ElevenLabs Conversational AI swap.
 *
 * ⚠ THROWAWAY. Remove after the proof runs. Token-gated. Uses ELEVENLABS_API_KEY from the Render env
 * IN PLACE (never returned, never logged). Proves end-to-end, with NO browser/mic:
 *   create a German ElevenAgent → signed-url → WS → send a German TEXT turn → receive AUDIO + the
 *   agent's German reply → measure latency. Confirms the pipeline + gives a real time-to-first-audio.
 */
import express from 'express';
import { WebSocket } from 'ws';

export const phase0Router = express.Router();

const TOKEN = 'p0_elabs_9f3k2x7q_prove_2026';   // obscure gate; endpoint is removed right after the proof
const XI = () => process.env.ELEVENLABS_API_KEY;
const API = 'https://api.elevenlabs.io';

async function pickGermanVoice() {
  try {
    const r = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': XI() } });
    const j = await r.json();
    const voices = j?.voices || [];
    // Prefer a voice whose labels/name hint German/multilingual; else the first available.
    const de = voices.find(v => /german|deutsch|multiling/i.test(JSON.stringify(v.labels || {}) + (v.name || '')));
    const v = de || voices[0];
    return v ? { voice_id: v.voice_id, name: v.name } : null;
  } catch { return null; }
}

phase0Router.get('/eleven-test', async (req, res) => {
  if (req.query.token !== TOKEN) return res.status(403).json({ error: 'forbidden' });
  if (!XI()) return res.status(500).json({ error: 'no_elevenlabs_key_on_server' });

  const out = { steps: [] };
  const step = (s, extra) => out.steps.push({ s, t: Date.now(), ...(extra || {}) });
  try {
    // 1. voice
    const voice = req.query.voice_id ? { voice_id: req.query.voice_id, name: '(query)' } : await pickGermanVoice();
    step('voice', voice || { none: true });

    // 2. create agent (German interviewer, built-in Gemini LLM to avoid custom-LLM secret setup)
    const model = req.query.llm || 'gemini-2.5-flash';
    const createBody = {
      conversation_config: {
        agent: {
          prompt: { prompt: 'Du bist Frau Yasmin, eine freundliche deutsche BPO-Interviewerin. Antworte kurz, natürlich und ausschließlich auf Deutsch. Stelle eine kurze Rückfrage.', llm: model },
          first_message: 'Guten Tag, schön dass Sie da sind. Erzählen Sie mir kurz von sich.',
          language: 'de',
        },
        tts: { model_id: 'eleven_flash_v2_5', ...(voice ? { voice_id: voice.voice_id } : {}) },   // German (non-English) agents require turbo/flash v2_5
      },
    };
    const cr = await fetch(`${API}/v1/convai/agents/create`, {
      method: 'POST', headers: { 'xi-api-key': XI(), 'Content-Type': 'application/json' }, body: JSON.stringify(createBody),
    });
    const crText = await cr.text();
    if (!cr.ok) { step('create_failed', { status: cr.status, body: crText.slice(0, 300) }); return res.json({ ok: false, ...out }); }
    const agentId = JSON.parse(crText).agent_id;
    step('agent_created', { agentId, model });

    // 3. signed url
    const su = await fetch(`${API}/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, { headers: { 'xi-api-key': XI() } });
    const suj = await su.json();
    if (!suj?.signed_url) { step('signed_url_failed', { body: JSON.stringify(suj).slice(0, 200) }); return res.json({ ok: false, agentId, ...out }); }
    step('signed_url');

    // 4. WS conversation: init → (let greeting play) → user_message → measure first audio of the reply
    const result = await new Promise((resolve) => {
      const ws = new WebSocket(suj.signed_url);
      let userMsgAt = 0, firstReplyAudioAt = 0, greetingAudioAt = 0, sentUserMsg = false;
      let agentReply = '', audioChunks = 0, audioBytes = 0;
      const done = (extra) => { try { ws.close(); } catch {} resolve({ agentReply, audioChunks, audioBytes,
        greetingLatencyMs: greetingAudioAt && wsOpenAt ? greetingAudioAt - wsOpenAt : null,
        replyLatencyMs: firstReplyAudioAt && userMsgAt ? firstReplyAudioAt - userMsgAt : null, ...extra }); };
      let wsOpenAt = 0;
      const hardTimeout = setTimeout(() => done({ timeout: true }), 22000);

      ws.on('open', () => {
        wsOpenAt = Date.now();
        ws.send(JSON.stringify({ type: 'conversation_initiation_client_data' }));
        // give the greeting ~3s, then send the candidate's German answer
        setTimeout(() => { userMsgAt = Date.now(); sentUserMsg = true;
          ws.send(JSON.stringify({ type: 'user_message', text: 'Ich heiße Ahmed und habe drei Jahre Erfahrung im Kundenservice. Ich arbeite gerne im Team.' }));
        }, 3000);
      });
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', event_id: m.ping_event?.event_id })); return; }
        if (m.type === 'audio') {
          const b64 = m.audio_event?.audio_base_64 || '';
          if (!sentUserMsg) { if (!greetingAudioAt) greetingAudioAt = Date.now(); }
          else { if (!firstReplyAudioAt) firstReplyAudioAt = Date.now(); audioChunks++; audioBytes += Math.floor(b64.length * 0.75); }
          // once we have a few reply chunks, we've proven it
          if (sentUserMsg && audioChunks >= 8) { clearTimeout(hardTimeout); done({}); }
        }
        if (m.type === 'agent_response') { const t = m.agent_response_event?.agent_response || ''; if (sentUserMsg) agentReply = t; }
      });
      ws.on('error', (e) => { clearTimeout(hardTimeout); done({ wsError: e.message }); });
      ws.on('close', () => { clearTimeout(hardTimeout); done({ closed: true }); });
    });
    step('conversation_done', result);

    return res.json({ ok: !!result.replyLatencyMs, agentId, voice, model, ...result, steps: out.steps });
  } catch (e) {
    step('exception', { msg: e.message });
    return res.json({ ok: false, error: e.message, ...out });
  }
});

export default { phase0Router };
