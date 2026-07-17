import express from 'express';
import { requireAuth, rateLimit } from './auth.js';
import { analyzePronunciationAttempt, pronunciationFlags } from './pronunciationCore.js';
import { PRONUNCIATION_PROTOCOL_VERSION } from './pronunciationRegistry.js';
import { PRONUNCIATION_RELEASES } from './pronunciationReleases.js';
import { resolveShadowingTarget } from './shadowing.js';

const ATTEMPT = /^[a-zA-Z0-9_-]{8,100}$/u;

async function defaultTargetResolver(accountId, surface, rawTargetId) {
  if (surface !== 'shadowing') return null;
  const match = /^shadowing:(\d{1,10})$/u.exec(String(rawTargetId || ''));
  return match ? resolveShadowingTarget(accountId, match[1]) : null;
}

export function createPronunciationRouter({ env = process.env, detector = null,
  releases = PRONUNCIATION_RELEASES, targetResolver = defaultTargetResolver, auth = requireAuth } = {}) {
  const router = express.Router();

  router.get('/pronunciation/capabilities', auth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const flags = pronunciationFlags(env, req.account.id);
    res.json({ feature: { mode: flags.mode, enabled: flags.enabled, prompted: flags.prompted,
      spontaneous: flags.spontaneous, protocolVersion: PRONUNCIATION_PROTOCOL_VERSION },
      releasedCategories: Object.freeze(Object.keys(releases).filter((id) => releases[id]?.passed === true).sort()),
      claim: 'experimental_phone_clarity_only' });
  });

  router.post('/pronunciation/attempt', auth,
    rateLimit({ windowMs: 60 * 60 * 1000, max: 30, tag: 'pronunciation-attempt', keyExtra: (req) => req.account.id }),
    express.raw({ type: ['audio/wav', 'application/octet-stream'], limit: '4mb' }), async (req, res) => {
      const flags = pronunciationFlags(env, req.account.id);
      if (!flags.enabled) return res.status(404).json({ error: 'not_found' });
      const attemptId = String(req.query.attemptId || ''); const surface = String(req.query.surface || '');
      const requestedTarget = String(req.query.targetId || '');
      if (!ATTEMPT.test(attemptId)) return res.status(400).json({ error: 'invalid_attempt' });
      const binding = await targetResolver(req.account.id, surface, requestedTarget).catch(() => null);
      if (!binding || binding.targetId !== requestedTarget) return res.status(400).json({ error: 'invalid_target' });
      const result = await analyzePronunciationAttempt({ accountId: req.account.id, attemptId,
        targetId: binding.targetId, targetText: binding.targetText, surface, audio: req.body,
        detector, releases, env });
      res.set('Cache-Control', 'no-store');
      return res.json(result);
    });

  return router;
}

export const pronunciationRouter = createPronunciationRouter();
