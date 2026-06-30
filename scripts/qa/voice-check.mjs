/**
 * EARS — synthesize the boss voice (Deepgram Aura), transcribe it back to measure INTELLIGIBILITY,
 * report speech-rate/loudness, and save WAVs you can listen to. Free (uses the existing Deepgram key).
 * Usage: node scripts/qa/voice-check.mjs        (reads DEEPGRAM_API_KEY from server/.env)
 *        node scripts/qa/voice-check.mjs "Eine eigene deutsche Zeile zum Testen."
 */
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../../server/.env', import.meta.url), 'utf8');
const key = (env.match(/^DEEPGRAM_API_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!key) { console.error('no DEEPGRAM_API_KEY in server/.env'); process.exit(1); }
const VOICE = 'aura-2-julius-de';
const lines = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Guten Tag, schön dass Sie da sind.',
  'Erzählen Sie mir bitte kurz von Ihrer Berufserfahrung.',
  'Gut. Und wie würden Sie mit einem wütenden Kunden umgehen?',
];
const toWav = (pcm, sr = 24000) => { const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]); };
const rmsPeak = (pcm) => { let s = 0, peak = 0, n = pcm.length / 2; for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); s += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); } return { rms: Math.sqrt(s / n), peak }; };
const norm = (s) => s.toLowerCase().replace(/[^a-zäöüß ]/g, ' ').replace(/\s+/g, ' ').trim();

for (const [i, line] of lines.entries()) {
  const sr = await fetch(`https://api.deepgram.com/v1/speak?model=${VOICE}&encoding=linear16&sample_rate=24000`, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) });
  const pcm = Buffer.from(await sr.arrayBuffer());
  const wav = toWav(pcm); fs.writeFileSync(`boss_${i + 1}.wav`, wav);
  const sec = (pcm.length / 2) / 24000, { rms, peak } = rmsPeak(pcm), words = line.split(/\s+/).length;
  const lr = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=de&punctuate=true', { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' }, body: wav });
  const back = (await lr.json()).results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  const a = norm(line).split(' '), set = new Set(norm(back).split(' '));
  const match = a.filter((w) => set.has(w)).length / a.length;
  console.log(`\n[${i + 1}] "${line}"\n   dur=${sec.toFixed(1)}s  ~${Math.round(words / (sec / 60))} wpm  peak=${(peak / 32767 * 100).toFixed(0)}%FS\n   heard back: "${back}"\n   intelligibility: ${(match * 100).toFixed(0)}%  → saved boss_${i + 1}.wav`);
}
