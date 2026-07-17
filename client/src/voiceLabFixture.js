// Development-only exact-audio adapter for the Continuous Learner Reality Lab.
// It is deliberately unreachable in production builds and never adds an HTTP route.
let fixtureBytes = null;
let fixtureName = '';

export function voiceLabEnabled() {
  return import.meta.env.DEV && /(?:^|[?&])voiceLab=1(?:&|$)/u.test(window.location.search)
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export async function setVoiceLabFixture(file) {
  if (!voiceLabEnabled()) throw new Error('voice_lab_disabled');
  if (!file || file.size < 44 || file.size > 4 * 1024 * 1024 || !/\.wav$/iu.test(file.name || '')) {
    throw new Error('invalid_voice_fixture');
  }
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  const ascii = String.fromCharCode(...header);
  if (!ascii.startsWith('RIFF') || ascii.slice(8, 12) !== 'WAVE') throw new Error('invalid_voice_fixture');
  fixtureBytes = bytes; fixtureName = file.name;
  return { name: fixtureName, bytes: bytes.byteLength };
}

export function currentVoiceLabFixture() { return fixtureBytes ? { name: fixtureName, bytes: fixtureBytes.byteLength } : null; }

export async function createVoiceLabStream() {
  if (!voiceLabEnabled() || !fixtureBytes) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx({ sampleRate: 24_000 });
  if (context.state === 'suspended') await context.resume();
  const audio = await context.decodeAudioData(fixtureBytes.slice(0));
  const source = context.createBufferSource();
  const destination = context.createMediaStreamDestination();
  const monitor = context.createGain(); monitor.gain.value = 0.7;
  source.buffer = audio;
  source.connect(destination);
  source.connect(monitor); monitor.connect(context.destination); // audible proof for the operator
  // Keep the destination track alive after the fixture ends. The real recorder owns stop timing;
  // ending the track here looked like a microphone unplug and discarded an otherwise valid take.
  // AudioRecorder.stop() stops the track, which then closes this private context.
  destination.stream.getAudioTracks()[0]?.addEventListener('ended', () => context.close().catch(() => {}));
  source.start();
  return destination.stream;
}
