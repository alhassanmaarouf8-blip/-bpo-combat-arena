---
name: subagent-contract
description: The standing contract for ANY subagent working in this repo. Orchestrators - point agents here with ONE line ("Read .claude/skills/subagent-contract/SKILL.md and follow it") instead of pasting rules into every prompt. Agents - this is binding.
---

# Subagent contract — OMNI-PERFORM (bpo-combat-arena)

You are working on a LIVE product with real users (learners fighting for jobs). Every rule below
exists because breaking it once hurt a real person or the owner's trust.

## Before you start
1. Read `.claude/skills/app-map/SKILL.md` — the codebase map (saves you ~30k tokens of exploring).
2. UI task? Also read `.claude/skills/design-system/SKILL.md` — the visual law.
3. Learner-facing numbers/verdicts/corrections? Also `.claude/skills/feedback-accuracy-doctrine/SKILL.md`.
4. ANYTHING learner-facing (audio, text, UI, feedback)? Also `.claude/skills/owner-doctrine/SKILL.md`
   — the owner's 8 laws + 60-second pre-ship checklist. It predicts his verdict before he gives it;
   a violation there WILL come back as an angry bug report.
5. Touch ONLY the files your task names. If other files need changes, SAY so in your report instead.

## While you work
- **NO git commands** (no add/commit/push/checkout) unless your task explicitly grants them.
  The orchestrator reviews and ships.
- Match the surrounding code: inline styles, comment voice (WHY-comments, CAPS emphasis), naming.
- **Never author Arabic/masri.** Existing Arabic strings stay verbatim; new spots get German +
  `{/* OWNER-AR slot */}`.
- **Zero spend**: no new dependencies, no paid/external services. Free LanguageTool + public
  GitHub API are the only allowed network calls (plus the app's own endpoints).
- No employer/company names anywhere. No fabricated metrics, content, or test output.
- Honesty over completeness: if a task can't be done truthfully (missing data, wrong assumption
  in the brief), skip it and report why — never fake it.

## Before you claim "done"
Run from repo root and PASTE the real one-line results in your report:
- `npm run lint`
- `npm run design-lint`
- `(cd client && npm run build)` — if you touched client/
- `node --test server/*.test.mjs server/scoring/*.test.mjs server/brain/*.test.mjs` — if you touched server/
- `node scripts/german-check.mjs <files>` — if you changed German content (fix REAL flags; known
  false positives are listed in app-map)
A red gate you can't fix = report it red. Never hand over a broken tree silently.

## Your report (final message — it is parsed, not read casually)
1. What changed, per file, with line-ish locations.
2. What you skipped and why.
3. Real gate outputs (one line each).
