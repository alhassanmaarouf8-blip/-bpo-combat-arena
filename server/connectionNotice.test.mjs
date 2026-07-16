import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offline notice keeps the app session intact and only offers recovery actions', async () => {
  const source = await readFile(new URL('../client/src/ConnectionNotice.jsx', import.meta.url), 'utf8');
  assert.match(source, /window\.addEventListener\('offline'/u);
  assert.match(source, /Dein gespeicherter Stand bleibt erhalten/u);
  assert.match(source, /window\.location\.reload\(\)/u);
  assert.doesNotMatch(source, /onLogout|localStorage\.clear|removeItem\(/u);
});
