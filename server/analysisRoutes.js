/**
 * analysisRoutes.js — read API for the Deep Diagnostic Engine (v2 Phase 2).
 *
 *   GET /api/analysis/:sessionId → { status } | { status:'ready', answers, aggregates }
 *     Self-data only (the authed account's own interview). While 'queued', the GET itself
 *     lazily re-runs the analysis (see analysisRunner) — polling IS the retry queue.
 *
 *   GET /api/error-events → { events } — the caller's own flat error history (bounded),
 *     the queryable fuel for the Phase-3 bottleneck selector and for owner debugging.
 */
import express from 'express';
import { requireAuth, rateLimit } from './auth.js';
import { getOrRetryAnalysis } from './analysisRunner.js';
import { loadErrorEvents } from './analysisStore.js';

export const analysisRouter = express.Router();

analysisRouter.get('/analysis/:sessionId',
  requireAuth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120, tag: 'analysis-get', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const record = await getOrRetryAnalysis(req.account.id, req.params.sessionId);
      if (!record) return res.status(404).json({ error: 'analysis_not_found' });
      if (record.status !== 'ready') return res.json({ status: record.status });
      // The client gets the validated analysis + code-counted aggregates — never the raw input
      // blob and never another user's data (the key is scoped to the authed account above).
      return res.json({ status: 'ready', answers: record.analysis.answers, cefr: record.analysis.cefr, aggregates: record.aggregates });
    } catch (err) {
      console.error('[analysisRoutes] get failed:', err.message);
      return res.status(500).json({ error: 'analysis_get_failed' });
    }
  });

analysisRouter.get('/error-events',
  requireAuth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 60, tag: 'error-events', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      return res.json({ events: await loadErrorEvents(req.account.id) });
    } catch (err) {
      console.error('[analysisRoutes] error-events failed:', err.message);
      return res.status(500).json({ error: 'error_events_failed' });
    }
  });

export default analysisRouter;
