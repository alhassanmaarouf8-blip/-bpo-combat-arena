import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPublicPreviewMonitor,
  isPreviewUnavailableError,
  isPublicPreviewOn,
} from './interviewPassAvailability.js';

test('only an exact public on attestation is renderable', () => {
  assert.equal(isPublicPreviewOn({ enabled:true, mode:'on' }), true);
  assert.equal(isPublicPreviewOn({ enabled:true, mode:'beta' }), false);
  assert.equal(isPublicPreviewOn({ enabled:true }), false);
  assert.equal(isPublicPreviewOn({ enabled:false, mode:'on' }), false);
});

test('availability monitor retries one initial failure, detects rollback, and throttles focus storms', async () => {
  let clock = 1_000;
  let calls = 0;
  const scheduled = [];
  const states = [];
  const responses = [
    new Error('cold start'),
    { enabled:true, mode:'on' },
    { enabled:false, mode:'off' },
    new Error('later network issue'),
  ];
  const monitor = createPublicPreviewMonitor({
    getStatus:async () => {
      const response = responses[calls++];
      if (response instanceof Error) throw response;
      return response;
    },
    onAvailability:(state) => states.push(state),
    now:() => clock,
    schedule:(callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    cancelSchedule:() => {},
    minIntervalMs:30_000,
    retryDelayMs:1_250,
  });

  await monitor.start();
  assert.deepEqual(states, ['off']);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_250);
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states, ['off', 'on']);

  await Promise.all([monitor.revalidate(), monitor.revalidate(), monitor.revalidate()]);
  assert.equal(calls, 2, 'focus storm inside throttle window must not probe');
  clock += 30_000;
  await monitor.revalidate();
  assert.equal(calls, 3);
  assert.deepEqual(states, ['off', 'on', 'off']);

  clock += 30_000;
  await monitor.revalidate();
  assert.equal(scheduled.length, 1, 'passive failures never schedule more retries');
  monitor.stop();
});

test('a passive transient failure preserves an already-visible browser-only CV surface', async () => {
  let clock = 5_000;
  let calls = 0;
  const states = [];
  const scheduled = [];
  const monitor = createPublicPreviewMonitor({
    getStatus:async () => {
      calls += 1;
      if (calls === 1) return { enabled:true, mode:'on' };
      throw Object.assign(new Error('sleeping backend'), { code:'network_error' });
    },
    onAvailability:(state) => states.push(state),
    now:() => clock,
    schedule:(callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    cancelSchedule:() => {},
    minIntervalMs:30_000,
    retryDelayMs:1_250,
  });

  await monitor.start();
  assert.deepEqual(states, ['on']);
  clock += 30_000;
  await monitor.revalidate();
  assert.deepEqual(states, ['on'], 'transient revalidation must not unmount and erase local CV text');
  assert.equal(scheduled.length, 1);
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states, ['on'], 'one failed recovery probe also preserves the visible form');
  assert.equal(scheduled.length, 1, 'the recovery probe cannot create an infinite retry loop');
  monitor.stop();
});

test('only rollback-class flow errors notify the parent', () => {
  for (const code of ['feature_disabled', 'feature_paused', 'privacy_configuration_required']) {
    assert.equal(isPreviewUnavailableError({ code }), true, code);
  }
  assert.equal(isPreviewUnavailableError({ code:'network_error' }), false);
  assert.equal(isPreviewUnavailableError(null), false);
});

test('App wiring is public-on only, refreshes safely, and unmounts on flow rollback', () => {
  const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('./InterviewPassPreview.jsx', import.meta.url), 'utf8');

  assert.match(app, /interviewPassFeatureState\s*===\s*['"]on['"]\s*&&\s*<Suspense/u);
  assert.doesNotMatch(app, /interviewPassFeatureState\s*===\s*['"]beta['"]/u);
  assert.match(app, /window\.addEventListener\(['"]focus['"],\s*revalidateWhenVisible\)/u);
  assert.match(app, /document\.addEventListener\(['"]visibilitychange['"],\s*revalidateWhenVisible\)/u);
  assert.match(app, /window\.setInterval\(revalidateWhenVisible,\s*PUBLIC_PREVIEW_REVALIDATE_MS\)/u);
  assert.match(app, /monitor\.start\(\)/u);
  assert.match(app, /onUnavailable=\{hideUnavailableInterviewPass\}/u);
  assert.match(app, /interviewPassUnavailableRef\.current\s*=\s*true/u);
  assert.match(preview, /isPreviewUnavailableError\(requestError\)/u);
  assert.match(preview, /markUnavailable\(requestError\.code\)/u);
  assert.match(preview, /setAvailability\(['"]hidden['"]\)/u);
  assert.match(preview, /onUnavailable\?\.\(code\)/u);
});
