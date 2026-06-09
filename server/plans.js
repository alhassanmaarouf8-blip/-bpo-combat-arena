/**
 * plans.js  —  "Zielplan" (goal plan) CRUD.
 *
 * A self-contained coaching layer ADDED ON TOP of the app. It does NOT touch the voice
 * interview, scoring, or websocket engine — it only persists user-authored plans.
 *
 *   GET    /api/plans                       → list the user's plans
 *   POST   /api/plans                       → create a plan { title, deadline, maxFights }
 *   GET    /api/plans/:id                   → one plan
 *   PUT    /api/plans/:id                   → replace structure (title/deadline/days), re-validated
 *   PATCH  /api/plans/:id/steps/:stepId     → toggle a step done/undone
 *   DELETE /api/plans/:id                   → delete a plan
 *
 * Persistence reuses the existing per-user store (loadUser/saveUser); plans live under
 * profile.plans, so no storage code changes were needed.
 */
import express from 'express';
import { randomUUID } from 'crypto';
import { loadUser, saveUser } from './store.js';
import { requireAuth }        from './auth.js';
import { generateTask, giveFeedback, transcribeAudio, speakingFeedback } from './planGuide.js';

export const planRouter = express.Router();

export const STEP_TYPES = ['research', 'written', 'speaking', 'fight'];
const MAX_FIGHTS_HARD   = 3;     // hard ceiling — voice fights are the rationed, expensive step
const DEFAULT_MAX_FIGHTS = 3;

const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clampInt  = (n, lo, hi, dflt) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
};
const str = (s, max) => String(s ?? '').trim().slice(0, max);

async function plansOf(userId) {
  const p = await loadUser(userId);
  if (!Array.isArray(p.plans)) p.plans = [];   // default without touching store.js
  return { profile: p, plans: p.plans };
}

// Count the rationed voice fights in a set of days.
function countFights(days) {
  return days.reduce((n, d) => n + d.steps.filter((s) => s.type === 'fight').length, 0);
}

// Normalize client-supplied days into the canonical shape, preserving completion state of
// steps that already exist (matched by id) so a structure edit never wipes progress.
function normalizeDays(rawDays, existingStepsById) {
  return (Array.isArray(rawDays) ? rawDays : []).slice(0, 60).map((d) => ({
    id:    typeof d.id === 'string' ? d.id : randomUUID(),
    date:  isDateStr(d.date) ? d.date : null,
    steps: (Array.isArray(d.steps) ? d.steps : []).slice(0, 20).map((s) => {
      const id   = typeof s.id === 'string' ? s.id : randomUUID();
      const prev = existingStepsById.get(id);
      return {
        id,
        type:  STEP_TYPES.includes(s.type) ? s.type : 'written',
        topic: str(s.topic, 200),
        // completion is preserved from the server's copy; only PATCH toggles it
        done:   prev ? !!prev.done : !!s.done,
        result: prev ? (prev.result ?? null) : (s.result ?? null),
      };
    }),
  }));
}

function indexSteps(plan) {
  const m = new Map();
  for (const d of (plan?.days || [])) for (const s of d.steps) m.set(s.id, s);
  return m;
}

// ── List ──────────────────────────────────────────────────────────────────────
planRouter.get('/plans', requireAuth, async (req, res) => {
  try {
    const { plans } = await plansOf(req.account.id);
    res.json({ plans });
  } catch (err) {
    console.error('[plans] list error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────
planRouter.post('/plans', requireAuth, async (req, res) => {
  try {
    const title    = str(req.body?.title, 120);
    const deadline = req.body?.deadline;
    if (!title)             return res.status(400).json({ error: 'title_required' });
    if (!isDateStr(deadline)) return res.status(400).json({ error: 'bad_deadline' });

    const { profile, plans } = await plansOf(req.account.id);
    const now  = Date.now();
    const plan = {
      id:        randomUUID(),
      title,
      deadline,
      maxFights: clampInt(req.body?.maxFights, 1, MAX_FIGHTS_HARD, DEFAULT_MAX_FIGHTS),
      createdAt: now,
      updatedAt: now,
      days:      [],
    };
    plans.push(plan);
    await saveUser(profile);
    res.status(201).json({ plan });
  } catch (err) {
    console.error('[plans] create error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});

// ── Read one ──────────────────────────────────────────────────────────────────
planRouter.get('/plans/:id', requireAuth, async (req, res) => {
  try {
    const { plans } = await plansOf(req.account.id);
    const plan = plans.find((p) => p.id === req.params.id);
    if (!plan) return res.status(404).json({ error: 'not_found' });
    res.json({ plan });
  } catch (err) {
    console.error('[plans] read error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});

// ── Replace structure (days/steps/title/deadline) ───────────────────────────────
planRouter.put('/plans/:id', requireAuth, async (req, res) => {
  try {
    const { profile, plans } = await plansOf(req.account.id);
    const plan = plans.find((p) => p.id === req.params.id);
    if (!plan) return res.status(404).json({ error: 'not_found' });

    if (req.body?.title !== undefined) {
      const t = str(req.body.title, 120);
      if (!t) return res.status(400).json({ error: 'title_required' });
      plan.title = t;
    }
    if (req.body?.deadline !== undefined) {
      if (!isDateStr(req.body.deadline)) return res.status(400).json({ error: 'bad_deadline' });
      plan.deadline = req.body.deadline;
    }
    if (req.body?.maxFights !== undefined) {
      plan.maxFights = clampInt(req.body.maxFights, 1, MAX_FIGHTS_HARD, plan.maxFights ?? DEFAULT_MAX_FIGHTS);
    }
    if (req.body?.days !== undefined) {
      const days = normalizeDays(req.body.days, indexSteps(plan));
      const fights = countFights(days);
      if (fights > plan.maxFights) {
        return res.status(400).json({ error: 'fight_cap', max: plan.maxFights, requested: fights });
      }
      plan.days = days;
    }
    plan.updatedAt = Date.now();
    await saveUser(profile);
    res.json({ plan });
  } catch (err) {
    console.error('[plans] update error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});

// ── Toggle a single step done/undone (atomic; never loses other edits) ──────────
planRouter.patch('/plans/:id/steps/:stepId', requireAuth, async (req, res) => {
  try {
    const { profile, plans } = await plansOf(req.account.id);
    const plan = plans.find((p) => p.id === req.params.id);
    if (!plan) return res.status(404).json({ error: 'not_found' });

    const step = indexSteps(plan).get(req.params.stepId);
    if (!step) return res.status(404).json({ error: 'step_not_found' });

    step.done = req.body?.done !== undefined ? !!req.body.done : !step.done;
    plan.updatedAt = Date.now();
    await saveUser(profile);
    res.json({ plan });
  } catch (err) {
    console.error('[plans] toggle error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});

// Locate a plan + one of its steps for the authenticated user.
async function findStep(userId, planId, stepId) {
  const { profile, plans } = await plansOf(userId);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return { error: 'not_found' };
  const step = indexSteps(plan).get(stepId);
  if (!step) return { error: 'step_not_found' };
  return { profile, plan, step };
}

// ── Generate the AI task/prompt for a guidance step (research/written/speaking) ──
planRouter.post('/plans/:id/steps/:stepId/generate', requireAuth, async (req, res) => {
  try {
    const found = await findStep(req.account.id, req.params.id, req.params.stepId);
    if (found.error) return res.status(404).json({ error: found.error });
    if (found.step.type === 'fight') return res.status(400).json({ error: 'fight_has_no_guidance' });

    const task = await generateTask({
      type:  found.step.type,
      topic: found.step.topic,
      level: req.body?.level === 'b2' ? 'b2' : 'a2-b1',
    });
    found.step.result = { ...(found.step.result || {}), task, taskAt: Date.now() };
    found.plan.updatedAt = Date.now();
    await saveUser(found.profile);
    res.json({ plan: found.plan, task });
  } catch (err) {
    console.error('[plans] generate error:', err.message);
    res.status(err.message === 'no_api_key' ? 503 : 500).json({ error: 'guide_failed' });
  }
});

// ── Get AI feedback on the learner's response to a guidance step ─────────────────
planRouter.post('/plans/:id/steps/:stepId/feedback', requireAuth, async (req, res) => {
  try {
    const found = await findStep(req.account.id, req.params.id, req.params.stepId);
    if (found.error) return res.status(404).json({ error: found.error });
    if (found.step.type === 'fight') return res.status(400).json({ error: 'fight_has_no_guidance' });

    const input = str(req.body?.input, 2000);
    if (!input) return res.status(400).json({ error: 'empty_input' });

    const fb = await giveFeedback({
      type:  found.step.type,
      topic: found.step.topic,
      task:  found.step.result?.task,
      input,
      level: req.body?.level === 'b2' ? 'b2' : 'a2-b1',
    });
    found.step.result = { ...(found.step.result || {}), input, feedback: fb.de, feedback_ar: fb.ar, feedbackAt: Date.now() };
    found.plan.updatedAt = Date.now();
    await saveUser(found.profile);
    res.json({ plan: found.plan, feedback: fb.de, feedback_ar: fb.ar });
  } catch (err) {
    console.error('[plans] feedback error:', err.message);
    const code = err.message === 'no_api_key' ? 503 : err.message === 'empty_input' ? 400 : 500;
    res.status(code).json({ error: code === 503 ? 'no_api_key' : 'guide_failed' });
  }
});

// ── Speaking step: raw audio → transcript → metrics + feedback (cheap models only) ──
planRouter.post('/plans/:id/steps/:stepId/speak',
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '15mb' }),
  requireAuth,
  async (req, res) => {
    try {
      const found = await findStep(req.account.id, req.params.id, req.params.stepId);
      if (found.error) return res.status(404).json({ error: found.error });
      if (found.step.type !== 'speaking') return res.status(400).json({ error: 'not_a_speaking_step' });

      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.length < 1000) return res.status(400).json({ error: 'empty_audio' });
      const durationMs = Math.max(0, parseInt(req.query.ms, 10) || 0);
      const level      = req.query.level === 'b2' ? 'b2' : 'a2-b1';

      // 1) transcribe (gpt-4o-mini-transcribe)
      const transcript = await transcribeAudio(audio, { mime: req.headers['content-type'] || 'audio/wav' });
      // 2) compute metrics deterministically (the model never invents numbers)
      const words   = transcript.split(/\s+/).filter(Boolean).length;
      const wpm     = durationMs > 0 ? Math.round(words / (durationMs / 60000)) : 0;
      const fillers = (` ${transcript.toLowerCase()} `.match(/\b(äh+|ähm+|ehm+|also|halt|irgendwie|quasi|sozusagen)\b/g) ?? []).length;
      // 3) named feedback on the transcript (gpt-4o-mini), German + Arabic
      let feedback = { de: '', ar: '' };
      if (words >= 2) {
        try { feedback = await speakingFeedback({ transcript, wpm, fillers, topic: found.step.topic, level }); }
        catch (e) { console.error('[plans] speaking feedback failed:', e.message); }
      }

      found.step.result = { ...(found.step.result || {}), transcript,
        feedback: feedback.de, feedback_ar: feedback.ar, wpm, fillers, words, durationMs, at: Date.now() };
      found.plan.updatedAt = Date.now();
      await saveUser(found.profile);

      res.json({ transcript, feedback: feedback.de, feedback_ar: feedback.ar,
        metrics: { wpm, fillers, words, durationMs }, plan: found.plan });
    } catch (err) {
      console.error('[plans] speak error:', err.message);
      res.status(err.message === 'no_api_key' ? 503 : 500).json({ error: err.message === 'no_api_key' ? 'no_api_key' : 'speak_failed' });
    }
  });

// ── Delete ──────────────────────────────────────────────────────────────────────
planRouter.delete('/plans/:id', requireAuth, async (req, res) => {
  try {
    const { profile, plans } = await plansOf(req.account.id);
    const i = plans.findIndex((p) => p.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'not_found' });
    plans.splice(i, 1);
    await saveUser(profile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[plans] delete error:', err.message);
    res.status(500).json({ error: 'plans_failed' });
  }
});
