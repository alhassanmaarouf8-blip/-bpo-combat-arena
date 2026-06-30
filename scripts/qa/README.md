# QA superpowers (dev-only, free, never shipped to the app)

Tools that give the assistant real perception of the app. Open-source, zero cost.

**First-time setup** (once): `cd scripts/qa && npm i && npx playwright install chromium`

- **Eyes** — `node scripts/qa/screenshot.mjs [url] [--signup]` → PNGs of landing + (with `--signup`) the logged-in home; read the PNGs to *see* it. (skill: `see-app`)
- **Ears** — `node scripts/qa/voice-check.mjs ["line"]` → intelligibility + speech-rate + saved WAVs. (skill: `hear-voice`)

Sibling deterministic gates (no browser, run from repo root):
- `npm run design-lint` — 2-color system enforcement. (skill: `check-design`)
- `node scripts/german-check.mjs` — German correctness. (skill: `check-german`)

`node_modules/` here is gitignored; `npm i` restores it.
