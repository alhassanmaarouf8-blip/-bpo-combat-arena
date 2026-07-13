import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  VacancyImportError,
  assertPublicDnsAnswers,
  extractJobPostingJsonLd,
  importVacancyFromUrl,
  isPublicInternetAddress,
  normalizeVacancyImportUrl,
} from './vacancyImport.js';

function fakeResponse(statusCode, headers = {}, body = '') {
  const response = Readable.from([Buffer.from(body)]);
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

function fakeRequests(responses, calls = []) {
  return {
    calls,
    request(options, callback) {
      calls.push(options);
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => callback(responses.shift()));
      return req;
    },
  };
}

test('vacancy import URL policy is exact HTTPS allowlist, without credentials or custom ports', () => {
  assert.equal(normalizeVacancyImportUrl('https://www.wuzzuf.net/jobs/p/123?x=1#details').sourceHost, 'wuzzuf.net');
  assert.equal(normalizeVacancyImportUrl('https://jobs.lever.co/acme/123').sourceHost, 'jobs.lever.co');
  for (const url of [
    'http://jobs.lever.co/acme/123',
    'https://user:secret@jobs.lever.co/acme/123',
    'https://jobs.lever.co:444/acme/123',
    'https://evil.example/jobs.lever.co/acme/123',
    'https://jobs.lever.co.evil.example/acme/123',
  ]) {
    assert.throws(() => normalizeVacancyImportUrl(url), (error) =>
      error instanceof VacancyImportError && error.code === 'paste_required' && !error.message.includes(url));
  }
});

test('private, local, reserved, mapped, and mixed DNS answers fail closed', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '198.51.100.2', '::', '::1', 'fc00::1',
    'fe80::1', '2001:db8::1', '::ffff:127.0.0.1',
  ]) assert.equal(isPublicInternetAddress(address), false, address);
  assert.equal(isPublicInternetAddress('8.8.8.8'), true);
  assert.equal(isPublicInternetAddress('2001:4860:4860::8888'), true);
  assert.deepEqual(assertPublicDnsAnswers([{ address: '8.8.8.8', family: 4 }]), [{ address: '8.8.8.8', family: 4 }]);
  assert.throws(
    () => assertPublicDnsAnswers([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]),
    (error) => error.reason === 'unsafe_source',
  );
});

test('JSON-LD extraction selects a bounded JobPosting and returns plain derived fields only', () => {
  const html = `<!doctype html><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', name: 'ignore' },
      {
        '@type': ['Thing', 'JobPosting'],
        title: 'German <b>Support</b> Agent',
        hiringOrganization: { name: 'Example &amp; Co' },
        description: '<p>Handle customer tickets.</p>',
        qualifications: ['German B2', 'Flexible shifts'],
      },
    ],
  })}</script>`;
  const result = extractJobPostingJsonLd(html, 'text/html; charset=utf-8');
  assert.deepEqual(result, {
    title: 'German Support Agent',
    employer: 'Example & Co',
    description: 'Handle customer tickets. German B2. Flexible shifts',
  });
  assert.equal(extractJobPostingJsonLd('<script type="application/ld+json">{"@type":"Article"}</script>'), null);
});

test('secure importer pins the checked address and never returns the source URL', async () => {
  const document = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title: 'Technical Support Agent',
    hiringOrganization: { name: 'Acme' },
    description: 'Troubleshoot customer issues. German B2 required. Flexible shift availability.',
  })}</script>`;
  const fake = fakeRequests([
    fakeResponse(200, { 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(document)) }, document),
  ]);
  const result = await importVacancyFromUrl('https://jobs.lever.co/acme/secret-query?candidate=private', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: fake.request,
  });
  assert.deepEqual(Object.keys(result).sort(), ['description', 'employer', 'sourceHost', 'title']);
  assert.equal(result.sourceHost, 'jobs.lever.co');
  assert.equal(JSON.stringify(result).includes('secret-query'), false);
  assert.equal(fake.calls[0].servername, 'jobs.lever.co');
  assert.equal(fake.calls[0].rejectUnauthorized, true);
  const pinned = await new Promise((resolve, reject) => {
    fake.calls[0].lookup('jobs.lever.co', {}, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(pinned, { address: '8.8.8.8', family: 4 });
});

test('redirects are manually revalidated and blocked destinations become paste_required', async () => {
  const fake = fakeRequests([
    fakeResponse(302, { location: 'https://internal.example/private' }),
  ]);
  await assert.rejects(
    importVacancyFromUrl('https://jobs.lever.co/acme/123', {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      request: fake.request,
    }),
    (error) => error instanceof VacancyImportError
      && error.code === 'paste_required'
      && error.reason === 'redirect_blocked'
      && error.message === 'paste_required',
  );
  assert.equal(fake.calls.length, 1);
});

test('oversized remote responses are rejected before buffering', async () => {
  const fake = fakeRequests([
    fakeResponse(200, { 'content-type': 'text/html', 'content-length': String(1024 * 1024) }, ''),
  ]);
  await assert.rejects(
    importVacancyFromUrl('https://apply.workable.com/acme/j/123', {
      lookup: async () => [{ address: '8.8.4.4', family: 4 }],
      request: fake.request,
    }),
    (error) => error.code === 'paste_required' && error.reason === 'source_too_large',
  );
});
