// One-shot proof: GeminiLiveProxy on the VERTEX transport (GEMINI_USE_VERTEX=1) reaches
// ready, answers a text turn with native audio + transcript. Run:
//   GEMINI_VERTEX_TOKEN=$(gcloud auth print-access-token) GEMINI_USE_VERTEX=1 node vertex-proof.test.mjs
import { GeminiLiveProxy } from './geminiLiveProxy.js';

let audio = 0, text = '';
const proxy = new GeminiLiveProxy({ handlers: {
  onReady: () => { console.log('READY (vertex setupComplete)'); proxy.sendText('Sag genau: Vertex funktioniert.'); },
  onBossAudio: (b) => { audio += b.length; },
  onBossText: (t) => { if (!t.startsWith('[') && !t.startsWith('__')) text += t; },
  onTurnComplete: () => {
    console.log(`PROOF: audio=${audio}B  transcript="${text.trim()}"`);
    console.log(audio > 0 ? 'PASS' : 'FAIL');
    proxy.close(); process.exit(audio > 0 ? 0 : 1);
  },
  onError: (e) => { console.error('FAIL error:', e.message); process.exit(1); },
  onClose: (c, r) => { console.log(`closed ${c} ${r}`); if (audio === 0) process.exit(1); },
}});
await proxy.start({ systemInstruction: 'Du bist ein Testassistent. Antworte auf Deutsch, ein kurzer Satz.' });
setTimeout(() => { console.error('FAIL timeout'); process.exit(1); }, 30000);
