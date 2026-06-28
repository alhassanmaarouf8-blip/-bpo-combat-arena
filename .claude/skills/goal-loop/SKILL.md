---
name: goal-loop
description: >
  For multi-deliverable work with an objective completion condition (e.g. "all 6 files exist, none empty,
  ≥6 real competitors, ≥25 drafts"). Parallelize independent work across sub-agents, keep working turn
  after turn until the written bar is met, then verify as a hostile critic. Auto-apply when a task has
  several independent parts or a countable done-condition.
---

# Goal-loop — parallelize to an objective bar, then judge hostilely

Stop being the bottleneck. Don't hand back partial work; drive to the written condition.

## Steps
1. **Write the bar first** — an objective, countable Definition of Done ("N files, none empty, ≥X real
   sources, no TODOs"). If the user gave a vague goal, restate it as a measurable condition and proceed.
2. **Fan out.** Anything independent runs in parallel via sub-agents. Each sub-agent gets:
   - its own clean context, **one** deliverable, and a rule to **not overwrite another agent's files**
     (use worktree isolation if they mutate shared files).
   Launch them in a single batch when possible so they run concurrently.
3. **Synthesize** the results into the deliverables.
4. **Hostile-critic pass (worker ≠ judge).** Re-open every artifact and grade it against the written bar
   as an adversary, not as the agent who made it: is each file present, non-empty, specific (not generic),
   and does it clear the count/quality threshold? Fix anything thin before declaring done.
5. **Loop** until the bar is met — keep going across turns; don't stop at "good enough."

## Composes with
- Start from a `council` GREEN verdict when the goal itself is a risky bet.
- End by routing the result through `ship-and-verify` (DoD + release gate) before reporting "done."
- If the session gets long mid-loop, drop a `session-handoff` so the loop survives a context reset.

## Don't
- Don't declare done by vibe or by trusting the sub-agents' own "done."
- Don't let sub-agents write to the same file in parallel.
- Don't fabricate to hit a count — a real "found only 4" beats a padded 6.
