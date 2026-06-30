---
name: see-app
description: Take real screenshots of the OMNI-PERFORM app (mobile + desktop; landing and the logged-in home) and view them, so UI/design/layout work is grounded in actual pixels instead of guesses. Use when verifying a visual change, judging "how does it look", or capturing before/after.
---

# see-app — give yourself eyes (free, Playwright)

The app can be SEEN, not just reasoned about. Steps:

1. **First run only** (one-time, free): `cd scripts/qa && npm i && npx playwright install chromium`
2. **Capture:** `node scripts/qa/screenshot.mjs [url] [--signup]`
   - default url = `https://bpo-combat-arena.vercel.app`; pass a localhost url to shoot a local build.
   - `--signup` also creates a throwaway account and captures the **logged-in home** (`home-mobile.png`).
   - Produces `landing-mobile.png`, `landing-desktop.png`, and (with --signup) `home-mobile.png`, plus a console/page-error count.
3. **Look:** Read each generated `.png` with the Read tool to actually see it.

**Before/after:** screenshot → make the change → push → wait for the Vercel deploy → screenshot again → compare. Captures real visual diffs (and any browser console errors). Honest limit: this shows layout/colour/hierarchy; subjective taste still benefits from the owner's eye.
