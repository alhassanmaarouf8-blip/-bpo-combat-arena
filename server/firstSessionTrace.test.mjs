import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFirstSessionTrace, publicOwnerTrace } from './firstSessionTrace.js';

test('first-session trace is ordered, idempotent, and reason-allowlisted', () => {
  const profile = { sessions: [] };
  appendFirstSessionTrace(profile, 'start_clicked', { now: 100 });
  appendFirstSessionTrace(profile, 'start_clicked', { now: 101 });
  appendFirstSessionTrace(profile, 'mic_blocked', { reason: 'permission-string-from-browser', now: 102 });
  appendFirstSessionTrace(profile, 'fight_started', { now: 103 });
  appendFirstSessionTrace(profile, 'session_closed', { reason: 'tab killed by browser', now: 104 });

  assert.deepEqual(publicOwnerTrace(profile.firstSessionTrace), {
    version: 1,
    startedAt: 100,
    endedAt: 104,
    events: [
      { event: 'start_clicked', at: 100 },
      { event: 'mic_blocked', at: 102, reason: 'other' },
      { event: 'fight_started', at: 103 },
      { event: 'session_closed', at: 104, reason: 'other' },
    ],
  });
});

test('completed accounts do not start a first-session trace', () => {
  const profile = { sessions: [{ date: 1 }] };
  assert.equal(appendFirstSessionTrace(profile, 'start_clicked', { now: 100 }), null);
  assert.equal(profile.firstSessionTrace, undefined);
});

test('a finished first journey cannot become ongoing behavioral telemetry', () => {
  const profile = { sessions: [] };
  appendFirstSessionTrace(profile, 'start_clicked', { now: 100 });
  appendFirstSessionTrace(profile, 'session_closed', { reason: 'abrupt_close', now: 101 });
  appendFirstSessionTrace(profile, 'fight_started', { now: 102 });
  assert.deepEqual(profile.firstSessionTrace.events, [
    { event: 'start_clicked', at: 100 },
    { event: 'session_closed', at: 101, reason: 'abrupt_close' },
  ]);
});

test('owner projection strips unexpected fields and caps its public shape', () => {
  const projection = publicOwnerTrace({
    version: 999,
    startedAt: 10,
    endedAt: 20,
    rawAudio: 'never expose',
    transcript: 'never expose',
    events: [{ event: 'fight_started', at: 11, reason: 'ignored', ip: '127.0.0.1', rawCloseReason: 'secret' }],
  });
  assert.deepEqual(projection, {
    version: 1,
    startedAt: 10,
    endedAt: 20,
    events: [{ event: 'fight_started', at: 11 }],
  });
});
