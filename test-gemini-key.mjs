#!/usr/bin/env node
/**
 * Validate a Gemini API key locally without ever storing or printing it.
 * Usage (PowerShell): node test-gemini-key.mjs "$env:GEMINI_API_KEY"
 */
import { WebSocket } from 'ws';

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Usage: set GEMINI_API_KEY, then run node test-gemini-key.mjs');
  process.exit(1);
}

console.log('Testing the supplied Gemini API key…');
const host = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
const ws = new WebSocket(host);
let finished = false;

const finish = (code, message) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (message) (code === 0 ? console.log : console.error)(message);
  try { ws.close(); } catch {}
  process.exit(code);
};

const timeout = setTimeout(() => finish(1, 'TIMEOUT: Gemini did not answer within 10 seconds.'), 10_000);

ws.on('open', () => ws.send(JSON.stringify({
  setup: {
    model: 'models/gemini-2.5-flash-native-audio-latest',
    systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
    generationConfig: { speechConfig: { voiceName: 'Aoede' } },
  },
})));
ws.on('message', (data) => {
  try { if (JSON.parse(data.toString()).setupComplete) finish(0, 'SUCCESS: Gemini accepted the key.'); }
  catch { /* ignore non-JSON frames */ }
});
ws.on('error', () => finish(1, 'FAILED: Gemini rejected the connection or the network failed.'));
ws.on('close', (code) => { if (!finished) finish(1, `FAILED: Gemini closed the connection (code ${code}).`); });
