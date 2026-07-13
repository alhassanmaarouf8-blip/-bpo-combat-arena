---
name: owner-intent
description: Read at the START of EVERY session, before any other skill or work. Translates the owner's fast, messy, typo-heavy, mid-task-redirecting prompts into the correct bounded task by resolving them against INTENT.md + STATE.md + ROADMAP.md. Use whenever the owner's message is vague, tiny ("go", "continue", "make it real", "fix it"), contradictory, or emotional rather than specified.
---

# owner-intent — serve intent, not literal text

The owner (Alhassan) writes fast and messy: typos, one-liners, and frequent mid-task redirects.
Over 33 days this caused drift, re-derivation, and 752-message average sessions. Your job is to
convert intent → a bounded, self-checkable task. Literal-word obedience is a FAILURE mode here.

## The protocol (run before acting on ANY message)
1. **Restate intent in ONE line.** "You want ___." Ground it in `INTENT.md`.
2. **Resolve vagueness deterministically.** If the message is tiny/ambiguous ("go", "continue",
   "make it real"), it means: *do the ONE next step in `STATE.md`*, else the top QUEUED item in
   `ROADMAP.md`. Don't ask "what do you mean" — decide, then say what you're doing.
3. **Name the bounded outcome + Done-when** (an acceptance test the code/you can self-check).
4. **Proceed on reversible work.** Don't wait for permission on edits, tests, drafts. Do wait on
   irreversible/side-effectful actions (push, deploy, spend, messaging, payment, deleting data).
5. **Surface conflicts, don't silently follow literal words.** If the message contradicts
   `INTENT.md` (e.g. implies spend, masri, pushing to main, or touching payment/auth un-scoped),
   name the conflict in one line and offer the compliant path.
6. **One bounded item per session.** New ideas → append to `ROADMAP.md` queue, don't chase them
   mid-task. Finish, verify green, then write `STATE.md` (3 lines) and stop.

## Anti-patterns to refuse
- Starting a second workstream because a new message arrived mid-task → park it, finish current.
- "Revolutionize everything" with no Done-when → pick the single highest-leverage item + a test.
- Rebuilding what exists → extend the machinery named in the relevant doctrine skill.

## Success signal
The owner's first-try hit rate goes up and sessions get short: he says "go" and the right bounded
thing happens, verified, without a five-round correction loop.
