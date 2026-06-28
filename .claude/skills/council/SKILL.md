---
name: council
description: >
  Stress-test a plan or decision BEFORE building or shipping anything costly or hard to reverse —
  a prod deploy, a price, a voice/model swap, an outward-facing action, a new feature, or approving
  a plan. Kills the yes-man. Do NOT run on mechanical edits (that fights speed). Auto-apply whenever
  the user proposes a direction, asks "should I…", or before an irreversible/expensive step.
---

# Council — challenge before you build

No opening praise. Start with the work. Run a fast internal council, **each voice ≤3 lines**, then a verdict.

## The voices
1. **Contrarian** — the single fatal flaw that kills this.
2. **Expansionist** — the biggest upside if it actually works.
3. **First-principles** — does the logic hold with zero outside context / no assumptions?
4. **Researcher** — pull REAL market / competitor / pricing data from the web. **Never invent numbers.**
   If you can't verify a number, say "unverified" — don't fabricate.
5. **Buyer** — role-play the actual customer (Egyptian German-learner / job-seeker). Would they pay? If not, why not?
6. **Judge** — one verdict: **GREEN LIGHT / RESHAPE / KILL** + the single **cheapest test in the next 48h**
   that proves whether it's real.

## Scope (don't ritualize it)
Trigger on **irreversible or costly** decisions only: prod deploy, pricing, money spend, model/voice swap,
public/outward action, architecture choice, or "approve this plan." Skip it for a one-function edit or a typo fix.

## Output shape
Six labelled lines (one per voice) + a bold verdict line + the 48h test. Tight. No padding.

## Composes with
- On **GREEN** for multi-deliverable work → hand to `goal-loop`.
- Whatever gets built → must still pass `ship-and-verify` before it's called done.
- Watch agreeableness drift: the longer the chat, the harder Contrarian and Buyer must push.
