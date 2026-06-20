import express from 'express';
import multer from 'multer';
import { scoreAnswer } from './panelscorer.mjs';
import { verifyToken, getAccountById, dailyMinutesFor } from '../auth.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const DEFAULT_ENABLED = process.env.PANEL_SCORER_ENABLED === 'true';

function isSegmentEnabled() {
  return DEFAULT_ENABLED && process.env.PANEL_SCORER_ENABLED !== 'false';
}

router.post('/score', upload.single('audio'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isSegmentEnabled()) {
    return res.status(501).json({ error: 'disabled' });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'auth_required' });
  const account = await getAccountById(payload.uid);
  if (!account) return res.status(401).json({ error: 'invalid_account' });

  const minutes = dailyMinutesFor(account);
  if (minutes <= 0) return res.status(402).json({ error: 'daily_limit' });

  if (!req.file || !req.file.buffer?.length) {
    return res.status(400).json({ error: 'missing_audio' });
  }

  const level = (req.body.level || 'a2-b1').toString();
  const scenarioId = (req.body.scenarioId || 'general').toString();
  const mimeType = (req.file.mimetype || req.headers['content-type'] || 'audio/wav').toString();

  try {
    const result = await scoreAnswer(req.file.buffer, { level, scenarioId, mimeType, userId: account.id });
    return res.json(result);
  } catch (error) {
    console.error(`[scoreRouter] scoring failed user=${account.id}: ${error.message}`);
    return res.status(502).json({ error: 'scoring_failed', message: error.message });
  }
});

export { router as scoreRouter };
