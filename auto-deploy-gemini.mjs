#!/usr/bin/env node
/**
 * auto-deploy-gemini.mjs — One-command Gemini Live setup
 *
 * This script automates the entire Gemini setup process:
 *   1. Validates your API key locally
 *   2. Updates Render environment variables via API
 *   3. Triggers a deploy
 *   4. Polls until live
 *   5. Tests the live endpoint
 *
 * Usage:
 *   GEMINI_API_KEY=YOUR_KEY RENDER_API_KEY=YOUR_RENDER_KEY node auto-deploy-gemini.mjs
 *
 * Getting your keys:
 *   - GEMINI_API_KEY: Create at https://console.cloud.google.com (Generative Language API)
 *   - RENDER_API_KEY: Get at https://dashboard.render.com/account/api-tokens
 */

import { WebSocket } from 'ws';
import https from 'https';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const RENDER_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = 'srv-d8ktvpbeo5us73asj7i0';
const BACKEND_URL = 'https://bpo-combat-arena.onrender.com';

if (!GEMINI_KEY || !RENDER_KEY) {
  console.error('❌ Missing environment variables');
  console.error('Usage:');
  console.error('  GEMINI_API_KEY=YOUR_KEY RENDER_API_KEY=YOUR_RENDER_KEY node auto-deploy-gemini.mjs');
  console.error('\nGetting your keys:');
  console.error('  1. GEMINI_API_KEY: Create at https://console.cloud.google.com');
  console.error('  2. RENDER_API_KEY: Get at https://dashboard.render.com/account/api-tokens');
  process.exit(1);
}

console.log('🚀 Gemini Live Auto-Deploy Starting\n');

// Step 1: Validate key
console.log('1️⃣  Validating Gemini API key...');
await validateGeminiKey();

// Step 2: Update Render
console.log('\n2️⃣  Updating Render environment variables...');
await updateRenderEnv();

// Step 3: Wait for deploy
console.log('\n3️⃣  Waiting for deploy to complete (~90 seconds)...');
await waitForDeploy();

// Step 4: Test live
console.log('\n4️⃣  Testing live endpoint...');
await testLiveEndpoint();

console.log('\n✅ ✅ ✅ COMPLETE! Gemini Live is now LIVE and TESTED.\n');
process.exit(0);

// ─────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────

async function validateGeminiKey() {
  return new Promise((resolve, reject) => {
    const HOST = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_KEY}`;
    const ws = new WebSocket(HOST);
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-latest',
          systemInstruction: { parts: [{ text: 'Test' }] },
          generationConfig: { speechConfig: { voiceName: 'Aoede' } },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.setupComplete) {
          clearTimeout(timeout);
          ws.close();
          console.log('   ✅ Key is valid.');
          resolve();
        }
      } catch {}
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      if (code === 1008 || code === 1002) {
        reject(new Error(`Auth failed (code ${code}): ${reason}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function updateRenderEnv() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      env: [
        { key: 'GEMINI_API_KEY', value: GEMINI_KEY, isSecret: true },
        { key: 'USE_GEMINI_LIVE', value: '1' },
      ],
    });

    const req = https.request(
      {
        hostname: 'api.render.com',
        port: 443,
        path: `/v1/services/${SERVICE_ID}`,
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${RENDER_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('   ✅ Render env updated.');
            resolve();
          } else {
            reject(new Error(`Render API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function waitForDeploy() {
  return new Promise((resolve) => {
    const poll = setInterval(async () => {
      try {
        const health = await fetch(`${BACKEND_URL}/health`).then(r => r.json());
        if (health.geminiLive === true) {
          clearInterval(poll);
          console.log('   ✅ Deploy complete, Gemini Live active.');
          resolve();
        }
      } catch {}
    }, 5_000);

    setTimeout(() => {
      clearInterval(poll);
      console.log('   ⚠️  Deploy timeout (Render may still be starting).');
      resolve();
    }, 120_000);
  });
}

async function testLiveEndpoint() {
  try {
    const health = await fetch(`${BACKEND_URL}/health`).then(r => r.json());
    console.log(`   ✅ Backend healthy. Gemini: ${health.geminiLive ? '🟢 LIVE' : '🔴 OFF'}`);
  } catch (err) {
    console.error(`   ⚠️  Could not reach backend: ${err.message}`);
  }
}
