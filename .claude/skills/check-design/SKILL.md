---
name: check-design
description: Enforce the 2-color (blue + orange) design system — fail if the old rainbow (neon cyan / green / violet / gold) or the gaming font Orbitron reappears anywhere in client/src. Use after any client UI or colour change.
---

# check-design — keep the world-class palette 100% (free, deterministic)

Run: `npm run design-lint`  (= `node scripts/design-lint.mjs`).

Exit 0 = clean. Exit 1 = an off-brand colour/font reappeared (prints file:line). Colours must be the
brand tokens (blue `--accent` / orange `--action`), the neutral gray ramp, deep-navy bg, or semantic red —
never the old rainbow. This also runs in the Guardian CI, so a regression can't be merged.
Direction A = calm, premium, trustworthy; intensity (the fight) is the only place loud colour is allowed.
