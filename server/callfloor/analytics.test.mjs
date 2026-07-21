/**
 * analytics.test.mjs — pins the Phase 3 deterministic aggregates: honest denominators
 * (null resolved never counts as failure), thin-data abstention, shift report BPO metrics,
 * career profile best-seat gating, rejection stamina, and the per-call score delta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorScore, resolvedPct, shiftReport, careerProfile, rejectionStamina, scoreDelta,
  MIN_SEAT_CALLS, STAMINA_MIN_CALLS } from './analytics.js';

const call = (over, { q = 'inbound_cs', sat = 3, resolved = null, sid = Math.random().toString(36).slice(2),
  scenarioId = 'ics-rechnung-doppelt', skills = [], createdAt = 0 } = {}) => ({
  sessionId: sid, quadrant: q, scenarioId, handleSeconds: 120, satisfactionFinal: sat, resolved,
  skills, meta: { overall: over }, createdAt,
});

test('floorScore: mean of evidence-backed overalls; null when none scored', () => {
  assert.equal(floorScore([call(80), call(60)]).score, 70);
  assert.equal(floorScore([{ meta: {} }, { meta: { overall: null } }]).score, null);
  assert.deepEqual(floorScore([]), { score: null, calls: 0, scored: 0 });
});

test('resolvedPct: null-resolved calls are EXCLUDED from the denominator (never a failure)', () => {
  // 1 resolved true, 1 false, 2 null → 1/2 judged = 50%
  const rs = [call(80, { resolved: true }), call(40, { resolved: false }), call(50), call(50)];
  assert.equal(resolvedPct(rs), 50);
  assert.equal(resolvedPct([call(50), call(50)]), null);   // nothing judgeable → null, not 0
});

test('shiftReport: BPO metrics, best/hardest by overall, empty flag', () => {
  assert.deepEqual(shiftReport([]), { callsHandled: 0, empty: true });
  const rs = [
    call(90, { sat: 5, resolved: true, sid: 'a' }),
    call(40, { sat: 1, resolved: false, sid: 'b' }),
    call(70, { sat: 3, sid: 'c' }),
  ];
  const r = shiftReport(rs);
  assert.equal(r.callsHandled, 3);
  assert.equal(r.resolvedPct, 50);              // a(true), b(false) judged; c null excluded
  assert.equal(r.avgSatisfaction, 3);           // (5+1+3)/3
  assert.equal(r.avgHandleSec, 120);
  assert.equal(r.floorScore, 67);               // round((90+40+70)/3)
  assert.equal(r.bestCall.sessionId, 'a');
  assert.equal(r.hardestCall.sessionId, 'b');
  assert.equal(r.bestCall.title_de, 'Doppelt abgebuchte Rechnung');   // enriched from the scenario bank
});

test('careerProfile: a seat needs MIN_SEAT_CALLS before it can be best/train-up', () => {
  const rs = [
    call(90, { q: 'inbound_cs', sid: '1' }), call(80, { q: 'inbound_cs', sid: '2' }),   // tested
    call(30, { q: 'outbound_sales', scenarioId: 'osa-kaltakquise-buero', sid: '3' }),   // 1 call → untested
  ];
  const p = careerProfile(rs);
  assert.equal(p.bestSeat, 'inbound_cs');
  assert.equal(p.trainUp, null);                // only one tested seat
  const ics = p.seats.find((s) => s.quadrant === 'inbound_cs');
  assert.equal(ics.tested, true);
  assert.equal(ics.avgOverall, 85);
  const osa = p.seats.find((s) => s.quadrant === 'outbound_sales');
  assert.equal(osa.tested, false);              // below MIN → honestly not bewertbar
  assert.ok(MIN_SEAT_CALLS >= 2);
});

test('careerProfile: top & weak skill computed per seat from all scored skills', () => {
  const skills = [{ key: 'deeskalation', score: 5, quote: 'x' }, { key: 'empathie', score: 2, quote: '' }];
  const rs = [call(70, { skills, sid: 'a' }), call(70, { skills, sid: 'b' })];
  const ics = careerProfile(rs).seats.find((s) => s.quadrant === 'inbound_cs');
  assert.equal(ics.topSkill, 'deeskalation');
  assert.equal(ics.weakSkill, 'empathie');      // score counts even though its quote is empty
});

test('rejectionStamina: abstains below the minimum sample', () => {
  const rs = [call(50, { q: 'outbound_sales', scenarioId: 'osa-kaltakquise-buero' })];
  const st = rejectionStamina(rs);
  assert.equal(st.measurable, false);
  assert.ok(STAMINA_MIN_CALLS >= 3);
});

test('rejectionStamina: collapse after rejections scores lower than holding', () => {
  // 4 outbound-sales calls; a rejection (resolved:false / cold) then a weak follow-up = low stamina.
  const os = (over, opts) => call(over, { q: 'outbound_sales', scenarioId: 'osa-kaltakquise-buero', ...opts });
  const collapse = rejectionStamina([
    os(70, { sid: 'a', createdAt: 1, sat: 4 }),
    os(30, { sid: 'b', createdAt: 2, sat: 1, resolved: false }),   // rejection
    os(20, { sid: 'c', createdAt: 3, sat: 1 }),                    // collapses after it
    os(65, { sid: 'd', createdAt: 4, sat: 4 }),
  ]);
  assert.equal(collapse.measurable, true);
  assert.ok(collapse.score < 100, `expected drop, got ${collapse.score}`);
  assert.equal(collapse.label, collapse.score >= 85 ? 'haelt_dem_druck_stand'
    : collapse.score >= 60 ? 'wackelt_nach_absagen' : 'bricht_nach_absagen_ein');
});

test('scoreDelta: before vs after this call; null when no prior scored evidence', () => {
  const prior = [call(60, { sid: 'p1' }), call(80, { sid: 'p2' })];   // floor 70
  const d = scoreDelta(prior, call(90, { sid: 'new' }));              // floor after = round(230/3)=77
  assert.equal(d.before, 70);
  assert.equal(d.after, 77);
  assert.equal(d.delta, 7);
  assert.equal(scoreDelta([], call(50, { sid: 'x' })).before, null);
});
