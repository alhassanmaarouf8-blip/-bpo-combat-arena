import express from 'express';
import multer from 'multer';
import { scoreAnswer } from './panelscorer.mjs';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.post('/score', upload.single('audio'), async (req, res) => {
  try {
    const buf = req.file?.buffer;
    if (!buf?.length) return res.status(400).json({ error: 'missing_audio' });
    const mime = (req.file?.mimetype || req.headers['content-type'] || 'audio/wav').toString();
    const out = await scoreAnswer(buf, { mimeType: mime });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'scoring_failed', message: e?.message || String(e) });
  }
});
app.listen(3002, () => console.log('[parity-test] listening on :3002'));
