/**
 * compAccess.js — the standing comp-access whitelist: emails the owner grants a paid plan to
 * WITHOUT any payment, proactively (they never ask, never see a paywall). Two moments this
 * applies:
 *   1. SIGNUP — createAccount() (auth.js) checks the whitelist and auto-grants the plan the
 *      instant the account is created.
 *   2. ADMIN ADD — if the email already has an account, the grant applies immediately.
 * Persisted so it survives restarts. Small list by nature (never bulk), so a flat array is fine.
 * No auth.js import here (auth.js imports THIS file) — keeps the dependency direction one-way.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbEnabled, kvGet, kvSet } from './db.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DATA_DIR, 'comp-access.json');
const NS = 'compAccess';

let _cache = null;

async function load() {
  if (_cache) return _cache;
  if (dbEnabled()) { _cache = (await kvGet(NS, 'list')) ?? []; return _cache; }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  try { _cache = JSON.parse(await readFile(FILE, 'utf8')); } catch { _cache = []; }
  return _cache;
}
async function persist() {
  if (dbEnabled()) { await kvSet(NS, 'list', _cache); return; }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(_cache, null, 2), 'utf8');
}

export async function listComp() {
  return [...(await load())];
}

export async function findComp(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const list = await load();
  return list.find((x) => x.email === e) || null;
}

// Add or update a whitelist entry. Does NOT touch any existing account — the caller (admin.js /
// auth.js signup) is responsible for applying the grant to a real account when one exists.
export async function addComp({ email, plan = 'elite', note = '' }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('invalid_email'), { code: 400 });
  const list = await load();
  const existing = list.find((x) => x.email === email);
  if (existing) { existing.plan = plan; existing.note = note; }
  else list.push({ email, plan, note, addedAt: Date.now() });
  await persist();
  return existing || list[list.length - 1];
}

export async function removeComp(email) {
  email = String(email || '').trim().toLowerCase();
  const list = await load();
  const idx = list.findIndex((x) => x.email === email);
  if (idx === -1) return false;
  list.splice(idx, 1);
  await persist();
  return true;
}
