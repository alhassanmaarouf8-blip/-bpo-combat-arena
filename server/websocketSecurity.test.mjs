import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-not-prod';
const auth = await import('./auth.js');
const { WebSocketManager, websocketOriginAllowed } = await import('./websocketManager.js');

const uniq = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;

function managerHarness(active = new Set()) {
  const manager = Object.create(WebSocketManager.prototype);
  manager._activeFightUsers = active;
  return manager;
}

function contextHarness() {
  const sent = [];
  const closed = [];
  const deadline = setTimeout(() => {}, 60_000);
  deadline.unref?.();
  const ctx = {
    sessionId: 'test-session',
    userId: 'anon',
    authenticated: false,
    realtimeClient: null,
    accountLocked: null,
    authDeadline: deadline,
    startInFlight: false,
    messageWindowAt: Date.now(),
    messageCount: 0,
    lastActivityAt: Date.now(),
    socket: {
      readyState: 1,
      send(raw) { sent.push(JSON.parse(raw)); },
      close(code, reason) { closed.push({ code, reason }); },
    },
  };
  return { ctx, sent, closed, deadline };
}

test('WebSocket origin policy denies originless clients unless explicitly opted in', () => {
  const allowed = ['https://app.example.com'];
  assert.equal(websocketOriginAllowed('https://app.example.com', allowed), true);
  assert.equal(websocketOriginAllowed('https://evil.example', allowed), false);
  assert.equal(websocketOriginAllowed(undefined, allowed), false);
  assert.equal(websocketOriginAllowed(undefined, allowed, true), true);
});

test('invalid and unverified WebSocket starts close promptly without clearing auth deadline', async () => {
  const manager = managerHarness();
  const invalid = contextHarness();
  await manager._handleStartFight(invalid.ctx, { token: 'invalid' });
  assert.equal(invalid.closed[0].code, 4401);
  assert.equal(invalid.ctx.authDeadline, invalid.deadline);
  assert.equal(invalid.ctx.authenticated, false);
  clearTimeout(invalid.deadline);

  const account = await auth.createAccount(uniq('ws-unverified'), 'password1234', null);
  const unverified = contextHarness();
  await manager._handleStartFight(unverified.ctx, { token: auth.signToken(account) });
  assert.equal(unverified.closed[0].code, 4403);
  assert.equal(unverified.ctx.authDeadline, unverified.deadline);
  assert.equal(unverified.ctx.authenticated, false);
  clearTimeout(unverified.deadline);
});

test('paywalled and duplicate WebSocket starts close instead of retaining capacity', async () => {
  const paywalledAccount = await auth.createAccount(uniq('ws-paywall'), 'password1234', null);
  paywalledAccount.emailVerifiedAt = Date.now();
  paywalledAccount.subscription.freeFightUsed = true;
  const paywalled = contextHarness();
  await managerHarness()._handleStartFight(paywalled.ctx, { token: auth.signToken(paywalledAccount) });
  assert.equal(paywalled.closed[0].code, 4403);
  assert.equal(paywalled.ctx.authenticated, false);
  assert.equal(paywalled.ctx.authDeadline, paywalled.deadline);
  clearTimeout(paywalled.deadline);

  const duplicateAccount = await auth.createAccount(uniq('ws-duplicate'), 'password1234', null);
  duplicateAccount.emailVerifiedAt = Date.now();
  const duplicate = contextHarness();
  await managerHarness(new Set([duplicateAccount.id]))
    ._handleStartFight(duplicate.ctx, { token: auth.signToken(duplicateAccount) });
  assert.equal(duplicate.closed[0].code, 4409);
  assert.equal(duplicate.ctx.authenticated, false);
  assert.equal(duplicate.ctx.authDeadline, duplicate.deadline);
  clearTimeout(duplicate.deadline);
});

test('PING before authentication does not clear the authentication deadline', () => {
  const manager = managerHarness();
  const ping = contextHarness();
  manager._onMessage(ping.ctx, Buffer.from(JSON.stringify({ type: 'ping' })), false);
  assert.equal(ping.sent.at(-1).type, 'pong');
  assert.equal(ping.ctx.authDeadline, ping.deadline);
  assert.equal(ping.ctx.authenticated, false);
  clearTimeout(ping.deadline);
});

