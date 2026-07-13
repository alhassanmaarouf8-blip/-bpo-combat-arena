import express from 'express';
import { requireAuth } from './auth.js';
import { mutateUser } from './store.js';
import { acknowledgeEvent, answerSalmaQuestion, consumeQuestion, normalizeSalmaCoachState,
  publicSalmaCoach, salmaCoachCapabilities, salmaCoachFlags, syncSalmaCoach, updatePreferences } from './salmaCoachCore.js';

export const salmaCoachRouter = express.Router();
function requireCoach(req, res, next) {
  const flags = salmaCoachFlags(process.env, req.account);
  if (!flags.enabled) return res.status(404).json({ error: 'not_found' });
  req.salmaCoachFlags = flags; next();
}

salmaCoachRouter.get('/salma/coach', requireAuth, requireCoach, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const view = await mutateUser(req.account.id, (profile) => ({ value: publicSalmaCoach(profile, req.account, req.salmaCoachFlags) }));
    res.json(view);
  } catch (error) {
    console.error(`[salma-coach] read failed account=${req.account.id}: ${error.message}`);
    res.status(500).json({ error: 'coach_unavailable' });
  }
});

salmaCoachRouter.put('/salma/preferences', requireAuth, requireCoach, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const preferences = await mutateUser(req.account.id, (profile) => {
      profile.salmaCoach = updatePreferences(profile.salmaCoach, req.body); syncSalmaCoach(profile);
      return { value: profile.salmaCoach.preferences };
    });
    res.json({ preferences });
  } catch (error) { res.status(error.code || 500).json({ error: error.code ? error.message : 'preferences_failed' }); }
});

salmaCoachRouter.post('/salma/question', requireAuth, requireCoach, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (Object.keys(body).some((key) => !['question', 'context'].includes(key))) return res.status(400).json({ error: 'invalid_request' });
    const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
    if (Object.keys(context).some((key) => !['screen', 'drillId'].includes(key))) return res.status(400).json({ error: 'invalid_context' });
    const screen = typeof context.screen === 'string' ? context.screen : '';
    const drillId = typeof context.drillId === 'string' ? context.drillId : '';
    if (screen && !['home', 'drill', 'debrief', 'vacancy'].includes(screen)) return res.status(400).json({ error: 'invalid_context' });
    if (drillId && !['satzbau-schmiede', 'sag-es-richtig', 'flow-drill', 'hoer-check', 'shadowing', 'druck-leiter', 'srs'].includes(drillId)) return res.status(400).json({ error: 'invalid_context' });
    const capabilities = salmaCoachCapabilities(req.account);
    const result = await mutateUser(req.account.id, (profile) => {
      const synced = syncSalmaCoach(profile); profile.salmaCoach = consumeQuestion(synced.state, capabilities.dailyQuestions);
      const answer = answerSalmaQuestion(body.question, { screen, drillId }, profile.salmaCoach);
      return { value: { ...answer, remaining: Math.max(0, capabilities.dailyQuestions - profile.salmaCoach.coachState.questionUsage.count) } };
    });
    res.json(result);
  } catch (error) { res.status(error.code || 500).json({ error: error.code ? error.message : 'question_failed' }); }
});

salmaCoachRouter.post('/salma/events/:id/ack', requireAuth, requireCoach, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await mutateUser(req.account.id, (profile) => { profile.salmaCoach = acknowledgeEvent(normalizeSalmaCoachState(profile.salmaCoach), req.params.id); });
    res.json({ ok: true });
  } catch (error) { res.status(error.code || 500).json({ error: error.code ? error.message : 'ack_failed' }); }
});
