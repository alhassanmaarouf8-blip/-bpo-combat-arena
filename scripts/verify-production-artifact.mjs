import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('client/dist');
await stat(root).catch(() => { throw new Error('client/dist is missing; build the production client first'); });

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

const files = await walk(root);
const failures = [];
let totalJsBytes = 0;
for (const file of files) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (rel.endsWith('.map')) failures.push(`${rel}: public source map`);
  if (/\.apk$/i.test(rel)) failures.push(`${rel}: executable installer must not ship inside the web app`);
  if (/ElevenTest/i.test(rel)) failures.push(`${rel}: internal provider test surface shipped publicly`);
  if (/\.js$/i.test(rel)) {
    const bytes = (await stat(file)).size;
    totalJsBytes += bytes;
    if (bytes > 1_500_000) failures.push(`${rel}: JavaScript chunk exceeds 1.5 MB raw`);
  }
  if (!/\.(?:html|js|css|json|txt|xml)$/i.test(rel)) continue;
  const body = await readFile(file, 'utf8');
  const checks = [
    [/localhost(?::\d+)?/i, 'localhost reference'],
    [/[?&](?:token|key|admin_key)=/i, 'credential in URL'],
    [/data-owner-debug|omniDebugDump|\?debug=1/i, 'production debug recorder'],
    [/chatgpt\.com|openai\.com|claude\.ai/i, 'AI/tool-branded customer-facing URL'],
    [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key pattern'],
    [/sk-(?:proj-)?[0-9A-Za-z_-]{20,}/, 'provider API key pattern'],
  ];
  for (const [pattern, label] of checks) if (pattern.test(body)) failures.push(`${rel}: ${label}`);
}
if (totalJsBytes > 3_500_000) failures.push(`JavaScript total exceeds 3.5 MB raw (${totalJsBytes} bytes)`);

const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
for (const match of indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const attrs = match[1] || '';
  if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']module["']/.test(attrs)) continue;
  if (!/type\s*=\s*["']application\/ld\+json["']/.test(attrs)) failures.push('index.html: unexpected inline executable script');
}
const jsonLd = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
if (jsonLd) {
  const hash = `sha256-${createHash('sha256').update(jsonLd).digest('base64')}`;
  const vercel = await readFile('client/vercel.json', 'utf8');
  if (!vercel.includes(hash)) failures.push('client/vercel.json: CSP is missing the exact JSON-LD script hash');
}

if (failures.length) {
  console.error('Production artifact verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Production artifact verification passed (${files.length} files).`);
