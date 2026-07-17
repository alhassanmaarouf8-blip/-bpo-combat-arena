/**
 * Voice Reality Lab
 *
 * Generates and optionally plays controlled German learner speech through the computer's
 * real audio output. During browser QA the production UI records that sound through its normal
 * microphone path, so Shadowing, Flow, Spoken Review and Salma exercise the same capture,
 * transcription and grading path a learner uses. No test endpoint or production bypass exists.
 *
 * Examples:
 *   node scripts/qa/voice-reality-lab.mjs generate --text "Guten Tag" --profile clean
 *   node scripts/qa/voice-reality-lab.mjs play --file <absolute.wav>
 */
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_TEXT = 600;
const PROFILES = Object.freeze({
  clean: { rate: '+0%', pitch: '+0Hz', filter: 'loudnorm=I=-20:LRA=7:TP=-2' },
  slow: { rate: '-35%', pitch: '-8Hz', filter: 'loudnorm=I=-20:LRA=7:TP=-2' },
  rushed: { rate: '+35%', pitch: '+8Hz', filter: 'loudnorm=I=-20:LRA=7:TP=-2' },
  quiet: { rate: '+0%', pitch: '+0Hz', filter: 'volume=0.12' },
  noisy: { rate: '+0%', pitch: '+0Hz',
    filter: 'asplit=2[voice][v];anoisesrc=color=pink:amplitude=0.025[noise];[v][noise]amix=inputs=2:duration=first:weights=1 0.35,loudnorm=I=-20:LRA=7:TP=-2' },
  clipped: { rate: '+0%', pitch: '+0Hz', filter: 'volume=8,alimiter=limit=0.22:attack=1:release=8,volume=4' },
});

function boundedText(value) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > MAX_TEXT) throw new Error(`text must contain 1-${MAX_TEXT} printable characters`);
  return text;
}

function profileFor(value) {
  const key = String(value || 'clean').toLowerCase();
  if (!Object.hasOwn(PROFILES, key)) throw new Error(`unknown profile: ${key}`);
  return { key, ...PROFILES[key] };
}

function findExecutable(name) {
  const lines = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!lines[0]) throw new Error(`${name} is not installed`);
  return lines[0];
}

export function voiceFixtureIdentity({ text, profile, voice }) {
  return createHash('sha256').update(JSON.stringify({ text: boundedText(text), profile: profileFor(profile).key,
    voice: String(voice || 'de-DE-ConradNeural') })).digest('hex').slice(0, 16);
}

export async function generateVoiceFixture({ text, profile = 'clean', voice = 'de-DE-ConradNeural', outDir } = {}) {
  const safeText = boundedText(text);
  const selected = profileFor(profile);
  const id = voiceFixtureIdentity({ text: safeText, profile: selected.key, voice });
  const directory = path.resolve(outDir || path.join(tmpdir(), 'omni-perform-voice-lab'));
  await mkdir(directory, { recursive: true });
  const mp3 = path.join(directory, `${id}.source.mp3`);
  const wav = path.join(directory, `${id}.${selected.key}.wav`);
  const manifest = path.join(directory, `${id}.json`);
  const edgeTts = findExecutable('edge-tts');
  const ffmpeg = findExecutable('ffmpeg');

  await exec(edgeTts, ['--voice', String(voice), `--rate=${selected.rate}`, `--pitch=${selected.pitch}`,
    '--text', safeText, '--write-media', mp3], { windowsHide: true, timeout: 60_000 });
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-af', selected.filter,
    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, timeout: 60_000 });
  const record = { version: 1, id, text: safeText, profile: selected.key, voice: String(voice),
    rate: selected.rate, pitch: selected.pitch, sampleRate: 24000, channels: 1,
    generatedAt: new Date().toISOString(), wav };
  await writeFile(manifest, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export async function playVoiceFixture(file) {
  const absolute = path.resolve(String(file || ''));
  const head = await readFile(absolute).then((buffer) => buffer.subarray(0, 12));
  if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('only RIFF/WAVE fixtures can be played');
  }
  const escaped = absolute.replaceAll("'", "''");
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System; $p=New-Object System.Media.SoundPlayer '${escaped}'; $p.PlaySync()`],
  { windowsHide: true, timeout: 120_000 });
  return absolute;
}

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  const args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!key?.startsWith('--') || rest[index + 1] == null) throw new Error(`invalid argument near ${key || 'end'}`);
    args[key.slice(2)] = rest[index + 1];
  }
  return { command, args };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseArgs(argv);
  if (command === 'generate') {
    const result = await generateVoiceFixture({ text: args.text, profile: args.profile, voice: args.voice, outDir: args.out });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'play') {
    await playVoiceFixture(args.file);
    process.stdout.write(`${path.resolve(args.file)}\n`);
    return;
  }
  throw new Error('usage: generate --text <German> [--profile clean|slow|rushed|quiet|noisy|clipped] or play --file <wav>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[voice-reality-lab] ${error.message}`); process.exitCode = 1; });
}
