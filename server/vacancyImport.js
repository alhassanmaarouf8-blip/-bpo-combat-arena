/**
 * vacancyImport.js
 *
 * Fetches supported public vacancy pages and extracts their JobPosting JSON-LD.
 * User URLs are never returned, persisted, or logged. Every hop is HTTPS, host-
 * allowlisted, DNS-checked, and pinned to the checked address for the TLS request.
 */
import https from 'node:https';
import net, { BlockList } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export const VACANCY_IMPORT_HOSTS = Object.freeze({
  'wuzzuf.net': 'wuzzuf.net',
  'www.wuzzuf.net': 'wuzzuf.net',
  'jobs.lever.co': 'jobs.lever.co',
  'boards.greenhouse.io': 'boards.greenhouse.io',
  'apply.workable.com': 'apply.workable.com',
  'jobs.smartrecruiters.com': 'jobs.smartrecruiters.com',
});

export const VACANCY_IMPORT_LIMITS = Object.freeze({
  maxUrlChars: 2048,
  maxRedirects: 3,
  maxResponseBytes: 512 * 1024,
  timeoutMs: 6500,
  maxJsonLdScripts: 24,
  maxJsonLdChars: 256 * 1024,
});

export class VacancyImportError extends Error {
  constructor(reason = 'paste_required') {
    super('paste_required');
    this.name = 'VacancyImportError';
    this.code = 'paste_required';
    this.reason = reason;
  }
}

function fail(reason) {
  throw new VacancyImportError(reason);
}

export function normalizeVacancyImportUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > VACANCY_IMPORT_LIMITS.maxUrlChars) {
    fail('unsupported_source');
  }
  if(/[\u0000-\u001f\u007f]/u.test(raw)) fail('unsafe_source');

  let url;
  try { url = new URL(raw.trim()); }
  catch { fail('unsupported_source'); }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    fail('unsafe_source');
  }
  if (!Object.hasOwn(VACANCY_IMPORT_HOSTS, host)) fail('unsupported_source');
  if (url.hash) url.hash = '';
  return { url, sourceHost: VACANCY_IMPORT_HOSTS[host] };
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(network, prefix, 'ipv6');

function mappedIpv4(address) {
  const lower = String(address).toLowerCase();
  const dotted = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!hex) return null;
  const value = (parseInt(hex[1], 16) * 0x10000) + parseInt(hex[2], 16);
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

export function isPublicInternetAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 4) return !blocked.check(address, 'ipv4');
  const mapped = mappedIpv4(address);
  if (mapped) return isPublicInternetAddress(mapped);
  return !blocked.check(address, 'ipv6');
}

export function assertPublicDnsAnswers(records) {
  if (!Array.isArray(records) || !records.length || records.length > 32) fail('unsafe_source');
  const checked = records.map((record) => {
    const address = String(record?.address || '');
    const actualFamily = net.isIP(address);
    const family = Number(record?.family) || actualFamily;
    if (!actualFamily || family !== actualFamily || !isPublicInternetAddress(address)) fail('unsafe_source');
    return { address, family };
  });
  // Prefer IPv4 because many app hosts do not have outbound IPv6; address pinning
  // still makes the choice safe and deterministic.
  return checked.sort((a, b) => a.family - b.family || a.address.localeCompare(b.address));
}

function remainingMs(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) fail('source_timeout');
  return remaining;
}

async function lookupBeforeDeadline(hostname, deadline, lookupFn) {
  let timer;
  try {
    return await Promise.race([
      lookupFn(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new VacancyImportError('source_timeout')), remainingMs(deadline));
      }),
    ]);
  } catch (error) {
    if (error instanceof VacancyImportError) throw error;
    fail('source_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function requestPinned(url, record, deadline, requestFn) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(response);
    };
    const options = {
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      rejectUnauthorized: true,
      agent: false,
      headers: {
        Host: url.hostname,
        Accept: 'text/html,application/xhtml+xml,application/ld+json,application/json;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'BPO-Combat-Arena-Vacancy-Importer/1.0',
      },
      lookup(_hostname, _options, callback) {
        callback(null, record.address, record.family);
      },
    };

    let req;
    try {
      req = requestFn(options, (res) => finish(null, res));
    } catch {
      finish(new VacancyImportError('source_unavailable'));
      return;
    }
    if (settled) return;
    timer = setTimeout(() => {
      req.destroy();
      finish(new VacancyImportError('source_timeout'));
    }, remainingMs(deadline));
    req.once('error', () => finish(new VacancyImportError('source_unavailable')));
    req.end();
  });
}

function collectBoundedBody(response, deadline) {
  return new Promise((resolve, reject) => {
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > VACANCY_IMPORT_LIMITS.maxResponseBytes) {
      response.destroy();
      reject(new VacancyImportError('source_too_large'));
      return;
    }
    const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
    if (encoding !== 'identity') {
      response.destroy();
      reject(new VacancyImportError('unsupported_response'));
      return;
    }

    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(body);
    };
    const timer = setTimeout(() => {
      response.destroy();
      finish(new VacancyImportError('source_timeout'));
    }, remainingMs(deadline));
    response.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > VACANCY_IMPORT_LIMITS.maxResponseBytes) {
        response.destroy();
        finish(new VacancyImportError('source_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    response.once('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    response.once('aborted', () => finish(new VacancyImportError('source_unavailable')));
    response.once('error', () => finish(new VacancyImportError('source_unavailable')));
  });
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const value = entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
}

function plainText(value, max) {
  return decodeEntities(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' '))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, max);
}

function typeIsJobPosting(value) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => {
    const normalized = String(type || '').trim().toLowerCase();
    return normalized === 'jobposting' || /(?:\/|#)jobposting$/u.test(normalized);
  });
}

function attributesDeclareJsonLd(attributes) {
  const match = String(attributes || '').match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').split(';', 1)[0].trim().toLowerCase();
  return value === 'application/ld+json';
}

function findJobPosting(root) {
  const queue = [{ value: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 256) {
    const { value, depth } = queue.shift();
    visited += 1;
    if (!value || depth > 8) continue;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 64)) queue.push({ value: child, depth: depth + 1 });
      continue;
    }
    if (typeof value !== 'object') continue;
    if (typeIsJobPosting(value['@type'])) return value;
    if (Object.hasOwn(value, '@graph')) queue.push({ value: value['@graph'], depth: depth + 1 });
    if (Object.hasOwn(value, 'mainEntity')) queue.push({ value: value.mainEntity, depth: depth + 1 });
  }
  return null;
}

function valueText(value, max = 8000) {
  if (typeof value === 'string' || typeof value === 'number') return plainText(value, max);
  if (Array.isArray(value)) return plainText(value.slice(0, 32).map((item) => valueText(item, 1000)).join('. '), max);
  if (value && typeof value === 'object') return plainText(value.name || value.value || '', max);
  return '';
}

function shapeJobPosting(job) {
  if (!job) return null;
  const title = valueText(job.title || job.name, 120);
  if (!title) return null;
  const organization = job.hiringOrganization;
  const employer = valueText(organization?.name || organization, 100);
  const detailFields = [
    job.description, job.responsibilities, job.qualifications, job.skills,
    job.experienceRequirements, job.educationRequirements,
  ];
  const description = plainText(detailFields.map((value) => valueText(value, 12000)).filter(Boolean).join('. '), 20000)
    .replace(/\.\.(?=\s|$)/gu, '.');
  return { title, employer: employer || null, description };
}

export function extractJobPostingJsonLd(body, contentType = 'text/html') {
  if (typeof body !== 'string' || body.length > VACANCY_IMPORT_LIMITS.maxResponseBytes) return null;
  const candidates = [];
  if (/\b(?:application\/json|application\/ld\+json)\b/iu.test(contentType)) candidates.push(body);

  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  let match;
  while ((match = scripts.exec(body)) && candidates.length < VACANCY_IMPORT_LIMITS.maxJsonLdScripts) {
    if (!attributesDeclareJsonLd(match[1])) continue;
    if (match[2].length <= VACANCY_IMPORT_LIMITS.maxJsonLdChars) candidates.push(match[2]);
  }

  for (let candidate of candidates) {
    candidate = candidate.trim().replace(/^<!--/u, '').replace(/-->$/u, '').trim();
    if (!candidate || candidate.length > VACANCY_IMPORT_LIMITS.maxJsonLdChars) continue;
    try {
      const shaped = shapeJobPosting(findJobPosting(JSON.parse(candidate)));
      if (shaped) return shaped;
    } catch { /* malformed JSON-LD: try the next bounded script */ }
  }
  return null;
}

/**
 * Returns derived JobPosting fields and a canonical allowlist host only.
 * The caller deliberately never receives the requested or redirected URL.
 */
export async function importVacancyFromUrl(rawUrl, dependencies = {}) {
  const lookupFn = dependencies.lookup || dnsLookup;
  const requestFn = dependencies.request || https.request;
  const timeoutMs = Math.min(Math.max(Number(dependencies.timeoutMs) || VACANCY_IMPORT_LIMITS.timeoutMs, 250), 15000);
  const deadline = Date.now() + timeoutMs;
  let current = normalizeVacancyImportUrl(rawUrl);

  for (let redirects = 0; redirects <= VACANCY_IMPORT_LIMITS.maxRedirects; redirects += 1) {
    const records = assertPublicDnsAnswers(await lookupBeforeDeadline(current.url.hostname, deadline, lookupFn));
    const response = await requestPinned(current.url, records[0], deadline, requestFn);
    const status = Number(response.statusCode) || 0;

    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      response.resume();
      if (!location || redirects >= VACANCY_IMPORT_LIMITS.maxRedirects || String(location).length > VACANCY_IMPORT_LIMITS.maxUrlChars) {
        fail('redirect_blocked');
      }
      let next;
      try { next = new URL(String(location), current.url); }
      catch { fail('redirect_blocked'); }
      try { current = normalizeVacancyImportUrl(next.href); }
      catch { fail('redirect_blocked'); }
      continue;
    }

    if (status !== 200) {
      response.resume();
      fail('source_blocked');
    }
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (contentType && !/^(?:text\/html|application\/xhtml\+xml|application\/ld\+json|application\/json)\b/u.test(contentType)) {
      response.resume();
      fail('unsupported_response');
    }
    const body = await collectBoundedBody(response, deadline);
    const posting = extractJobPostingJsonLd(body, contentType);
    if (!posting) fail('jsonld_missing');
    return { ...posting, sourceHost: current.sourceHost };
  }
  fail('redirect_blocked');
}
