# OMNI-PERFORM (bpo-combat-arena) — auto-loaded operating instructions

German BPO interview trainer for the Egyptian market. **Frontend** `client/` → Vercel. **Backend**
`server/` → Render. **Push to `main` = deploy both.** This file auto-loads; the skills below do NOT —
invoke them. Written so any model (Opus 4.8 or later) operates this repo at full level.

## FIRST, before anything else (the intent layer — added 2026-07-09):
- Read **`INTENT.md`** (the owner's standing truth) + **`STATE.md`** (3-line continuity — replaces
  "continue the last session") + invoke skill **`owner-intent`**. The owner writes fast/messy and
  redirects mid-task: serve his INTENT, resolve tiny/vague prompts to the ONE next step in
  `STATE.md` (else the top QUEUED `ROADMAP.md` item), state the one-line plan, proceed on reversible
  work. Finish ONE bounded item, then rewrite `STATE.md`.

## Read/invoke BEFORE the matching work (don't explore cold — these replace exploration):
- **Any task here:** skill **`app-map`** (where everything lives) + **`owner-doctrine`** (predicts the
  owner's verdict — his 8 laws; read before ANYTHING learner-facing).
- **Any client/UI change:** skill **`design-system`** (blue+orange, ONE orange per screen, Inter,
  44px targets) + run `npm run design-lint`.
- **Any German content:** `node scripts/german-check.mjs <files>` (known false positives noted in
  app-map).
- **Anything learner-facing** (a number, verdict, correction): skill
  **`feedback-accuracy-doctrine`** — deterministic graders only, never blame a truncated/mis-heard
  turn on the learner, honest-when-thin.
- **"What should the student do next" logic:** skill **`bottleneck-doctrine`**.
- **Shipping:** skill **`ship`** / **`ship-and-verify`** — "done" = deployed AND verified live.

## Hard owner rules (non-negotiable — full doctrine in `.claude/skills/owner-doctrine`)
- **Zero spend, ever** (one owner-approved exception: ElevenLabs voice). No new paid deps.
- **Never name any employer/company.** No fabricated metrics. Nothing robotic (native voice or
  silence — no browser speechSynthesis).
- **Never author Egyptian-Arabic (masri)** — leave OWNER-AR slots for the owner to fill.
- **Verify by proof, one bounded change per ship, Guardian must go green.**

## Gotchas that keep biting
- **Shared OneDrive tree** — other sessions may be live-editing. `git status` + check for recent
  edits FIRST; stage files BY NAME, never `git add -A`. Glob/Grep time out on OneDrive — use
  PowerShell or targeted Read.
- **Render deploys are PATH-FILTERED** — backend `/health` build stamp only advances on `server/`
  commits. For client/docs-only ships, verify the frontend `<meta name="build">` + Guardian; don't
  poll Render. (See skill `launch-ops`.)
- **Verify a deploy is live:** backend `curl -s .../health` → `build`; frontend
  `curl -s bpo-combat-arena.vercel.app | grep 'meta name="build"'`; both == `git rev-parse --short HEAD`.
- Guardian red does NOT block Render/Vercel deploys.

## Queues
- **`ROADMAP.md`** = the single owner-approved build queue (nightly builder reads it). Don't invent
  items. **Launch/distribution** state + owner checklist = skill `launch-ops`.
