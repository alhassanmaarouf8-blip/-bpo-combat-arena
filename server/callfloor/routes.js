/**
 * callfloor/routes.js — the Call Floor API (Mode 2). Mounted in server.js under /api; the
 * KILL SWITCH lives HERE: unless CALLFLOOR_ENABLED=1, every route answers the same 404 the
 * global catch-all would — flag off ⇒ the API surface is indistinguishable from "Mode 2 never
 * existed". Auth + rate limits ride the existing exported middleware (read-only imports).
 */

import express from 'express';
import { requireAuth, rateLimit, listAllAccounts } from '../auth.js';
import { voicedDurationMs } from '../audioGuard.js';
import { callFloorEntitlement, requiredPlanForQuadrant } from './entitlements.js';
import { planLedger } from './ledger.js';
import { EGP_PER_USD, PAYMENT_FEE } from './margin.config.js';
import { QUADRANTS, RUBRICS } from './scenarios.js';
import { personaTurn } from './callEngine.js';
import { transcribeCallTurn } from './transcribe.js';
import { recordAiUsage } from './usage.js';
import { PRICEBOOK } from './pricebook.config.js';
import { runPostCall } from './postCall.js';
import { listCallResults, secondsUsedToday } from './resultsStore.js';
import { dayKey } from '../time.js';
import * as cs from './callSession.js';
import * as shift from './shift.js';
import { shiftReport, careerProfile, scoreDelta, floorScore } from './analytics.js';

export const callfloorRouter = express.Router();

const enabled = () => process.env.CALLFLOOR_ENABLED === '1';
callfloorRouter.use('/callfloor', (req, res, next) => {
  if (!enabled()) return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'no-store');
  next();
});

const postCallPromises = new Map();   // sessionId → Promise<result> (in-flight verdicts)

// The persona's reply is spoken by the client via the EXISTING /api/tts-stream (drill path) —
// a frozen route that logs nothing, so the chars are metered HERE (units measured, list-priced).
async function logTtsChars(userId, text) {
  const chars = String(text || '').length;
  if (!chars) return;
  const rate = PRICEBOOK['deepgram:aura-2'];
  await recordAiUsage({
    userId, feature: 'callfloor-tts', provider: 'deepgram', model: 'aura-2',
    unitType: 'chars', unitsIn: 0, unitsOut: chars,
    usdActual: (chars / 1000) * rate.actual.per1kChars,
    usdList:   (chars / 1000) * rate.list.per1kChars,
    measured: true,
  });
}

function sessionOr404(req, res) {
  const session = cs.getLive(String(req.params.id || ''));
  if (!session || session.userId !== req.account.id) {
    res.status(404).json({ error: 'no_live_call' });
    return null;
  }
  return session;
}

// The honest Floor-Score delta for a just-judged call: score across all prior calls vs including
// this one. Never fabricated — null when there isn't enough scored evidence yet.
async function deltaFor(userId, result) {
  if (!result) return null;
  const all = await listCallResults(userId).catch(() => []);
  const prior = all.filter((r) => r.sessionId !== result.sessionId);
  return scoreDelta(prior, result);
}

// ── State: quadrants + today's remaining allowance ────────────────────────────────────────────
callfloorRouter.get('/callfloor/state', requireAuth, async (req, res) => {
  try {
    const ent = callFloorEntitlement(req.account);
    const used = await secondsUsedToday(req.account.id, dayKey());
    res.json({
      planId: ent.planId,
      entitlement: { dailyCallSeconds: ent.dailyCallSeconds, quadrants: ent.quadrants, freeTalk: ent.freeTalk,
        overageEgpPerBlock: ent.overageEgpPerBlock, overageBlockMin: ent.overageBlockMin },
      quadrants: Object.entries(QUADRANTS).map(([id, q]) => ({ id, label_de: q.label_de, label_ar: q.label_ar,
        skill_de: q.skill_de, unlocked: ent.quadrants.includes(id),
        requiredPlan: ent.quadrants.includes(id) ? null : requiredPlanForQuadrant(id) })),
      usedTodaySec: used,
      dailyLimitSec: ent.dailyCallSeconds,   // now plan-based (field kept for client compatibility)
      remainingSec: Math.max(0, ent.dailyCallSeconds - used),
      shiftOptions: shift.SHIFT_MINUTES,
      results: (await listCallResults(req.account.id)).slice(-20).map((r) => ({
        quadrant: r.quadrant, scenarioId: r.scenarioId, resolved: r.resolved,
        satisfactionFinal: r.satisfactionFinal, overall: r.meta?.overall ?? null, createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('[callfloor] state failed:', err.message);
    res.status(500).json({ error: 'state_failed' });
  }
});

// ── Start a call ──────────────────────────────────────────────────────────────────────────────
callfloorRouter.post('/callfloor/session',
  requireAuth, express.json(),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, tag: 'callfloor-start', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    try {
      const quadrant = String(req.body?.quadrant || '');
      if (!QUADRANTS[quadrant]) return res.status(400).json({ error: 'unknown_quadrant' });
      const out = await cs.startCall({ userId: req.account.id, account: req.account, quadrant });
      if (out.error) {
        const code = out.error === 'daily_limit' ? 429
          : (out.error === 'quadrant_locked' || out.error === 'not_entitled') ? 403 : 400;
        return res.status(code).json(out);
      }
      const { session, scenario, opening } = out;
      if (opening) await logTtsChars(req.account.id, opening.text);
      // `unsolvable` and the goal stay SERVER-SIDE (covert-test law — the skill is judged, not announced).
      res.json({
        sessionId: session.id, quadrant,
        scenario: {
          id: scenario.id, title_de: scenario.title_de, title_ar: scenario.title_ar,
          brief_de: scenario.brief_de, brief_ar: scenario.brief_ar,
          customerName: scenario.customer.name, voice: scenario.voice,
        },
        opening: opening ? { text: opening.text } : null,
        mood: session.mood,
        maxTurns: cs.MAX_AGENT_TURNS, maxMs: cs.MAX_CALL_MS,
      });
    } catch (err) {
      console.error('[callfloor] start failed:', err.message);
      res.status(500).json({ error: 'start_failed' });
    }
  });

// ── One spoken agent turn ─────────────────────────────────────────────────────────────────────
callfloorRouter.post('/callfloor/session/:id/turn',
  requireAuth,
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '4mb' }),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 200, tag: 'callfloor-turn', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    try {
      const session = sessionOr404(req, res);
      if (!session) return;
      const wall = cs.wallReason(session);
      if (wall) return res.json({ forceEnd: true, reason: wall });
      if (!req.body?.length || req.body.length < 1200) return res.status(400).json({ error: 'no_audio' });
      // Anti-farm voiced floor (same doctrine + threshold as the personal step): silence is not a turn.
      const voicedMs = voicedDurationMs(req.body) || 0;
      if (voicedMs < 800) return res.status(422).json({ error: 'no_voice' });

      const { text: heard, durationSec } = await transcribeCallTurn(req.body,
        { userId: req.account.id, mime: req.headers['content-type'] || 'audio/wav' });
      if (!heard) return res.status(422).json({ error: 'no_voice' });
      cs.recordAgentTurn(session, { text: heard, durationSec });

      const scenario = cs.getScenario(session.scenarioId);
      const customer = await personaTurn({
        scenario,
        history: session.transcript.map((t) => ({ role: t.role, text: t.text })),
        prevMood: session.mood, userId: req.account.id,
      });
      cs.recordCustomerTurn(session, customer);
      await logTtsChars(req.account.id, customer.text);

      const turnsLeft = Math.max(0, cs.MAX_AGENT_TURNS - session.agentTurns);
      res.json({
        heard,
        customer: { text: customer.text, mood: customer.mood, end: customer.end },
        mood: customer.mood, turnsLeft,
        forceEnd: customer.end || turnsLeft === 0 || !!cs.wallReason(session),
      });
    } catch (err) {
      console.error('[callfloor] turn failed:', err.message);
      res.status(502).json({ error: 'turn_failed' });   // honest: the customer line failed, not the learner
    }
  });

// ── End the call → verdict (waits briefly; client polls /result if the judge is still working) ─
callfloorRouter.post('/callfloor/session/:id/end',
  requireAuth, express.json(),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 60, tag: 'callfloor-end', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    try {
      const session = sessionOr404(req, res);
      if (!session) return;
      const scenario = cs.getScenario(session.scenarioId);
      await cs.endCall(session);
      const p = runPostCall({ session, scenario });
      postCallPromises.set(session.id, p);
      p.finally(() => setTimeout(() => postCallPromises.delete(session.id), 10 * 60_000));

      const result = await Promise.race([p, new Promise((r) => setTimeout(() => r('pending'), 12_000))]);
      if (result === 'pending' || !result) {
        return res.json({ sessionId: session.id, pending: true,
          handleSeconds: Math.round((session.endedAt - session.startedAt) / 1000), satisfactionFinal: session.finalMood });
      }
      res.json({ sessionId: session.id, pending: false, result, scoreDelta: await deltaFor(req.account.id, result) });
    } catch (err) {
      console.error('[callfloor] end failed:', err.message);
      res.status(500).json({ error: 'end_failed' });
    }
  });

// ── Poll the verdict / list a finished call's result ──────────────────────────────────────────
callfloorRouter.get('/callfloor/session/:id/result', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const inFlight = postCallPromises.get(id);
    if (inFlight) {
      const r = await Promise.race([inFlight, new Promise((r2) => setTimeout(() => r2('pending'), 100))]);
      if (r === 'pending') return res.json({ pending: true });
      if (r) return res.json({ pending: false, result: r, scoreDelta: await deltaFor(req.account.id, r) });
    }
    const all = await listCallResults(req.account.id);
    const found = all.find((r) => r.sessionId === id);
    if (found) return res.json({ pending: false, result: found, scoreDelta: await deltaFor(req.account.id, found) });
    res.json({ pending: !!inFlight, result: null, failed: !inFlight });   // honest: judge failed / unknown id
  } catch (err) {
    console.error('[callfloor] result failed:', err.message);
    res.status(500).json({ error: 'result_failed' });
  }
});

// ── Shift Mode: start a run of back-to-back calls (time budget clamped to the daily ceiling) ────
callfloorRouter.post('/callfloor/shift',
  requireAuth, express.json(),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 20, tag: 'callfloor-shift', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    try {
      const out = await shift.startShift({ userId: req.account.id, account: req.account, targetMin: req.body?.targetMin });
      if (out.error) return res.status(429).json(out);
      res.json({ shiftId: out.shift.id, targetSec: out.shift.targetSec, startedAt: out.shift.startedAt,
        remainingDailySec: out.remainingDailySec, options: shift.SHIFT_MINUTES });
    } catch (err) {
      console.error('[callfloor] shift start failed:', err.message);
      res.status(500).json({ error: 'shift_failed' });
    }
  });

// ── Shift report: the BPO supervisor read of the active shift's calls (server-computed) ─────────
callfloorRouter.get('/callfloor/shift/report', requireAuth, async (req, res) => {
  try {
    const s = shift.getShift(req.account.id);
    if (!s) return res.json({ active: false });
    const all = await listCallResults(req.account.id);
    const report = shiftReport(shift.resultsInShift(s, all));
    res.json({ active: true, targetSec: s.targetSec, elapsedSec: Math.round((Date.now() - s.startedAt) / 1000), report });
  } catch (err) {
    console.error('[callfloor] shift report failed:', err.message);
    res.status(500).json({ error: 'report_failed' });
  }
});

// Close the shift (client calls when the budget is spent or the learner stops) → final report.
callfloorRouter.post('/callfloor/shift/end', requireAuth, express.json(), async (req, res) => {
  try {
    const s = shift.getShift(req.account.id);
    const all = await listCallResults(req.account.id);
    const report = shiftReport(shift.resultsInShift(s, all));
    shift.endShift(req.account.id);
    res.json({ report });
  } catch (err) {
    console.error('[callfloor] shift end failed:', err.message);
    res.status(500).json({ error: 'shift_end_failed' });
  }
});

// ── Quadrant Career Profile: demonstrated skill per seat + best seat + rejection stamina ────────
callfloorRouter.get('/callfloor/profile', requireAuth, async (req, res) => {
  try {
    const all = await listCallResults(req.account.id);
    res.json({ totalCalls: all.length, profile: careerProfile(all), floorScore: floorScore(all) });
  } catch (err) {
    console.error('[callfloor] profile failed:', err.message);
    res.status(500).json({ error: 'profile_failed' });
  }
});

// ── Admin cost ledger: month-to-date AI cost vs plan revenue → live margin, per user + per plan.
// ADMIN_KEY-gated like admin.js; answers 404 (not 401) without the key so the route stays invisible.
callfloorRouter.get('/callfloor/admin/ledger', async (req, res) => {
  const ADMIN = String(process.env.ADMIN_KEY || '');
  const key = String(req.query.key || req.get('x-admin-key') || '');
  if (!ADMIN || key.length < 8 || key !== ADMIN) return res.status(404).json({ error: 'not_found' });
  try {
    const accounts = await listAllAccounts();
    const now = Date.now();
    const led = await planLedger(accounts, now);
    res.json({
      generatedAt: now,
      egpPerUsd: EGP_PER_USD,
      paymentFee: PAYMENT_FEE,
      note: 'Costs at LIST (the honest cost structure) AND actual (free-tier today). Placeholders — refresh margin.config + pricebook before Phase 6.',
      perPlan: led.perPlan,
      perUser: led.perUser,
    });
  } catch (err) {
    console.error('[callfloor] admin ledger failed:', err.message);
    res.status(500).json({ error: 'ledger_failed' });
  }
});

export { RUBRICS };
export default { callfloorRouter };
