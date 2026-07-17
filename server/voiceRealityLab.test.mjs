import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { voiceFixtureIdentity } from '../scripts/qa/voice-reality-lab.mjs';

test('voice fixtures are deterministic and reject unsupported corruption profiles', () => {
  const base = { text: 'Guten Tag, wie kann ich Ihnen helfen?', profile: 'clean', voice: 'de-DE-ConradNeural' };
  assert.equal(voiceFixtureIdentity(base), voiceFixtureIdentity({ ...base }));
  assert.notEqual(voiceFixtureIdentity(base), voiceFixtureIdentity({ ...base, profile: 'slow' }));
  assert.throws(() => voiceFixtureIdentity({ ...base, profile: 'invented' }), /unknown profile/u);
  assert.throws(() => voiceFixtureIdentity({ ...base, text: ' '.repeat(20) }), /1-600/u);
});

test('voice lab is an acoustic black-box harness, never a production injection route', async () => {
  const source = await readFile(new URL('../scripts/qa/voice-reality-lab.mjs', import.meta.url), 'utf8');
  assert.match(source, /System\.Media\.SoundPlayer/u);
  assert.match(source, /edge-tts/u);
  assert.match(source, /ffmpeg/u);
  assert.doesNotMatch(source, /\/api\/(?:shadowing|fluency|spoken-review|transcribe)/u);
  assert.doesNotMatch(source, /Authorization|Bearer|localStorage|sessionStorage/u);
});

test('exact fixture adapter is localhost development-only and production has no injection route', async () => {
  const [fixture, recorder, overlay, shadowing] = await Promise.all([
    readFile(new URL('../client/src/voiceLabFixture.js', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/audioRecorder.js', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/VoiceLabOverlay.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../client/src/Shadowing.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(fixture, /import\.meta\.env\.DEV/u);
  assert.match(fixture, /localhost.*127\.0\.0\.1/u);
  assert.match(fixture, /voiceLab=1/u);
  assert.doesNotMatch(fixture + recorder + overlay, /fetch\(|XMLHttpRequest|WebSocket/u);
  assert.match(recorder, /await createVoiceLabStream\(\)/u);
  assert.match(shadowing, /result\.match \?\? result\.accuracy/u);
});
