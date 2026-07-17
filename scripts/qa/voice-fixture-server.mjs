import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!root) throw new Error('usage: node voice-fixture-server.mjs <fixture-directory>');

createServer(async (request, response) => {
  const match = /^\/voice-fixtures\/([a-z0-9._-]+\.wav)$/iu.exec(request.url || '');
  if (!match) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(path.join(root, match[1]));
    response.writeHead(200, {
      'Content-Type': 'audio/wav', 'Content-Length': bytes.length,
      'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
}).listen(8787, '127.0.0.1', () => process.stdout.write('voice fixtures ready\n'));
