---
name: launch-ops
description: "The distribution/launch playbook for OMNI-PERFORM — payment link (PAYMENT_URL/Paddle), Search Console verification, legal pages, the OWNER-AR masri sheet round-trip, and deploy-verify nuances. TRIGGER: launch, distribution, payments, PAYMENT_URL, Paddle, Lemon Squeezy, webhook, Search Console, sitemap, legal pages, refund policy, masri sheet, owner-ar."
---

# launch-ops — distribution & launch playbook

Since 2026-07-04 the strategic focus is **distribution + first verified hires**, not more
product (owner-ratified trajectory audit). Product building belongs to the nightly fleet;
local sessions support the owner's go-to-market actions. This file is the map.

## State (2026-07-04, commit `945c340`)

- **Legal pages LIVE:** `client/public/{terms,privacy,refund}.html`, linked from the landing's
  quiet footer (AGB · Datenschutz · Rückerstattung) + sitemap.xml. English (payment-provider
  review audience). Claims are as-built — if processors/auth change, update privacy.html in the
  same ship. **refund.html is a session-authored DRAFT (14-day first purchase / 7-day unused
  renewal / tech-failure refunds) pending explicit owner approval — treat its terms as changeable
  on his word only.**
- **Masri sheet:** `node scripts/owner-ar-sheet.mjs` → regenerates `docs/owner-ar-sheet.md`
  (45 slots/11 files at v1). Idempotent — rerun after landing strings to see what's left.
- **Payments:** manual Vodafone Cash (`server/payments.js`, verify-first) + optional
  `PAYMENT_URL` env on Render (hosted checkout link; pricing page picks it up). Webhook
  auto-fulfillment is **ROADMAP 11b (QUEUED)** — read that item before building it.
- **SEO surface:** `client/public/{robots.txt,sitemap.xml,og.png}` live; `<noscript>` hero in
  index.html. Search Console NOT yet verified (owner step below).

## Owner-blocked steps and how a session supports each

1. **Search Console:** owner adds URL-prefix property for `https://bpo-combat-arena.vercel.app`,
   chooses HTML-tag verification, pastes the `google-site-verification` meta tag into chat →
   session ships it in `client/index.html` `<head>` → verify live (`curl | grep
   google-site-verification`) → owner clicks Verify → submits `sitemap.xml`.
2. **Payment link:** owner signs up (Paddle recommended — Payoneer payout works from Egypt;
   fallback Lemon Squeezy/Gumroad), creates products matching `server/plans.config.js` EXACTLY
   (Basic 1299/12990 EGP, Elite 2999/29990 EGP), sets `PAYMENT_URL` on Render. Session verifies:
   pricing page shows the checkout path (incognito). Then build ROADMAP 11b so fulfillment
   stops being manual.
3. **Masri sheet round-trip:** owner fills the عربي column (`-` = keep German). Session lands
   the strings at the file:line rows, runs langGuard-sensitive tests + german-check is N/A for
   Arabic but `node --test server/*.test.mjs` catches script-drift (langGuard), ships, reruns
   the generator to prove the sheet shrank. Bank/data rows (fluencyDrill chunk bank, satzbau
   cue_de seeds, drillIntros map) need per-item expansion with the owner — the sheet only points
   at them.

## Gotchas (hard-won, don't rediscover)

- **Render deploys are path-filtered:** the backend `/health` `build` stamp only advances on
  commits touching `server/` (observed: two consecutive client/docs-only commits, `9d093e0` and
  `945c340`, produced NO backend redeploy; uptime kept growing). For client-only ships, verify
  the FRONTEND meta build + Guardian and don't burn 10 minutes polling Render — note "backend
  stamp unchanged by design" instead. Backend-touching ships still require the stamp match.
- **Shared tree:** other sessions edit live (check `git status` + `find -newermt '45 minutes
  ago'` first). Stage files BY NAME — never `git add -A`/`-u`. Repo-wide `npm run lint` may be
  red from OTHER sessions' untracked scratch files; lint your changed files explicitly and say so
  in the commit message.
- **Marketing copy:** the no-masri rule covers learner-facing product content; give the owner
  post SKELETONS (hook = "employers re-test live, we ARE the re-test"; gift = free assessment)
  and let him voice them. NEVER: employer names, salary figures, "X hired" counts
  (do-not-publish list in [[omni-perform-competitive-audit]] memory).
- **Legal pages are static `client/public/*.html`** — not React, not design-linted; keep them
  self-contained (inline CSS, dark navy + orange links) and update `lastmod` in sitemap.xml when
  they change.

## Verification bar for launch-ops changes

Frontend: `curl -s https://bpo-combat-arena.vercel.app | grep 'meta name="build"'` == HEAD sha;
legal pages `curl -o /dev/null -w '%{http_code}'` == 200 each; screenshot via
`scripts/qa/screenshot.mjs` (run it from a scratch dir — PNGs land in CWD) when the landing
changed. Guardian green via the public Actions API. Backend stamp: only for server-touching
ships (see gotcha).
