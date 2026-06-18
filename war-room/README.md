# OMNI-PERFORM War Room

The Chief of Staff org that drives OMNI-PERFORM toward: **lowest cost · highest quality ·
Egyptians hired**.

## The org (`.claude/agents/`)
- `chief-of-staff` — orchestrator. Runs daily 12:00 Cairo, delegates, writes the brief.
- `cost-engineer` 🦊 — EGP per interview minute.
- `quality-engineer` 🏆 — best trainer in market.
- `hiring-strategist` 🎯 — Egyptians hired (north star).
- `growth-marketer` 📈 — MRR.
- `reliability-sentinel` 🛡️ — uptime & safety.

## Files here
- `STATE.md` — rolling memory (read/updated every run).
- `AUTONOMY` — one word: `STAGED` (default — irreversible actions need your GO) or `FULL`
  (Chief of Staff also executes deploys/spend/outreach itself, still logged).
- `briefs/YYYY-MM-DD.md` — the daily war-room brief.

## How to run it
- **Automatically:** the scheduled routine fires at 12:00 Africa/Cairo (manage via `/schedule`).
- **Manually, anytime:** in Claude Code ask — "run the war room" — or invoke the
  `chief-of-staff` agent. It will delegate to the 5 specialists and produce today's brief.
- **Go full autonomy:** change the contents of `AUTONOMY` to `FULL`. Revert to `STAGED` to require approvals.

## The rule that keeps it safe
Reversible work (research, drafts, branch commits, build-checks) happens autonomously.
Irreversible work (push-to-prod deploy, spending, changing prices, emailing real users/employers,
rotating live secrets) is staged in the brief as **⏳ NEEDS YOUR GO** unless `AUTONOMY` = `FULL`.
Everything obeys the `ship-and-verify` skill: "done" = verified live.
