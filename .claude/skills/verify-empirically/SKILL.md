---
name: verify-empirically
description: Before depending on ANY external claim — an API parameter, a library behavior, a config flag, a file:line from a subagent, a "the docs say" — prove it with the smallest real test FIRST. Agent output, documentation, memory, and your own assumptions are leads, not facts. Use before building on or shipping anything whose truth you have not personally observed.
---

# verify-empirically — test the real thing before you trust it

A senior engineer's reflex: **claims are hypotheses; only observation is proof.** This skill exists because trusting a plausible claim shipped a bug that would have broken core functionality.

## The rule
Before you build on, or ship, anything that rests on an unverified claim, run the **smallest possible real test** that would FALSIFY it. If you can't observe it, you don't know it.

## What counts as an unverified claim (treat ALL as "prove it")
- "The API supports parameter X" / "the docs say…" → make one real call with and without X, compare status/output.
- A subagent's `file:line` or "this returns null / this is dead code" → open the file and read those exact lines; grep for real usage.
- "This function/flag does Y" → call it with a real input and check the output (today's filler regex: `node` one-liner with German text caught a `\b`-vs-`ä` bug).
- A memory or past note naming a file/flag/value → confirm it still exists before recommending it.
- "Removing this is safe / it's unused" → grep the whole tree for usage first.

## How (cheap tests, in order of preference)
1. **Isolated probe** — one curl / one `node -e` / one `node --check` that exercises ONLY the claim. Compare the control (without) vs the change (with).
2. **Read the source** — the actual lines, not a summary of them.
3. **Run the gate** — lint / type-check / unit test / build on the real change.
4. **Observe in prod** where the user observes (deploy stamp, `/health`, a screenshot) — see `ship`.

## Watch-outs (real ones hit today)
- Encoding/quoting can make a test fail for the WRONG reason (a 400 from mangled UTF-8 looked like "param rejected" — it wasn't). Isolate one variable at a time; re-test with a clean input before concluding.
- A control test ("does it work at all without my change?") disambiguates "my claim is false" from "my whole setup is broken."
- Don't print secrets while testing with real keys; using a key for a tiny real call is normal usage, not a cost.

## Output
State what you tested, the observed result, and the conclusion — e.g. "Aura-2 `?speed=` → 400 vs 200 without it → param unsupported → dropped it." A claim you verified is now a fact you can build on; one you couldn't verify must be flagged, not assumed. Pairs with [[supervisor]] and `ship`.
