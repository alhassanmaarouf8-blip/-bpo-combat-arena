import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'espree';
import path from 'node:path';
import process from 'node:process';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(?:js|mjs|jsx)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [...await walk('server'), ...await walk('scripts'), ...await walk('client/src')].sort();
const failures = [];
for (const file of files) {
  try {
    parse(await readFile(file, 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: file.endsWith('.jsx') },
      allowHashBang: true,
    });
  } catch (error) {
    failures.push(`${file}:${error.lineNumber || '?'}:${error.column || '?'}\n${error.message}`);
  }
}
if (failures.length) {
  console.error(`Syntax check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Syntax check passed (${files.length} files).`);
