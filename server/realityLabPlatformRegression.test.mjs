import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('service-worker upgrades preserve reminder metadata and notification deep links', async () => {
  const source = await read('../client/public/sw.js');
  assert.match(source, /k !== CACHE && k !== META_CACHE/u);
  assert.match(source, /notification\?\.data\?\.url/u);
  assert.match(source, /navigate\?\.\(target\)/u);
  assert.match(source, /openWindow\(target\)/u);
});

test('query-bearing offline navigations fall back to the shell without caching the query', async () => {
  const source = await read('../client/public/sw.js');
  const queryBranch = source.slice(source.indexOf('if (url.search)'), source.indexOf("e.respondWith((async () =>", source.indexOf('if (url.search)')));
  assert.match(queryBranch, /fetch\(req\)\.catch/u);
  assert.match(queryBranch, /req\.mode === 'navigate'/u);
  assert.match(queryBranch, /caches\.match\('\/index\.html'\)/u);
  assert.doesNotMatch(queryBranch, /\.put\(/u);
});

test('reduced-motion first paint and suspense loading are stationary', async () => {
  const [html, loading] = await Promise.all([read('../client/index.html'), read('../client/src/Loading.jsx')]);
  assert.match(html, /prefers-reduced-motion:reduce\)\{#boot-splash \.ring\{animation:none/u);
  assert.match(loading, /prefers-reduced-motion:reduce\)\{\[role=status\]\{animation:none!important/u);
});

test('Arabic interface metadata and typed-answer focus remain exposed', async () => {
  const source = await read('../client/src/App.jsx');
  assert.match(source, /document\.documentElement\.lang = feedbackLang === 'ar' \? 'ar-EG' : 'de'/u);
  assert.match(source, /document\.documentElement\.dir = feedbackLang === 'ar' \? 'rtl' : 'ltr'/u);
  assert.match(source, /className="interview-answer-input"/u);
  assert.doesNotMatch(source, /className="interview-answer-input"[\s\S]{0,700}outline:'none'/u);
});
