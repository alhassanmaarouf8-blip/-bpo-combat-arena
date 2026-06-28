---
name: ship-and-verify
description: >
  Use for ANY change, fix, or feature in OMNI-PERFORM (bpo-combat-arena) that the user will
  test or that needs to go live. Encodes the deploy-and-verify discipline learned the hard way:
  the user tests on the LIVE site, so "done" means deployed AND verified on prod — not just
  written to disk. Apply whenever editing server/, client/, or the admin panel, or whenever
  the user says "test", "fix", "make it work", or reports something "still broken."
---

# Ship & Verify — do it right the first time (OMNI-PERFORM / bpo-combat-arena)

The #1 lesson from a long debugging run: **most "it's still broken" reports were not code bugs —
they were "built but not deployed" or "deployed but not verified live."** Follow this every time.

## Architecture facts (don't re-discover these)
- **Repo:** `C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena`, branch `main`, GitHub remote. Push = deploy.
- **Server** (`server/`, Node + WebSocket) → deploys on **Render** automatically on `git push origin main`.
  Live: `https://bpo-combat-arena.onrender.com`. Prod uses Postgres when `DATABASE_URL` is set; local dev uses JSON files / in-memory (payments are in-memory locally → reset on restart).
- **Client** (`client/`, Vite/React) → deploys on **Vercel** automatically on the same push (no `vercel.json`
  in the repo, but the GitHub hookup works — verified: pushed client strings appear in the live bundle).
  Live: `https://bpo-combat-arena.vercel.app`.
- **Admin panel** HTML is served BY the server (`server/admin.js`), so admin-panel changes deploy via **Render**, not Vercel.
- Render free tier sleeps (~15 min idle) → first request can take ~50s (the app has a ColdStartScreen for this).

## THE GOLDEN RULE
**If the user is going to test it, it must be DEPLOYED first.** The user tests on the live URLs.
"Stop for testing" only makes sense for LOCAL testing — and then you must say so explicitly and give
the local run steps. Never tell the user to "test X" when X is only on disk. When in doubt: push, verify, then hand off.

## THE RELEASE GATE — human-gate anything you cannot verify yourself  ⟵ hard rule
Push-to-main is a **release to real clients**, not a save. So:
- If you can verify it with real tools (HTTP probe, grep the bundle, run the script, drive the UI), the
  Golden Rule applies: push → verify live → report.
- If you **cannot** verify it yourself — **audio quality, on-device feel, voice naturalness, anything
  subjective** — it does NOT go to prod on your say-so. Build it on a **branch** or behind a **flag/env
  toggle** (e.g. `USE_ELEVENLABS=1`), tell the user plainly "I can't verify this from here," and ship to
  prod only after they validate OR explicitly say "ship blind." Make the unverifiable a loud gate, never a footnote.
- Real precedent: a band-pass voice filter was shipped to prod unheard → "extremely robotic" → revert + lost time.
  The fix was to stage it for a device listen first. Default to that.

## Before every push — build-check
- Server JS: `node --check server/<file>.js`, then resolve imports: `node -e "import('./server/<file>.js').then(()=>console.log('ok')).catch(e=>{console.error(e.message);process.exit(1)})"`
- Client JSX (esbuild is in `client/node_modules`): `node ./node_modules/esbuild/bin/esbuild src/<File>.jsx --loader:.jsx=jsx >/dev/null` (expect exit 0).
  - Multiple files at once need `--outdir`; a single file to stdout is fine.
- For a core-engine change (websocketManager/server.js), boot the local server once to confirm it starts (see Local run).

## Cross-cutting changes deploy server + client TOGETHER
If you add a new WS message type, API field, or contract consumed by BOTH sides, commit BOTH in ONE push.
New-server + old-client (or vice versa) = a broken skew window (e.g. server emits `NO_SESSION`, old client
shows a stuck spinner). One push minimizes the window; mention the brief skew if relevant.

## After every push — VERIFY THE DEPLOY LANDED (never assume)
1. **Server (Render):** `curl -s https://bpo-combat-arena.onrender.com/health` → low `uptime` = redeployed.
2. **Client (Vercel):** fetch live HTML → find the hashed bundle → grep it for a STRING you added:
   ```bash
   curl -s https://bpo-combat-arena.vercel.app/ -o h.html
   B=$(grep -oE '/assets/[A-Za-z0-9_.-]+\.js' h.html | head -1)
   curl -s "https://bpo-combat-arena.vercel.app$B" | grep -F "<a user-facing string you just added>"
   ```
   - Grep for **string literals / UI copy** you added — they survive minification. Do NOT grep for variable
     or function names (`realismProfiles`, etc.) — the minifier renames them and you'll get a false "missing."
3. **Tell the user to HARD-REFRESH** (Ctrl/Cmd+Shift+R). The browser caches the old JS bundle — the single
   most common "you deployed but I see no change."

## Verify BEHAVIOR on prod, then clean up
- Exercise the real flow with a throwaway account on prod (signup → activate via admin → hit the endpoint).
- Clean up test accounts via `/admin/delete-account` — but the **`ADMIN_KEY` may have been rotated**; if cleanup
  returns `forbidden`, that's why. Don't leave noise; if you can't delete, say so.

## Env / dashboard items you CANNOT do from code — always flag these to the user
- `OAI_MODEL` (e.g. `gpt-realtime-2`), `VODAFONE_CASH_NUMBER` (no value → users literally cannot pay),
  `ADMIN_KEY` (rotate if exposed), `DATABASE_URL`. Code defaults exist but env overrides them on Render.
- Secrets: never hardcode. `.env` is gitignored (`.gitignore` blocks `.env*`). Confirm with `git ls-files`.

## Windows / Git-Bash gotchas in this environment
- Node maps `/tmp` to `C:\tmp` (doesn't exist) → `writeFileSync('/tmp/..')` throws. Write temp files into the
  project dir, or use bash redirection (`curl ... -o /tmp/x` on the bash side is fine; node paths are not).
- Kill the local server by port: PowerShell `(Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess` → `Stop-Process -Id <pid> -Force`.
- Local run: `cd server && ADMIN_KEY=testkey123 node server.js` (background), then `curl localhost:3001/health`.
- Local `server/data/accounts.json` can be `null` (corrupt) → breaks auth on signup; reset to `{ "accounts":{}, "emailIndex":{} }` for local testing (it's gitignored test data).

## Reporting discipline
State exactly one of: **written** (on disk, not built) / **built** (compiles) / **deployed** (pushed) /
**verified live** (probed prod + behavior). Only say "done"/"live"/"fixed" after **verified live**.
If a fix depends on the user's env or a hard-refresh, say that in the same breath — don't let them discover it by re-reporting the bug.
