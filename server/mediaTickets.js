import { randomBytes } from 'crypto';

const TTL_MS = 60_000;
const MAX_TICKETS = 1000;
const tickets = new Map();

function prune() {
  const now = Date.now();
  for (const [id, row] of tickets) if (row.expiresAt <= now || row.usesLeft <= 0) tickets.delete(id);
  while (tickets.size > MAX_TICKETS) tickets.delete(tickets.keys().next().value);
}

export function mintMediaTicket(payload) {
  prune();
  const id = randomBytes(32).toString('base64url');
  tickets.set(id, { ...payload, expiresAt: Date.now() + TTL_MS, usesLeft: 1 });
  return id;
}

export function consumeMediaTicket(id, expectedKind) {
  const key = String(id || '');
  const row = tickets.get(key);
  if (!row || row.expiresAt <= Date.now() || row.kind !== expectedKind || row.usesLeft <= 0) {
    if (row) tickets.delete(key);
    return null;
  }
  row.usesLeft -= 1;
  if (row.usesLeft <= 0) tickets.delete(key);
  return row;
}
