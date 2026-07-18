/**
 * pronunciationGold.js — consent-gated gold-recording collection (owner order 2026-07-18: the app's
 * own users become the pronunciation gold corpus).
 *
 * POST /api/pronunciation-gold/clip  (multipart-free: JSON { itemId, consent:true, audioB64, selfLevel })
 *   - Enabled ONLY when PRON_GOLD_COLLECT=1 (default OFF — inert in prod until the owner flips it).
 *   - Requires explicit consent:true in the SAME request (no consent, no storage — ever).
 *   - Stores under an OPAQUE id (no account id, no name, no email): gold-<sha12>.webm + sidecar JSON
 *     { itemId, selfLevel, receivedAt, sha256 }. Deletion = removing the pair (deletable-on-request).
 *   - This is NOT production-audio persistence: consent is the licence; nothing else is kept.
 * GET /api/pronunciation-gold/manifest (admin key) — inventory for the offline eval pipeline.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GOLD_ITEMS = [
  'hoehle', 'hoelle', 'miete', 'mitte', 'bieten', 'bitten', 'ofen', 'offen', 'staat', 'stadt',
];
const MAX_B64 = 2_500_000; // ~1.8MB audio ≈ plenty for one carrier sentence, tiny enough to be safe

export function goldEnabled() { return process.env.PRON_GOLD_COLLECT === '1'; }

export function createPronunciationGoldRouter({ dir = path.resolve('data/pron-gold'), adminKey = process.env.ADMIN_KEY } = {}) {
  const r = Router();

  r.post('/pronunciation-gold/clip', (req, res) => {
    if (!goldEnabled()) return res.status(404).json({ error: 'disabled' });
    const { itemId, consent, audioB64, selfLevel } = req.body || {};
    if (consent !== true) return res.status(400).json({ error: 'consent_required' });
    if (!GOLD_ITEMS.includes(itemId)) return res.status(400).json({ error: 'unknown_item' });
    if (typeof audioB64 !== 'string' || !audioB64 || audioB64.length > MAX_B64) {
      return res.status(400).json({ error: 'bad_audio' });
    }
    let buf;
    try { buf = Buffer.from(audioB64, 'base64'); } catch { return res.status(400).json({ error: 'bad_audio' }); }
    if (buf.length < 4000) return res.status(400).json({ error: 'too_short' }); // no empty/click clips
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    fs.mkdirSync(dir, { recursive: true });
    const id = `gold-${sha.slice(0, 12)}`;
    fs.writeFileSync(path.join(dir, `${id}.webm`), buf);
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      itemId, selfLevel: ['A2', 'B1', 'B2'].includes(selfLevel) ? selfLevel : 'unknown',
      receivedAt: new Date().toISOString(), sha256: sha,
    }));
    return res.json({ ok: true, id }); // opaque id only — nothing identity-linked
  });

  r.get('/pronunciation-gold/manifest', (req, res) => {
    if (!adminKey || req.query.key !== adminKey) return res.status(403).json({ error: 'forbidden' });
    let rows = [];
    try {
      rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => ({ id: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
    } catch { /* empty dir = empty manifest */ }
    return res.json({ count: rows.length, rows });
  });

  return r;
}
