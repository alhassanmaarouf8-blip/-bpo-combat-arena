# INTENT.md — the owner's standing truth (read this FIRST, every session)

> Serve my **intent**, not my literal words. I write fast and messy (typos, one-liners, mid-task
> redirects). If a message is vague, contradictory, or tiny ("continue", "go", "make it real"),
> resolve it against THIS file + `STATE.md` + the top QUEUED item in `ROADMAP.md`, state the
> one-line plan, and proceed. Only stop to ask when the choice is irreversible or genuinely
> ambiguous between two very different intents.

## Mission
Make OMNI-PERFORM's **live German interview feel more human than a real HR panel**. The interview
IS the product. A learner must trust it to prepare them for a real German BPO/customer-service
interview so they get hired.

## Definition of "real / natural" (the bar the agent self-checks against)
The interview passes when:
- In the **first 10 seconds** a German speaker can't tell it's AI (no scripted-sounding openers,
  natural onset like "Hm… also…", human pacing).
- The boss **remembers the candidate's exact words** and reuses them (callback / contradiction /
  the next question grows from the last answer) — via the `claimLedger`.
- The boss has **emotion that reaches the words** (`bossEmotion` drifts with how the candidate is
  doing) — delivery only; the **scorer stays mood-blind so grading is always fair**.
- It **ends like a human** (personal thanks + at most ONE verified observation + warm goodbye),
  never just stops.
- Register fits the persona (**Angemessenheit**) — a strict director never says casual "gibt's/ne?".
See `.claude/skills/naturalness/SKILL.md` for the exact levers. This is the current #1 focus.

## Money goal
Get to first paying users. **Fulfillment must not depend on my manual step** — automate plan
activation on payment (keep the manual Vodafone-Cash flow as the no-card fallback). Coaching /
digital products are allowed side-revenue but the app is the engine.

## Hard rules (non-negotiable — mirror of owner-doctrine)
- **$0 only.** No new paid service (one approved exception: ElevenLabs voice). No new paid deps.
- **Never name any employer/company.** No fabricated metrics. Praise/blame NEVER invented — both
  are quote-gated and honesty-gated.
- **Never author Egyptian-Arabic (masri)** — leave OWNER-AR slots for me.
- German shown to learners must pass **german-check**; verify voice feel with **hear-voice**.
- **Never push to main.** One bounded item per ship, on `feature/<slug>`. All gates green
  (lint, design-lint, tests, client build). Verify by proof + independent agent, not my approval.
- Don't touch auth / payment gating / pricing / workflows unless the item explicitly says so.
- Audio-loop changes (barge-in, mic-during-boss) = the ONE high-risk area → OFF-by-default flag +
  my live test.

## My working contract with you (the fix for 33 days of thrash)
1. **One bounded item per session.** Park new ideas in `ROADMAP.md`; finish the current one first.
2. Every task gets a **Done-when** acceptance test before you start.
3. Continuity lives in `STATE.md`, not in a 4,000-message thread. Read it first, rewrite it last.
4. Proceed on reversible work without waiting for permission. Surface conflicts with this file.
