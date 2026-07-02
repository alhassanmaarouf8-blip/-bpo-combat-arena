#!/usr/bin/env node
/**
 * test-gemini-key.mjs — Validate a Gemini API key locally before deploying to Render.
 *
 * Usage:
 *   node test-gemini-key.mjs <YOUR_API_KEY>
 *
 * Example:
 *   node test-gemini-key.mjs AIzaSyD1234567890abcdefghijklmnop
 *
 * What it does:
 *   1. Attempts to connect to Gemini's WebSocket endpoint
 *   2. Sends the API key for authentication
 *   3. Reports SUCCESS if Gemini accepts it, or FAIL with the exact error if it rejects it
 */

import { WebSocket } from 'ws';

const API_KEY = process.argv[2];

if (!API_KEY) {
  console.error('❌ Usage: node test-gemini-key.mjs <API_KEY>');
  console.error('Example: node test-gemini-key.mjs AIzaSyD...');
  process.exit(1);
}

console.log(`🔍 Testing Gemini API key: ${API_KEY.slice(0, 20)}...`);
console.log('Connecting to Gemini WebSocket...\n');

const HOST = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
const ws = new WebSocket(HOST);

let isResolved = false;

const timeout = setTimeout(() => {
  if (!isResolved) {
    isResolved = true;
    console.error('❌ TIMEOUT: No response from Gemini after 10 seconds. Check your internet connection.');
    process.exit(1);
  }
}, 10_000);

ws.on('open', () => {
  console.log('✅ WebSocket connected.');
  console.log('Sending setup message...\n');

  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-2.5-flash-native-audio-latest',
      systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
      generationConfig: { speechConfig: { voiceName: 'Aoede' } },
    },
  }));
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return; // ignore non-JSON frames
  }

  if (msg.setupComplete) {
    if (!isResolved) {
      isResolved = true;
      clearTimeout(timeout);
      console.log('✅ ✅ ✅ SUCCESS! Your Gemini API key is VALID.\n');
      console.log('The key works correctly. You can now add it to Render:');
      console.log('  1. Go to https://dashboard.render.com/web/srv-d8ktvpbeo5us73asj7i0/env');
      console.log('  2. Click Edit');
      console.log('  3. Update GEMINI_API_KEY with your key');
      console.log('  4. Save and deploy\n');
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (err) => {
  if (!isResolved) {
    isResolved = true;
    clearTimeout(timeout);
    console.error(`❌ WebSocket error: ${err.message}`);
    process.exit(1);
  }
});

ws.on('close', (code, reason) => {
  if (!isResolved) {
    isResolved = true;
    clearTimeout(timeout);
    const reasonStr = reason?.toString() || '(no reason)';

    if (code === 1008 || code === 1002) {
      console.error(`❌ AUTHENTICATION FAILED (code ${code}): ${reasonStr}`);
      console.error('\nThe API key is INVALID. This means:');
      console.error('  • The key is expired or revoked');
      console.error('  • The key is from a project without Generative Language API enabled');
      console.error('  • The key is from a project without billing enabled');
      console.error('  • The key is malformed or copied incorrectly\n');
      console.error('👉 Go to https://console.cloud.google.com and create a new API key.');
      console.error('   Follow the steps in GEMINI_SETUP.md\n');
      process.exit(1);
    }

    if (code === 1000) {
      console.log('⚠️  Connection closed normally (unexpected).');
      process.exit(1);
    }

    console.error(`❌ Connection closed with code ${code}: ${reasonStr}`);
    process.exit(1);
  }
});
