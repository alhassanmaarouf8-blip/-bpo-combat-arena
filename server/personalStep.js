/**
 * personalStep.js — Phase 4: the personal step behind "PERSÖNLICHEN SCHRITT ÖFFNEN".
 *
 * One record per analyzed interview (KV ns 'personalstep', key user:session): the generated
 * 3-stage exercise set + server-tracked rep progress. Completion is SERVER-confirmed (every
 * stage-1 answer and every stage-2/3 spoken rep is validated here), and completing the block
 * flips the Phase-3 bottleneck record to status 'drilled' — which is what unlocks the
 * RE-INTERVIEW button and arms the mastery dampener + retested/closed transitions.
 *
 *   GET  /api/personal-step[?sessionId=]     → brief (bottleneck+evidence+why) + sanitized set + progress
 *   POST /api/personal-step/answer           → stage-1 which-is-correct, validated server-side
 *   POST /api/personal-step/speak            → stage-2/3 audio rep: Groq-Whisper transcript +
 *                                              deterministic target check (SAG-ES-RICHTIG doctrine:
 *                                              lenient, never wrongly "falsch"; 2 misses = geübt)
 *   POST /api/personal-step/regenerate       → explicit fresh set (the ONLY regeneration path)
 *
 * Solutions never leave the server before the learner answers: stage-1 options are shuffled
 * deterministically and unlabeled; stage-3's must_use line + indicator tokens return only after
 * the attempt (the transfer question must stay a covert test).
 */
import express from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, rateLimit } from './auth.js';
import { dbEnabled, kvGet, kvSet } from './db.js';
import { loadBottlenecks, saveBottlenecks } from './bottleneckStore.js';
import { generateExerciseSet, fallbackSet, historyEntries } from './exerciseGenerator.js';
import { voicedDurationMs } from './audioGuard.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'personalstep');
const NS  = 'personalstep';
const STT_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MAX_SPEAK_ATTEMPTS = 2;   // after 2 honest misses a rep counts as "geübt" — STT noise must never trap the learner

const safe = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
const key  = (u, s) => `${safe(u)}__${safe(s)}`;

export async function loadStep(userId, sessionId) {
  if (dbEnabled()) return (await kvGet(NS, `${safe(userId)}:${safe(sessionId)}`)) ?? null;
  try { return JSON.parse(await readFile(path.join(DIR, `${key(userId, sessionId)}.json`), 'utf8')); }
  catch { return null; }
}
export async function saveStep(step) {
  step.updatedAt = Date.now();
  if (dbEnabled()) { await kvSet(NS, `${safe(step.userId)}:${safe(step.sessionId)}`, step); return step; }
  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, `${key(step.userId, step.sessionId)}.json`), JSON.stringify(step), 'utf8');
  return step;
}

// ── Generation lifecycle (fired from analysisRunner right after the bottleneck is selected) ────
export async function startExerciseGeneration({ userId, sessionId, bottleneck, level, cairoDay }) {
  const step = {
    v: 1, userId, sessionId, cairoDay, code: bottleneck.code, status: 'generating',
    createdAt: Date.now(), progress: {}, attempts: {}, completed: false,
  };
  await saveStep(step);
  try {
    const { set, usage } = await generateExerciseSet({
      bottleneck, evidence: bottleneck.evidenceQuotes || [], level,
      exerciseHistory: bottleneck.exerciseHistory || [], sessionId,
    });
    step.set = set; step.usage = usage; step.status = 'ready';
  } catch (err) {
    console.error(`[personalStep] generation failed session=${sessionId}: ${err.message} — falling back`);
    const fb = fallbackSet({ bottleneck, evidence: bottleneck.evidenceQuotes || [] });
    if (fb) { step.set = fb; step.status = 'fallback'; }
    else step.status = 'failed';
  }
  await saveStep(step);
  // Novelty across days: this set's item texts join the bottleneck record's exerciseHistory,
  // so a repeat-day generation is FORBIDDEN from reusing them (owner spec §3 of Phase 3).
  if (step.set) {
    try {
      const state = await loadBottlenecks(userId);
      const rec = (state.records || []).find((r) => r.sessionId === sessionId);
      if (rec) {
        rec.exerciseHistory = [...(rec.exerciseHistory || []), ...historyEntries(step.set)].slice(-60);
        await saveBottlenecks(userId, state);
      }
    } catch (e) { console.error(`[personalStep] history append failed: ${e.message}`); }
  }
  return step;
}

// ── Grading helpers (deterministic; SAG-ES-RICHTIG lenient doctrine) ───────────────────────────
const tokenize = (s) => String(s ?? '').toLowerCase().normalize('NFC')
  .replace(/[^a-zäöüß0-9\s]/gi, ' ').split(/\s+/).filter((t) => t.length >= 2);

/** Coverage of target content tokens in the transcript, 1-edit-tolerant for tokens ≥4 chars. */
export function targetCoverage(target, heard) {
  const tt = tokenize(target).filter((t) => t.length >= 3);
  if (!tt.length) return 1;
  const ht = new Set(tokenize(heard));
  const near = (t) => {
    if (ht.has(t)) return true;
    if (t.length < 4) return false;
    for (const h of ht) {
      if (Math.abs(h.length - t.length) > 1) continue;
      let diff = 0, i = 0, j = 0;
      while (i < t.length && j < h.length) {
        if (t[i] === h[j]) { i++; j++; continue; }
        if (++diff > 1) break;
        if (t.length > h.length) i++;
        else if (h.length > t.length) j++;
        else { i++; j++; }
      }
      if (diff + (t.length - i) + (h.length - j) <= 1) return true;
    }
    return false;
  };
  return tt.filter(near).length / tt.length;
}

export function gradeStage2(target, heard) {
  return targetCoverage(target, heard) >= 0.7;
}
export function gradeStage3(indicatorTokens, heard, voicedMs) {
  const ht = new Set(tokenize(heard));
  const hit = (indicatorTokens || []).some((tok) => tokenize(tok).every((t) => ht.has(t)));
  // Credit-only fallback: a sustained, substantive answer is never called a failure outright.
  const sustained = voicedMs >= 12_000 && tokenize(heard).length >= 15;
  return hit || sustained;
}

async function transcribeGroq(buffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('no_api_key');
  const ext = (String(mimeType).split('/')[1] || 'wav').split(';')[0].trim() || 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimeType }), `rep.${ext}`);
  fd.append('model', STT_MODEL);
  fd.append('language', 'de');
  fd.append('response_format', 'text');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Groq STT ${res.status}`);
    return (await res.text()).trim();
  } finally { clearTimeout(timer); }
}

// ── Progress + completion ──────────────────────────────────────────────────────────────────────
export function allItems(set) {
  return [...(set?.stage1 || []), ...(set?.stage2 || []), ...(set?.stage3 || [])];
}
export function isComplete(step) {
  if (!step?.set) return false;
  return allItems(step.set).every((i) => (step.progress?.[i.id] || 0) >= (i.reps || 1));
}

async function markDrilledIfComplete(step) {
  if (step.completed || !isComplete(step)) return false;
  step.completed = true;
  step.completedAt = Date.now();
  try {
    const state = await loadBottlenecks(step.userId);
    const rec = (state.records || []).find((r) => r.sessionId === step.sessionId);
    if (rec && rec.status === 'open') { rec.status = 'drilled'; rec.drilledAt = Date.now(); }
    await saveBottlenecks(step.userId, state);
  } catch (e) { console.error(`[personalStep] drilled status failed: ${e.message}`); }
  console.log(`[personalStep] BLOCK COMPLETE  user=${step.userId}  session=${step.sessionId}  code=${step.code} → re-interview unlocked`);
  return true;
}

// ── Sanitization: what the client may see before answering ─────────────────────────────────────
const shuffleFirst = (sessionId, id) =>
  ([...`${sessionId}${id}`].reduce((s, c) => s + c.charCodeAt(0), 0) % 2) === 0;

export function sanitizedSet(step) {
  const s = step.set;
  if (!s) return null;
  return {
    title_de: s.title_de, title_ar: s.title_ar, fallback: !!s.fallback,
    totalReps: s.totalReps, estMinutes: s.estMinutes,
    stage1: (s.stage1 || []).map((i) => ({
      id: i.id, reps: i.reps, repsDone: step.progress?.[i.id] || 0,
      options: shuffleFirst(step.sessionId, i.id) ? [i.faulty, i.corrected] : [i.corrected, i.faulty],
    })),
    stage2: (s.stage2 || []).map((i) => ({
      id: i.id, reps: i.reps, repsDone: step.progress?.[i.id] || 0,
      instruction_de: i.instruction_de, instruction_ar: i.instruction_ar,
      prompt: i.prompt, target: i.target, why_de: i.why_de, why_ar: i.why_ar,
    })),
    stage3: (s.stage3 || []).map((i) => ({
      id: i.id, reps: i.reps, repsDone: step.progress?.[i.id] || 0,
      frage: i.frage, countdownS: i.countdownS, why_de: i.why_de, why_ar: i.why_ar,
      // must_use + indicator_tokens deliberately absent: the transfer question is a covert test.
    })),
  };
}

// ── Router ─────────────────────────────────────────────────────────────────────────────────────
export const personalStepRouter = express.Router();

async function stepForRequest(req, res) {
  let sessionId = String(req.query.sessionId || req.body?.sessionId || '');
  if (!sessionId) {
    // No session named → the newest bottleneck's step (the "personal step for today").
    const state = await loadBottlenecks(req.account.id);
    sessionId = (state.records || []).at(-1)?.sessionId || '';
  }
  if (!sessionId) { res.status(404).json({ error: 'no_personal_step' }); return null; }
  const step = await loadStep(req.account.id, sessionId);
  if (!step) { res.status(404).json({ error: 'no_personal_step' }); return null; }
  return step;
}

personalStepRouter.get('/personal-step',
  requireAuth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120, tag: 'personal-step', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const step = await stepForRequest(req, res);
      if (!step) return;
      const state = await loadBottlenecks(req.account.id);
      const rec = (state.records || []).find((r) => r.sessionId === step.sessionId) || null;
      return res.json({
        sessionId: step.sessionId, status: step.status, completed: !!step.completed,
        reinterviewUnlocked: !!step.completed,
        bottleneck: rec ? {
          code: rec.code, category: rec.category, subcode: rec.subcode, why: rec.why,
          evidenceQuotes: rec.evidenceQuotes, runnerUps: rec.runnerUps,
          repeat: rec.repeat, dayStreak: rec.dayStreak, status: rec.status,
        } : null,
        set: sanitizedSet(step),
      });
    } catch (err) {
      console.error('[personalStep] get failed:', err.message);
      return res.status(500).json({ error: 'personal_step_failed' });
    }
  });

personalStepRouter.post('/personal-step/answer',
  requireAuth, express.json(),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 200, tag: 'personal-step-answer', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const step = await stepForRequest(req, res);
      if (!step) return;
      const item = (step.set?.stage1 || []).find((i) => i.id === String(req.body?.itemId || ''));
      if (!item) return res.status(400).json({ error: 'unknown_item' });
      const choice = String(req.body?.choice || '');
      const correct = choice.trim() === item.corrected.trim();
      if (correct) step.progress[item.id] = Math.min(item.reps, (step.progress[item.id] || 0) + 1);
      const unlocked = await markDrilledIfComplete(step);
      await saveStep(step);
      return res.json({ correct, corrected: item.corrected, faulty: item.faulty,
        why_de: item.why_de, why_ar: item.why_ar,
        repsDone: step.progress[item.id] || 0, completed: !!step.completed, reinterviewUnlocked: !!step.completed || unlocked });
    } catch (err) {
      console.error('[personalStep] answer failed:', err.message);
      return res.status(500).json({ error: 'answer_failed' });
    }
  });

personalStepRouter.post('/personal-step/speak',
  requireAuth,
  express.raw({ type: ['audio/wav', 'audio/webm', 'application/octet-stream'], limit: '4mb' }),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 90, tag: 'personal-step-speak', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const step = await stepForRequest(req, res);
      if (!step) return;
      const itemId = String(req.query.itemId || '');
      const item = allItems(step.set).find((i) => i.id === itemId);
      if (!item || itemId.startsWith('s1')) return res.status(400).json({ error: 'unknown_item' });
      if (!req.body?.length || req.body.length < 1200) return res.status(400).json({ error: 'no_audio' });

      const voicedMs = voicedDurationMs(req.body) || 0;
      // A near-silent clip is NOT an attempt (E2E verification 07-20: two silent posts walked the
      // MAX_SPEAK_ATTEMPTS ladder and completed a rep — farming the server-confirmed unlock).
      // The learner sees an honest "speak, please"; nothing is counted or consumed.
      if (voicedMs < 800) return res.status(422).json({ error: 'no_voice' });   // 800ms: still kills silence-farming, never traps a short honest answer
      const heard = await transcribeGroq(req.body, req.headers['content-type'] || 'audio/wav');
      const stage3 = itemId.startsWith('s3');
      const passed = stage3
        ? gradeStage3(item.indicator_tokens, heard, voicedMs)
        : gradeStage2(item.target, heard);

      const attempts = (step.attempts[itemId] = (step.attempts[itemId] || 0) + 1);
      let counted = passed;
      let practiced = false;   // honest label: counted after MAX attempts without a clean pass
      if (!passed && attempts >= MAX_SPEAK_ATTEMPTS) { counted = true; practiced = true; }
      if (counted) {
        step.progress[itemId] = Math.min(item.reps, (step.progress[itemId] || 0) + 1);
        step.attempts[itemId] = 0;
      }
      const unlocked = await markDrilledIfComplete(step);
      await saveStep(step);
      return res.json({
        passed, practiced, heard,
        ...(stage3 ? { must_use_de: item.must_use_de, must_use_ar: item.must_use_ar } : { target: item.target }),
        why_de: item.why_de, why_ar: item.why_ar,
        repsDone: step.progress[itemId] || 0, reps: item.reps,
        completed: !!step.completed, reinterviewUnlocked: !!step.completed || unlocked,
      });
    } catch (err) {
      console.error('[personalStep] speak failed:', err.message);
      return res.status(err.message === 'no_api_key' ? 503 : 500).json({ error: 'speak_failed' });
    }
  });

// Explicit fresh set — the ONLY regeneration path (spec §5: cache per interview otherwise).
personalStepRouter.post('/personal-step/regenerate',
  requireAuth, express.json(),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 4, tag: 'personal-step-regen', keyExtra: (req) => req.account.id }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const step = await stepForRequest(req, res);
      if (!step) return;
      const state = await loadBottlenecks(req.account.id);
      const rec = (state.records || []).find((r) => r.sessionId === step.sessionId);
      if (!rec) return res.status(404).json({ error: 'no_bottleneck' });
      const fresh = await startExerciseGeneration({
        userId: req.account.id, sessionId: step.sessionId, bottleneck: rec,
        level: req.body?.level || 'b2', cairoDay: step.cairoDay,
      });
      return res.json({ status: fresh.status, set: sanitizedSet(fresh) });
    } catch (err) {
      console.error('[personalStep] regenerate failed:', err.message);
      return res.status(500).json({ error: 'regenerate_failed' });
    }
  });

export default { personalStepRouter, startExerciseGeneration, loadStep, saveStep, isComplete,
  gradeStage2, gradeStage3, targetCoverage, sanitizedSet, allItems };
