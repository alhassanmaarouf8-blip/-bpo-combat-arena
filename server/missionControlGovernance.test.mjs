import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TRACKED_APPLICATIONS, PLANS, trackedApplicationsFor } from './plans.config.js';
import {
  applyMissionControlGovernance,
  governedMissionControlFlagsFor,
  trackerLimitForMissionFlags,
} from './missionControlGovernance.js';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const LIVE_ENV = Object.freeze({
  OPPORTUNITY_COPILOT_MODE:'on',
  JOB_DISCOVERY_LIVE_ENABLED:'true',
  MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
});

test('job discovery requires both its live switch and fail-closed concierge validation', () => {
  const basic = { id:'governance-basic', subscription:{ plan:'basic' } };
  for (const value of [undefined, '', 'false', '0', 'off', 'yes', 'validated']) {
    const flags = governedMissionControlFlagsFor(basic, {
      env:{ ...LIVE_ENV, MISSION_CONTROL_CONCIERGE_VALIDATED:value },
      now:NOW,
    });
    assert.equal(flags.jobDiscoveryLive, false, `unexpectedly enabled for ${String(value)}`);
  }

  for (const value of ['1', 'true', 'TRUE', 'on', ' ON ']) {
    const flags = governedMissionControlFlagsFor(basic, {
      env:{ ...LIVE_ENV, MISSION_CONTROL_CONCIERGE_VALIDATED:value },
      now:NOW,
    });
    assert.equal(flags.jobDiscoveryLive, true, `did not enable for ${value}`);
  }

  const validationAlone = governedMissionControlFlagsFor(basic, {
    env:{
      OPPORTUNITY_COPILOT_MODE:'on',
      MISSION_CONTROL_CONCIERGE_VALIDATED:'true',
      MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
    },
    now:NOW,
  });
  assert.equal(validationAlone.jobDiscoveryLive, false);

  const cannotOverrideBase = applyMissionControlGovernance(
    { plan:'basic', jobDiscoveryLive:false },
    { MISSION_CONTROL_CONCIERGE_VALIDATED:'true' },
  );
  assert.equal(cannotOverrideBase.jobDiscoveryLive, false);
});

test('tracker entitlement follows the plan source of truth (trial REMOVED: stamp = plain free)', () => {
  assert.deepEqual({
    free:PLANS.free.trackedApplications,
    basic:PLANS.basic.trackedApplications,
    elite:PLANS.elite.trackedApplications,
  }, { free:1, basic:100, elite:250 });
  assert.equal(trackedApplicationsFor('free'), 1);
  assert.equal(trackedApplicationsFor('basic'), 100);
  assert.equal(trackedApplicationsFor('elite'), 250);
  assert.equal(trackedApplicationsFor('unknown'), 0);
  assert.equal(MAX_TRACKED_APPLICATIONS, 250);

  const cases = [
    ['free', { id:'governance-free', subscription:{ plan:'free' } }, 1],
    ['basic', { id:'governance-basic', subscription:{ plan:'basic' } }, 100],
    ['elite', { id:'governance-elite', subscription:{ plan:'elite' } }, 250],
    // Owner order 2026-07-25: the trial is ONE day of BASIC, so a trial stamp gets Basic's tracker
    // ceiling (100) — never Elite's 250.
    ['trial', {
      id:'governance-trial',
      subscription:{ plan:'free', trialStartedAt:NOW - 60_000 },
    }, 100],
  ];

  for (const [label, account, expected] of cases) {
    const flags = governedMissionControlFlagsFor(account, {
      env:{ OPPORTUNITY_COPILOT_MODE:'on', MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true' },
      now:NOW,
    });
    assert.equal(flags.canTrackApplications, expected, label);
    assert.equal(trackerLimitForMissionFlags(flags), expected, label);
  }

  assert.equal(trackerLimitForMissionFlags(null), 0);
  assert.equal(trackerLimitForMissionFlags({ plan:'unknown' }), 1);
});

test('governance returns a new object and never mutates the core entitlement result', () => {
  const base = Object.freeze({
    plan:'basic',
    trial:false,
    admin:false,
    canTrackApplications:30,
    jobDiscoveryLive:true,
  });
  const governed = applyMissionControlGovernance(base, {
    MISSION_CONTROL_CONCIERGE_VALIDATED:'true',
    MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
  });
  assert.notEqual(governed, base);
  assert.equal(base.canTrackApplications, 30);
  assert.equal(governed.canTrackApplications, 100);
  assert.equal(governed.jobDiscoveryLive, true);
});

test('all Mission Control writers fail closed without explicit single-writer attestation', () => {
  const base = {
    interviewPassEnabled:true,
    copilotEnabled:true,
    targetedLive:true,
    jobDiscoveryLive:true,
  };
  for (const value of [undefined, '', 'false', '0', 'off', 'yes']) {
    const flags = applyMissionControlGovernance(base, {
      MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:value,
      MISSION_CONTROL_CONCIERGE_VALIDATED:'true',
    });
    assert.equal(flags.singleWriterConfirmed, false);
    assert.equal(flags.interviewPassEnabled, false);
    assert.equal(flags.copilotEnabled, false);
    assert.equal(flags.targetedLive, false);
    assert.equal(flags.jobDiscoveryLive, false);
  }
  const enabled = applyMissionControlGovernance(base, {
    MISSION_CONTROL_SINGLE_WRITER_CONFIRMED:'true',
    MISSION_CONTROL_CONCIERGE_VALIDATED:'true',
  });
  assert.equal(enabled.singleWriterConfirmed, true);
  assert.equal(enabled.copilotEnabled, true);
});
