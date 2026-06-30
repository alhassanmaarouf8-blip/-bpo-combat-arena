---
name: ship
description: The verified ship loop for OMNI-PERFORM — run every gate, commit, push to main (= deploy), and confirm the Guardian went green. Use whenever shipping any change to this repo.
---

# ship — verified deploy loop (the one run dozens of times; now one skill)

1. **Verify locally — ALL must pass** (don't push otherwise):
   - `npm run lint`
   - `npm run design-lint`
   - `node --test server/brain/*.test.mjs`
   - `(cd client && npm run build)`
   - if server German changed: `node scripts/german-check.mjs <changed files>`
2. **Commit + deploy:** clear message ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, then `git push origin main` (Render + Vercel auto-deploy on push).
3. **Confirm the Guardian is green** (the repo is PUBLIC, so the Actions API needs no auth):
   `curl -s "https://api.github.com/repos/alhassanmaarouf8-blip/-bpo-combat-arena/actions/runs?per_page=4&branch=main"` →
   parse JSON **with UTF-8** (commit messages contain emoji) → find the `Guardian` run on your HEAD sha → wait until `conclusion=success`.
   If red: the free auto-fixer (GitHub Models) may repair it; otherwise fix the cause.

## Hard guardrails (never violate)
Zero paid services / no money ever · never name a company/employer/account · no fabricated metrics ·
never ship fake Egyptian-Arabic masri (leave owner slots) · verify-by-proof · one bounded change per ship.
Behavioral/audio/visual changes are owner-gated — verify what you can (`see-app`, `hear-voice`) and flag the rest.
