---
name: session-handoff
description: >
  When a session gets long (~¼ of the context window) or before any /clear, write a tight handoff so a
  fresh window loses nothing. Auto-apply when the chat is long, when the user says /clear or "start fresh,"
  or when you notice your own quality degrading.
---

# Session-handoff — survive the context reset

You degrade well before the window is full. Reset deliberately instead of leaning on auto-compact.

## Write this block (tight enough to paste into a fresh window with zero loss)

```
SESSION HANDOFF — <date>
WORKING ON:        <the goal, one line>
DECISIONS LOCKED:  <choices made that should not be re-litigated>
SHIPPED:           <what is live/verified, with build hash or commit>
KEY FILES + STATE: <path — current state / what changed>
VERIFICATION:      <what's verified live vs only built vs unverifiable-and-human-gated>
OPEN QUESTIONS:    <decisions still needing the user>
PICK UP AT:        <the exact next action>
```

## Rules
- Be specific: real file paths, real commit/build hashes, real counts. No vibes.
- Carry the **verification status** forward explicitly — especially anything flagged "I can't verify this"
  so the next window doesn't re-ship it blind (see `ship-and-verify` release gate).
- Prefer **handoff-then-clear** over auto-compact. Built-ins: `/context`, `/clear`, `/copy`.

## Composes with
- Mid `goal-loop`: snapshot the bar + which sub-deliverables are done so the loop resumes cleanly.
- After `ship-and-verify`: copy the exact written/built/deployed/verified state into SHIPPED + VERIFICATION.
