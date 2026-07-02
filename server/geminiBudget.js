/**
 * geminiBudget.js — the hard monthly spend ceiling for the paid Gemini Live interview path.
 *
 * Gemini Live native-audio is the ONLY paid piece of the app (everything else is $0). The owner
 * authorized it behind a strict guardrail: a monthly USD cap (default $5), after which live
 * interviews SILENTLY fall back to the free Deepgram→Groq→TTS pipeline — a user is never blocked,
 * and there is never a surprise bill. This module owns that ceiling:
 *
 *   - usageToCostUsd(usageMetadata)  price ONE session-cumulative usage report (pure, tested)
 *   - recordSessionUsage(prev, u)    add this session's delta to the running month total (persisted)
 *   - isCapped() / spentThisMonth()  the gate _handleStartFight checks BEFORE opening a paid session
 *
 * Persistence is a small JSON file (GEMINI_BUDGET_FILE, default server/data/gemini-budget.json).
 * NOTE: Render's disk is ephemeral, so a redeploy resets the meter — the practical exposure is tiny
 * (owner-gated + each fight is wall-clock-capped at 7.5 min), and the failure mode is "the cap
 * resets", never "a user is blocked". The two enforcement points (pre-session refuse + per-report
 * mid-session cut) are the real protection, independent of persistence surviving.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORE  = process.env.GEMINI_BUDGET_FILE || path.join(__dir, 'data', 'gemini-budget.json');
const CAP_USD = Number(process.env.GEMINI_BUDGET_USD || 5);

// USD per token — Gemini 2.5 Flash native audio, verified at ai.google.dev/gemini-api/docs/pricing:
// audio in $3/M, audio out $12/M, text in $0.50/M, text out $2/M.
const RATE = { textIn: 0.5e-6, audioIn: 3e-6, textOut: 2e-6, audioOut: 12e-6 };

function monthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

let state = { month: monthKey(), spentUsd: 0 };
try {
  const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  if (s && typeof s.spentUsd === 'number' && typeof s.month === 'string') state = s;
} catch { /* first run / unreadable → fresh month at 0 */ }

function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(state));
  } catch (e) { /* best-effort; a write failure must never break an interview */ }
}

function rollIfNewMonth() {
  const m = monthKey();
  if (state.month !== m) { state = { month: m, spentUsd: 0 }; persist(); }
}

// Sum a *TokensDetails array into { audio, text } token counts.
function splitModality(details) {
  let audio = 0, text = 0;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (String(d.modality || '').toUpperCase() === 'AUDIO') audio += d.tokenCount || 0;
      else text += d.tokenCount || 0;
    }
  }
  return { audio, text };
}

/**
 * Price one Gemini usageMetadata object (session-cumulative) → USD. Pure; the unit tests pin this.
 * Prefers per-modality token detail; falls back to treating the bulk prompt/response as audio
 * (the dominant, most-expensive case) so the cap can only ever OVER-estimate, never undershoot.
 */
export function usageToCostUsd(u) {
  if (!u) return 0;
  const p = splitModality(u.promptTokensDetails);
  const r = splitModality(u.responseTokensDetails);
  let inAudio = p.audio, inText = p.text, outAudio = r.audio, outText = r.text;
  if (!u.promptTokensDetails   && u.promptTokenCount)   inAudio  = u.promptTokenCount;
  if (!u.responseTokensDetails && u.responseTokenCount) outAudio = u.responseTokenCount;
  // Native-audio "thinking" tokens are billed at the output rate but sit outside the detail arrays.
  const thoughts = (u.thoughtsTokenCount || 0) * RATE.textOut;
  return inAudio * RATE.audioIn + inText * RATE.textIn + outAudio * RATE.audioOut + outText * RATE.textOut + thoughts;
}

export function capUsd() { return CAP_USD; }

export function spentThisMonth() { rollIfNewMonth(); return state.spentUsd; }

export function isCapped() { rollIfNewMonth(); return state.spentUsd >= CAP_USD; }

/**
 * Fold one session-cumulative usage report into the month total. `prevSessionUsd` is the last
 * priced total FOR THE SAME SESSION (reports are cumulative, so we add only the delta).
 * Returns { sessionUsd, deltaUsd, monthUsd, capUsd, capped }.
 */
export function recordSessionUsage(prevSessionUsd, usageMetadata) {
  rollIfNewMonth();
  const sessionUsd = usageToCostUsd(usageMetadata);
  const prev = prevSessionUsd || 0;
  // Reports are session-cumulative (verified empirically in the $5 metered harness test — priced
  // deltas matched real billing), so the delta is what this report added. HEDGE: if a report ever
  // prices BELOW the previous total (semantics turned per-turn incremental, or a counter reset),
  // count the WHOLE report — the cap may only ever over-estimate, never undershoot.
  const deltaUsd = sessionUsd >= prev ? sessionUsd - prev : sessionUsd;
  state.spentUsd += deltaUsd;
  persist();
  return { sessionUsd, deltaUsd, monthUsd: state.spentUsd, capUsd: CAP_USD, capped: state.spentUsd >= CAP_USD };
}

// Test-only: reset the in-memory meter (does not delete the file unless persist() is called after).
export function _resetForTest(spentUsd = 0) { state = { month: monthKey(), spentUsd }; }

export default { usageToCostUsd, capUsd, spentThisMonth, isCapped, recordSessionUsage, _resetForTest };
