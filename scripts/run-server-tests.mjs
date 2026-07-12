import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const providerProofs = new Set([
  path.normalize('server/vertex-proof.test.mjs'),
]);
const all = (await walk('server')).sort();
const files = all.filter((file) => process.env.RUN_PROVIDER_PROOFS === '1' || !providerProofs.has(path.normalize(file)));

if (!files.length) throw new Error('No server tests found');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
