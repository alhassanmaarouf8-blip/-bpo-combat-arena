#!/usr/bin/env node
/** Fail CI before a credential reaches git; values are never printed. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const allow = new Set(['scripts/check-secrets.mjs']);
const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.wav', '.mp4', '.apk', '.pdf']);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean).filter((file) => !allow.has(file));
const hits = [];

for (const file of files) {
  if (binaryExtensions.has(path.extname(file).toLowerCase())) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (content.includes('\0')) {
    hits.push(`${file}:1 (unexpected binary data in source file)`);
    continue;
  }
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      hits.push(`${file}:${line} (${name})`);
    }
  }
}

if (hits.length) {
  console.error('Potential credentials found. Values are intentionally hidden:');
  for (const hit of hits) console.error(`- ${hit}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} tracked and untracked source files).`);
