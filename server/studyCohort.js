import express from 'express';
import { activateAccountStudyCohort, publicAccount, rateLimit, requireSession,
  studyCohortInviteStatus } from './auth.js';

export const studyCohortRouter = express.Router();

studyCohortRouter.post('/study-cohort/status',
  rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 500, tag: 'study-status-global', global: true }),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, tag: 'study-status' }),
  async (req, res) => {
    const status = await studyCohortInviteStatus(req.body?.invite);
    res.set('Cache-Control', 'no-store');
    if (!status.valid) return res.json({ valid:false, state:status.state });
    return res.json({ valid: true, cohort: '21-day-study', days: status.invite.days });
  });

studyCohortRouter.post('/study-cohort/claim', requireSession,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, tag: 'study-claim', accountOnly: true,
    keyExtra: (req) => req.account.id }),
  async (req, res) => {
    const account = await activateAccountStudyCohort(req.account, req.body?.invite);
    const view = account ? publicAccount(account) : null;
    res.set('Cache-Control', 'no-store');
    if (!view?.studyAccess) {
      const status = await studyCohortInviteStatus(req.body?.invite);
      const error = status.state === 'expired' ? 'study_invite_expired'
        : status.state === 'used' ? 'study_invite_used'
          : status.state === 'invalid' ? 'invalid_study_invite'
            : 'study_access_unavailable';
      return res.status(403).json({ error });
    }
    return res.json({ account: view });
  });
