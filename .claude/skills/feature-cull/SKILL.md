---
name: feature-cull
description: Delete duplicate / off-loop features from OMNI-PERFORM so each survivor has real depth (Musk's algorithm). TRIGGER — owner says "cut what repeats", "delete non-vital", "too many features", "depth not breadth", "analyze as Elon Musk", or any feature-consolidation/decluttering pass.
---

# feature-cull — dedupe toward depth (Musk's algorithm)

Owner's standing intent (2026-07-05): **fewer features, each deep** — not many shallow overlapping ones. "The best part is no part." Every surface must sit ON the core value loop or it's a delete candidate.

## The one sacred thing — the core value loop
> Interview with a real German boss → honest "am I hireable?" verdict → the ONE thing to fix → drill it → back to the interview. Repeat until hired.

Anything that **duplicates** a loop step, **forks the "what do I do now?" decision**, or is **off-loop vanity** is a cut candidate.

## Steps
1. **Map, don't explore.** Read `app-map` skill first. Inventory features from `client/src/App.jsx` imports + the `_overlays` array + the Übungen grid + footer list. Grep, don't read whole files.
2. **Classify each feature:**
   - **Dead** — mounted but `{false &&}` / gated off / never renders (e.g. a `!SOME_FLAG` branch where the flag is always true). Highest-confidence cut.
   - **Duplicate router** — a second/third thing answering "what's next?" (the live brain `BrainGuide` is the single source; kill competing routers).
   - **Off-loop vanity** — cert, leaderboard, badges: don't get anyone hired.
   - **Passive** — watch-only (video). Cut LAST — Musk's "don't delete what you'll add back 10%"; it may be the only teaching layer.
   - **Vital/deep** — the interview, the honest verdict, the brain, the daily-habit engine, and the production drills. KEEP.
3. **Delete + REROUTE (don't just delete).** If a weakness/skill pointed at the cut feature, repoint it to the deep survivor (e.g. grammar/complexity → Satzbau-Schmiede, not a generic lesson map). Check for couplings: pricing copy, skill→drill maps (`TRAIN_FOR_SKILL`, Debrief `onTrainSkill`, HireVerdict `onTrain`), WS message strings.
4. **Remove every site:** import, `useState`, `_overlays` registry entry, the `|| xOpen` in anyOverlayOpen, the overlay render, all entry buttons, then `rm` the file.
5. **One bounded cut per commit.** Client-only, explicit-path (`git add client/src/App.jsx <file>`) — a concurrent session is often live in `server/`; never `git add -A`.

## Verify (all must pass)
`(cd client && npm run build)` · `npx eslint client/src/App.jsx` (0 undef/unused) · `npm run design-lint` · Guardian green · `node scripts/qa/screenshot.mjs <url> --signup` (0 page errors, home renders). Bundle should shrink — report the kB.

## Gotchas
- Bundle-size delta is your proof a cut was real (this pass: 393.6→343.7kB, −13%).
- Never author masri — if a cut touches Arabic copy, trim only, keep existing words, flag OWNER-AR.
- Leave orphaned server routes for a separate ship if another session is editing `server/`.
- A "briefing" is not always THE WeeklyBriefing — `showBriefing` is the live pre-fight CS card. Grep the exact symbol before deleting.
- Record the cull to memory ([[omni-perform-feature-cull-musk]]) so nobody re-adds the dead ones.
